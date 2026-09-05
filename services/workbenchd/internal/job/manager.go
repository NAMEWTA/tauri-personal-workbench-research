package job

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/personal-workbench/workbenchd/internal/platform"
)

type Job struct {
	ID         string     `json:"id"`
	Type       string     `json:"type"`
	State      string     `json:"state"`
	Progress   int        `json:"progress"`
	Stage      string     `json:"stage"`
	StartedAt  time.Time  `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt"`
	Error      string     `json:"error"`
}

func (j Job) Terminal() bool {
	return j.State == "succeeded" || j.State == "failed" || j.State == "cancelled"
}

type Manager struct {
	db          *sql.DB
	mu          sync.RWMutex
	jobs        map[string]Job
	cancels     map[string]context.CancelFunc
	subscribers map[string]map[chan Job]struct{}
	wg          sync.WaitGroup
}

func NewManager(db *sql.DB) *Manager {
	m := &Manager{db: db, jobs: map[string]Job{}, cancels: map[string]context.CancelFunc{}, subscribers: map[string]map[chan Job]struct{}{}}
	m.load()
	return m
}

func (m *Manager) load() {
	if m.db == nil {
		return
	}
	now := platform.Now()
	_, _ = m.db.Exec(`UPDATE background_jobs SET state='failed',stage='interrupted',finished_at=?,error='服务重启，任务已中断' WHERE state IN ('queued','running')`, platform.TimeText(now))
	rows, err := m.db.Query(`SELECT id,job_type,state,progress,stage,started_at,finished_at,error FROM background_jobs ORDER BY started_at DESC LIMIT 200`)
	if err != nil {
		return
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		item, err := scan(rows)
		if err == nil {
			m.jobs[item.ID] = item
		}
	}
}

func (m *Manager) Start(kind string, operation func(context.Context, func(int, string)) error) (Job, error) {
	item := Job{ID: platform.NewID(), Type: kind, State: "queued", Stage: "queued", StartedAt: platform.Now()}
	if err := m.persist(item); err != nil {
		return Job{}, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.mu.Lock()
	m.jobs[item.ID] = item
	m.cancels[item.ID] = cancel
	m.mu.Unlock()
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		defer func() {
			cancel()
			m.mu.Lock()
			delete(m.cancels, item.ID)
			m.mu.Unlock()
		}()
		if !m.update(item.ID, func(value *Job) { value.State, value.Stage = "running", "preparing" }) {
			return
		}
		err := operation(ctx, func(progress int, stage string) {
			m.update(item.ID, func(value *Job) {
				value.Progress = max(0, min(100, progress))
				value.Stage = stage
			})
		})
		finished := platform.Now()
		m.update(item.ID, func(value *Job) {
			value.FinishedAt = &finished
			switch {
			case errors.Is(err, context.Canceled):
				value.State, value.Stage, value.Error = "cancelled", "cancelled", ""
			case err != nil:
				value.State, value.Stage, value.Error = "failed", "failed", "任务未能完成"
			default:
				value.State, value.Stage, value.Progress = "succeeded", "complete", 100
			}
		})
	}()
	return item, nil
}

func (m *Manager) Shutdown(ctx context.Context) error {
	m.mu.RLock()
	cancels := make([]context.CancelFunc, 0, len(m.cancels))
	for _, cancel := range m.cancels {
		cancels = append(cancels, cancel)
	}
	m.mu.RUnlock()
	for _, cancel := range cancels {
		cancel()
	}
	done := make(chan struct{})
	go func() { m.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (m *Manager) Get(id string) (Job, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	value, ok := m.jobs[id]
	return value, ok
}

func (m *Manager) Cancel(id string) (Job, bool) {
	m.mu.RLock()
	cancel, active := m.cancels[id]
	item, exists := m.jobs[id]
	m.mu.RUnlock()
	if !exists || item.Terminal() {
		return item, exists
	}
	if active {
		cancel()
	}
	return item, true
}

func (m *Manager) Subscribe(id string) (<-chan Job, func(), bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.jobs[id]
	if !ok {
		return nil, func() {}, false
	}
	updates := make(chan Job, 1)
	updates <- item
	if m.subscribers[id] == nil {
		m.subscribers[id] = map[chan Job]struct{}{}
	}
	m.subscribers[id][updates] = struct{}{}
	return updates, func() {
		m.mu.Lock()
		delete(m.subscribers[id], updates)
		m.mu.Unlock()
	}, true
}

func (m *Manager) update(id string, change func(*Job)) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	value, ok := m.jobs[id]
	if !ok || value.Terminal() {
		return false
	}
	previous := value
	change(&value)
	// 进度回调可能运行于数据库事务内；仅持久化生命周期，最终状态包含最终进度。
	if value.State != previous.State {
		if err := m.persist(value); err != nil {
			slog.Error("persist job state", "job_id", id, "state", value.State, "error", err)
			value.State, value.Stage, value.Error = "failed", "failed", "任务状态无法持久化"
			value.Progress = previous.Progress
			finished := platform.Now()
			value.FinishedAt = &finished
			if err := m.persist(value); err != nil {
				slog.Error("persist failed job state", "job_id", id, "error", err)
			}
		}
	}
	// 持久化完成后才发布内存状态，Get 和新订阅者不会看到未落盘的成功状态。
	m.jobs[id] = value
	for listener := range m.subscribers[id] {
		select {
		case listener <- value:
		default:
			select {
			case <-listener:
			default:
			}
			select {
			case listener <- value:
			default:
			}
		}
	}
	return value.State != "failed"
}

func (m *Manager) persist(item Job) error {
	if m.db == nil {
		return nil
	}
	var finished any
	if item.FinishedAt != nil {
		finished = platform.TimeText(*item.FinishedAt)
	}
	_, err := m.db.Exec(`INSERT INTO background_jobs(id,job_type,state,progress,stage,started_at,finished_at,error) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,progress=excluded.progress,stage=excluded.stage,finished_at=excluded.finished_at,error=excluded.error`, item.ID, item.Type, item.State, item.Progress, item.Stage, platform.TimeText(item.StartedAt), finished, item.Error)
	return err
}

type scanner interface{ Scan(...any) error }

func scan(row scanner) (Job, error) {
	var item Job
	var started string
	var finished sql.NullString
	err := row.Scan(&item.ID, &item.Type, &item.State, &item.Progress, &item.Stage, &started, &finished, &item.Error)
	if err != nil {
		return Job{}, err
	}
	item.StartedAt, err = time.Parse(time.RFC3339Nano, started)
	if err != nil {
		return Job{}, err
	}
	if finished.Valid {
		value, parseErr := time.Parse(time.RFC3339Nano, finished.String)
		if parseErr != nil {
			return Job{}, parseErr
		}
		item.FinishedAt = &value
	}
	return item, nil
}
