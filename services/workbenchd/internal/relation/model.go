package relation

import (
	"strings"
	"time"
	"unicode/utf8"
)

type Relation struct {
	ID             string    `json:"id"`
	SourceID       string    `json:"sourceId"`
	TargetID       string    `json:"targetId"`
	TargetTitle    string    `json:"targetTitle"`
	TargetTypeID   string    `json:"targetTypeId"`
	TargetTypeName string    `json:"targetTypeName"`
	RelationType   string    `json:"relationType"`
	Notes          string    `json:"notes"`
	CreatedAt      time.Time `json:"createdAt"`
}

type Input struct {
	TargetID     string `json:"targetId"`
	RelationType string `json:"relationType"`
	Notes        string `json:"notes"`
}

func (input Input) Valid() bool {
	relationLength := utf8.RuneCountInString(strings.TrimSpace(input.RelationType))
	return input.TargetID != "" && relationLength > 0 && relationLength <= 80 && utf8.RuneCountInString(input.Notes) <= 500
}
