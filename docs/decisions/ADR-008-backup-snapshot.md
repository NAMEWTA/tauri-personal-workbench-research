# ADR-008: Backup snapshot

Backups use the modernc Online Backup API, a fixed attachment manifest, per-file SHA-256, ZIP verification, and atomic publication. Failed backups never participate in retention cleanup.
