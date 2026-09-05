package sqlite_test

import (
	"context"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"reflect"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/personal-workbench/workbenchd/internal/app"
	"github.com/personal-workbench/workbenchd/internal/archive"
	"github.com/personal-workbench/workbenchd/internal/platform"
	"github.com/personal-workbench/workbenchd/internal/preferences"
	"github.com/personal-workbench/workbenchd/internal/relation"
	workbenchsqlite "github.com/personal-workbench/workbenchd/internal/storage/sqlite"
	"github.com/personal-workbench/workbenchd/internal/task"
	"github.com/personal-workbench/workbenchd/migrations"
)

func openStore(t *testing.T) *workbenchsqlite.Store {
	t.Helper()
	store, err := workbenchsqlite.Open(context.Background(), t.TempDir(), "V2 测试", "0.2.9")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestOpenCreatesV2BaselineAndLocksWorkspace(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	store, err := workbenchsqlite.Open(ctx, workspace, "V2 工作区", "0.2.9")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := workbenchsqlite.Open(ctx, workspace, "V2 工作区", "0.2.9"); err == nil {
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

func TestSQLiteConnectionPragmasApplyToEveryPooledConnection(t *testing.T) {
	store := openStore(t)
	db := store.DB()
	db.SetMaxOpenConns(4)
	ctx := context.Background()
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	acquired := make(chan struct{}, 4)
	release := make(chan struct{})
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			conn, err := db.Conn(ctx)
			acquired <- struct{}{}
			<-release
			if err != nil {
				errs <- err
				return
			}
			defer func() { _ = conn.Close() }()
			for pragma, want := range map[string]int{"foreign_keys": 1, "busy_timeout": 5000, "synchronous": 1} {
				var got int
				if err := conn.QueryRowContext(ctx, "PRAGMA "+pragma).Scan(&got); err != nil {
					errs <- err
					return
				}
				if got != want {
					errs <- fmt.Errorf("%s=%d, want %d", pragma, got, want)
					return
				}
			}
			var journal string
			if err := conn.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&journal); err != nil {
				errs <- err
				return
			}
			if journal != "wal" {
				errs <- fmt.Errorf("journal_mode=%s", journal)
			}
		}()
	}
	for i := 0; i < 4; i++ {
		<-acquired
	}
	close(release)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestWorkspaceDataIsIsolatedAcrossSQLiteFiles(t *testing.T) {
	ctx := context.Background()
	workspaceA := t.TempDir()
	workspaceB := t.TempDir()
	storeA, err := workbenchsqlite.Open(ctx, workspaceA, "工作区 A", "0.2.9")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = storeA.Close() }()
	storeB, err := workbenchsqlite.Open(ctx, workspaceB, "工作区 B", "0.2.9")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = storeB.Close() }()

	created, err := storeA.CreateArchive(ctx, archive.Input{CollectionID: "template", Title: "只属于 A"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := storeA.CreateTask(ctx, task.Input{Title: "只属于 A 的任务", Status: "todo", Priority: "normal", RecordID: &created.ID}); err != nil {
		t.Fatal(err)
	}

	archivesB, err := storeB.ListArchiveRecords(ctx, "", "", "updated", 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	if archivesB.Total != 0 || len(archivesB.Items) != 0 {
		t.Fatalf("workspace B saw workspace A archives: %#v", archivesB)
	}
	tasksB, err := storeB.ListTasks(ctx, task.Filter{View: "all"})
	if err != nil {
		t.Fatal(err)
	}
	if len(tasksB) != 0 {
		t.Fatalf("workspace B saw workspace A tasks: %#v", tasksB)
	}
	resultsB, err := storeB.Search(ctx, "只属于 A")
	if err != nil {
		t.Fatal(err)
	}
	if len(resultsB) != 0 {
		t.Fatalf("workspace B search returned workspace A data: %#v", resultsB)
	}
	if storeA.DBPath() == storeB.DBPath() {
		t.Fatalf("workspaces unexpectedly share sqlite path: %q", storeA.DBPath())
	}
}

func TestWorkspacePersistenceIndexesAreLocalSQLiteTables(t *testing.T) {
	store := openStore(t)
	required := []string{
		"workspace_meta",
		"archive_collections",
		"archive_fields",
		"archive_records",
		"archive_record_values",
		"tasks",
		"entity_relations",
		"tags",
		"entity_tags",
		"attachments",
		"backup_runs",
		"trash_entries",
		"change_log",
		"background_jobs",
		"workspace_settings",
		"search_index",
	}
	for _, name := range required {
		var found string
		if err := store.DB().QueryRow(`SELECT name FROM sqlite_master WHERE name=?`, name).Scan(&found); err != nil {
			t.Fatalf("persistence table %q is missing: %v", name, err)
		}
		if found != name {
			t.Fatalf("unexpected persistence table name %q for %q", found, name)
		}
	}
	if filepath.Base(store.DBPath()) != "workbench.sqlite3" || filepath.Dir(store.DBPath()) != store.WorkspacePath() {
		t.Fatalf("database is outside workspace: path=%q workspace=%q", store.DBPath(), store.WorkspacePath())
	}
}

func TestCustomArchiveTypesFieldsAndArchives(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := openStore(t)
	types, err := store.ListArchiveCollections(ctx)
	if err != nil || len(types) != 1 || types[0].Name != "模板档案" {
		t.Fatalf("seed types=%#v err=%v", types, err)
	}
	projectType, err := store.CreateArchiveCollection(ctx, archive.CollectionInput{Name: "项目", Icon: "FolderKanban", Color: "#356F9E", SortOrder: 3})
	if err != nil {
		t.Fatal(err)
	}
	field, err := store.CreateArchiveField(ctx, projectType.ID, archive.FieldInput{Key: "stage", Label: "阶段", ValueType: "select", Group: "项目信息", Required: true, Options: []string{"规划", "执行"}})
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.CreateArchive(ctx, archive.Input{CollectionID: projectType.ID, Title: "离线工作台 V2", Summary: "统一领域模型", Fields: map[string]any{"stage": "执行"}})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := store.GetArchive(ctx, created.ID)
	if err != nil || loaded.CollectionName != "项目" || loaded.Fields["stage"] != "执行" {
		t.Fatalf("archive=%#v err=%v", loaded, err)
	}
	if err := store.DeleteArchiveCollection(ctx, projectType.ID); err != app.ErrConflict {
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
	owner, err := store.CreateArchive(ctx, archive.Input{CollectionID: "template", Title: "任务负责人"})
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
	today, err := store.CreateTask(ctx, task.Input{Title: "今日统一任务", Status: "todo", Priority: "high", StartsAt: &start, EndsAt: &end, Timezone: "Asia/Shanghai", RecordID: &owner.ID})
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
	if err != nil || len(todayItems) != 1 || todayItems[0].ID != today.ID || todayItems[0].RecordTitle != "任务负责人" {
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
	archiveItems, err := store.ListTasks(ctx, task.Filter{View: "all", RecordID: owner.ID})
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
	source, _ := store.CreateArchive(ctx, archive.Input{CollectionID: "template", Title: "张三"})
	target, _ := store.CreateArchive(ctx, archive.Input{CollectionID: "template", Title: "示例企业"})
	created, err := store.CreateRelation(ctx, source.ID, relation.Input{TargetID: target.ID, RelationType: "任职于"})
	if err != nil {
		t.Fatal(err)
	}
	items, err := store.ListRelations(ctx, source.ID)
	if err != nil || len(items) != 1 || items[0].TargetID != target.ID || items[0].TargetCollectionID != "template" || items[0].TargetCollectionName != "模板档案" {
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
	owner, _ := store.CreateArchive(ctx, archive.Input{CollectionID: "template", Title: "附件档案"})
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

func TestTaskDueDateAndRecurringCompletion(t *testing.T) {
	ctx := context.Background()
	store := openStore(t)
	due := time.Now().Format("2006-01-02")
	taskItem, err := store.CreateTask(ctx, task.Input{
		Title:        "重复任务",
		Status:       "todo",
		Priority:     "normal",
		DueOn:        &due,
		Recurrence:   "FREQ=DAILY",
		Reminders:    []string{time.Now().Add(time.Hour).UTC().Format(time.RFC3339)},
		EstimateMins: func() *int { value := 30; return &value }(),
	})
	if err != nil || taskItem.DueOn == nil || taskItem.Recurrence != "FREQ=DAILY" || len(taskItem.Reminders) != 1 {
		t.Fatalf("created task=%#v err=%v", taskItem, err)
	}
	completed := task.Input{Title: taskItem.Title, Status: "done", Priority: taskItem.Priority, DueOn: taskItem.DueOn, Recurrence: taskItem.Recurrence, Reminders: taskItem.Reminders, EstimateMins: taskItem.EstimateMins}
	if _, err := store.UpdateTask(ctx, taskItem.ID, completed); err != nil {
		t.Fatal(err)
	}
	items, err := store.ListTasks(ctx, task.Filter{View: "all"})
	if err != nil || len(items) != 1 || items[0].Status != "todo" || items[0].DueOn == nil || *items[0].DueOn == due {
		t.Fatalf("next occurrence=%#v err=%v", items, err)
	}
}

func TestWorkspacePreferencesPersistAcrossReopen(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	store, err := workbenchsqlite.Open(ctx, workspace, "偏好测试", "0.2.9")
	if err != nil {
		t.Fatal(err)
	}
	initial, err := store.Preferences(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if initial.Theme != "system" || initial.SidebarCollapsed || initial.InspectorWidth != 344 || len(initial.RecentSearches) != 0 {
		t.Fatalf("initial preferences=%#v", initial)
	}
	recent := []preferences.RecentSearch{{ID: "task-1", Type: "task", Title: "本地任务", Subtitle: "任务"}}
	collapsed := true
	theme := "dark"
	width := 420
	updated, err := store.UpdatePreferences(ctx, preferences.Update{Theme: &theme, SidebarCollapsed: &collapsed, InspectorWidth: &width, RecentSearches: &recent})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Theme != theme || !updated.SidebarCollapsed || updated.InspectorWidth != width || len(updated.RecentSearches) != 1 {
		t.Fatalf("updated preferences=%#v", updated)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := workbenchsqlite.Open(ctx, workspace, "偏好测试", "0.2.9")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reopened.Close() }()
	loaded, err := reopened.Preferences(ctx)
	if err != nil || loaded.Theme != theme || !loaded.SidebarCollapsed || loaded.InspectorWidth != width || len(loaded.RecentSearches) != 1 || loaded.RecentSearches[0].ID != "task-1" {
		t.Fatalf("loaded preferences=%#v err=%v", loaded, err)
	}
	badWidth := 999
	if _, err := reopened.UpdatePreferences(ctx, preferences.Update{InspectorWidth: &badWidth}); err != preferences.ErrInvalid {
		t.Fatalf("invalid width err=%v", err)
	}
}

func TestTaskViewsRespectLocalDatesAndHalfOpenIntervals(t *testing.T) {
	for _, timezone := range []string{"Pacific/Kiritimati", "America/New_York"} {
		t.Run(timezone, func(t *testing.T) {
			store := openStore(t)
			ctx := context.Background()
			location, err := time.LoadLocation(timezone)
			if err != nil {
				t.Fatal(err)
			}
			now := time.Now().In(location)
			start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location)
			end := start.AddDate(0, 0, 1)
			createScheduled := func(title, status string, from, to time.Time) {
				t.Helper()
				from, to = from.UTC(), to.UTC()
				if _, err := store.CreateTask(ctx, task.Input{Title: title, Status: status, Priority: "normal", StartsAt: &from, EndsAt: &to, Timezone: timezone}); err != nil {
					t.Fatal(err)
				}
			}
			createScheduled("expired", "todo", start.Add(-3*time.Hour), start.Add(-time.Hour))
			createScheduled("ends-at-midnight", "todo", start.Add(-time.Hour), start)
			createScheduled("today", "todo", start.Add(time.Hour), start.Add(2*time.Hour))
			createScheduled("spanning", "todo", start.Add(-time.Hour), end.Add(time.Hour))
			createScheduled("starts-at-tomorrow", "todo", end, end.Add(time.Hour))
			createScheduled("completed", "done", start.Add(time.Hour), start.Add(2*time.Hour))
			for title, day := range map[string]time.Time{"due-today": start, "due-tomorrow": end, "due-after-tomorrow": end.AddDate(0, 0, 1)} {
				due := day.Format("2006-01-02")
				if _, err := store.CreateTask(ctx, task.Input{Title: title, Status: "todo", Priority: "normal", DueOn: &due}); err != nil {
					t.Fatal(err)
				}
			}
			for _, scenario := range []struct {
				name   string
				filter task.Filter
				want   []string
			}{
				{"today", task.Filter{View: "today", Timezone: timezone}, []string{"due-today", "spanning", "today"}},
				{"tomorrow", task.Filter{View: "tomorrow", Timezone: timezone}, []string{"due-tomorrow", "spanning", "starts-at-tomorrow"}},
				{"calendar", task.Filter{View: "calendar", From: &start, To: &end}, []string{"completed", "spanning", "today"}},
				{"completed", task.Filter{View: "completed"}, []string{"completed"}},
				{"all", task.Filter{View: "all"}, []string{"due-after-tomorrow", "due-today", "due-tomorrow", "ends-at-midnight", "expired", "spanning", "starts-at-tomorrow", "today"}},
			} {
				t.Run(scenario.name, func(t *testing.T) {
					items, err := store.ListTasks(ctx, scenario.filter)
					if err != nil {
						t.Fatal(err)
					}
					got := make([]string, 0, len(items))
					for _, item := range items {
						got = append(got, item.Title)
					}
					slices.Sort(got)
					if !slices.Equal(got, scenario.want) {
						t.Fatalf("titles=%v, want %v", got, scenario.want)
					}
				})
			}
		})
	}
}

func TestTaskParentValidationRejectsMissingDeletedAndCyclicLinks(t *testing.T) {
	store := openStore(t)
	ctx := context.Background()
	input := task.Input{Title: "parent", Status: "todo", Priority: "normal"}
	parent, err := store.CreateTask(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	input.Title, input.ParentID = "child", &parent.ID
	child, err := store.CreateTask(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	input.Title, input.ParentID = "grandchild", &child.ID
	grandchild, err := store.CreateTask(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	deleted, err := store.CreateTask(ctx, task.Input{Title: "deleted", Status: "todo", Priority: "normal"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.TrashTask(ctx, deleted.ID); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct {
		name, parentID string
		want           error
	}{
		{"self", parent.ID, app.ErrValidation}, {"cycle", grandchild.ID, app.ErrValidation},
		{"missing", "missing-parent", app.ErrNotFound}, {"deleted", deleted.ID, app.ErrNotFound},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			candidate := task.Input{Title: "changed", Status: "todo", Priority: "normal", ParentID: &scenario.parentID}
			if _, err := store.UpdateTask(ctx, parent.ID, candidate); !errors.Is(err, scenario.want) {
				t.Fatalf("update err=%v, want %v", err, scenario.want)
			}
			persisted, err := store.GetTask(ctx, parent.ID)
			if err != nil || persisted.ParentID != nil || persisted.Title != "parent" {
				t.Fatalf("failed update changed task: %#v err=%v", persisted, err)
			}
			if scenario.name == "missing" || scenario.name == "deleted" {
				if _, err := store.CreateTask(ctx, candidate); !errors.Is(err, scenario.want) {
					t.Fatalf("create err=%v, want %v", err, scenario.want)
				}
			}
		})
	}
}

func TestTaskRecurrenceRejectsUnsupportedWritesAndCreatesSupportedOccurrences(t *testing.T) {
	store := openStore(t)
	ctx := context.Background()
	base := task.Input{Title: "recurrence", Status: "todo", Priority: "normal"}
	item, err := store.CreateTask(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	for _, rule := range []string{"FREQ=YEARLY", "FREQ=DAILY;INTERVAL=2", "FREQ=WEEKLY;BYDAY=MO", "not-a-rule"} {
		input := base
		input.Recurrence = rule
		if _, err := store.CreateTask(ctx, input); !errors.Is(err, app.ErrValidation) {
			t.Fatalf("create %q err=%v", rule, err)
		}
		input.Status = "done"
		if _, err := store.UpdateTask(ctx, item.ID, input); !errors.Is(err, app.ErrValidation) {
			t.Fatalf("update %q err=%v", rule, err)
		}
	}
	persisted, err := store.GetTask(ctx, item.ID)
	if err != nil || persisted.Status != "todo" || persisted.Recurrence != "" {
		t.Fatalf("invalid rule changed task: %#v err=%v", persisted, err)
	}
	for _, scenario := range []struct{ rule, want string }{{" FREQ=DAILY ", "2026-01-16"}, {"freq=weekly", "2026-01-22"}, {"FREQ=MONTHLY", "2026-02-15"}} {
		t.Run(scenario.rule, func(t *testing.T) {
			due := "2026-01-15"
			input := task.Input{Title: scenario.rule, Status: "todo", Priority: "normal", Recurrence: scenario.rule, DueOn: &due}
			created, err := store.CreateTask(ctx, input)
			if err != nil {
				t.Fatal(err)
			}
			input.Status = "done"
			if _, err := store.UpdateTask(ctx, created.ID, input); err != nil {
				t.Fatal(err)
			}
			items, err := store.ListTasks(ctx, task.Filter{View: "all", Query: scenario.rule})
			if err != nil || len(items) != 1 || items[0].DueOn == nil || *items[0].DueOn != scenario.want {
				t.Fatalf("occurrence=%#v err=%v, want %s", items, err, scenario.want)
			}
		})
	}
}

func TestCorruptTaskRemindersAreReportedByReadAndList(t *testing.T) {
	store := openStore(t)
	ctx := context.Background()
	item, err := store.CreateTask(ctx, task.Input{Title: "reminder", Status: "todo", Priority: "normal"})
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{`[`, `{}`, `[1]`} {
		if _, err := store.DB().ExecContext(ctx, `UPDATE tasks SET reminders_json=? WHERE id=?`, raw, item.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := store.GetTask(ctx, item.ID); err == nil {
			t.Fatalf("GetTask accepted corrupt reminders %q", raw)
		}
		if _, err := store.ListTasks(ctx, task.Filter{View: "all"}); err == nil {
			t.Fatalf("ListTasks accepted corrupt reminders %q", raw)
		}
	}
}

func TestArchiveFieldDefaultsAndExplicitValuesShareValidation(t *testing.T) {
	for _, scenario := range []struct {
		name, kind     string
		options        []string
		required       bool
		valid, invalid any
	}{
		{"number", "number", nil, false, float64(42), "42"},
		{"finite-number", "number", nil, false, float64(0), math.Inf(1)},
		{"date", "date", nil, false, "2026-09-05", "2026-02-30"},
		{"datetime", "datetime", nil, false, "2026-09-05T10:00:00+08:00", "2026-09-05"},
		{"select", "select", []string{"ready", "done"}, false, "ready", "missing"},
		{"multi-select", "multiSelect", []string{"ready", "done"}, false, []any{"ready"}, []any{"missing"}},
		{"required-text", "text", nil, true, "value", " "},
		{"required-multi-select", "multiSelect", []string{"ready"}, true, []any{"ready"}, []any{}},
		{"boolean", "boolean", nil, true, false, "false"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			store := openStore(t)
			ctx := context.Background()
			input := archive.FieldInput{Key: "value", Label: "Value", ValueType: scenario.kind, Options: scenario.options, Required: scenario.required, Sensitive: true, DefaultValue: scenario.invalid}
			if _, err := store.CreateArchiveField(ctx, "template", input); !errors.Is(err, app.ErrValidation) {
				t.Fatalf("invalid default accepted: err=%v", err)
			}
			input.DefaultValue = scenario.valid
			field, err := store.CreateArchiveField(ctx, "template", input)
			if err != nil || !field.Sensitive {
				t.Fatalf("field=%#v err=%v", field, err)
			}
			created, err := store.CreateArchive(ctx, archive.Input{CollectionID: "template", Title: "defaults"})
			if err != nil || !reflect.DeepEqual(created.Fields["value"], scenario.valid) {
				t.Fatalf("default=%#v err=%v", created.Fields, err)
			}
			if _, err := store.CreateArchive(ctx, archive.Input{CollectionID: "template", Title: "invalid value", Fields: map[string]any{"value": scenario.invalid}}); !errors.Is(err, app.ErrValidation) {
				t.Fatalf("invalid explicit value err=%v", err)
			}
			input.DefaultValue = scenario.invalid
			if _, err := store.UpdateArchiveField(ctx, field.ID, input); !errors.Is(err, app.ErrValidation) {
				t.Fatalf("invalid updated default err=%v", err)
			}
		})
	}
}

func TestArchiveFieldOptionsAndRequiredValuesRejectInvalidData(t *testing.T) {
	store := openStore(t)
	ctx := context.Background()
	for _, options := range [][]string{nil, {}, {""}, {" "}, {"one", "one"}} {
		if _, err := store.CreateArchiveField(ctx, "template", archive.FieldInput{Key: "choice", Label: "Choice", ValueType: "select", Options: options}); !errors.Is(err, app.ErrValidation) {
			t.Fatalf("options=%v err=%v", options, err)
		}
	}
	field, err := store.CreateArchiveField(ctx, "template", archive.FieldInput{Key: "required", Label: "Required", ValueType: "text", Required: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, values := range []map[string]any{nil, {"required": nil}, {"required": ""}, {"required": " "}} {
		if _, err := store.CreateArchive(ctx, archive.Input{CollectionID: "template", Title: "missing required", Fields: values}); !errors.Is(err, app.ErrValidation) {
			t.Fatalf("values=%v err=%v", values, err)
		}
	}
	if _, err := store.DB().ExecContext(ctx, `UPDATE archive_fields SET default_value_json='12' WHERE id=?`, field.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateArchive(ctx, archive.Input{CollectionID: "template", Title: "corrupt default"}); !errors.Is(err, app.ErrValidation) {
		t.Fatalf("stored invalid default bypassed validation: %v", err)
	}
}

func TestCollectionDeletionIgnoresTrashedRecordsAndPreservesTheirFieldValues(t *testing.T) {
	store := openStore(t)
	ctx := context.Background()
	collection, err := store.CreateArchiveCollection(ctx, archive.CollectionInput{Name: "Disposable", Icon: "Table2", Color: "#527A9E"})
	if err != nil {
		t.Fatal(err)
	}
	field, err := store.CreateArchiveField(ctx, collection.ID, archive.FieldInput{Key: "value", Label: "Value", ValueType: "text"})
	if err != nil {
		t.Fatal(err)
	}
	item, err := store.CreateArchive(ctx, archive.Input{CollectionID: collection.ID, Title: "history", Fields: map[string]any{"value": "retained"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteArchiveCollection(ctx, collection.ID); !errors.Is(err, app.ErrConflict) {
		t.Fatalf("active record delete err=%v", err)
	}
	if err := store.TrashArchive(ctx, item.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteArchiveCollection(ctx, collection.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetArchiveCollection(ctx, collection.ID); !errors.Is(err, app.ErrNotFound) {
		t.Fatalf("deleted collection err=%v", err)
	}
	var count int
	if err := store.DB().QueryRowContext(ctx, `SELECT count(*) FROM archive_record_values WHERE archive_id=? AND field_definition_id=?`, item.ID, field.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("history values=%d err=%v", count, err)
	}
	if err := store.DeleteArchiveCollection(ctx, collection.ID); !errors.Is(err, app.ErrNotFound) {
		t.Fatalf("second deletion err=%v", err)
	}
}

func TestArchivePaginationRejectsInvalidStorageInputs(t *testing.T) {
	store := openStore(t)
	for _, bounds := range [][2]int{{0, 0}, {-1, 0}, {201, 0}, {50, -1}, {50, 1_000_001}} {
		if _, err := store.ListArchiveRecords(context.Background(), "", "", "updated", bounds[0], bounds[1]); !errors.Is(err, app.ErrValidation) {
			t.Fatalf("bounds=%v err=%v", bounds, err)
		}
	}
}
