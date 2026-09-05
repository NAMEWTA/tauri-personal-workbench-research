package attachment

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"time"

	"github.com/personal-workbench/workbenchd/internal/platform"
)

const maxFileSize int64 = 1 << 30

var ErrNotFound = errors.New("attachment not found")

type Attachment struct {
	ID          string    `json:"id"`
	DisplayName string    `json:"displayName"`
	MediaType   string    `json:"mediaType"`
	Size        int64     `json:"size"`
	SHA256      string    `json:"sha256"`
	CreatedAt   time.Time `json:"createdAt"`
}
type Manager struct {
	db        *sql.DB
	workspace string
}

func New(db *sql.DB, workspace string) *Manager { return &Manager{db: db, workspace: workspace} }

func (m *Manager) List(ctx context.Context, entityID string) ([]Attachment, error) {
	var exists int
	if err := m.db.QueryRowContext(ctx, `SELECT count(*) FROM archive_records WHERE id=? AND deleted_at IS NULL`, entityID).Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return nil, ErrNotFound
	}
	rows, err := m.db.QueryContext(ctx, `SELECT id,display_name,media_type,byte_size,sha256,created_at FROM attachments WHERE entity_type='archive' AND entity_id=? AND deleted_at IS NULL ORDER BY created_at DESC,id`, entityID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	items := make([]Attachment, 0)
	for rows.Next() {
		var item Attachment
		var created string
		if err := rows.Scan(&item.ID, &item.DisplayName, &item.MediaType, &item.Size, &item.SHA256, &created); err != nil {
			return nil, err
		}
		item.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (m *Manager) Import(ctx context.Context, entityID string, paths []string) ([]Attachment, error) {
	return m.ImportWithProgress(ctx, entityID, paths, func(int, string) {})
}

func (m *Manager) ImportWithProgress(ctx context.Context, entityID string, paths []string, progress func(int, string)) ([]Attachment, error) {
	if len(paths) == 0 || len(paths) > 20 {
		return nil, fmt.Errorf("invalid attachment count")
	}
	items := make([]Attachment, 0, len(paths))
	targets := make([]string, 0, len(paths))
	relatives := make([]string, 0, len(paths))
	progress(5, "validating")
	for index, source := range paths {
		if err := ctx.Err(); err != nil {
			cleanupTargets(targets)
			return nil, err
		}
		progress(10+(index*80)/len(paths), "copying")
		item, relative, target, err := m.copyOne(ctx, source)
		if err != nil {
			cleanupTargets(targets)
			return nil, err
		}
		items = append(items, item)
		relatives = append(relatives, relative)
		targets = append(targets, target)
	}
	progress(92, "recording")
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		cleanupTargets(targets)
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM archive_records WHERE id=? AND deleted_at IS NULL`, entityID).Scan(&exists); err != nil {
		cleanupTargets(targets)
		return nil, err
	}
	if exists == 0 {
		cleanupTargets(targets)
		return nil, ErrNotFound
	}
	for index, item := range items {
		if _, err := tx.ExecContext(ctx, `INSERT INTO attachments(id,entity_type,entity_id,display_name,relative_path,media_type,byte_size,sha256,created_at) VALUES(?,'archive',?,?,?,?,?,?,?)`, item.ID, entityID, item.DisplayName, relatives[index], item.MediaType, item.Size, item.SHA256, platform.TimeText(item.CreatedAt)); err != nil {
			cleanupTargets(targets)
			return nil, err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO change_log(id,entity_type,entity_id,action,changed_at) VALUES(?,'archive',?,'attachment_import',?)`, platform.NewID(), entityID, platform.TimeText(platform.Now())); err != nil {
		cleanupTargets(targets)
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		cleanupTargets(targets)
		return nil, err
	}
	progress(100, "complete")
	return items, nil
}

func cleanupTargets(targets []string) {
	for _, target := range targets {
		_ = os.Remove(target)
	}
}
func (m *Manager) copyOne(ctx context.Context, sourcePath string) (Attachment, string, string, error) {
	canonical, err := filepath.EvalSymlinks(sourcePath)
	if err != nil {
		return Attachment{}, "", "", fmt.Errorf("resolve attachment source: %w", err)
	}
	canonical, err = filepath.Abs(canonical)
	if err != nil {
		return Attachment{}, "", "", err
	}
	source, err := os.Open(canonical)
	if err != nil {
		return Attachment{}, "", "", err
	}
	defer func() { _ = source.Close() }()
	stat, err := source.Stat()
	if err != nil {
		return Attachment{}, "", "", err
	}
	if !stat.Mode().IsRegular() || stat.Size() > maxFileSize {
		return Attachment{}, "", "", fmt.Errorf("attachment is not a supported regular file")
	}
	id := platform.NewID()
	now := platform.Now()
	extension := filepath.Ext(stat.Name())
	relative := filepath.Join("attachments", now.Format("2006"), now.Format("01"), id, "payload"+extension)
	target := filepath.Join(m.workspace, relative)
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return Attachment{}, "", "", err
	}
	temporary := target + ".tmp"
	defer func() { _ = os.Remove(temporary) }()
	output, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return Attachment{}, "", "", err
	}
	hash := sha256.New()
	size, copyErr := copyContext(ctx, io.MultiWriter(output, hash), source, maxFileSize)
	syncErr := output.Sync()
	closeErr := output.Close()
	if copyErr != nil {
		return Attachment{}, "", "", copyErr
	}
	if syncErr != nil {
		return Attachment{}, "", "", syncErr
	}
	if closeErr != nil {
		return Attachment{}, "", "", closeErr
	}
	if err := os.Rename(temporary, target); err != nil {
		return Attachment{}, "", "", err
	}
	mediaType := mime.TypeByExtension(extension)
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}
	item := Attachment{ID: id, DisplayName: stat.Name(), MediaType: mediaType, Size: size, SHA256: hex.EncodeToString(hash.Sum(nil)), CreatedAt: now}
	return item, filepath.ToSlash(relative), target, nil
}
func (m *Manager) Delete(ctx context.Context, id string) error {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var entityID string
	if err := tx.QueryRowContext(ctx, `SELECT entity_id FROM attachments WHERE id=? AND deleted_at IS NULL`, id).Scan(&entityID); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	now := platform.Now()
	result, err := tx.ExecContext(ctx, `UPDATE attachments SET deleted_at=? WHERE id=? AND deleted_at IS NULL`, platform.TimeText(now), id)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO change_log(id,entity_type,entity_id,action,changed_at) VALUES(?,'archive',?,'attachment_remove',?)`, platform.NewID(), entityID, platform.TimeText(now)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO trash_entries(id,entity_type,entity_id,title,deleted_at) SELECT ?,'attachment',id,display_name,? FROM attachments WHERE id=?`, platform.NewID(), platform.TimeText(now), id); err != nil {
		return err
	}
	return tx.Commit()
}
func (m *Manager) OpenTarget(ctx context.Context, id string) (string, error) {
	var relative string
	if err := m.db.QueryRowContext(ctx, `SELECT relative_path FROM attachments WHERE id=? AND deleted_at IS NULL`, id).Scan(&relative); errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	} else if err != nil {
		return "", err
	}
	local := filepath.FromSlash(relative)
	if !filepath.IsLocal(local) {
		return "", fmt.Errorf("attachment path is unsafe")
	}
	root, err := filepath.EvalSymlinks(filepath.Join(m.workspace, "attachments"))
	if err != nil {
		return "", err
	}
	target, err := filepath.EvalSymlinks(filepath.Join(m.workspace, local))
	if err != nil {
		return "", err
	}
	relativeToRoot, err := filepath.Rel(root, target)
	if err != nil || !filepath.IsLocal(relativeToRoot) {
		return "", fmt.Errorf("attachment escaped managed directory")
	}
	info, err := os.Stat(target)
	if err != nil || !info.Mode().IsRegular() {
		return "", fmt.Errorf("attachment target is unavailable")
	}
	return target, nil
}
func copyContext(ctx context.Context, destination io.Writer, source io.Reader, maxBytes int64) (int64, error) {
	buffer := make([]byte, 128*1024)
	var written int64
	for {
		if err := ctx.Err(); err != nil {
			return written, err
		}
		count, readErr := source.Read(buffer)
		if count > 0 {
			if maxBytes > 0 && written+int64(count) > maxBytes {
				return written, fmt.Errorf("attachment exceeds maximum size")
			}
			value, writeErr := destination.Write(buffer[:count])
			written += int64(value)
			if writeErr != nil {
				return written, writeErr
			}
			if value != count {
				return written, io.ErrShortWrite
			}
		}
		if readErr == io.EOF {
			return written, nil
		}
		if readErr != nil {
			return written, readErr
		}
	}
}
