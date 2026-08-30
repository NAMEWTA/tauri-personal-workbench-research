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
	"github.com/personal-workbench/workbenchd/internal/archive"
	"github.com/personal-workbench/workbenchd/internal/platform"
)

const archiveColumns = `a.id,a.archive_type_id,t.name,t.icon,t.color,a.title,a.summary,a.body,a.created_at,a.updated_at`

func (s *Store) ListArchives(ctx context.Context, query, typeID, sortBy string, limit, offset int) (app.ArchivePage, error) {
	if limit < 1 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	pattern := "%" + strings.TrimSpace(query) + "%"
	condition := `a.deleted_at IS NULL AND t.deleted_at IS NULL AND (a.title LIKE ? OR a.summary LIKE ?)`
	args := []any{pattern, pattern}
	if typeID != "" {
		condition += ` AND a.archive_type_id=?`
		args = append(args, typeID)
	}
	order := `a.updated_at DESC,a.id DESC`
	switch sortBy {
	case "", "updated":
	case "title":
		order = `a.title COLLATE NOCASE,a.id`
	default:
		return app.ArchivePage{}, app.ErrValidation
	}
	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM archives a JOIN archive_types t ON t.id=a.archive_type_id WHERE `+condition, args...).Scan(&total); err != nil {
		return app.ArchivePage{}, err
	}
	args = append(args, limit, offset)
	rows, err := s.db.QueryContext(ctx, `SELECT `+archiveColumns+` FROM archives a JOIN archive_types t ON t.id=a.archive_type_id WHERE `+condition+` ORDER BY `+order+` LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return app.ArchivePage{}, err
	}
	defer func() { _ = rows.Close() }()
	items := make([]archive.Archive, 0)
	for rows.Next() {
		item, err := scanArchive(rows)
		if err != nil {
			return app.ArchivePage{}, err
		}
		item.Fields, err = s.archiveFields(ctx, item.ID)
		if err != nil {
			return app.ArchivePage{}, err
		}
		items = append(items, item)
	}
	return app.ArchivePage{Items: items, Total: total, Limit: limit, Offset: offset}, rows.Err()
}

func (s *Store) GetArchive(ctx context.Context, id string) (archive.Archive, error) {
	item, err := scanArchive(s.db.QueryRowContext(ctx, `SELECT `+archiveColumns+` FROM archives a JOIN archive_types t ON t.id=a.archive_type_id WHERE a.id=? AND a.deleted_at IS NULL AND t.deleted_at IS NULL`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return archive.Archive{}, app.ErrNotFound
	}
	if err != nil {
		return archive.Archive{}, err
	}
	item.Fields, err = s.archiveFields(ctx, id)
	return item, err
}

func (s *Store) CreateArchive(ctx context.Context, input archive.Input) (archive.Archive, error) {
	if !input.Valid() {
		return archive.Archive{}, app.ErrValidation
	}
	fields, definitions, err := s.normalizeArchiveFields(ctx, input.TypeID, input.Fields, true)
	if err != nil {
		return archive.Archive{}, err
	}
	now := platform.Now()
	id := platform.NewID()
	err = s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO archives(id,archive_type_id,title,summary,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, id, input.TypeID, strings.TrimSpace(input.Title), input.Summary, input.Body, platform.TimeText(now), platform.TimeText(now)); err != nil {
			return err
		}
		if err := writeArchiveFields(ctx, tx, id, fields, definitions, now); err != nil {
			return err
		}
		return writeChange(ctx, tx, "archive", id, "create", now)
	})
	if err != nil {
		return archive.Archive{}, err
	}
	return s.GetArchive(ctx, id)
}

