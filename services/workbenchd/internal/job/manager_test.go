package job_test

import (
	"context"
	"testing"
	"time"

	"github.com/personal-workbench/workbenchd/internal/job"
	workbenchsqlite "github.com/personal-workbench/workbenchd/internal/storage/sqlite"
)

func TestCancelPublishesAndPersistsTerminalState(t *testing.T) {
	store, err := workbenchsqlite.Open(context.Background(), t.TempDir(), "任务测试", "0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	manager := job.NewManager(store.DB())
	started := make(chan struct{})
	item, err := manager.Start("backup", func(ctx context.Context, progress func(int, string)) error {
		progress(25, "database")
		close(started)
		<-ctx.Done()
		return ctx.Err()
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("job did not start")
	}
	updates, unsubscribe, ok := manager.Subscribe(item.ID)
	if !ok {
		t.Fatal("job subscription was not created")
	}
	defer unsubscribe()
	if _, ok := manager.Cancel(item.ID); !ok {
		t.Fatal("job was not cancelled")
	}
	deadline := time.After(2 * time.Second)
	for {
		select {
		case update := <-updates:
			if update.State == "cancelled" {
				reloaded := job.NewManager(store.DB())
				persisted, ok := reloaded.Get(item.ID)
				if !ok || persisted.State != "cancelled" || persisted.FinishedAt == nil {
					t.Fatalf("terminal state was not persisted: %#v", persisted)
				}
				return
			}
		case <-deadline:
			t.Fatal("cancelled update was not published")
		}
	}
}
