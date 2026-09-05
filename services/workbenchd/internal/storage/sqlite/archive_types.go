package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/personal-workbench/workbenchd/internal/app"
	"github.com/personal-workbench/workbenchd/internal/archive"
	"github.com/personal-workbench/workbenchd/internal/platform"
)

func (s *Store) ListArchiveCollections(ctx context.Context) ([]archive.CollectionDefinition, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT t.id,t.name,t.icon,t.color,t.sort_order,f.id,f.field_key,f.label,f.value_type,f.group_name,f.is_required,f.is_sensitive,f.options_json,f.default_value_json,f.sort_order FROM archive_collections t LEFT JOIN archive_fields f ON f.archive_type_id=t.id AND f.deleted_at IS NULL WHERE t.deleted_at IS NULL ORDER BY t.sort_order,t.name,t.id,f.sort_order,f.label,f.id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	items := make([]archive.CollectionDefinition, 0)
	for rows.Next() {
		var collectionID, name, icon, color string
		var typeOrder int
		var fieldID, key, label, valueType, group, optionsJSON, defaultJSON sql.NullString
		var required, sensitive, fieldOrder sql.NullInt64
		if err := rows.Scan(&collectionID, &name, &icon, &color, &typeOrder, &fieldID, &key, &label, &valueType, &group, &required, &sensitive, &optionsJSON, &defaultJSON, &fieldOrder); err != nil {
			return nil, err
		}
		if len(items) == 0 || items[len(items)-1].ID != collectionID {
			items = append(items, archive.CollectionDefinition{ID: collectionID, Name: name, Icon: icon, Color: color, SortOrder: typeOrder, Fields: []archive.FieldDefinition{}})
		}
		if fieldID.Valid {
			field, err := decodeFieldDefinition(fieldID.String, key.String, label.String, valueType.String, group.String, required.Int64 != 0, sensitive.Int64 != 0, optionsJSON.String, defaultJSON, int(fieldOrder.Int64))
			if err != nil {
				return nil, err
			}
			items[len(items)-1].Fields = append(items[len(items)-1].Fields, field)
		}
	}
	return items, rows.Err()
}

func (s *Store) GetArchiveCollection(ctx context.Context, id string) (archive.CollectionDefinition, error) {
	items, err := s.ListArchiveCollections(ctx)
	if err != nil {
		return archive.CollectionDefinition{}, err
	}
	for _, item := range items {
		if item.ID == id {
			return item, nil
		}
	}
	return archive.CollectionDefinition{}, app.ErrNotFound
}

func (s *Store) CreateArchiveCollection(ctx context.Context, input archive.CollectionInput) (archive.CollectionDefinition, error) {
	if !input.Valid() {
		return archive.CollectionDefinition{}, app.ErrValidation
	}
	now := platform.Now()
	id := platform.NewID()
	_, err := s.db.ExecContext(ctx, `INSERT INTO archive_collections(id,name,icon,color,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, id, strings.TrimSpace(input.Name), input.Icon, input.Color, input.SortOrder, platform.TimeText(now), platform.TimeText(now))
	if err != nil {
		return archive.CollectionDefinition{}, constraintError(err)
	}
	return s.GetArchiveCollection(ctx, id)
}

func (s *Store) UpdateArchiveCollection(ctx context.Context, id string, input archive.CollectionInput) (archive.CollectionDefinition, error) {
	if !input.Valid() {
		return archive.CollectionDefinition{}, app.ErrValidation
	}
	result, err := s.db.ExecContext(ctx, `UPDATE archive_collections SET name=?,icon=?,color=?,sort_order=?,updated_at=? WHERE id=? AND deleted_at IS NULL`, strings.TrimSpace(input.Name), input.Icon, input.Color, input.SortOrder, platform.TimeText(platform.Now()), id)
	if err != nil {
		return archive.CollectionDefinition{}, constraintError(err)
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return archive.CollectionDefinition{}, app.ErrNotFound
	}
	return s.GetArchiveCollection(ctx, id)
}

func (s *Store) DeleteArchiveCollection(ctx context.Context, id string) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM archive_records WHERE archive_type_id=? AND deleted_at IS NULL`, id).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			return app.ErrConflict
		}
		now := platform.Now()
		if _, err := tx.ExecContext(ctx, `UPDATE archive_fields SET deleted_at=?,updated_at=? WHERE archive_type_id=? AND deleted_at IS NULL`, platform.TimeText(now), platform.TimeText(now), id); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE archive_collections SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL`, platform.TimeText(now), platform.TimeText(now), id)
		if err != nil {
			return err
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			return app.ErrNotFound
		}
		if err := writeChange(ctx, tx, "archive_collection", id, "delete", now); err != nil {
			return err
		}
		return nil
	})
}

func (s *Store) CreateArchiveField(ctx context.Context, collectionID string, input archive.FieldInput) (archive.FieldDefinition, error) {
	if !input.Valid() {
		return archive.FieldDefinition{}, app.ErrValidation
	}
	if _, err := s.GetArchiveCollection(ctx, collectionID); err != nil {
		return archive.FieldDefinition{}, err
	}
	id := platform.NewID()
	options, defaultValue, err := encodeFieldConfig(input)
	if err != nil {
		return archive.FieldDefinition{}, app.ErrValidation
	}
	stamp := platform.TimeText(platform.Now())
	_, err = s.db.ExecContext(ctx, `INSERT INTO archive_fields(id,archive_type_id,field_key,label,value_type,group_name,is_required,is_sensitive,options_json,default_value_json,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, collectionID, strings.TrimSpace(input.Key), strings.TrimSpace(input.Label), input.ValueType, fieldGroup(input.Group), boolInt(input.Required), boolInt(input.Sensitive), options, defaultValue, input.SortOrder, stamp, stamp)
	if err != nil {
		return archive.FieldDefinition{}, constraintError(err)
	}
	return s.getArchiveField(ctx, id)
}

