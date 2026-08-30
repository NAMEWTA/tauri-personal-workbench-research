package task

import (
	"strings"
	"time"
	"unicode/utf8"
)

type Task struct {
	ID           string     `json:"id"`
	Title        string     `json:"title"`
	Status       string     `json:"status"`
	Priority     string     `json:"priority"`
	StartsAt     *time.Time `json:"startsAt"`
	EndsAt       *time.Time `json:"endsAt"`
	AllDay       bool       `json:"allDay"`
	Timezone     string     `json:"timezone"`
	ArchiveID    *string    `json:"archiveId"`
	ArchiveTitle string     `json:"archiveTitle"`
	Notes        string     `json:"notes"`
	CompletedAt  *time.Time `json:"completedAt"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

type Input struct {
	Title     string     `json:"title"`
	Status    string     `json:"status"`
	Priority  string     `json:"priority"`
	StartsAt  *time.Time `json:"startsAt"`
	EndsAt    *time.Time `json:"endsAt"`
	AllDay    bool       `json:"allDay"`
	Timezone  string     `json:"timezone"`
	ArchiveID *string    `json:"archiveId"`
	Notes     string     `json:"notes"`
}

type Filter struct {
	View      string
	Timezone  string
	Query     string
	ArchiveID string
	From      *time.Time
	To        *time.Time
}

func (in Input) Valid() bool {
	statuses := map[string]bool{"todo": true, "doing": true, "done": true}
	priorities := map[string]bool{"low": true, "normal": true, "high": true, "urgent": true}
	titleLength := utf8.RuneCountInString(strings.TrimSpace(in.Title))
	if titleLength == 0 || titleLength > 300 || utf8.RuneCountInString(in.Notes) > 1_000_000 || !statuses[in.Status] || !priorities[in.Priority] {
		return false
	}
	if (in.StartsAt == nil) != (in.EndsAt == nil) {
		return false
	}
	if in.StartsAt == nil {
		return in.Timezone == "" || validTimezone(in.Timezone)
	}
	return in.EndsAt.After(*in.StartsAt) && validTimezone(in.Timezone)
}

func validTimezone(value string) bool {
	if value == "" {
		return false
	}
	_, err := time.LoadLocation(value)
	return err == nil
}
