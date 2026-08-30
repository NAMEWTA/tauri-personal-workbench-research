package workspace

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

var ErrInUse = errors.New("workspace is already open")

type Lock struct {
	file *os.File
}

func Acquire(workspacePath string) (*Lock, error) {
	path := filepath.Join(workspacePath, ".workbench.lock")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open workspace lock: %w", err)
	}
	locked, err := tryLock(file)
	if err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("lock workspace: %w", err)
	}
	if !locked {
		_ = file.Close()
		return nil, ErrInUse
	}
	if err := file.Truncate(0); err != nil {
		_ = unlock(file)
		_ = file.Close()
		return nil, fmt.Errorf("reset workspace lock metadata: %w", err)
	}
	if _, err := file.Seek(0, 0); err != nil {
		_ = unlock(file)
		_ = file.Close()
		return nil, fmt.Errorf("seek workspace lock metadata: %w", err)
	}
	metadata := struct {
		PID        int       `json:"pid"`
		AcquiredAt time.Time `json:"acquiredAt"`
	}{PID: os.Getpid(), AcquiredAt: time.Now().UTC()}
	if err := json.NewEncoder(file).Encode(metadata); err != nil {
		_ = unlock(file)
		_ = file.Close()
		return nil, fmt.Errorf("write workspace lock metadata: %w", err)
	}
	if err := file.Sync(); err != nil {
		_ = unlock(file)
		_ = file.Close()
		return nil, fmt.Errorf("sync workspace lock metadata: %w", err)
	}
	return &Lock{file: file}, nil
}

func (l *Lock) Close() error {
	if l == nil || l.file == nil {
		return nil
	}
	err := errors.Join(unlock(l.file), l.file.Close())
	l.file = nil
	return err
}
