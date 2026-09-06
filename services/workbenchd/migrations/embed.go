package migrations

import "embed"

const CurrentVersion int64 = 2

// FS contains immutable forward-only database migrations.
//
//go:embed *.sql
var FS embed.FS
