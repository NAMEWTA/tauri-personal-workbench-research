package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/personal-workbench/workbenchd/internal/app"
	"github.com/personal-workbench/workbenchd/internal/platform"
	"github.com/personal-workbench/workbenchd/internal/task"
)

const taskColumns = `t.id,t.title,t.status,t.priority,t.starts_at,t.ends_at,t.all_day,t.timezone,t.archive_id,COALESCE(a.title,''),t.notes,t.completed_at,t.created_at,t.updated_at`

func (s *Store) ListTasks(ctx context.Context, filter task.Filter) ([]task.Task, error) {
	location := time.Local
	var err error
	if filter.Timezone != "" {
		location, err = time.LoadLocation(filter.Timezone)
		if err != nil {
			return nil, app.ErrValidation
		}
	}
	condition := `t.deleted_at IS NULL`
	args := []any{}
	now := time.Now().In(location)
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location).UTC()
	todayEnd := todayStart.In(location).AddDate(0, 0, 1).UTC()
	tomorrowEnd := todayEnd.In(location).AddDate(0, 0, 1).UTC()
	switch filter.View {
	case "", "all":
		condition += ` AND t.status<>'done'`
	case "today":
		condition += ` AND t.status<>'done' AND t.starts_at IS NOT NULL AND (t.ends_at<? OR (t.starts_at<? AND t.ends_at>?))`
		args = append(args, platform.TimeText(todayStart), platform.TimeText(todayEnd), platform.TimeText(todayStart))
	case "tomorrow":
		condition += ` AND t.status<>'done' AND t.starts_at IS NOT NULL AND t.starts_at<? AND t.ends_at>?`
		args = append(args, platform.TimeText(tomorrowEnd), platform.TimeText(todayEnd))
	case "completed":
		condition += ` AND t.status='done'`
	default:
		return nil, app.ErrValidation
	}
	if filter.From != nil || filter.To != nil {
		if filter.From == nil || filter.To == nil || !filter.To.After(*filter.From) {
			return nil, app.ErrValidation
		}
		condition += ` AND t.starts_at IS NOT NULL AND t.starts_at<? AND t.ends_at>?`
		args = append(args, platform.TimeText(*filter.To), platform.TimeText(*filter.From))
	}
	if filter.ArchiveID != "" {
		condition += ` AND t.archive_id=?`
		args = append(args, filter.ArchiveID)
	}
	if query := strings.TrimSpace(filter.Query); query != "" {
		condition += ` AND (t.title LIKE ? OR t.notes LIKE ?)`
		pattern := "%" + query + "%"
		args = append(args, pattern, pattern)
	}
	order := `CASE WHEN t.status='done' THEN 1 ELSE 0 END,CASE WHEN t.starts_at IS NULL THEN 1 ELSE 0 END,t.starts_at,t.updated_at DESC,t.id`
	rows, err := s.db.QueryContext(ctx, `SELECT `+taskColumns+` FROM tasks t LEFT JOIN archives a ON a.id=t.archive_id AND a.deleted_at IS NULL WHERE `+condition+` ORDER BY `+order, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	items := make([]task.Task, 0)
	for rows.Next() {
		item, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetTask(ctx context.Context, id string) (task.Task, error) {
	item, err := scanTask(s.db.QueryRowContext(ctx, `SELECT `+taskColumns+` FROM tasks t LEFT JOIN archives a ON a.id=t.archive_id AND a.deleted_at IS NULL WHERE t.id=? AND t.deleted_at IS NULL`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return task.Task{}, app.ErrNotFound
	}
	return item, err
}

func (s *Store) CreateTask(ctx context.Context, input task.Input) (task.Task, error) {
	if !input.Valid() {
		return task.Task{}, app.ErrValidation
	}
	if err := s.validateTaskArchive(ctx, input.ArchiveID); err != nil {
		return task.Task{}, err
	}
	now := platform.Now()
	var completedAt *time.Time
	if input.Status == "done" {
		completedAt = &now
	}
	timezone := input.Timezone
	if timezone == "" {
		timezone = "UTC"
	}
	id := platform.NewID()
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO tasks(id,title,status,priority,starts_at,ends_at,all_day,timezone,archive_id,notes,completed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, strings.TrimSpace(input.Title), input.Status, input.Priority, nullableTime(input.StartsAt), nullableTime(input.EndsAt), input.AllDay, timezone, input.ArchiveID, input.Notes, nullableTime(completedAt), platform.TimeText(now), platform.TimeText(now)); err != nil {
			return err
		}
		return writeChange(ctx, tx, "task", id, "create", now)
	})
	if err != nil {
		return task.Task{}, err
	}
	return s.GetTask(ctx, id)
}

func (s *Store) UpdateTask(ctx context.Context, id string, input task.Input) (task.Task, error) {
	if !input.Valid() {
		return task.Task{}, app.ErrValidation
	}
	current, err := s.GetTask(ctx, id)
	if err != nil {
		return task.Task{}, err
	}
	if err := s.validateTaskArchive(ctx, input.ArchiveID); err != nil {
		return task.Task{}, err
	}
	now := platform.Now()
	completedAt := current.CompletedAt
	if input.Status == "done" && current.Status != "done" {
		completedAt = &now
	} else if input.Status != "done" {
		completedAt = nil
	}
	timezone := input.Timezone
	if timezone == "" {
		timezone = "UTC"
	}
	err = s.withTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `UPDATE tasks SET title=?,status=?,priority=?,starts_at=?,ends_at=?,all_day=?,timezone=?,archive_id=?,notes=?,completed_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL`, strings.TrimSpace(input.Title), input.Status, input.Priority, nullableTime(input.StartsAt), nullableTime(input.EndsAt), input.AllDay, timezone, input.ArchiveID, input.Notes, nullableTime(completedAt), platform.TimeText(now), id)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return app.ErrNotFound
		}
		return writeChange(ctx, tx, "task", id, "update", now)
	})
	if err != nil {
		return task.Task{}, err
	}
	return s.GetTask(ctx, id)
}

func (s *Store) TrashTask(ctx context.Context, id string) error {
	return s.trash(ctx, "task", "tasks", id)
}

func (s *Store) validateTaskArchive(ctx context.Context, archiveID *string) error {
	if archiveID == nil || *archiveID == "" {
		return nil
	}
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM archives WHERE id=? AND deleted_at IS NULL`, *archiveID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return app.ErrValidation
	}
	return nil
}

func scanTask(row scanner) (task.Task, error) {
	var item task.Task
	var starts, ends, completed sql.NullString
	var archiveID sql.NullString
	var created, updated string
	if err := row.Scan(&item.ID, &item.Title, &item.Status, &item.Priority, &starts, &ends, &item.AllDay, &item.Timezone, &archiveID, &item.ArchiveTitle, &item.Notes, &completed, &created, &updated); err != nil {
		return task.Task{}, err
	}
	if archiveID.Valid {
		item.ArchiveID = &archiveID.String
	}
	var err error
	if item.StartsAt, err = parseNullableTime(starts); err != nil {
		return task.Task{}, err
	}
	if item.EndsAt, err = parseNullableTime(ends); err != nil {
		return task.Task{}, err
	}
	if item.CompletedAt, err = parseNullableTime(completed); err != nil {
		return task.Task{}, err
	}
	if item.CreatedAt, err = time.Parse(time.RFC3339Nano, created); err != nil {
		return task.Task{}, err
	}
	item.UpdatedAt, err = time.Parse(time.RFC3339Nano, updated)
	return item, err
}
