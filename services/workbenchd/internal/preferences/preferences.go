package preferences

import "errors"

var ErrInvalid = errors.New("invalid preferences")

type RecentSearch struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
}

type Values struct {
	Theme            string         `json:"theme"`
	SidebarCollapsed bool           `json:"sidebarCollapsed"`
	InspectorWidth   int            `json:"inspectorWidth"`
	RecentSearches   []RecentSearch `json:"recentSearches"`
}

type Update struct {
	Theme            *string         `json:"theme,omitempty"`
	SidebarCollapsed *bool           `json:"sidebarCollapsed,omitempty"`
	InspectorWidth   *int            `json:"inspectorWidth,omitempty"`
	RecentSearches   *[]RecentSearch `json:"recentSearches,omitempty"`
}

func (u Update) Validate() error {
	if u.Theme != nil && !ValidTheme(*u.Theme) {
		return ErrInvalid
	}
	if u.InspectorWidth != nil && (*u.InspectorWidth < 300 || *u.InspectorWidth > 480) {
		return ErrInvalid
	}
	if u.RecentSearches != nil {
		if len(*u.RecentSearches) > 8 {
			return ErrInvalid
		}
		for _, item := range *u.RecentSearches {
			if item.ID == "" || item.Title == "" || (item.Type != "archive" && item.Type != "task" && item.Type != "attachment") {
				return ErrInvalid
			}
		}
	}
	return nil
}

func ValidTheme(value string) bool {
	return value == "light" || value == "dark" || value == "system"
}
