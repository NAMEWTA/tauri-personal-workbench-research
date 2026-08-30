package backup

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/personal-workbench/workbenchd/internal/platform"
	modernsqlite "modernc.org/sqlite"
)

type Run struct {
	ID         string     `json:"id"`
	State      string     `json:"state"`
	Path       string     `json:"path"`
	Size       int64      `json:"size"`
	StartedAt  time.Time  `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt"`
	Error      string     `json:"error"`
}

type manifestFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}
type manifest struct {
	FormatVersion  int            `json:"formatVersion"`
	WorkspaceID    string         `json:"workspaceId"`
	SchemaVersion  int            `json:"schemaVersion"`
	AppVersion     string         `json:"appVersion"`
	ServiceVersion string         `json:"serviceVersion"`
	CreatedAt      time.Time      `json:"createdAt"`
	Files          []manifestFile `json:"files"`
}

type Manager struct {
	db        *sql.DB
	workspace string
	mu        sync.Mutex
}

func New(db *sql.DB, workspace string) *Manager {
	_ = os.Remove(filepath.Join(workspace, ".operation-active"))
	return &Manager{db: db, workspace: workspace}
}

func (m *Manager) DB() *sql.DB { return m.db }

func (m *Manager) List(ctx context.Context) ([]Run, error) {
	rows, err := m.db.QueryContext(ctx, `SELECT id,state,path,byte_size,started_at,finished_at,error FROM backup_runs ORDER BY started_at DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	items := make([]Run, 0)
	for rows.Next() {
		var item Run
		var started string
		var finished sql.NullString
		if err := rows.Scan(&item.ID, &item.State, &item.Path, &item.Size, &started, &finished, &item.Error); err != nil {
			return nil, err
		}
		item.StartedAt, err = time.Parse(time.RFC3339Nano, started)
		if err != nil {
			return nil, err
		}
		if finished.Valid {
			value, parseErr := time.Parse(time.RFC3339Nano, finished.String)
			if parseErr != nil {
				return nil, parseErr
			}
			item.FinishedAt = &value
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (m *Manager) NeedsAutomaticBackup(ctx context.Context, now time.Time) (bool, error) {
	var latest sql.NullString
	if err := m.db.QueryRowContext(ctx, `SELECT max(finished_at) FROM backup_runs WHERE state='succeeded'`).Scan(&latest); err != nil {
		return false, err
	}
	if !latest.Valid {
		return true, nil
	}
	finished, err := time.Parse(time.RFC3339Nano, latest.String)
	if err != nil {
		return false, err
	}
	return now.UTC().Sub(finished) >= 24*time.Hour, nil
}

func (m *Manager) Create(ctx context.Context, destination string, progress func(int, string)) (run Run, finalErr error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.markOperation("backup"); err != nil {
		return run, err
	}
	defer m.clearOperation()
	run = Run{ID: platform.NewID(), State: "running", StartedAt: platform.Now()}
	if _, err := m.db.ExecContext(ctx, `INSERT INTO backup_runs(id,state,started_at) VALUES(?,?,?)`, run.ID, run.State, platform.TimeText(run.StartedAt)); err != nil {
		return run, err
	}
	defer func() {
		finished := platform.Now()
		run.FinishedAt = &finished
		if finalErr != nil {
			run.State = "failed"
			run.Error = "备份未能完成"
		} else {
			run.State = "succeeded"
		}
		_, _ = m.db.ExecContext(context.Background(), `UPDATE backup_runs SET state=?,path=?,byte_size=?,finished_at=?,error=? WHERE id=?`, run.State, run.Path, run.Size, platform.TimeText(finished), run.Error, run.ID)
		if finalErr == nil {
			m.pruneSuccessful(context.Background(), destination, 10)
		}
	}()
	if destination == "" {
		destination = filepath.Join(m.workspace, "backups")
	}
	destination, finalErr = filepath.Abs(destination)
	if finalErr != nil {
		return run, finalErr
	}
	if finalErr = os.MkdirAll(destination, 0o700); finalErr != nil {
		return run, finalErr
	}
	temporary, err := os.MkdirTemp(filepath.Join(m.workspace, "backups"), ".backup-")
	if err != nil {
		return run, err
	}
	defer func() { _ = os.RemoveAll(temporary) }()
	progress(10, "database")
	databasePath := filepath.Join(temporary, "database.sqlite3")
	if err = m.onlineBackup(ctx, databasePath); err != nil {
		return run, err
	}
	progress(35, "manifest")
	files := []manifestFile{}
	databaseInfo, err := fileDigest(databasePath, "database.sqlite3")
	if err != nil {
		return run, err
	}
	files = append(files, databaseInfo)
	snapshotDB, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return run, err
	}
	attachmentRows, err := snapshotDB.QueryContext(ctx, `SELECT relative_path,byte_size,sha256 FROM attachments WHERE deleted_at IS NULL ORDER BY relative_path`)
	if err != nil {
		_ = snapshotDB.Close()
		return run, err
	}
	attachmentRoot, err := filepath.EvalSymlinks(filepath.Join(m.workspace, "attachments"))
	if err != nil {
		_ = attachmentRows.Close()
		_ = snapshotDB.Close()
		return run, err
	}
	for attachmentRows.Next() {
		if err := ctx.Err(); err != nil {
			_ = attachmentRows.Close()
			_ = snapshotDB.Close()
			return run, err
		}
		var relative, expectedHash string
		var expectedSize int64
		if err := attachmentRows.Scan(&relative, &expectedSize, &expectedHash); err != nil {
			_ = attachmentRows.Close()
			_ = snapshotDB.Close()
			return run, err
		}
		local := filepath.FromSlash(relative)
		if !filepath.IsLocal(local) || !strings.HasPrefix(filepath.ToSlash(local), "attachments/") {
			_ = attachmentRows.Close()
			_ = snapshotDB.Close()
			return run, fmt.Errorf("managed attachment path is unsafe")
		}
		target, err := filepath.EvalSymlinks(filepath.Join(m.workspace, local))
		if err != nil {
			_ = attachmentRows.Close()
			_ = snapshotDB.Close()
			return run, err
		}
		relativeToRoot, err := filepath.Rel(attachmentRoot, target)
		if err != nil || !filepath.IsLocal(relativeToRoot) {
			_ = attachmentRows.Close()
			_ = snapshotDB.Close()
			return run, fmt.Errorf("managed attachment escaped workspace")
		}
		info, err := fileDigest(target, filepath.ToSlash(local))
		if err != nil || info.Size != expectedSize || info.SHA256 != expectedHash {
			_ = attachmentRows.Close()
			_ = snapshotDB.Close()
			return run, fmt.Errorf("managed attachment checksum mismatch")
		}
		files = append(files, info)
	}
	if err := attachmentRows.Err(); err != nil {
		_ = attachmentRows.Close()
		_ = snapshotDB.Close()
		return run, err
	}
	if err := attachmentRows.Close(); err != nil {
		_ = snapshotDB.Close()
		return run, err
	}
	if err := snapshotDB.Close(); err != nil {
		return run, err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	var workspaceID, appVersion string
	var schemaVersion int
	if err := m.db.QueryRowContext(ctx, `SELECT id,schema_version,app_version FROM workspace_meta LIMIT 1`).Scan(&workspaceID, &schemaVersion, &appVersion); err != nil {
		return run, err
	}
	document := manifest{FormatVersion: 2, WorkspaceID: workspaceID, SchemaVersion: schemaVersion, AppVersion: appVersion, ServiceVersion: appVersion, CreatedAt: platform.Now(), Files: files}
	manifestPath := filepath.Join(temporary, "manifest.json")
	raw, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return run, err
	}
	if err = os.WriteFile(manifestPath, raw, 0o600); err != nil {
		return run, err
	}
	name := fmt.Sprintf("workbench-backup-%s-%s.zip", run.StartedAt.Format("20060102-150405"), run.ID)
	tempZip := filepath.Join(destination, "."+name+".tmp")
	finalZip := filepath.Join(destination, name)
	defer func() { _ = os.Remove(tempZip) }()
	progress(55, "archive")
	if err = writeZip(ctx, tempZip, m.workspace, databasePath, manifestPath, files); err != nil {
		return run, err
	}
	progress(85, "verify")
	if err = verifyZip(tempZip, document); err != nil {
		return run, err
	}
	if err = os.Rename(tempZip, finalZip); err != nil {
		return run, err
	}
	stat, err := os.Stat(finalZip)
	if err != nil {
		return run, err
	}
	run.Path = finalZip
	run.Size = stat.Size()
	progress(100, "complete")
	return run, nil
}

func (m *Manager) markOperation(kind string) error {
	return os.WriteFile(filepath.Join(m.workspace, ".operation-active"), []byte(kind+"\n"), 0o600)
}

func (m *Manager) clearOperation() { _ = os.Remove(filepath.Join(m.workspace, ".operation-active")) }

func (m *Manager) pruneSuccessful(ctx context.Context, destination string, keep int) {
	if keep < 1 {
		return
	}
	destination, err := filepath.Abs(destination)
	if err != nil {
		return
	}
	rows, err := m.db.QueryContext(ctx, `SELECT id,path FROM backup_runs WHERE state='succeeded' AND path<>'' ORDER BY julianday(finished_at) DESC,rowid DESC`)
	if err != nil {
		return
	}
	defer func() { _ = rows.Close() }()
	type candidate struct{ id, path string }
	items := []candidate{}
	for rows.Next() {
		var item candidate
		if rows.Scan(&item.id, &item.path) == nil {
			items = append(items, item)
		}
	}
	retained := 0
	for _, item := range items {
		absolute, err := filepath.Abs(item.path)
		name := filepath.Base(absolute)
		if err != nil || !sameDirectory(filepath.Dir(absolute), destination) || !strings.HasPrefix(name, "workbench-backup-") || !strings.HasSuffix(name, ".zip") {
			continue
		}
		retained++
		if retained <= keep {
			continue
		}
		if err := os.Remove(absolute); err == nil || os.IsNotExist(err) {
			_, _ = m.db.ExecContext(ctx, `DELETE FROM backup_runs WHERE id=?`, item.id)
		}
	}
}

func sameDirectory(first, second string) bool {
	return strings.EqualFold(filepath.Clean(first), filepath.Clean(second))
}

type backuper interface {
	NewBackup(string) (*modernsqlite.Backup, error)
}

func (m *Manager) onlineBackup(ctx context.Context, destination string) error {
	connection, err := m.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = connection.Close() }()
	return connection.Raw(func(driverConnection any) error {
		backup, err := driverConnection.(backuper).NewBackup(destination)
		if err != nil {
			return err
		}
		for more := true; more; {
			if err := ctx.Err(); err != nil {
				_ = backup.Finish()
				return err
			}
			more, err = backup.Step(128)
			if err != nil {
				_ = backup.Finish()
				return err
			}
		}
		return backup.Finish()
	})
}

func fileDigest(path, archivePath string) (manifestFile, error) {
	file, err := os.Open(path)
	if err != nil {
		return manifestFile{}, err
	}
	defer func() { _ = file.Close() }()
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return manifestFile{}, err
	}
	return manifestFile{Path: archivePath, Size: size, SHA256: hex.EncodeToString(hash.Sum(nil))}, nil
}
func writeZip(ctx context.Context, target, workspace, databasePath, manifestPath string, files []manifestFile) error {
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	writer := zip.NewWriter(output)
	closeAll := func(operationErr error) error {
		zipErr := writer.Close()
		fileErr := output.Close()
		if operationErr != nil {
			return operationErr
		}
		if zipErr != nil {
			return zipErr
		}
		return fileErr
	}
	entries := append([]manifestFile{{Path: "manifest.json"}}, files...)
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return closeAll(err)
		}
		source := filepath.Join(workspace, filepath.FromSlash(entry.Path))
		switch entry.Path {
		case "database.sqlite3":
			source = databasePath
		case "manifest.json":
			source = manifestPath
		}
		input, err := os.Open(source)
		if err != nil {
			return closeAll(err)
		}
		header := &zip.FileHeader{Name: entry.Path, Method: zip.Deflate}
		header.Modified = time.Unix(0, 0).UTC()
		part, err := writer.CreateHeader(header)
		if err == nil {
			_, err = io.Copy(part, input)
		}
		_ = input.Close()
		if err != nil {
			return closeAll(err)
		}
	}
	return closeAll(nil)
}
func verifyZip(path string, document manifest) error {
	reader, err := zip.OpenReader(path)
	if err != nil {
		return err
	}
	defer func() { _ = reader.Close() }()
	expected := map[string]manifestFile{}
	for _, item := range document.Files {
		expected[item.Path] = item
	}
	for _, item := range reader.File {
		if item.Name == "manifest.json" {
			continue
		}
		wanted, ok := expected[item.Name]
		if !ok {
			return fmt.Errorf("unexpected backup entry")
		}
		if strings.Contains(item.Name, "..") || filepath.IsAbs(item.Name) {
			return fmt.Errorf("unsafe backup entry")
		}
		source, err := item.Open()
		if err != nil {
			return err
		}
		hash := sha256.New()
		size, err := io.Copy(hash, source)
		_ = source.Close()
		if err != nil {
			return err
		}
		if size != wanted.Size || hex.EncodeToString(hash.Sum(nil)) != wanted.SHA256 {
			return fmt.Errorf("backup checksum mismatch")
		}
		delete(expected, item.Name)
	}
	if len(expected) != 0 {
		return fmt.Errorf("backup is incomplete")
	}
	return nil
}
