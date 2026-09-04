-- +goose Up
ALTER TABLE workspace_settings ADD COLUMN theme TEXT NOT NULL DEFAULT 'system' CHECK(theme IN ('light','dark','system'));
ALTER TABLE workspace_settings ADD COLUMN sidebar_collapsed INTEGER NOT NULL DEFAULT 0 CHECK(sidebar_collapsed IN (0,1));
ALTER TABLE workspace_settings ADD COLUMN inspector_width INTEGER NOT NULL DEFAULT 344 CHECK(inspector_width BETWEEN 300 AND 480);
ALTER TABLE workspace_settings ADD COLUMN recent_searches_json TEXT NOT NULL DEFAULT '[]';

-- +goose Down
-- SQLite cannot drop columns on all supported versions; the V2 schema is forward-only.
