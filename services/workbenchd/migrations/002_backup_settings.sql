-- +goose Up
CREATE TABLE workspace_settings (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  backup_directory TEXT NOT NULL DEFAULT ''
);
INSERT INTO workspace_settings(singleton, backup_directory) VALUES(1, '');

-- +goose Down
DROP TABLE workspace_settings;
