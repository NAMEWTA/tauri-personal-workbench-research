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
	DueOn        *string    `json:"dueOn"`
	AllDay       bool       `json:"allDay"`
	Timezone     string     `json:"timezone"`
	RecordID     *string    `json:"recordId"`
	RecordTitle  string     `json:"recordTitle"`
	Notes        string     `json:"notes"`
	Recurrence   string     `json:"recurrence"`
	Reminders    []string   `json:"reminders"`
	ParentID     *string    `json:"parentId"`
	EstimateMins *int       `json:"estimateMinutes"`
	CompletedAt  *time.Time `json:"completedAt"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

type Input struct {
	Title        string     `json:"title"`
	Status       string     `json:"status"`
	Priority     string     `json:"priority"`
	StartsAt     *time.Time `json:"startsAt"`
	EndsAt       *time.Time `json:"endsAt"`
	DueOn        *string    `json:"dueOn"`
	AllDay       bool       `json:"allDay"`
	Timezone     string     `json:"timezone"`
	RecordID     *string    `json:"recordId"`
	Notes        string     `json:"notes"`
	Recurrence   string     `json:"recurrence"`
	Reminders    []string   `json:"reminders"`
	ParentID     *string    `json:"parentId"`
	EstimateMins *int       `json:"estimateMinutes"`
}

type Filter struct {
	View               string
	Timezone           string
	Query              string
	From               *time.Time
	To                 *time.Time
	DueFrom            string
	DueTo              string
	IncludeUnscheduled bool
	RecordID           string
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
	if in.DueOn != nil {
		if _, err := time.Parse("2006-01-02", *in.DueOn); err != nil {
			return false
		}
	}
	if len(in.Recurrence) > 500 || len(in.Reminders) > 20 {
		return false
	}
	for _, reminder := range in.Reminders {
		if _, err := time.Parse(time.RFC3339, reminder); err != nil {
			return false
		}
	}
	if in.EstimateMins != nil && (*in.EstimateMins < 1 || *in.EstimateMins > 100000) {
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
