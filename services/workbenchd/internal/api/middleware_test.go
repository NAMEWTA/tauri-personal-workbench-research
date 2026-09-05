package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTimeoutProblemUsesRequestID(t *testing.T) {
	handler := requestIDs(timeout(5 * time.Millisecond)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		time.Sleep(25 * time.Millisecond)
	})))
	request := httptest.NewRequest(http.MethodGet, "/api/v3/slow", nil)
	request.Header.Set("X-Request-ID", "request-trace-123")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || response.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("status=%d content-type=%q", response.Code, response.Header().Get("Content-Type"))
	}
	var problem Problem
	if err := json.Unmarshal(response.Body.Bytes(), &problem); err != nil || problem.Code != "request_timeout" || problem.TraceID != "request-trace-123" {
		t.Fatalf("problem=%#v err=%v", problem, err)
	}
}
