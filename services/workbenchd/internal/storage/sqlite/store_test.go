package sqlite_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/personal-workbench/workbenchd/internal/app"
	"github.com/personal-workbench/workbenchd/internal/archive"
	"github.com/personal-workbench/workbenchd/internal/platform"
	"github.com/personal-workbench/workbenchd/internal/relation"
	workbenchsqlite "github.com/personal-workbench/workbenchd/internal/storage/sqlite"
	"github.com/personal-workbench/workbenchd/internal/task"
	"github.com/personal-workbench/workbenchd/migrations"
)

func openStore(t *testing.T) *workbenchsqlite.Store {
	t.Helper()
	store, err := workbenchsqlite.Open(context.Background(), t.TempDir(), "V2 测试", "0.2.0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestOpenCreatesV2BaselineAndLocksWorkspace(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	store, err := workbenchsqlite.Open(ctx, workspace, "V2 工作区", "0.2.0")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := workbenchsqlite.Open(ctx, workspace, "V2 工作区", "0.2.0"); err == nil {
		t.Fatal("expected concurrent open to fail")
	}
	name, version, err := store.WorkspaceMeta(ctx)
	if err != nil || name != "V2 工作区" || int64(version) != migrations.CurrentVersion {
		t.Fatalf("metadata name=%q version=%d err=%v", name, version, err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestCustomArchiveTypesFieldsAndArchives(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := openStore(t)
	types, err := store.ListArchiveTypes(ctx)
	if err != nil || len(types) != 3 {
		t.Fatalf("seed types=%#v err=%v", types, err)
	}
	projectType, err := store.CreateArchiveType(ctx, archive.TypeInput{Name: "项目", Icon: "FolderKanban", Color: "#356F9E", SortOrder: 3})
	if err != nil {
		t.Fatal(err)
	}
	field, err := store.CreateArchiveField(ctx, projectType.ID, archive.FieldInput{Key: "stage", Label: "阶段", ValueType: "select", Group: "项目信息", Required: true, Options: []string{"规划", "执行"}})
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.CreateArchive(ctx, archive.Input{TypeID: projectType.ID, Title: "离线工作台 V2", Summary: "统一领域模型", Fields: map[string]any{"stage": "执行"}})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := store.GetArchive(ctx, created.ID)
	if err != nil || loaded.TypeName != "项目" || loaded.Fields["stage"] != "执行" {
		t.Fatalf("archive=%#v err=%v", loaded, err)
	}
	if err := store.DeleteArchiveType(ctx, projectType.ID); err != app.ErrConflict {
		t.Fatalf("used type delete err=%v", err)
	}
	if _, err := store.UpdateArchiveField(ctx, field.ID, archive.FieldInput{Key: "stage", Label: "阶段", ValueType: "number", Group: "项目信息", Required: true}); err != app.ErrConflict {
		t.Fatalf("in-use field type change err=%v", err)
	}
	results, err := store.Search(ctx, "离线工作台")
	if err != nil || len(results) != 1 || results[0].ID != created.ID {
		t.Fatalf("search=%#v err=%v", results, err)
	}
}

func TestUnifiedTaskViewsRangeArchiveAndTrash(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := openStore(t)
	owner, err := store.CreateArchive(ctx, archive.Input{TypeID: "person", Title: "任务负责人"})
	if err != nil {
		t.Fatal(err)
	}
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().In(location)
	start := time.Date(now.Year(), now.Month(), now.Day(), 9, 0, 0, 0, location).UTC()
	end := start.Add(time.Hour)
	today, err := store.CreateTask(ctx, task.Input{Title: "今日统一任务", Status: "todo", Priority: "high", StartsAt: &start, EndsAt: &end, Timezone: "Asia/Shanghai", ArchiveID: &owner.ID})
	if err != nil {
		t.Fatal(err)
	}
	tomorrowStart := start.AddDate(0, 0, 1)
	tomorrowEnd := tomorrowStart.Add(time.Hour)
	if _, err := store.CreateTask(ctx, task.Input{Title: "明日统一任务", Status: "todo", Priority: "normal", StartsAt: &tomorrowStart, EndsAt: &tomorrowEnd, Timezone: "Asia/Shanghai"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateTask(ctx, task.Input{Title: "未排期任务", Status: "todo", Priority: "normal"}); err != nil {
		t.Fatal(err)
	}
	completed, err := store.CreateTask(ctx, task.Input{Title: "已完成任务", Status: "done", Priority: "normal"})
	if err != nil || completed.CompletedAt == nil {
		t.Fatalf("completed=%#v err=%v", completed, err)
	}
	todayItems, err := store.ListTasks(ctx, task.Filter{View: "today", Timezone: "Asia/Shanghai"})
	if err != nil || len(todayItems) != 1 || todayItems[0].ID != today.ID || todayItems[0].ArchiveTitle != "任务负责人" {
		t.Fatalf("today=%#v err=%v", todayItems, err)
	}
	tomorrowItems, err := store.ListTasks(ctx, task.Filter{View: "tomorrow", Timezone: "Asia/Shanghai"})
	if err != nil || len(tomorrowItems) != 1 {
		t.Fatalf("tomorrow=%#v err=%v", tomorrowItems, err)
	}
	allItems, err := store.ListTasks(ctx, task.Filter{View: "all", Timezone: "Asia/Shanghai"})
	if err != nil || len(allItems) != 3 {
		t.Fatalf("all incomplete=%#v err=%v", allItems, err)
	}
	calendarItems, err := store.ListTasks(ctx, task.Filter{View: "all", From: &start, To: &end})
	if err != nil || len(calendarItems) != 1 || calendarItems[0].ID != today.ID {
		t.Fatalf("calendar range=%#v err=%v", calendarItems, err)
	}
	archiveItems, err := store.ListTasks(ctx, task.Filter{View: "all", ArchiveID: owner.ID})
	if err != nil || len(archiveItems) != 1 {
		t.Fatalf("archive tasks=%#v err=%v", archiveItems, err)
	}
	if err := store.TrashTask(ctx, today.ID); err != nil {
		t.Fatal(err)
	}
	trash, err := store.ListTrash(ctx)
	if err != nil || len(trash) != 1 {
		t.Fatalf("trash=%#v err=%v", trash, err)
	}
	if err := store.RestoreTrash(ctx, trash[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetTask(ctx, today.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ListTasks(ctx, task.Filter{View: "today", Timezone: "Invalid/Timezone"}); err != app.ErrValidation {
		t.Fatalf("invalid timezone err=%v", err)
	}
}

func TestArchiveRelationsIncludeNavigableTypeMetadata(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := openStore(t)
	source, _ := store.CreateArchive(ctx, archive.Input{TypeID: "person", Title: "张三"})
	target, _ := store.CreateArchive(ctx, archive.Input{TypeID: "organization", Title: "示例企业"})
	created, err := store.CreateRelation(ctx, source.ID, relation.Input{TargetID: target.ID, RelationType: "任职于"})
	if err != nil {
		t.Fatal(err)
	}
	items, err := store.ListRelations(ctx, source.ID)
	if err != nil || len(items) != 1 || items[0].TargetID != target.ID || items[0].TargetTypeID != "organization" || items[0].TargetTypeName != "企业" {
		t.Fatalf("relations=%#v err=%v", items, err)
	}
	if err := store.DeleteRelation(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
}

func TestSQLitePragmasFTSAndAttachmentSearchMapping(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := openStore(t)
	var journal string
	if err := store.DB().QueryRow(`PRAGMA journal_mode`).Scan(&journal); err != nil || journal != "wal" {
		t.Fatalf("journal=%q err=%v", journal, err)
	}
	owner, _ := store.CreateArchive(ctx, archive.Input{TypeID: "person", Title: "附件档案"})
	attachmentID := platform.NewID()
	if _, err := store.DB().ExecContext(ctx, `INSERT INTO attachments(id,entity_type,entity_id,display_name,relative_path,media_type,byte_size,sha256,created_at) VALUES(?,'archive',?,'竣工验收报告.pdf',?,'application/pdf',12,?,?)`, attachmentID, owner.ID, filepath.Join(owner.ID, attachmentID+".pdf"), "checksum", platform.TimeText(platform.Now())); err != nil {
		t.Fatal(err)
	}
	results, err := store.Search(ctx, "竣工验收")
	if err != nil || len(results) != 1 || results[0].Type != "attachment" || results[0].ID != owner.ID {
		t.Fatalf("attachment search=%#v err=%v", results, err)
	}
	if err := store.RebuildSearch(ctx, func(int, string) {}); err != nil || !store.SearchHealthy(ctx) {
		t.Fatalf("rebuild err=%v healthy=%v", err, store.SearchHealthy(ctx))
	}
}
