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

func TestTerminalPersistenceFailureNeverPublishesSuccess(t *testing.T) {
	for _, scenario := range []struct {
		name, condition      string
		failedStatePersisted bool
	}{
		{"success-write-rejected", "NEW.state='succeeded'", true},
		{"all-writes-rejected", "1=1", false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			store, err := workbenchsqlite.Open(context.Background(), t.TempDir(), "任务持久化失败", "0.2.9")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = store.Close() })
			manager := job.NewManager(store.DB())
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				if err := manager.Shutdown(ctx); err != nil {
					t.Error(err)
				}
			})
			started, release := make(chan struct{}), make(chan struct{})
			item, err := manager.Start("test", func(ctx context.Context, progress func(int, string)) error {
				progress(50, "working")
				close(started)
				select {
				case <-release:
					return nil
				case <-ctx.Done():
					return ctx.Err()
				}
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
				t.Fatal("job subscription missing")
			}
			defer unsubscribe()
			if _, err := store.DB().Exec(`CREATE TRIGGER reject_terminal BEFORE UPDATE ON background_jobs WHEN ` + scenario.condition + ` BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END`); err != nil {
				t.Fatal(err)
			}
			close(release)
			deadline := time.After(2 * time.Second)
			for {
				select {
				case update := <-updates:
					if !update.Terminal() {
						continue
					}
					if update.State != "failed" || update.FinishedAt == nil || update.Error != "任务状态无法持久化" {
						t.Fatalf("terminal update=%#v", update)
					}
					current, ok := manager.Get(item.ID)
					if !ok || current.State != "failed" {
						t.Fatalf("Get exposed invalid state: %#v", current)
					}
					if scenario.failedStatePersisted {
						var state string
						if err := store.DB().QueryRow(`SELECT state FROM background_jobs WHERE id=?`, item.ID).Scan(&state); err != nil || state != "failed" {
							t.Fatalf("persisted state=%q err=%v", state, err)
						}
					}
					return
				case <-deadline:
					t.Fatal("terminal failure was not published")
				}
			}
		})
	}
}
