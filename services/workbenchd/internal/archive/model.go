package archive

import (
	"strings"
	"time"
	"unicode/utf8"
)

type Archive struct {
	ID        string         `json:"id"`
	TypeID    string         `json:"typeId"`
	TypeName  string         `json:"typeName"`
	TypeIcon  string         `json:"typeIcon"`
	TypeColor string         `json:"typeColor"`
	Title     string         `json:"title"`
	Summary   string         `json:"summary"`
	Body      string         `json:"body"`
	Fields    map[string]any `json:"fields"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
}

type Input struct {
	TypeID  string         `json:"typeId"`
	Title   string         `json:"title"`
	Summary string         `json:"summary"`
	Body    string         `json:"body"`
	Fields  map[string]any `json:"fields"`
}

type FieldDefinition struct {
	ID           string   `json:"id"`
	Key          string   `json:"key"`
	Label        string   `json:"label"`
	ValueType    string   `json:"valueType"`
	Group        string   `json:"group"`
	Required     bool     `json:"required"`
	Sensitive    bool     `json:"sensitive"`
	Options      []string `json:"options"`
	DefaultValue any      `json:"defaultValue"`
	SortOrder    int      `json:"sortOrder"`
}

type FieldInput struct {
	Key          string   `json:"key"`
	Label        string   `json:"label"`
	ValueType    string   `json:"valueType"`
	Group        string   `json:"group"`
	Required     bool     `json:"required"`
	Sensitive    bool     `json:"sensitive"`
	Options      []string `json:"options"`
	DefaultValue any      `json:"defaultValue"`
	SortOrder    int      `json:"sortOrder"`
}

type TypeDefinition struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Icon      string            `json:"icon"`
	Color     string            `json:"color"`
	SortOrder int               `json:"sortOrder"`
	Fields    []FieldDefinition `json:"fields"`
}

type TypeInput struct {
	Name      string `json:"name"`
	Icon      string `json:"icon"`
	Color     string `json:"color"`
	SortOrder int    `json:"sortOrder"`
}

func (in Input) Valid() bool {
	titleLength := utf8.RuneCountInString(strings.TrimSpace(in.Title))
	return in.TypeID != "" && titleLength > 0 && titleLength <= 200 && utf8.RuneCountInString(in.Summary) <= 500 && utf8.RuneCountInString(in.Body) <= 1_000_000
}

func (in TypeInput) Valid() bool {
	length := utf8.RuneCountInString(strings.TrimSpace(in.Name))
	return length > 0 && length <= 80 && utf8.RuneCountInString(in.Icon) <= 40 && validColor(in.Color)
}

func (in FieldInput) Valid() bool {
	types := map[string]bool{"text": true, "multiline": true, "number": true, "date": true, "datetime": true, "boolean": true, "select": true}
	keyLength := utf8.RuneCountInString(strings.TrimSpace(in.Key))
	labelLength := utf8.RuneCountInString(strings.TrimSpace(in.Label))
	groupLength := utf8.RuneCountInString(strings.TrimSpace(in.Group))
	if keyLength == 0 || keyLength > 80 || labelLength == 0 || labelLength > 80 || groupLength > 80 || !types[in.ValueType] || len(in.Options) > 100 {
		return false
	}
	return in.ValueType != "select" || len(in.Options) > 0
}

func validColor(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	for _, char := range value[1:] {
		if !isHexDigit(char) {
			return false
		}
	}
	return true
}

func isHexDigit(char rune) bool {
	return (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')
}
