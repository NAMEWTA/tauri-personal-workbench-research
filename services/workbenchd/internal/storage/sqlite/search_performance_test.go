package sqlite_test

import (
	"context"
	"fmt"
	"sort"
	"testing"
	"time"

	workbenchsqlite "github.com/personal-workbench/workbenchd/internal/storage/sqlite"
)

const searchScale = 100_000

func seedSearchScale(b testing.TB) *workbenchsqlite.Store {
	b.Helper()
	store, err := workbenchsqlite.Open(context.Background(), b.TempDir(), "搜索性能", "0.1.0")
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = store.Close() })
	tx, err := store.DB().Begin()
	if err != nil {
		b.Fatal(err)
	}
	statement, err := tx.Prepare(`INSERT INTO search_index(entity_type,entity_id,title,content) VALUES(?,?,?,?)`)
	if err != nil {
		b.Fatal(err)
	}
	for index := 0; index < searchScale; index++ {
		entityType := "archive"
		if index%2 == 1 {
			entityType = "task"
		}
		if _, err := statement.Exec(entityType, fmt.Sprintf("scale-%06d", index), fmt.Sprintf("性能实体 %06d", index), fmt.Sprintf("离线工作台检索样本 独特标记%06d", index)); err != nil {
			b.Fatal(err)
		}
	}
	if err := statement.Close(); err != nil {
		b.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}
	return store
}

func TestSearchP95At100KEntities(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping 100k search performance gate in short mode")
	}
	store := seedSearchScale(t)
	durations := make([]time.Duration, 40)
	for index := range durations {
		started := time.Now()
		results, err := store.Search(context.Background(), "独特标记099999")
		if err != nil || len(results) != 1 || results[0].ID != "scale-099999" {
			t.Fatalf("unexpected result at sample %d: %#v, err=%v", index, results, err)
		}
		durations[index] = time.Since(started)
	}
	sort.Slice(durations, func(left, right int) bool { return durations[left] < durations[right] })
	p95 := durations[37]
	if p95 > 500*time.Millisecond {
		t.Fatalf("100k entity search P95 %s exceeds 500ms gate", p95)
	}
	t.Logf("100k entity search P95: %s", p95)
}

func BenchmarkSearch100K(b *testing.B) {
	store := seedSearchScale(b)
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		if _, err := store.Search(context.Background(), "独特标记099999"); err != nil {
			b.Fatal(err)
		}
	}
}
