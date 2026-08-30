package sqlite

import (
	"context"
	"time"

	"github.com/personal-workbench/workbenchd/internal/app"
)

func (s *Store) ListActivity(ctx context.Context, entityType, entityID string) ([]app.Activity, error) {
	if entityType != "archive" && entityType != "task" {
		return nil, app.ErrValidation
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,action,changed_at FROM change_log WHERE entity_type=? AND entity_id=? ORDER BY changed_at DESC,id DESC LIMIT 100`, entityType, entityID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	items := make([]app.Activity, 0)
	for rows.Next() {
		var item app.Activity
		var changed string
		if err := rows.Scan(&item.ID, &item.Action, &changed); err != nil {
			return nil, err
		}
		item.ChangedAt, err = time.Parse(time.RFC3339Nano, changed)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
