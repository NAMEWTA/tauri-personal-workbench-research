package backup_test

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/personal-workbench/workbenchd/internal/archive"
	"github.com/personal-workbench/workbenchd/internal/attachment"
	"github.com/personal-workbench/workbenchd/internal/backup"
	workbenchsqlite "github.com/personal-workbench/workbenchd/internal/storage/sqlite"
	"github.com/personal-workbench/workbenchd/migrations"
)

func TestOnlineBackupIncludesDatabaseAndAttachments(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	workspace := t.TempDir()
	store, err := workbenchsqlite.Open(ctx, workspace, "备份测试", "0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	owner, err := store.CreateArchive(ctx, archive.Input{TypeID: "organization", Title: "示例企业"})
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(t.TempDir(), "sample.txt")
	if err := os.WriteFile(source, []byte("attachment payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	imported, err := attachment.New(store.DB(), workspace).Import(ctx, owner.ID, []string{source})
	if err != nil {
		t.Fatal(err)
	}
	var storedPath string
	if err := store.DB().QueryRow(`SELECT relative_path FROM attachments WHERE id=?`, imported[0].ID).Scan(&storedPath); err != nil {
		t.Fatal(err)
	}
	unmanaged := filepath.Join(workspace, "attachments", "unmanaged.txt")
	if err := os.WriteFile(unmanaged, []byte("must not be archived"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := backup.New(store.DB(), workspace)
	configured := t.TempDir()
	if _, err := manager.Configure(ctx, configured); err != nil {
		t.Fatal(err)
	}
	run, err := manager.Create(ctx, "", func(int, string) {})
	if err != nil {
		t.Fatal(err)
	}
	if run.State != "succeeded" || run.Size == 0 {
		t.Fatalf("unexpected run: %#v", run)
	}
	reader, err := zip.OpenReader(run.Path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reader.Close() }()
	names := map[string]bool{}
	for _, entry := range reader.File {
		names[entry.Name] = true
	}
	for _, required := range []string{"manifest.json", "database.sqlite3", filepath.ToSlash(storedPath)} {
		if !names[required] {
			t.Errorf("missing %s", required)
		}
	}
	if names["attachments/unmanaged.txt"] {
		t.Fatal("unmanaged file was included in backup")
	}
}

func TestPreflightAndRestoreToNewWorkspace(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	store, err := workbenchsqlite.Open(ctx, workspace, "恢复来源", "0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	created, err := store.CreateArchive(ctx, archive.Input{TypeID: "person", Title: "恢复验证档案"})
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(t.TempDir(), "restore.txt")
	if err := os.WriteFile(source, []byte("restore payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := attachment.New(store.DB(), workspace).Import(ctx, created.ID, []string{source}); err != nil {
		t.Fatal(err)
	}
	manager := backup.New(store.DB(), workspace)
	if _, err := manager.Configure(ctx, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	run, err := manager.Create(ctx, "", func(int, string) {})
	if err != nil {
		t.Fatal(err)
	}
	report, err := manager.Preflight(ctx, run.Path)
	if err != nil {
		t.Fatal(err)
	}
	if report.WorkspaceName != "恢复来源" || report.SchemaVersion != migrations.CurrentVersion || report.FileCount != 2 {
		t.Fatalf("unexpected report: %#v", report)
	}
	destination := filepath.Join(t.TempDir(), "restored")
	if err := manager.RestoreToNewWorkspace(ctx, run.Path, destination, func(int, string) {}); err != nil {
		t.Fatal(err)
	}
	restored, err := workbenchsqlite.Open(ctx, destination, "ignored", "0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = restored.Close() }()
	loaded, err := restored.GetArchive(ctx, created.ID)
	if err != nil || loaded.Title != "恢复验证档案" {
		t.Fatalf("archive was not restored: %#v, %v", loaded, err)
	}
	restoredAttachments, err := attachment.New(restored.DB(), destination).List(ctx, created.ID)
	if err != nil || len(restoredAttachments) != 1 {
		t.Fatalf("attachment metadata was not restored: %#v, %v", restoredAttachments, err)
	}
	restoredTarget, err := attachment.New(restored.DB(), destination).OpenTarget(ctx, restoredAttachments[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(restoredTarget)
	if err != nil || string(raw) != "restore payload" {
		t.Fatalf("attachment was not restored: %q, %v", raw, err)
	}
}

func TestPreflightRejectsUnsafeArchivePath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "unsafe.zip")
	output, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(output)
	entry, err := writer.Create("../outside.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = entry.Write([]byte("unsafe"))
	manifestEntry, err := writer.Create("manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = manifestEntry.Write([]byte(`{"formatVersion":1,"files":[]}`))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := output.Close(); err != nil {
		t.Fatal(err)
	}
	manager := backup.New(nil, t.TempDir())
	if _, err := manager.Preflight(context.Background(), path); err == nil {
		t.Fatal("expected unsafe path to be rejected")
	}
}

func TestSuccessfulBackupRetentionAndFailureSafety(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	store, err := workbenchsqlite.Open(ctx, workspace, "保留测试", "0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	manager := backup.New(store.DB(), workspace)
	backupDirectory := t.TempDir()
	if _, err := manager.Configure(ctx, backupDirectory); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 11; index++ {
		run, err := manager.Create(ctx, "", func(int, string) {})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(run.Path); err != nil {
			t.Fatalf("backup %d missing immediately at %q: %v", index, run.Path, err)
		}
	}
	archives, err := filepath.Glob(filepath.Join(backupDirectory, "workbench-backup-*.zip"))
	if err != nil || len(archives) != 10 {
		entries, readErr := os.ReadDir(backupDirectory)
		names := make([]string, 0, len(entries))
		for _, entry := range entries {
			names = append(names, entry.Name())
		}
		t.Fatalf("expected 10 retained archives, got %d, err=%v readErr=%v entries=%v", len(archives), err, readErr, names)
	}
	runs, err := manager.List(ctx)
	if err != nil || len(runs) != 10 {
		t.Fatalf("expected 10 retained runs, got %d, err=%v", len(runs), err)
	}
	blockedDestination := filepath.Join(workspace, "not-a-directory")
	if err := os.WriteFile(blockedDestination, []byte("file"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Create(ctx, blockedDestination, func(int, string) {}); err == nil {
		t.Fatal("expected backup failure")
	}
	archives, _ = filepath.Glob(filepath.Join(backupDirectory, "workbench-backup-*.zip"))
	if len(archives) != 10 {
		t.Fatalf("failed backup removed successful archives: %d", len(archives))
	}
}

func TestAutomaticBackupDueWindow(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	store, err := workbenchsqlite.Open(ctx, workspace, "自动备份测试", "0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	manager := backup.New(store.DB(), workspace)
	now := time.Now().UTC()
	due, err := manager.NeedsAutomaticBackup(ctx, now)
	if err != nil || due {
		t.Fatalf("unconfigured workspace should not back up: due=%v err=%v", due, err)
	}
	if _, err := manager.Create(ctx, "", func(int, string) {}); err == nil {
		t.Fatal("unconfigured manual backup should fail")
	}
	configured := t.TempDir()
	settings, err := manager.Configure(ctx, configured)
	if err != nil || settings.BackupDirectory != configured {
		t.Fatalf("settings=%#v err=%v", settings, err)
	}
	due, err = manager.NeedsAutomaticBackup(ctx, now)
	if err != nil || !due {
		t.Fatalf("configured new workspace should need backup: due=%v err=%v", due, err)
	}
	if _, err := manager.Create(ctx, "", func(int, string) {}); err != nil {
		t.Fatal(err)
	}
	due, err = manager.NeedsAutomaticBackup(ctx, now.Add(time.Hour))
	if err != nil || due {
		t.Fatalf("recent backup should suppress automatic backup: due=%v err=%v", due, err)
	}
	if _, err := store.DB().ExecContext(ctx, `UPDATE backup_runs SET finished_at=? WHERE state='succeeded'`, now.Add(-25*time.Hour).Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	due, err = manager.NeedsAutomaticBackup(ctx, now)
	if err != nil || !due {
		t.Fatalf("old backup should be due: due=%v err=%v", due, err)
	}
}
