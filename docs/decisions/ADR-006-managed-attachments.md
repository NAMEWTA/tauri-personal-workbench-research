# ADR-006: Managed attachments

Go canonicalizes selected source paths, streams content through SHA-256 to a temporary file, atomically renames into a UUID-scoped workspace path, then commits metadata. The UI never constructs managed paths.

