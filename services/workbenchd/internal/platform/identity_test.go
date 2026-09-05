package platform_test

import (
	"testing"
	"time"

	"github.com/personal-workbench/workbenchd/internal/platform"
)

func TestLocalDayRangeUsesCalendarMidnightAcrossDST(t *testing.T) {
	for _, scenario := range []struct {
		name, zone, at, start, end string
		hours                      int
	}{
		{"spring-forward", "America/New_York", "2026-03-08T16:00:00Z", "2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z", 23},
		{"fall-back", "America/New_York", "2026-11-01T17:00:00Z", "2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z", 25},
		{"utc-date-differs", "Asia/Shanghai", "2026-09-04T18:00:00Z", "2026-09-04T16:00:00Z", "2026-09-05T16:00:00Z", 24},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			location, err := time.LoadLocation(scenario.zone)
			if err != nil {
				t.Fatal(err)
			}
			at, err := time.Parse(time.RFC3339, scenario.at)
			if err != nil {
				t.Fatal(err)
			}
			start, end := platform.LocalDayRange(at, location)
			if start.Format(time.RFC3339) != scenario.start || end.Format(time.RFC3339) != scenario.end || end.Sub(start) != time.Duration(scenario.hours)*time.Hour {
				t.Fatalf("range=[%s,%s), duration=%s", start, end, end.Sub(start))
			}
		})
	}
}
