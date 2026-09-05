package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/personal-workbench/workbenchd/internal/app"
	"github.com/personal-workbench/workbenchd/internal/platform"
	"github.com/personal-workbench/workbenchd/internal/task"
)

const taskColumns = `t.id,t.title,t.status,t.priority,t.starts_at,t.ends_at,t.due_on,t.all_day,t.timezone,t.archive_id,COALESCE(a.title,''),t.notes,t.recurrence_json,t.reminders_json,t.parent_id,t.estimate_minutes,t.completed_at,t.created_at,t.updated_at`

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
	todayStart, todayEnd := platform.LocalDayRange(now, location)
	tomorrowEnd := todayEnd.In(location).AddDate(0, 0, 1).UTC()
	switch filter.View {
	case "", "all":
		condition += ` AND t.status<>'done'`
	case "inbox":
		condition += ` AND t.status<>'done' AND t.starts_at IS NULL AND t.due_on IS NULL`
	case "upcoming":
		condition += ` AND t.status<>'done' AND (t.due_on>=? OR t.starts_at>=?)`
		args = append(args, now.Format("2006-01-02"), platform.TimeText(now.UTC()))
	case "today":
		condition += ` AND t.status<>'done' AND (t.due_on=? OR (t.starts_at IS NOT NULL AND t.starts_at<? AND t.ends_at>?))`
		args = append(args, now.Format("2006-01-02"), platform.TimeText(todayEnd), platform.TimeText(todayStart))
	case "tomorrow":
		tomorrowStart := todayEnd
		tomorrowEnd = tomorrowStart.In(location).AddDate(0, 0, 1).UTC()
		condition += ` AND t.status<>'done' AND (t.due_on=? OR (t.starts_at IS NOT NULL AND t.starts_at<? AND t.ends_at>?))`
		args = append(args, tomorrowStart.In(location).Format("2006-01-02"), platform.TimeText(tomorrowEnd), platform.TimeText(tomorrowStart))
	case "calendar":
		// Calendar is a time projection and includes completed scheduled tasks.
		condition += ` AND t.starts_at IS NOT NULL AND t.ends_at IS NOT NULL`
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
	if filter.RecordID != "" {
		condition += ` AND t.archive_id=?`
		args = append(args, filter.RecordID)
	}
	if filter.DueFrom != "" {
		if _, err := time.Parse("2006-01-02", filter.DueFrom); err != nil {
			return nil, app.ErrValidation
		}
		condition += ` AND t.due_on>=?`
		args = append(args, filter.DueFrom)
	}
	if filter.DueTo != "" {
		if _, err := time.Parse("2006-01-02", filter.DueTo); err != nil {
			return nil, app.ErrValidation
		}
		condition += ` AND t.due_on<=?`
		args = append(args, filter.DueTo)
	}
	if !filter.IncludeUnscheduled && filter.View == "calendar" {
		condition += ` AND t.starts_at IS NOT NULL`
	}
	if query := strings.TrimSpace(filter.Query); query != "" {
		condition += ` AND (t.title LIKE ? OR t.notes LIKE ?)`
		pattern := "%" + query + "%"
		args = append(args, pattern, pattern)
	}
	order := `CASE WHEN t.status='done' THEN 1 ELSE 0 END,CASE WHEN t.starts_at IS NULL THEN 1 ELSE 0 END,t.starts_at,t.updated_at DESC,t.id`
	rows, err := s.db.QueryContext(ctx, `SELECT `+taskColumns+` FROM tasks t LEFT JOIN archive_records a ON a.id=t.archive_id AND a.deleted_at IS NULL WHERE `+condition+` ORDER BY `+order, args...)
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
	item, err := scanTask(s.db.QueryRowContext(ctx, `SELECT `+taskColumns+` FROM tasks t LEFT JOIN archive_records a ON a.id=t.archive_id AND a.deleted_at IS NULL WHERE t.id=? AND t.deleted_at IS NULL`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return task.Task{}, app.ErrNotFound
	}
	return item, err
}

func (s *Store) CreateTask(ctx context.Context, input task.Input) (task.Task, error) {
	if !input.Valid() {
		return task.Task{}, app.ErrValidation
	}
	if err := s.validateTaskArchive(ctx, input.RecordID); err != nil {
		return task.Task{}, err
	}
	if err := s.validateParent(ctx, input.ParentID, ""); err != nil {
		return task.Task{}, err
	}
	if err := validateRecurrence(input.Recurrence); err != nil {
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
		reminders, _ := json.Marshal(input.Reminders)
		if _, err := tx.ExecContext(ctx, `INSERT INTO tasks(id,title,status,priority,starts_at,ends_at,due_on,all_day,timezone,archive_id,notes,recurrence_json,reminders_json,parent_id,estimate_minutes,completed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, strings.TrimSpace(input.Title), input.Status, input.Priority, nullableTime(input.StartsAt), nullableTime(input.EndsAt), nullableString(input.DueOn), input.AllDay, timezone, input.RecordID, input.Notes, input.Recurrence, string(reminders), input.ParentID, input.EstimateMins, nullableTime(completedAt), platform.TimeText(now), platform.TimeText(now)); err != nil {
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
	if err := s.validateTaskArchive(ctx, input.RecordID); err != nil {
		return task.Task{}, err
	}
	if err := s.validateParent(ctx, input.ParentID, id); err != nil {
		return task.Task{}, err
	}
	if err := validateRecurrence(input.Recurrence); err != nil {
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
		reminders, _ := json.Marshal(input.Reminders)
		result, err := tx.ExecContext(ctx, `UPDATE tasks SET title=?,status=?,priority=?,starts_at=?,ends_at=?,due_on=?,all_day=?,timezone=?,archive_id=?,notes=?,recurrence_json=?,reminders_json=?,parent_id=?,estimate_minutes=?,completed_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL`, strings.TrimSpace(input.Title), input.Status, input.Priority, nullableTime(input.StartsAt), nullableTime(input.EndsAt), nullableString(input.DueOn), input.AllDay, timezone, input.RecordID, input.Notes, input.Recurrence, string(reminders), input.ParentID, input.EstimateMins, nullableTime(completedAt), platform.TimeText(now), id)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return app.ErrNotFound
		}
		if err := writeChange(ctx, tx, "task", id, "update", now); err != nil {
			return err
		}
		if current.Status != "done" && input.Status == "done" && input.Recurrence != "" {
			return createNextRecurringTask(ctx, tx, input, now)
		}
		return nil
	})
	if err != nil {
		return task.Task{}, err
	}
	return s.GetTask(ctx, id)
}

func createNextRecurringTask(ctx context.Context, tx *sql.Tx, input task.Input, now time.Time) error {
	shift := func(value time.Time) time.Time {
		switch strings.ToUpper(strings.TrimSpace(input.Recurrence)) {
		case "FREQ=DAILY":
			return value.AddDate(0, 0, 1)
		case "FREQ=WEEKLY":
			return value.AddDate(0, 0, 7)
		case "FREQ=MONTHLY":
			return value.AddDate(0, 1, 0)
		default:
			return time.Time{}
		}
	}
	if shift(now).IsZero() {
		return nil
	}
	var dueOn *string
	if input.DueOn != nil {
		parsed, err := time.Parse("2006-01-02", *input.DueOn)
		if err != nil {
			return app.ErrValidation
		}
		next := shift(parsed).Format("2006-01-02")
		dueOn = &next
	}
	var starts, ends *time.Time
	if input.StartsAt != nil && input.EndsAt != nil {
		nextStart, nextEnd := shift(*input.StartsAt), shift(*input.EndsAt)
		starts, ends = &nextStart, &nextEnd
	}
	reminders, _ := json.Marshal(input.Reminders)
	_, err := tx.ExecContext(ctx, `INSERT INTO tasks(id,title,status,priority,starts_at,ends_at,due_on,all_day,timezone,archive_id,notes,recurrence_json,reminders_json,parent_id,estimate_minutes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, platform.NewID(), strings.TrimSpace(input.Title), "todo", input.Priority, nullableTime(starts), nullableTime(ends), nullableString(dueOn), input.AllDay, input.Timezone, input.RecordID, input.Notes, input.Recurrence, string(reminders), input.ParentID, input.EstimateMins, platform.TimeText(now), platform.TimeText(now))
	return err
}

func (s *Store) TrashTask(ctx context.Context, id string) error {
	return s.trash(ctx, "task", "tasks", id)
}

func (s *Store) validateTaskArchive(ctx context.Context, archiveID *string) error {
	if archiveID == nil || *archiveID == "" {
		return nil
	}
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM archive_records WHERE id=? AND deleted_at IS NULL`, *archiveID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return app.ErrNotFound
	}
	return nil
}

func validateRecurrence(value string) error {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "FREQ=DAILY", "FREQ=WEEKLY", "FREQ=MONTHLY":
		return nil
	default:
		return app.ErrValidation
	}
}

func (s *Store) validateParent(ctx context.Context, parentID *string, taskID string) error {
	if parentID == nil || strings.TrimSpace(*parentID) == "" {
		return nil
	}
	current := strings.TrimSpace(*parentID)
	seen := map[string]bool{}
	for current != "" {
		if current == taskID || seen[current] {
			return app.ErrValidation
		}
		seen[current] = true
		var next sql.NullString
		var deleted sql.NullString
		err := s.db.QueryRowContext(ctx, `SELECT parent_id,deleted_at FROM tasks WHERE id=?`, current).Scan(&next, &deleted)
		if errors.Is(err, sql.ErrNoRows) {
			return app.ErrNotFound
		}
		if err != nil {
			return err
		}
		if deleted.Valid {
			return app.ErrNotFound
		}
		if next.Valid {
			current = next.String
		} else {
			current = ""
		}
	}
	return nil
}

func scanTask(row scanner) (task.Task, error) {
	var item task.Task
	var starts, ends, dueOn, remindersJSON, completed sql.NullString
	var archiveID sql.NullString
	var parentID sql.NullString
	var estimate sql.NullInt64
	var created, updated string
	if err := row.Scan(&item.ID, &item.Title, &item.Status, &item.Priority, &starts, &ends, &dueOn, &item.AllDay, &item.Timezone, &archiveID, &item.RecordTitle, &item.Notes, &item.Recurrence, &remindersJSON, &parentID, &estimate, &completed, &created, &updated); err != nil {
		return task.Task{}, err
	}
	if archiveID.Valid {
		item.RecordID = &archiveID.String
	}
	if dueOn.Valid {
		item.DueOn = &dueOn.String
	}
	if parentID.Valid {
		item.ParentID = &parentID.String
	}
	if estimate.Valid {
		value := int(estimate.Int64)
		item.EstimateMins = &value
	}
	if remindersJSON.Valid && remindersJSON.String != "" {
		if err := json.Unmarshal([]byte(remindersJSON.String), &item.Reminders); err != nil {
			return task.Task{}, fmt.Errorf("decode reminders: %w", err)
		}
	}
	if item.Reminders == nil {
		item.Reminders = []string{}
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

func nullableString(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}
