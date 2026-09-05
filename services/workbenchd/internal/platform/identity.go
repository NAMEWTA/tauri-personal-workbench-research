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

func LocalDayRange(at time.Time, location *time.Location) (time.Time, time.Time) {
	local := at.In(location)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	return start.UTC(), start.AddDate(0, 0, 1).UTC()
}

func TimeText(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000000000Z")
}
