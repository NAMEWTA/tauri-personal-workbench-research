package sqlite

import (
	"context"
	"database/sql"
	"strings"
	"unicode/utf8"

	"github.com/personal-workbench/workbenchd/internal/app"
)

func (s *Store) Search(ctx context.Context, query string) ([]app.SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []app.SearchResult{}, nil
	}
	if utf8.RuneCountInString(query) >= 3 {
		items, err := s.searchFTS(ctx, query)
		if err == nil {
			return items, nil
		}
	}
	return s.searchLike(ctx, query)
}

func (s *Store) searchFTS(ctx context.Context, query string) ([]app.SearchResult, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT i.entity_type,
			CASE WHEN i.entity_type='attachment' THEN a.entity_id ELSE i.entity_id END,
			i.title,
			CASE i.entity_type
				WHEN 'archive' THEN COALESCE(ar.summary,'')
				WHEN 'task' THEN COALESCE(t.notes,'')
				WHEN 'attachment' THEN COALESCE(owner.title,'')
				ELSE '' END
		FROM search_index i
		LEFT JOIN archives ar ON i.entity_type='archive' AND ar.id=i.entity_id AND ar.deleted_at IS NULL
		LEFT JOIN tasks t ON i.entity_type='task' AND t.id=i.entity_id AND t.deleted_at IS NULL
		LEFT JOIN attachments a ON i.entity_type='attachment' AND a.id=i.entity_id AND a.deleted_at IS NULL
		LEFT JOIN archives owner ON owner.id=a.entity_id AND owner.deleted_at IS NULL
		WHERE search_index MATCH ?
			AND (i.entity_type<>'attachment' OR (a.id IS NOT NULL AND owner.id IS NOT NULL))
		ORDER BY bm25(search_index),i.title
		LIMIT 50`, quoteFTS(query))
	if err != nil {
		return nil, err
	}
	return scanSearchResults(rows)
}

func (s *Store) searchLike(ctx context.Context, query string) ([]app.SearchResult, error) {
	pattern := "%" + query + "%"
	rows, err := s.db.QueryContext(ctx, `
		SELECT 'archive',a.id,a.title,a.summary
		FROM archives a
		WHERE a.deleted_at IS NULL AND (a.title LIKE ? OR a.summary LIKE ? OR a.body LIKE ? OR EXISTS (
			SELECT 1 FROM archive_field_values v WHERE v.archive_id=a.id AND v.value_json LIKE ?))
		UNION ALL
		SELECT 'task',t.id,t.title,t.notes
		FROM tasks t WHERE t.deleted_at IS NULL AND (t.title LIKE ? OR t.notes LIKE ?)
		UNION ALL
		SELECT 'attachment',owner.id,att.display_name,owner.title
		FROM attachments att JOIN archives owner ON owner.id=att.entity_id
		WHERE att.deleted_at IS NULL AND owner.deleted_at IS NULL AND (att.display_name LIKE ? OR att.media_type LIKE ?)
		LIMIT 50`, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern)
	if err != nil {
		return nil, err
	}
	return scanSearchResults(rows)
}

func scanSearchResults(rows *sql.Rows) ([]app.SearchResult, error) {
	defer func() { _ = rows.Close() }()
	items := make([]app.SearchResult, 0)
	for rows.Next() {
		var item app.SearchResult
		if err := rows.Scan(&item.Type, &item.ID, &item.Title, &item.Subtitle); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func quoteFTS(query string) string {
	return `"` + strings.ReplaceAll(query, `"`, `""`) + `"`
}

func (s *Store) SearchHealthy(ctx context.Context) bool {
	var expected, indexed int
	if err := s.db.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM archives WHERE deleted_at IS NULL)+
		(SELECT count(*) FROM tasks WHERE deleted_at IS NULL)+
		(SELECT count(*) FROM attachments WHERE deleted_at IS NULL)`).Scan(&expected); err != nil {
		return false
	}
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM search_index`).Scan(&indexed); err != nil {
		return false
	}
	return expected == indexed
}

func (s *Store) RebuildSearch(ctx context.Context, progress func(int, string)) error {
	progress(5, "clearing")
	return s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM search_index`); err != nil {
			return err
		}
		progress(25, "archives")
		if _, err := tx.ExecContext(ctx, `INSERT INTO search_index(entity_type,entity_id,title,content)
			SELECT 'archive',a.id,a.title,a.summary || ' ' || a.body || ' ' || COALESCE(group_concat(v.value_json,' '),'')
			FROM archives a LEFT JOIN archive_field_values v ON v.archive_id=a.id
			WHERE a.deleted_at IS NULL GROUP BY a.id`); err != nil {
			return err
		}
		progress(55, "tasks")
		if _, err := tx.ExecContext(ctx, `INSERT INTO search_index(entity_type,entity_id,title,content) SELECT 'task',id,title,notes FROM tasks WHERE deleted_at IS NULL`); err != nil {
			return err
		}
		progress(80, "attachments")
		if _, err := tx.ExecContext(ctx, `INSERT INTO search_index(entity_type,entity_id,title,content) SELECT 'attachment',id,display_name,media_type FROM attachments WHERE deleted_at IS NULL`); err != nil {
			return err
		}
		progress(100, "complete")
		return nil
	})
}
