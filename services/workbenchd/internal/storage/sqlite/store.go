package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/personal-workbench/workbenchd/internal/platform"
	workspacepkg "github.com/personal-workbench/workbenchd/internal/workspace"
	"github.com/personal-workbench/workbenchd/migrations"
	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

type Store struct {
	db        *sql.DB
	path      string
	workspace string
	lock      *workspacepkg.Lock
}

type scanner interface{ Scan(...any) error }

func Open(ctx context.Context, workspacePath, workspaceName, appVersion string) (*Store, error) {
	if err := os.MkdirAll(workspacePath, 0o700); err != nil {
		return nil, fmt.Errorf("create workspace: %w", err)
	}
	workspaceLock, err := workspacepkg.Acquire(workspacePath)
	if err != nil {
		return nil, fmt.Errorf("open workspace: %w", err)
	}
	closeLock := true
	defer func() {
		if closeLock {
			_ = workspaceLock.Close()
		}
	}()
	for _, directory := range []string{"attachments", "exports", "logs", "backups"} {
		if err := os.MkdirAll(filepath.Join(workspacePath, directory), 0o700); err != nil {
			return nil, fmt.Errorf("create %s: %w", directory, err)
		}
	}
	dbPath := filepath.Join(workspacePath, "workbench.sqlite3")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	store := &Store{db: db, path: dbPath, workspace: workspacePath, lock: workspaceLock}
	if err := store.initialize(ctx, workspaceName, appVersion); err != nil {
		_ = db.Close()
		return nil, err
	}
	closeLock = false
	return store, nil
}

func (s *Store) initialize(ctx context.Context, workspaceName, appVersion string) error {
	for _, statement := range []string{"PRAGMA foreign_keys = ON", "PRAGMA journal_mode = WAL", "PRAGMA synchronous = NORMAL", "PRAGMA busy_timeout = 5000"} {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("sqlite configure: %w", err)
		}
	}
	goose.SetBaseFS(migrations.FS)
	goose.SetLogger(goose.NopLogger())
	if err := goose.SetDialect("sqlite3"); err != nil {
		return fmt.Errorf("migration dialect: %w", err)
	}
	currentVersion, err := goose.GetDBVersionContext(ctx, s.db)
	if err != nil {
		return fmt.Errorf("read migration version: %w", err)
	}
	if currentVersion > migrations.CurrentVersion {
		return fmt.Errorf("workspace schema %d is incompatible with V2 development schema %d", currentVersion, migrations.CurrentVersion)
	}
	if err := goose.UpContext(ctx, s.db, "."); err != nil {
		return fmt.Errorf("migrate workspace: %w", err)
	}
	var check string
	if err := s.db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&check); err != nil || check != "ok" {
		return fmt.Errorf("workspace integrity check failed: %s: %w", check, err)
	}
	return s.seed(ctx, workspaceName, appVersion)
}

func (s *Store) seed(ctx context.Context, workspaceName, appVersion string) error {
	now := platform.Now()
	stamp := platform.TimeText(now)
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO workspace_meta(id,name,schema_version,app_version,created_at,updated_at) VALUES(?,?,?,?,?,?)`, platform.NewID(), workspaceName, migrations.CurrentVersion, appVersion, stamp, stamp); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE workspace_meta SET schema_version=?,app_version=?,updated_at=?`, migrations.CurrentVersion, appVersion, stamp); err != nil {
			return err
		}
		types := [][5]any{
			{"person", "个人", "UserRound", "#3A7B6A", 0},
			{"organization", "企业", "Building2", "#527A9E", 1},
			{"event", "事件", "CalendarDays", "#A96F2D", 2},
		}
		for _, item := range types {
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO archive_types(id,name,icon,color,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, item[0], item[1], item[2], item[3], item[4], stamp, stamp); err != nil {
				return err
			}
		}
		fields := [][10]any{
			{"person-id-number", "person", "idNumber", "证件号码", "text", "身份信息", 0, 1, 0, `[]`},
			{"person-phone", "person", "phone", "联系电话", "text", "联系方式", 0, 0, 1, `[]`},
			{"organization-code", "organization", "creditCode", "统一社会信用代码", "text", "注册信息", 0, 1, 0, `[]`},
			{"organization-contact", "organization", "contact", "联系人", "text", "联系方式", 0, 0, 1, `[]`},
			{"event-location", "event", "location", "地点", "text", "事件信息", 0, 0, 0, `[]`},
			{"event-date", "event", "eventDate", "事件日期", "date", "事件信息", 0, 0, 1, `[]`},
		}
		for _, item := range fields {
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO field_definitions(id,archive_type_id,field_key,label,value_type,group_name,is_required,is_sensitive,sort_order,options_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, item[0], item[1], item[2], item[3], item[4], item[5], item[6], item[7], item[8], item[9], stamp, stamp); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return s.writeWorkspaceDescriptor(ctx)
}

func (s *Store) writeWorkspaceDescriptor(ctx context.Context) error {
	var descriptor struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		SchemaVersion int    `json:"schemaVersion"`
		AppVersion    string `json:"appVersion"`
	}
	if err := s.db.QueryRowContext(ctx, `SELECT id,name,schema_version,app_version FROM workspace_meta LIMIT 1`).Scan(&descriptor.ID, &descriptor.Name, &descriptor.SchemaVersion, &descriptor.AppVersion); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(descriptor, "", "  ")
	if err != nil {
		return err
	}
	target := filepath.Join(s.workspace, "workspace.json")
	temporary := target + ".tmp"
	if err := os.WriteFile(temporary, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, target); err == nil {
		return nil
	}
	backup := target + ".bak"
	_ = os.Remove(backup)
	if err := os.Rename(target, backup); err != nil && !os.IsNotExist(err) {
		_ = os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, target); err != nil {
		_ = os.Rename(backup, target)
		return err
	}
	_ = os.Remove(backup)
	return nil
}

func (s *Store) Close() error {
	_, checkpointErr := s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
	return errors.Join(checkpointErr, s.db.Close(), s.lock.Close())
}

func (s *Store) DBPath() string        { return s.path }
func (s *Store) DB() *sql.DB           { return s.db }
func (s *Store) WorkspacePath() string { return s.workspace }

func (s *Store) WorkspaceMeta(ctx context.Context) (string, int, error) {
	var name string
	var version int
	err := s.db.QueryRowContext(ctx, `SELECT name,schema_version FROM workspace_meta LIMIT 1`).Scan(&name, &version)
	return name, version, err
}

func (s *Store) WorkspaceID(ctx context.Context) (string, error) {
	var id string
	err := s.db.QueryRowContext(ctx, `SELECT id FROM workspace_meta LIMIT 1`).Scan(&id)
	return id, err
}

func (s *Store) withTx(ctx context.Context, operation func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := operation(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func writeChange(ctx context.Context, tx *sql.Tx, entityType, entityID, action string, at time.Time) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO change_log(id,entity_type,entity_id,action,changed_at) VALUES(?,?,?,?,?)`, platform.NewID(), entityType, entityID, action, platform.TimeText(at))
	return err
}

func nullableTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return platform.TimeText(*value)
}

func parseNullableTime(value sql.NullString) (*time.Time, error) {
	if !value.Valid {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value.String)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}
