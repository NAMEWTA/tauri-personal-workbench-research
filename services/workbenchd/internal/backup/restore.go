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
	"path"
	"path/filepath"
	"strings"

	"github.com/personal-workbench/workbenchd/migrations"
	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

const (
	maxRestoreFiles     = 10_000
	maxRestoreBytes     = int64(10 << 30)
	maxManifestSize     = int64(2 << 20)
	maxCompressionRatio = uint64(200)
)

type RestoreReport struct {
	FormatVersion int    `json:"formatVersion"`
	FileCount     int    `json:"fileCount"`
	TotalSize     int64  `json:"totalSize"`
	SchemaVersion int64  `json:"schemaVersion"`
	WorkspaceName string `json:"workspaceName"`
}

type validatedBackup struct {
	document manifest
	report   RestoreReport
}

func (m *Manager) Preflight(ctx context.Context, source string) (RestoreReport, error) {
	validated, err := validateBackup(ctx, source)
	if err != nil {
		return RestoreReport{}, err
	}
	return validated.report, nil
}

func (m *Manager) RestoreToNewWorkspace(ctx context.Context, source, destination string, progress func(int, string)) (finalErr error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.markOperation("restore"); err != nil {
		return err
	}
	defer m.clearOperation()
	validated, err := validateBackup(ctx, source)
	if err != nil {
		return err
	}
	destination, err = filepath.Abs(destination)
	if err != nil || destination == "" {
		return fmt.Errorf("invalid restore destination")
	}
	if samePath(destination, m.workspace) {
		return fmt.Errorf("restore destination must be a new workspace")
	}
	if entries, err := os.ReadDir(destination); err == nil && len(entries) != 0 {
		return fmt.Errorf("restore destination is not empty")
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	parent := filepath.Dir(destination)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return err
	}
	temporary, err := os.MkdirTemp(parent, ".workbench-restore-")
	if err != nil {
		return err
	}
	defer func() {
		if finalErr != nil {
			_ = os.RemoveAll(temporary)
		}
	}()
	progress(10, "validate")
	reader, err := zip.OpenReader(source)
	if err != nil {
		return err
	}
	defer func() { _ = reader.Close() }()
	entries := make(map[string]*zip.File, len(reader.File))
	for _, entry := range reader.File {
		entries[entry.Name] = entry
	}
	for index, wanted := range validated.document.Files {
		if err := ctx.Err(); err != nil {
			return err
		}
		entry := entries[wanted.Path]
		target := filepath.Join(temporary, filepath.FromSlash(wanted.Path))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return err
		}
		if err := extractVerified(entry, target, wanted); err != nil {
			return err
		}
		progress(15+(index+1)*65/len(validated.document.Files), "extract")
	}
	for _, directory := range []string{"attachments", "exports", "logs", "backups"} {
		if err := os.MkdirAll(filepath.Join(temporary, directory), 0o700); err != nil {
			return err
		}
	}
	progress(85, "integrity")
	if _, _, err := inspectDatabase(ctx, filepath.Join(temporary, "database.sqlite3")); err != nil {
		return err
	}
	if err := os.Rename(filepath.Join(temporary, "database.sqlite3"), filepath.Join(temporary, "workbench.sqlite3")); err != nil {
		return err
	}
	if err := os.Remove(destination); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.Rename(temporary, destination); err != nil {
		return err
	}
	progress(100, "complete")
	return nil
}

