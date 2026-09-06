-- +goose Up
ALTER TABLE tasks ADD COLUMN due_at TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
UPDATE tasks SET due_at = ends_at WHERE due_at IS NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL;

-- Rebuild settings so the paper theme is a persisted first-class option.
CREATE TABLE workspace_settings_v2 (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  backup_directory TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'system' CHECK(theme IN ('light','dark','system','paper')),
  sidebar_collapsed INTEGER NOT NULL DEFAULT 0 CHECK(sidebar_collapsed IN (0,1)),
  inspector_width INTEGER NOT NULL DEFAULT 344 CHECK(inspector_width BETWEEN 300 AND 480),
  recent_searches_json TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO workspace_settings_v2 SELECT singleton, backup_directory, theme, sidebar_collapsed, inspector_width, recent_searches_json FROM workspace_settings;
DROP TABLE workspace_settings;
ALTER TABLE workspace_settings_v2 RENAME TO workspace_settings;

-- +goose Down
DROP INDEX IF EXISTS idx_tasks_due_at;
-- due_at is intentionally retained on downgrade because SQLite cannot drop a column safely
