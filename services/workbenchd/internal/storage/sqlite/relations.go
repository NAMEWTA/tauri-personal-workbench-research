package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/personal-workbench/workbenchd/internal/app"
	"github.com/personal-workbench/workbenchd/internal/platform"
	"github.com/personal-workbench/workbenchd/internal/relation"
)

func (s *Store) ListRelations(ctx context.Context, archiveID string) ([]relation.Relation, error) {
	if _, err := s.GetArchive(ctx, archiveID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT r.id,r.source_id,r.target_id,a.title,t.id,t.name,r.relation_type,r.notes,r.created_at
		FROM entity_relations r
		JOIN archives a ON a.id=r.target_id AND a.deleted_at IS NULL
		JOIN archive_types t ON t.id=a.archive_type_id AND t.deleted_at IS NULL
		WHERE r.source_type='archive' AND r.source_id=? AND r.target_type='archive' AND r.deleted_at IS NULL
		ORDER BY r.created_at DESC,r.id`, archiveID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	items := make([]relation.Relation, 0)
	for rows.Next() {
		var item relation.Relation
		var created string
		if err := rows.Scan(&item.ID, &item.SourceID, &item.TargetID, &item.TargetTitle, &item.TargetTypeID, &item.TargetTypeName, &item.RelationType, &item.Notes, &created); err != nil {
			return nil, err
		}
		item.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) CreateRelation(ctx context.Context, sourceID string, input relation.Input) (relation.Relation, error) {
	if !input.Valid() || sourceID == input.TargetID {
		return relation.Relation{}, app.ErrValidation
	}
	if _, err := s.GetArchive(ctx, sourceID); err != nil {
		return relation.Relation{}, err
	}
	if _, err := s.GetArchive(ctx, input.TargetID); err != nil {
		if errors.Is(err, app.ErrNotFound) {
			return relation.Relation{}, app.ErrValidation
		}
		return relation.Relation{}, err
	}
	now := platform.Now()
	id := platform.NewID()
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO entity_relations(id,source_type,source_id,target_type,target_id,relation_type,notes,created_at) VALUES(?,'archive',?,'archive',?,?,?,?)`, id, sourceID, input.TargetID, strings.TrimSpace(input.RelationType), input.Notes, platform.TimeText(now)); err != nil {
			return err
		}
		return writeChange(ctx, tx, "archive", sourceID, "relation_create", now)
	})
	if err != nil {
		return relation.Relation{}, err
	}
	items, err := s.ListRelations(ctx, sourceID)
	if err != nil {
		return relation.Relation{}, err
	}
	for _, item := range items {
		if item.ID == id {
			return item, nil
		}
	}
	return relation.Relation{}, app.ErrNotFound
}

func (s *Store) DeleteRelation(ctx context.Context, id string) error {
	now := platform.Now()
	return s.withTx(ctx, func(tx *sql.Tx) error {
		var sourceID string
		if err := tx.QueryRowContext(ctx, `SELECT source_id FROM entity_relations WHERE id=? AND deleted_at IS NULL`, id).Scan(&sourceID); errors.Is(err, sql.ErrNoRows) {
			return app.ErrNotFound
		} else if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE entity_relations SET deleted_at=? WHERE id=?`, platform.TimeText(now), id); err != nil {
			return err
		}
		return writeChange(ctx, tx, "archive", sourceID, "relation_delete", now)
	})
}
