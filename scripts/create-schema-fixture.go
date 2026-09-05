package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	_ "modernc.org/sqlite"
)

func main() {
	if len(os.Args) != 3 {
		panic("usage: create-schema-fixture <database> <version>")
	}
	version, err := strconv.ParseInt(os.Args[2], 10, 64)
	if err != nil || version < 1 {
		panic("schema version must be a positive integer")
	}
	database, err := filepath.Abs(os.Args[1])
	if err != nil {
		panic(err)
	}
	if err := os.MkdirAll(filepath.Dir(database), 0o700); err != nil {
		panic(err)
	}
	db, err := sql.Open("sqlite", database)
	if err != nil {
		panic(err)
	}
	defer func() { _ = db.Close() }()
	if _, err := db.Exec(`CREATE TABLE goose_db_version (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		version_id INTEGER NOT NULL,
		is_applied INTEGER NOT NULL,
		tstamp TIMESTAMP DEFAULT (datetime('now'))
	)`); err != nil {
		panic(err)
	}
	if _, err := db.Exec(`INSERT INTO goose_db_version(version_id,is_applied) VALUES(0,1),(?,1)`, version); err != nil {
		panic(err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode = WAL`); err != nil {
		panic(err)
	}
	if _, err := db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		panic(err)
	}
	fmt.Printf("Created incompatible schema fixture %d at %s\n", version, database)
}
