package attachment_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/personal-workbench/workbenchd/internal/archive"
	"github.com/personal-workbench/workbenchd/internal/attachment"
	workbenchsqlite "github.com/personal-workbench/workbenchd/internal/storage/sqlite"
)

func TestManagedAttachmentImportAndRemoval(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	workspace := t.TempDir()
	store, err := workbenchsqlite.Open(ctx, workspace, "附件测试", "0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	owner, err := store.CreateArchive(ctx, archive.Input{CollectionID: "template", Title: "附件所有者"})
	if err != nil {
		t.Fatal(err)
	}
	sourceDirectory := t.TempDir()
	source := filepath.Join(sourceDirectory, "合同 副本.txt")
	payload := []byte("managed attachment payload")
	if err := os.WriteFile(source, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	manager := attachment.New(store.DB(), workspace)
	items, err := manager.Import(ctx, owner.ID, []string{source})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].DisplayName != "合同 副本.txt" || items[0].Size != int64(len(payload)) {
		t.Fatalf("unexpected items: %#v", items)
	}
	var relative string
	if err := store.DB().QueryRow(`SELECT relative_path FROM attachments WHERE id=?`, items[0].ID).Scan(&relative); err != nil {
		t.Fatal(err)
	}
	if filepath.IsAbs(relative) || !filepath.IsLocal(filepath.FromSlash(relative)) {
		t.Fatalf("unsafe relative path: %q", relative)
	}
	if _, err := os.Stat(filepath.Join(workspace, filepath.FromSlash(relative))); err != nil {
		t.Fatal(err)
	}
	target, err := manager.OpenTarget(ctx, items[0].ID)
	if err != nil || target != filepath.Join(workspace, filepath.FromSlash(relative)) {
		t.Fatalf("unexpected open target %q: %v", target, err)
	}
	if _, err := store.DB().Exec(`UPDATE attachments SET relative_path='../outside.txt' WHERE id=?`, items[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.OpenTarget(ctx, items[0].ID); err == nil {
		t.Fatal("expected unsafe stored path to be rejected")
	}
	if _, err := store.DB().Exec(`UPDATE attachments SET relative_path=? WHERE id=?`, relative, items[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := manager.Delete(ctx, items[0].ID); err != nil {
		t.Fatal(err)
	}
	listed, err := manager.List(ctx, owner.ID)
	if err != nil || len(listed) != 0 {
		t.Fatalf("attachment was not removed: %#v %v", listed, err)
	}
	trash, err := store.ListTrash(ctx)
	if err != nil || len(trash) != 1 || trash[0].EntityType != "attachment" {
		t.Fatalf("attachment trash=%#v err=%v", trash, err)
	}
	if err := store.RestoreTrash(ctx, trash[0].ID); err != nil {
		t.Fatal(err)
	}
	listed, err = manager.List(ctx, owner.ID)
	if err != nil || len(listed) != 1 {
		t.Fatalf("attachment was not restored: %#v %v", listed, err)
	}
	var activityCount int
	if err := store.DB().QueryRow(`SELECT count(*) FROM change_log WHERE entity_type='archive' AND entity_id=? AND action IN ('attachment_import','attachment_remove','attachment_restore')`, owner.ID).Scan(&activityCount); err != nil || activityCount != 3 {
		t.Fatalf("attachment activity count=%d err=%v", activityCount, err)
	}
}

func TestAttachmentImportRejectsMissingAndCancelledSources(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	workspace := t.TempDir()
	store, err := workbenchsqlite.Open(ctx, workspace, "附件测试", "0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	manager := attachment.New(store.DB(), workspace)
	if _, err := manager.Import(ctx, "missing", []string{filepath.Join(t.TempDir(), "missing.txt")}); err == nil {
		t.Fatal("expected missing source error")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	source := filepath.Join(t.TempDir(), "source.txt")
	if err := os.WriteFile(source, []byte("value"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Import(cancelled, "missing", []string{source}); err == nil {
		t.Fatal("expected cancellation error")
	}
}

func TestAttachmentBatchFailureRemovesEarlierFilesAndRows(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	workspace := t.TempDir()
	store, err := workbenchsqlite.Open(ctx, workspace, "附件回滚测试", "0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	owner, err := store.CreateArchive(ctx, archive.Input{CollectionID: "template", Title: "批量附件所有者"})
	if err != nil {
		t.Fatal(err)
	}
	valid := filepath.Join(t.TempDir(), "valid.txt")
	if err := os.WriteFile(valid, []byte("value"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := attachment.New(store.DB(), workspace)
	if _, err := manager.Import(ctx, owner.ID, []string{valid, filepath.Join(t.TempDir(), "missing.txt")}); err == nil {
		t.Fatal("expected batch import failure")
	}
	var rows int
	if err := store.DB().QueryRow(`SELECT count(*) FROM attachments WHERE entity_id=?`, owner.ID).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("attachment rows=%d err=%v", rows, err)
	}
	files := 0
	_ = filepath.WalkDir(filepath.Join(workspace, "attachments"), func(_ string, entry os.DirEntry, walkErr error) error {
		if walkErr == nil && !entry.IsDir() {
			files++
		}
		return nil
	})
	if files != 0 {
		t.Fatalf("managed files left after rollback: %d", files)
	}
}
