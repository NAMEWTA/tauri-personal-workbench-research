package sqlite

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	modernsqlite "modernc.org/sqlite"
)

type onlineBackuper interface {
	NewBackup(string) (*modernsqlite.Backup, error)
}

func (s *Store) createPreMigrationSnapshot(ctx context.Context, schemaVersion int64) (finalPath string, finalErr error) {
	directory := filepath.Join(s.workspace, "backups")
	name := fmt.Sprintf("pre-migration-%s-schema-%d.sqlite3", time.Now().UTC().Format("20060102T150405.000000000Z"), schemaVersion)
	finalPath = filepath.Join(directory, name)
	temporaryPath := finalPath + ".tmp"
	defer func() {
		if finalErr != nil {
			_ = os.Remove(temporaryPath)
		}
	}()
	connection, err := s.db.Conn(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = connection.Close() }()
	if err := connection.Raw(func(driverConnection any) error {
		backuper, ok := driverConnection.(onlineBackuper)
		if !ok {
			return fmt.Errorf("sqlite driver does not support online backup")
		}
		operation, err := backuper.NewBackup(temporaryPath)
		if err != nil {
			return err
		}
		for more := true; more; {
			if err := ctx.Err(); err != nil {
				_ = operation.Finish()
				return err
			}
			more, err = operation.Step(128)
			if err != nil {
				_ = operation.Finish()
				return err
			}
		}
		return operation.Finish()
	}); err != nil {
		return "", fmt.Errorf("create pre-migration snapshot: %w", err)
	}
	file, err := os.OpenFile(temporaryPath, os.O_RDWR, 0)
	if err != nil {
		return "", err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(temporaryPath, finalPath); err != nil {
		return "", err
	}
	return finalPath, nil
}