func validateBackup(ctx context.Context, source string) (validatedBackup, error) {
	reader, err := zip.OpenReader(source)
	if err != nil {
		return validatedBackup{}, fmt.Errorf("open backup: %w", err)
	}
	defer func() { _ = reader.Close() }()
	if len(reader.File) < 2 || len(reader.File) > maxRestoreFiles+1 {
		return validatedBackup{}, fmt.Errorf("backup file count is invalid")
	}
	entries := make(map[string]*zip.File, len(reader.File))
	var total int64
	for _, entry := range reader.File {
		if !safeArchivePath(entry.Name) || !entry.Mode().IsRegular() {
			return validatedBackup{}, fmt.Errorf("unsafe backup entry")
		}
		if _, exists := entries[entry.Name]; exists {
			return validatedBackup{}, fmt.Errorf("duplicate backup entry")
		}
		if entry.UncompressedSize64 > uint64(maxRestoreBytes) || total > maxRestoreBytes-int64(entry.UncompressedSize64) {
			return validatedBackup{}, fmt.Errorf("backup is too large")
		}
		if entry.UncompressedSize64 > 1<<20 && (entry.CompressedSize64 == 0 || entry.UncompressedSize64/entry.CompressedSize64 > maxCompressionRatio) {
			return validatedBackup{}, fmt.Errorf("backup compression ratio is unsafe")
		}
		total += int64(entry.UncompressedSize64)
		entries[entry.Name] = entry
	}
	manifestEntry, ok := entries["manifest.json"]
	if !ok || manifestEntry.UncompressedSize64 > uint64(maxManifestSize) {
		return validatedBackup{}, fmt.Errorf("backup manifest is missing or too large")
	}
	manifestReader, err := manifestEntry.Open()
	if err != nil {
		return validatedBackup{}, err
	}
	var document manifest
	err = json.NewDecoder(io.LimitReader(manifestReader, maxManifestSize+1)).Decode(&document)
	_ = manifestReader.Close()
	if err != nil || (document.FormatVersion != 1 && document.FormatVersion != 2) || len(document.Files) == 0 {
		return validatedBackup{}, fmt.Errorf("backup manifest is invalid")
	}
	if document.FormatVersion == 2 && (document.WorkspaceID == "" || document.SchemaVersion < 1 || document.AppVersion == "" || document.ServiceVersion == "") {
		return validatedBackup{}, fmt.Errorf("backup manifest is invalid")
	}
	if len(document.Files)+1 != len(entries) {
		return validatedBackup{}, fmt.Errorf("backup manifest does not match archive")
	}
	seen := map[string]bool{}
	for _, wanted := range document.Files {
		if !safeArchivePath(wanted.Path) || seen[wanted.Path] || wanted.Path == "manifest.json" {
			return validatedBackup{}, fmt.Errorf("backup manifest path is invalid")
		}
		seen[wanted.Path] = true
		entry, ok := entries[wanted.Path]
		if !ok || int64(entry.UncompressedSize64) != wanted.Size {
			return validatedBackup{}, fmt.Errorf("backup manifest file is missing")
		}
		if err := verifyEntry(ctx, entry, wanted); err != nil {
			return validatedBackup{}, err
		}
	}
	database, ok := entries["database.sqlite3"]
	if !ok {
		return validatedBackup{}, fmt.Errorf("backup database is missing")
	}
	temporary, err := os.CreateTemp("", "workbench-preflight-*.sqlite3")
	if err != nil {
		return validatedBackup{}, err
	}
	temporaryPath := temporary.Name()
	_ = temporary.Close()
	defer func() { _ = os.Remove(temporaryPath) }()
	if err := extractVerified(database, temporaryPath, findManifestFile(document.Files, "database.sqlite3")); err != nil {
		return validatedBackup{}, err
	}
	schema, name, err := inspectDatabase(ctx, temporaryPath)
	if err != nil {
		return validatedBackup{}, err
	}
	if document.SchemaVersion > 0 && schema != int64(document.SchemaVersion) {
		return validatedBackup{}, fmt.Errorf("backup schema metadata does not match database")
	}
	return validatedBackup{document: document, report: RestoreReport{FormatVersion: document.FormatVersion, FileCount: len(document.Files), TotalSize: total, SchemaVersion: schema, WorkspaceName: name}}, nil
}

func inspectDatabase(ctx context.Context, databasePath string) (int64, string, error) {
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return 0, "", err
	}
	defer func() { _ = db.Close() }()
	var integrity string
	if err := db.QueryRowContext(ctx, `PRAGMA integrity_check`).Scan(&integrity); err != nil || integrity != "ok" {
		return 0, "", fmt.Errorf("restored database integrity check failed")
	}
	version, err := goose.GetDBVersionContext(ctx, db)
	if err != nil || version > migrations.CurrentVersion {
		return 0, "", fmt.Errorf("backup schema version is not supported")
	}
	var name string
	if err := db.QueryRowContext(ctx, `SELECT name FROM workspace_meta LIMIT 1`).Scan(&name); err != nil {
		return 0, "", fmt.Errorf("backup workspace metadata is invalid")
	}
	return version, name, nil
}

func verifyEntry(ctx context.Context, entry *zip.File, wanted manifestFile) error {
	reader, err := entry.Open()
	if err != nil {
		return err
	}
	defer func() { _ = reader.Close() }()
	hash := sha256.New()
	written, err := io.Copy(hash, io.LimitReader(reader, wanted.Size+1))
	if err != nil || written != wanted.Size || hex.EncodeToString(hash.Sum(nil)) != wanted.SHA256 {
		return fmt.Errorf("backup checksum mismatch")
	}
	return ctx.Err()
}

func extractVerified(entry *zip.File, target string, wanted manifestFile) error {
	reader, err := entry.Open()
	if err != nil {
		return err
	}
	defer func() { _ = reader.Close() }()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(output, hash), io.LimitReader(reader, wanted.Size+1))
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written != wanted.Size || hex.EncodeToString(hash.Sum(nil)) != wanted.SHA256 {
		return fmt.Errorf("backup checksum mismatch")
	}
	return nil
}

func safeArchivePath(name string) bool {
	return name != "" && !strings.Contains(name, "\\") && !strings.Contains(name, ":") && !strings.HasPrefix(name, "/") && path.Clean(name) == name && name != "." && !strings.HasPrefix(name, "../")
}

func findManifestFile(files []manifestFile, name string) manifestFile {
	for _, file := range files {
		if file.Path == name {
			return file
		}
	}
	return manifestFile{}
}

func samePath(first, second string) bool {
	return strings.EqualFold(filepath.Clean(first), filepath.Clean(second))
}
