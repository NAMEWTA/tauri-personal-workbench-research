# ADR-001: Process ownership

Rust supervises one Go sidecar, React owns presentation, and Go exclusively owns domain logic, SQLite, attachments, search, jobs, backup, and restore. Business CRUD does not use Tauri commands.

