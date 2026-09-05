-- +goose Up
CREATE TABLE workspace_meta (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  app_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workspace_settings (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  backup_directory TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'system' CHECK(theme IN ('light','dark','system')),
  sidebar_collapsed INTEGER NOT NULL DEFAULT 0 CHECK(sidebar_collapsed IN (0,1)),
  inspector_width INTEGER NOT NULL DEFAULT 344 CHECK(inspector_width BETWEEN 300 AND 480),
  recent_searches_json TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO workspace_settings(singleton, backup_directory) VALUES(1, '');

CREATE TABLE archive_collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE archive_fields (
  id TEXT PRIMARY KEY,
  archive_type_id TEXT NOT NULL REFERENCES archive_collections(id),
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK(value_type IN ('text','multiline','number','date','datetime','boolean','select','multiSelect','url','email','phone','relation','attachment')),
  group_name TEXT NOT NULL DEFAULT '扩展属性',
  is_required INTEGER NOT NULL DEFAULT 0,
  is_sensitive INTEGER NOT NULL DEFAULT 0,
  options_json TEXT NOT NULL DEFAULT '[]',
  default_value_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(archive_type_id, field_key)
);

CREATE TABLE archive_records (
  id TEXT PRIMARY KEY,
  archive_type_id TEXT NOT NULL REFERENCES archive_collections(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_archives_type_updated ON archive_records(archive_type_id, updated_at DESC, id DESC);

CREATE TABLE archive_record_values (
  archive_id TEXT NOT NULL REFERENCES archive_records(id) ON DELETE CASCADE,
  field_definition_id TEXT NOT NULL REFERENCES archive_fields(id),
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(archive_id, field_definition_id)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('todo','doing','done')),
  priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
  starts_at TEXT,
  ends_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  due_on TEXT,
  recurrence_json TEXT NOT NULL DEFAULT '',
  reminders_json TEXT NOT NULL DEFAULT '[]',
  parent_id TEXT REFERENCES tasks(id),
  estimate_minutes INTEGER,
  archive_id TEXT REFERENCES archive_records(id),
  notes TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK((starts_at IS NULL AND ends_at IS NULL) OR (starts_at IS NOT NULL AND ends_at IS NOT NULL))
);
CREATE INDEX idx_tasks_status_start ON tasks(status, starts_at, id);
CREATE INDEX idx_tasks_archive ON tasks(archive_id, updated_at DESC);
CREATE INDEX idx_tasks_due_on ON tasks(due_on, status, id);
CREATE INDEX idx_tasks_parent ON tasks(parent_id, updated_at DESC);

CREATE TABLE task_reminders (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  remind_at TEXT NOT NULL,
  dismissed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_task_reminders_pending ON task_reminders(remind_at, dismissed_at);

CREATE TABLE entity_relations (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  relative_path TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE entity_tags (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(entity_type, entity_id, tag_id)
);

CREATE TABLE backup_runs (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  byte_size INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE trash_entries (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id)
);
CREATE TABLE change_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_change_log_changed ON change_log(changed_at DESC);

CREATE TABLE background_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','failed','cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  stage TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_background_jobs_started ON background_jobs(started_at DESC);

CREATE VIRTUAL TABLE search_index USING fts5(entity_type UNINDEXED, entity_id UNINDEXED, title, content, tokenize='trigram');

-- +goose StatementBegin
CREATE TRIGGER archives_search_insert AFTER INSERT ON archive_records WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO search_index(entity_type,entity_id,title,content) VALUES('archive',NEW.id,NEW.title,NEW.summary || ' ' || NEW.body);
END;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER archives_search_update AFTER UPDATE ON archive_records BEGIN
  DELETE FROM search_index WHERE entity_type='archive' AND entity_id=OLD.id;
  INSERT INTO search_index(entity_type,entity_id,title,content)
  SELECT 'archive',NEW.id,NEW.title,NEW.summary || ' ' || NEW.body || ' ' || COALESCE((SELECT group_concat(value_json,' ') FROM archive_record_values WHERE archive_id=NEW.id),'') WHERE NEW.deleted_at IS NULL;
END;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER archives_search_delete AFTER DELETE ON archive_records BEGIN
  DELETE FROM search_index WHERE entity_type='archive' AND entity_id=OLD.id;
END;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER archive_values_search_insert AFTER INSERT ON archive_record_values BEGIN
  DELETE FROM search_index WHERE entity_type='archive' AND entity_id=NEW.archive_id;
  INSERT INTO search_index(entity_type,entity_id,title,content)
  SELECT 'archive',a.id,a.title,a.summary || ' ' || a.body || ' ' || COALESCE((SELECT group_concat(value_json,' ') FROM archive_record_values WHERE archive_id=a.id),'') FROM archive_records a WHERE a.id=NEW.archive_id AND a.deleted_at IS NULL;
END;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER archive_values_search_update AFTER UPDATE ON archive_record_values BEGIN
  DELETE FROM search_index WHERE entity_type='archive' AND entity_id=OLD.archive_id;
  INSERT INTO search_index(entity_type,entity_id,title,content)
  SELECT 'archive',a.id,a.title,a.summary || ' ' || a.body || ' ' || COALESCE((SELECT group_concat(value_json,' ') FROM archive_record_values WHERE archive_id=a.id),'') FROM archive_records a WHERE a.id=NEW.archive_id AND a.deleted_at IS NULL;
END;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER archive_values_search_delete AFTER DELETE ON archive_record_values BEGIN
  DELETE FROM search_index WHERE entity_type='archive' AND entity_id=OLD.archive_id;
  INSERT INTO search_index(entity_type,entity_id,title,content)
  SELECT 'archive',a.id,a.title,a.summary || ' ' || a.body || ' ' || COALESCE((SELECT group_concat(value_json,' ') FROM archive_record_values WHERE archive_id=a.id),'') FROM archive_records a WHERE a.id=OLD.archive_id AND a.deleted_at IS NULL;
END;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER tasks_search_insert AFTER INSERT ON tasks WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO search_index(entity_type,entity_id,title,content) VALUES('task',NEW.id,NEW.title,NEW.notes);
END;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER tasks_search_update AFTER UPDATE ON tasks BEGIN
  DELETE FROM search_index WHERE entity_type='task' AND entity_id=OLD.id;
  INSERT INTO search_index(entity_type,entity_id,title,content) SELECT 'task',NEW.id,NEW.title,NEW.notes WHERE NEW.deleted_at IS NULL;
END;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER tasks_search_delete AFTER DELETE ON tasks BEGIN
  DELETE FROM search_index WHERE entity_type='task' AND entity_id=OLD.id;
END;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER attachments_search_insert AFTER INSERT ON attachments WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO search_index(entity_type,entity_id,title,content) VALUES('attachment',NEW.id,NEW.display_name,NEW.media_type);
END;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER attachments_search_update AFTER UPDATE ON attachments BEGIN
  DELETE FROM search_index WHERE entity_type='attachment' AND entity_id=OLD.id;
  INSERT INTO search_index(entity_type,entity_id,title,content) SELECT 'attachment',NEW.id,NEW.display_name,NEW.media_type WHERE NEW.deleted_at IS NULL;
END;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER attachments_search_delete AFTER DELETE ON attachments BEGIN
  DELETE FROM search_index WHERE entity_type='attachment' AND entity_id=OLD.id;
END;
-- +goose StatementEnd

-- +goose Down
DROP TABLE search_index;
DROP TABLE background_jobs;
DROP TABLE change_log;
DROP TABLE trash_entries;
DROP TABLE backup_runs;
DROP TABLE entity_tags;
DROP TABLE tags;
DROP TABLE attachments;
DROP TABLE entity_relations;
DROP TABLE tasks;
DROP TABLE archive_record_values;
DROP TABLE archive_records;
DROP TABLE archive_fields;
DROP TABLE archive_collections;
DROP TABLE workspace_settings;
DROP TABLE workspace_meta;
