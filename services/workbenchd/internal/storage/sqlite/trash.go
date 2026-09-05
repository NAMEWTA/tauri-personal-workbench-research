package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/personal-workbench/workbenchd/internal/app"
	"github.com/personal-workbench/workbenchd/internal/platform"
)

func (s *Store) trash(ctx context.Context, entityType, table, id string) error {
	if (entityType != "archive" || table != "archive_records") && (entityType != "task" || table != "tasks") {
		return app.ErrValidation
	}
	now := platform.Now()
	return s.withTx(ctx, func(tx *sql.Tx) error {
		var title string
		if err := tx.QueryRowContext(ctx, `SELECT title FROM `+table+` WHERE id=? AND deleted_at IS NULL`, id).Scan(&title); errors.Is(err, sql.ErrNoRows) {
			return app.ErrNotFound
		} else if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE `+table+` SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL`, platform.TimeText(now), platform.TimeText(now), id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO trash_entries(id,entity_type,entity_id,title,deleted_at) VALUES(?,?,?,?,?)`, platform.NewID(), entityType, id, title, platform.TimeText(now)); err != nil {
			return err
		}
		return writeChange(ctx, tx, entityType, id, "trash", now)
	})
}

func (s *Store) ListTrash(ctx context.Context) ([]app.TrashEntry, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,entity_id,entity_type,title,deleted_at FROM trash_entries ORDER BY deleted_at DESC,id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	items := make([]app.TrashEntry, 0)
	for rows.Next() {
		var item app.TrashEntry
		var deleted string
		if err := rows.Scan(&item.ID, &item.EntityID, &item.EntityType, &item.Title, &deleted); err != nil {
			return nil, err
		}
		item.DeletedAt, err = time.Parse(time.RFC3339Nano, deleted)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) RestoreTrash(ctx context.Context, trashID string) error {
	now := platform.Now()
	return s.withTx(ctx, func(tx *sql.Tx) error {
		var entityType, entityID string
		if err := tx.QueryRowContext(ctx, `SELECT entity_type,entity_id FROM trash_entries WHERE id=?`, trashID).Scan(&entityType, &entityID); errors.Is(err, sql.ErrNoRows) {
			return app.ErrNotFound
		} else if err != nil {
			return err
		}
		var statement string
		switch entityType {
		case "archive":
			statement = `UPDATE archive_records SET deleted_at=NULL,updated_at=? WHERE id=? AND deleted_at IS NOT NULL`
		case "task":
			statement = `UPDATE tasks SET deleted_at=NULL,updated_at=? WHERE id=? AND deleted_at IS NOT NULL`
		case "attachment":
			statement = `UPDATE attachments SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL`
		default:
			return app.ErrValidation
		}
		var result sql.Result
		var err error
		if entityType == "attachment" {
			result, err = tx.ExecContext(ctx, statement, entityID)
		} else {
			result, err = tx.ExecContext(ctx, statement, platform.TimeText(now), entityID)
		}
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return app.ErrNotFound
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM trash_entries WHERE id=?`, trashID); err != nil {
			return err
		}
		changeType := entityType
		changeID := entityID
		if entityType == "attachment" {
			changeType = "archive"
			if err := tx.QueryRowContext(ctx, `SELECT entity_id FROM attachments WHERE id=?`, entityID).Scan(&changeID); err != nil {
				return err
			}
			return writeChange(ctx, tx, changeType, changeID, "attachment_restore", now)
		}
		return writeChange(ctx, tx, changeType, changeID, "restore", now)
	})
}