func (s *Store) UpdateArchive(ctx context.Context, id string, input archive.Input) (archive.Archive, error) {
	if !input.Valid() {
		return archive.Archive{}, app.ErrValidation
	}
	if _, err := s.GetArchive(ctx, id); err != nil {
		return archive.Archive{}, err
	}
	fields, definitions, err := s.normalizeArchiveFields(ctx, input.TypeID, input.Fields, false)
	if err != nil {
		return archive.Archive{}, err
	}
	now := platform.Now()
	err = s.withTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `UPDATE archives SET archive_type_id=?,title=?,summary=?,body=?,updated_at=? WHERE id=? AND deleted_at IS NULL`, input.TypeID, strings.TrimSpace(input.Title), input.Summary, input.Body, platform.TimeText(now), id)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return app.ErrNotFound
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM archive_field_values WHERE archive_id=?`, id); err != nil {
			return err
		}
		if err := writeArchiveFields(ctx, tx, id, fields, definitions, now); err != nil {
			return err
		}
		return writeChange(ctx, tx, "archive", id, "update", now)
	})
	if err != nil {
		return archive.Archive{}, err
	}
	return s.GetArchive(ctx, id)
}

func (s *Store) TrashArchive(ctx context.Context, id string) error {
	return s.trash(ctx, "archive", "archives", id)
}

func (s *Store) archiveFields(ctx context.Context, archiveID string) (map[string]any, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT f.field_key,v.value_json FROM archive_field_values v JOIN field_definitions f ON f.id=v.field_definition_id WHERE v.archive_id=? AND f.deleted_at IS NULL ORDER BY f.sort_order,f.id`, archiveID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	values := map[string]any{}
	for rows.Next() {
		var key, raw string
		if err := rows.Scan(&key, &raw); err != nil {
			return nil, err
		}
		var value any
		if err := json.Unmarshal([]byte(raw), &value); err != nil {
			return nil, err
		}
		values[key] = value
	}
	return values, rows.Err()
}

func (s *Store) normalizeArchiveFields(ctx context.Context, typeID string, values map[string]any, applyDefaults bool) (map[string]any, map[string]archive.FieldDefinition, error) {
	definition, err := s.GetArchiveType(ctx, typeID)
	if err != nil {
		return nil, nil, err
	}
	fields := make(map[string]archive.FieldDefinition, len(definition.Fields))
	for _, field := range definition.Fields {
		fields[field.Key] = field
	}
	normalized := make(map[string]any, len(values))
	for key, value := range values {
		field, ok := fields[key]
		if !ok || !validFieldValue(field, value) {
			return nil, nil, app.ErrValidation
		}
		normalized[key] = value
	}
	for _, field := range definition.Fields {
		value, present := normalized[field.Key]
		if !present && applyDefaults && field.DefaultValue != nil {
			value, present = field.DefaultValue, true
			normalized[field.Key] = value
		}
		if field.Required && (!present || emptyFieldValue(value)) {
			return nil, nil, app.ErrValidation
		}
	}
	return normalized, fields, nil
}

func validFieldValue(field archive.FieldDefinition, value any) bool {
	if value == nil {
		return !field.Required
	}
	switch field.ValueType {
	case "text", "multiline":
		_, ok := value.(string)
		return ok
	case "date":
		text, ok := value.(string)
		if !ok || text == "" {
			return ok && !field.Required
		}
		_, err := time.Parse("2006-01-02", text)
		return err == nil
	case "datetime":
		text, ok := value.(string)
		if !ok || text == "" {
			return ok && !field.Required
		}
		_, err := time.Parse(time.RFC3339, text)
		return err == nil
	case "number":
		switch value.(type) {
		case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
			return true
		default:
			return false
		}
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "select":
		text, ok := value.(string)
		if !ok || text == "" {
			return ok && !field.Required
		}
		for _, option := range field.Options {
			if text == option {
				return true
			}
		}
	}
	return false
}

func emptyFieldValue(value any) bool {
	if value == nil {
		return true
	}
	text, ok := value.(string)
	return ok && strings.TrimSpace(text) == ""
}

func writeArchiveFields(ctx context.Context, tx *sql.Tx, archiveID string, values map[string]any, definitions map[string]archive.FieldDefinition, now time.Time) error {
	for key, value := range values {
		definition, ok := definitions[key]
		if !ok {
			return app.ErrValidation
		}
		raw, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("encode field %s: %w", key, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO archive_field_values(archive_id,field_definition_id,value_json,updated_at) VALUES(?,?,?,?)`, archiveID, definition.ID, string(raw), platform.TimeText(now)); err != nil {
			return err
		}
	}
	return nil
}

func scanArchive(row scanner) (archive.Archive, error) {
	var item archive.Archive
	var created, updated string
	if err := row.Scan(&item.ID, &item.TypeID, &item.TypeName, &item.TypeIcon, &item.TypeColor, &item.Title, &item.Summary, &item.Body, &created, &updated); err != nil {
		return archive.Archive{}, err
	}
	var err error
	item.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return archive.Archive{}, err
	}
	item.UpdatedAt, err = time.Parse(time.RFC3339Nano, updated)
	item.Fields = map[string]any{}
	return item, err
}