func (s *Store) UpdateArchiveField(ctx context.Context, id string, input archive.FieldInput) (archive.FieldDefinition, error) {
	if !input.Valid() {
		return archive.FieldDefinition{}, app.ErrValidation
	}
	var oldType string
	var values int
	if err := s.db.QueryRowContext(ctx, `SELECT value_type,(SELECT count(*) FROM archive_record_values WHERE field_definition_id=f.id) FROM archive_fields f WHERE id=? AND deleted_at IS NULL`, id).Scan(&oldType, &values); errors.Is(err, sql.ErrNoRows) {
		return archive.FieldDefinition{}, app.ErrNotFound
	} else if err != nil {
		return archive.FieldDefinition{}, err
	}
	if values > 0 && oldType != input.ValueType {
		return archive.FieldDefinition{}, app.ErrConflict
	}
	options, defaultValue, err := encodeFieldConfig(input)
	if err != nil {
		return archive.FieldDefinition{}, app.ErrValidation
	}
	_, err = s.db.ExecContext(ctx, `UPDATE archive_fields SET field_key=?,label=?,value_type=?,group_name=?,is_required=?,is_sensitive=?,options_json=?,default_value_json=?,sort_order=?,updated_at=? WHERE id=? AND deleted_at IS NULL`, strings.TrimSpace(input.Key), strings.TrimSpace(input.Label), input.ValueType, fieldGroup(input.Group), boolInt(input.Required), boolInt(input.Sensitive), options, defaultValue, input.SortOrder, platform.TimeText(platform.Now()), id)
	if err != nil {
		return archive.FieldDefinition{}, constraintError(err)
	}
	return s.getArchiveField(ctx, id)
}

func (s *Store) DeleteArchiveField(ctx context.Context, id string) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM archive_record_values WHERE field_definition_id=?`, id); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `DELETE FROM archive_fields WHERE id=?`, id)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return app.ErrNotFound
		}
		return nil
	})
}

func (s *Store) getArchiveField(ctx context.Context, id string) (archive.FieldDefinition, error) {
	var key, label, valueType, group, optionsJSON string
	var defaultJSON sql.NullString
	var required, sensitive bool
	var sortOrder int
	err := s.db.QueryRowContext(ctx, `SELECT field_key,label,value_type,group_name,is_required,is_sensitive,options_json,default_value_json,sort_order FROM archive_fields WHERE id=? AND deleted_at IS NULL`, id).Scan(&key, &label, &valueType, &group, &required, &sensitive, &optionsJSON, &defaultJSON, &sortOrder)
	if errors.Is(err, sql.ErrNoRows) {
		return archive.FieldDefinition{}, app.ErrNotFound
	}
	if err != nil {
		return archive.FieldDefinition{}, err
	}
	return decodeFieldDefinition(id, key, label, valueType, group, required, sensitive, optionsJSON, defaultJSON, sortOrder)
}

func decodeFieldDefinition(id, key, label, valueType, group string, required, sensitive bool, optionsJSON string, defaultJSON sql.NullString, sortOrder int) (archive.FieldDefinition, error) {
	field := archive.FieldDefinition{ID: id, Key: key, Label: label, ValueType: valueType, Group: group, Required: required, Sensitive: sensitive, Options: []string{}, SortOrder: sortOrder}
	if err := json.Unmarshal([]byte(optionsJSON), &field.Options); err != nil {
		return archive.FieldDefinition{}, err
	}
	if defaultJSON.Valid {
		if err := json.Unmarshal([]byte(defaultJSON.String), &field.DefaultValue); err != nil {
			return archive.FieldDefinition{}, err
		}
	}
	return field, nil
}

func encodeFieldConfig(input archive.FieldInput) (string, any, error) {
	if (input.ValueType == "select" || input.ValueType == "multiSelect") && len(input.Options) == 0 {
		return "", nil, errors.New("select field requires options")
	}
	for i, option := range input.Options {
		if strings.TrimSpace(option) == "" || len([]rune(option)) > 200 {
			return "", nil, errors.New("invalid option")
		}
		for _, other := range input.Options[:i] {
			if option == other {
				return "", nil, errors.New("duplicate option")
			}
		}
	}
	definition := archive.FieldDefinition{ValueType: input.ValueType, Options: input.Options, Required: input.Required}
	if input.DefaultValue != nil && !validFieldValue(definition, input.DefaultValue) {
		return "", nil, errors.New("invalid default value")
	}
	options, err := json.Marshal(input.Options)
	if err != nil {
		return "", nil, err
	}
	var defaultValue any
	if input.DefaultValue != nil {
		raw, err := json.Marshal(input.DefaultValue)
		if err != nil {
			return "", nil, err
		}
		defaultValue = string(raw)
	}
	return string(options), defaultValue, nil
}

func fieldGroup(value string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return "扩展属性"
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func constraintError(err error) error {
	if strings.Contains(strings.ToLower(err.Error()), "unique constraint") {
		return app.ErrConflict
	}
	return err
}
