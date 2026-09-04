package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/personal-workbench/workbenchd/internal/preferences"
)

func (s *Store) Preferences(ctx context.Context) (preferences.Values, error) {
	return readPreferences(ctx, s.db)
}

func (s *Store) UpdatePreferences(ctx context.Context, update preferences.Update) (preferences.Values, error) {
	if err := update.Validate(); err != nil {
		return preferences.Values{}, err
	}
	var result preferences.Values
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		current, err := readPreferences(ctx, tx)
		if err != nil {
			return err
		}
		if update.Theme != nil {
			current.Theme = *update.Theme
		}
		if update.SidebarCollapsed != nil {
			current.SidebarCollapsed = *update.SidebarCollapsed
		}
		if update.InspectorWidth != nil {
			current.InspectorWidth = *update.InspectorWidth
		}
		if update.RecentSearches != nil {
			current.RecentSearches = append([]preferences.RecentSearch(nil), (*update.RecentSearches)...)
		}
		recent, err := json.Marshal(current.RecentSearches)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE workspace_settings SET theme=?,sidebar_collapsed=?,inspector_width=?,recent_searches_json=? WHERE singleton=1`, current.Theme, boolToInt(current.SidebarCollapsed), current.InspectorWidth, string(recent))
		if err != nil {
			return err
		}
		result = current
		return nil
	})
	return result, err
}

type queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readPreferences(ctx context.Context, query queryer) (preferences.Values, error) {
	var result preferences.Values
	var collapsed int
	var recentRaw string
	if err := query.QueryRowContext(ctx, `SELECT theme,sidebar_collapsed,inspector_width,recent_searches_json FROM workspace_settings WHERE singleton=1`).Scan(&result.Theme, &collapsed, &result.InspectorWidth, &recentRaw); err != nil {
		return result, err
	}
	result.SidebarCollapsed = collapsed != 0
	if err := json.Unmarshal([]byte(recentRaw), &result.RecentSearches); err != nil {
		return result, err
	}
	if result.RecentSearches == nil {
		result.RecentSearches = []preferences.RecentSearch{}
	}
	return result, nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
