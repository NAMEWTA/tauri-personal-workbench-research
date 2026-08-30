# ADR-003: SQLite driver

Use `modernc.org/sqlite` with CGO disabled. The Windows gate verifies WAL, foreign keys, busy timeout, FTS5 trigram, concurrent-safe Online Backup, migration, and shutdown behavior.

