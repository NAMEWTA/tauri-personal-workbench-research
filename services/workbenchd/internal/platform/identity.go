package platform

import (
	"time"

	"github.com/google/uuid"
)

func NewID() string {
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.NewString()
	}
	return id.String()
}

func Now() time.Time { return time.Now().UTC() }

func TimeText(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000000000Z")
}
