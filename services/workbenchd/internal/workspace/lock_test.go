package workspace_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/personal-workbench/workbenchd/internal/workspace"
)

func TestLockPreventsConcurrentOpenAndCanBeReacquired(t *testing.T) {
	directory := t.TempDir()
	first, err := workspace.Acquire(directory)
	if err != nil {
		t.Fatal(err)
	}
	second, err := workspace.Acquire(directory)
	if !errors.Is(err, workspace.ErrInUse) || second != nil {
		t.Fatalf("expected ErrInUse, got lock=%v err=%v", second, err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := workspace.Acquire(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reopened.Close() }()
	if _, err := os.Stat(filepath.Join(directory, ".workbench.lock")); err != nil {
		t.Fatal(err)
	}
}
