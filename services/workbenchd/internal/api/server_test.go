package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	workbenchapi "github.com/personal-workbench/workbenchd/internal/api"
	"github.com/personal-workbench/workbenchd/internal/app"
	"github.com/personal-workbench/workbenchd/internal/archive"
	"github.com/personal-workbench/workbenchd/internal/attachment"
	"github.com/personal-workbench/workbenchd/internal/backup"
	workbenchsqlite "github.com/personal-workbench/workbenchd/internal/storage/sqlite"
	"github.com/personal-workbench/workbenchd/internal/task"
)

func testHandler(t *testing.T) http.Handler {
	result, _ := testHandlerWithStore(t)
	return result
}

func testHandlerWithStore(t *testing.T) (http.Handler, *workbenchsqlite.Store) {
	t.Helper()
	workspace := t.TempDir()
	store, err := workbenchsqlite.Open(context.Background(), workspace, "API 测试", "0.2.11")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	service := app.New(store, backup.New(store.DB(), workspace), attachment.New(store.DB(), workspace))
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := service.Shutdown(ctx); err != nil {
			t.Error(err)
		}
	})
	return workbenchapi.NewHandler(service, workbenchapi.Config{Token: "0123456789012345678901234567890123456789012", AllowedOrigins: []string{"http://127.0.0.1:1420"}, ServiceVersion: "test", Shutdown: func() {}}, slog.New(slog.NewTextHandler(io.Discard, nil))), store
}
func request(method, path, token, origin string, body []byte) *http.Request {
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	req.Host = "127.0.0.1:49152"
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	req.Header.Set("Content-Type", "application/json")
	return req
}

func TestAPISecurityAndArchiveConformance(t *testing.T) {
	t.Parallel()
	handler := testHandler(t)
	token := "0123456789012345678901234567890123456789012"
	t.Run("health is minimal", func(t *testing.T) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodGet, "/healthz", "", "", nil))
		if response.Code != 200 || response.Body.String() != "{\"alive\":true}\n" {
			t.Fatalf("response=%d %s", response.Code, response.Body.String())
		}
	})
	t.Run("missing token", func(t *testing.T) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodGet, "/api/v3/meta", "", "", nil))
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status=%d", response.Code)
		}
		var problem workbenchapi.Problem
		if err := json.Unmarshal(response.Body.Bytes(), &problem); err != nil || problem.Code != "unauthorized" || problem.TraceID == "" {
			t.Fatalf("problem=%#v err=%v", problem, err)
		}
	})
	t.Run("v3 alias exposes the same contract", func(t *testing.T) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodGet, "/api/v3/meta", token, "http://127.0.0.1:1420", nil))
		if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"apiVersion":3`)) {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
	})
	t.Run("workspace preferences are local and validated", func(t *testing.T) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodGet, "/api/v3/preferences", token, "http://127.0.0.1:1420", nil))
		if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"theme":"system"`)) {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodPatch, "/api/v3/preferences", token, "http://127.0.0.1:1420", []byte(`{"theme":"dark","sidebarCollapsed":true,"inspectorWidth":400,"recentSearches":[]}`)))
		if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"inspectorWidth":400`)) {
			t.Fatalf("update status=%d body=%s", response.Code, response.Body.String())
		}
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodPatch, "/api/v3/preferences", token, "http://127.0.0.1:1420", []byte(`{"inspectorWidth":999}`)))
		if response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("invalid status=%d body=%s", response.Code, response.Body.String())
		}
	})
	t.Run("wrong token", func(t *testing.T) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodGet, "/api/v3/meta", "wrong-token", "", nil))
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status=%d", response.Code)
		}
	})
	t.Run("body limit uses problem detail", func(t *testing.T) {
		response := httptest.NewRecorder()
		body := append([]byte(`{"collectionId":"person","title":"`), bytes.Repeat([]byte("x"), 2<<20)...)
		body = append(body, []byte(`"}`)...)
		handler.ServeHTTP(response, request(http.MethodPost, "/api/v3/archive-records", token, "http://127.0.0.1:1420", body))
		if response.Code != http.StatusRequestEntityTooLarge || response.Header().Get("Content-Type") != "application/problem+json" || !bytes.Contains(response.Body.Bytes(), []byte(`"code":"payload_too_large"`)) {
			t.Fatalf("status=%d type=%s body=%s", response.Code, response.Header().Get("Content-Type"), response.Body.String())
		}
	})
	t.Run("origin rejected", func(t *testing.T) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodGet, "/api/v3/meta", token, "https://example.com", nil))
		if response.Code != http.StatusForbidden {
			t.Fatalf("status=%d", response.Code)
		}
	})
	t.Run("host rejected", func(t *testing.T) {
		req := request(http.MethodGet, "/api/v3/meta", token, "", nil)
		req.Host = "example.com"
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != http.StatusForbidden {
			t.Fatalf("status=%d", response.Code)
		}
	})
	t.Run("loopback aliases rejected", func(t *testing.T) {
		for _, host := range []string{"localhost:49152", "[::1]:49152", "::1"} {
			req := request(http.MethodGet, "/api/v3/meta", token, "", nil)
			req.Host = host
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)
			if response.Code != http.StatusForbidden {
				t.Fatalf("host=%q status=%d", host, response.Code)
			}
		}
	})
	t.Run("archive create and list", func(t *testing.T) {
		typesResponse := httptest.NewRecorder()
		handler.ServeHTTP(typesResponse, request(http.MethodGet, "/api/v3/archive-collections", token, "http://127.0.0.1:1420", nil))
		if typesResponse.Code != http.StatusOK || !bytes.Contains(typesResponse.Body.Bytes(), []byte(`"name":"模板档案"`)) {
			t.Fatalf("types status=%d body=%s", typesResponse.Code, typesResponse.Body.String())
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodPost, "/api/v3/archive-records", token, "http://127.0.0.1:1420", []byte(`{"collectionId":"template","title":"王小明","summary":"测试"}`)))
		if response.Code != http.StatusCreated {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodGet, "/api/v3/archive-records?q=王小明", token, "http://127.0.0.1:1420", nil))
		if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte("王小明")) {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodPost, "/api/v3/archive-records", token, "http://127.0.0.1:1420", []byte(`{"collectionId":"template","title":"非法字段","fields":{"unknown":"value"}}`)))
		if response.Code != http.StatusUnprocessableEntity || !bytes.Contains(response.Body.Bytes(), []byte(`"code":"validation_failed"`)) {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
	})
	t.Run("custom type field and unified task", func(t *testing.T) {
		typeResponse := httptest.NewRecorder()
		handler.ServeHTTP(typeResponse, request(http.MethodPost, "/api/v3/archive-collections", token, "http://127.0.0.1:1420", []byte(`{"name":"项目","icon":"FolderKanban","color":"#356F9E","sortOrder":3}`)))
		if typeResponse.Code != http.StatusCreated {
			t.Fatalf("type status=%d body=%s", typeResponse.Code, typeResponse.Body.String())
		}
		var archiveType struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(typeResponse.Body.Bytes(), &archiveType); err != nil || archiveType.ID == "" {
			t.Fatalf("type=%#v err=%v", archiveType, err)
		}
		fieldResponse := httptest.NewRecorder()
		fieldBody := []byte(`{"key":"stage","label":"阶段","valueType":"select","group":"项目信息","required":true,"sensitive":false,"options":["规划","执行"],"sortOrder":0}`)
		handler.ServeHTTP(fieldResponse, request(http.MethodPost, "/api/v3/archive-collections/"+archiveType.ID+"/fields", token, "http://127.0.0.1:1420", fieldBody))
		if fieldResponse.Code != http.StatusCreated {
			t.Fatalf("field status=%d body=%s", fieldResponse.Code, fieldResponse.Body.String())
		}
		taskResponse := httptest.NewRecorder()
		handler.ServeHTTP(taskResponse, request(http.MethodPost, "/api/v3/tasks", token, "http://127.0.0.1:1420", []byte(`{"title":"统一任务","status":"todo","priority":"normal","allDay":false,"timezone":"Asia/Shanghai"}`)))
		if taskResponse.Code != http.StatusCreated {
			t.Fatalf("task status=%d body=%s", taskResponse.Code, taskResponse.Body.String())
		}
		var createdTask struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(taskResponse.Body.Bytes(), &createdTask); err != nil || createdTask.ID == "" {
			t.Fatalf("task=%#v err=%v", createdTask, err)
		}
		getResponse := httptest.NewRecorder()
		handler.ServeHTTP(getResponse, request(http.MethodGet, "/api/v3/tasks/"+createdTask.ID, token, "http://127.0.0.1:1420", nil))
		if getResponse.Code != http.StatusOK || !bytes.Contains(getResponse.Body.Bytes(), []byte("统一任务")) {
			t.Fatalf("get task status=%d body=%s", getResponse.Code, getResponse.Body.String())
		}
	})
	t.Run("invalid timezone is rejected", func(t *testing.T) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodGet, "/api/v3/dashboard?timezone=Invalid%2FTimezone", token, "http://127.0.0.1:1420", nil))
		if response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
	})
	t.Run("search health and rebuild job", func(t *testing.T) {
		status := httptest.NewRecorder()
		handler.ServeHTTP(status, request(http.MethodGet, "/api/v3/search/status", token, "http://127.0.0.1:1420", nil))
		if status.Code != http.StatusOK || status.Body.String() != "{\"healthy\":true}\n" {
			t.Fatalf("status=%d body=%s", status.Code, status.Body.String())
		}
		acceptedResponse := httptest.NewRecorder()
		handler.ServeHTTP(acceptedResponse, request(http.MethodPost, "/api/v3/search/rebuild", token, "http://127.0.0.1:1420", nil))
		if acceptedResponse.Code != http.StatusAccepted {
			t.Fatalf("status=%d body=%s", acceptedResponse.Code, acceptedResponse.Body.String())
		}
		var accepted struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(acceptedResponse.Body.Bytes(), &accepted); err != nil || accepted.ID == "" {
			t.Fatalf("job=%#v err=%v", accepted, err)
		}
		stream := httptest.NewRecorder()
		handler.ServeHTTP(stream, request(http.MethodGet, "/api/v3/jobs/"+accepted.ID+"/events", token, "http://127.0.0.1:1420", nil))
		if stream.Code != http.StatusOK || !bytes.Contains(stream.Body.Bytes(), []byte(`"state":"succeeded"`)) {
			t.Fatalf("status=%d body=%s", stream.Code, stream.Body.String())
		}
	})
}

func TestJobEventStreamPublishesTerminalState(t *testing.T) {
	handler := testHandler(t)
	token := "0123456789012345678901234567890123456789012"
	settings := httptest.NewRecorder()
	body, err := json.Marshal(map[string]string{"backupDirectory": t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	handler.ServeHTTP(settings, request(http.MethodPut, "/api/v3/backup-settings", token, "http://127.0.0.1:1420", body))
	if settings.Code != http.StatusOK {
		t.Fatalf("settings status=%d body=%s", settings.Code, settings.Body.String())
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request(http.MethodPost, "/api/v3/backups", token, "http://127.0.0.1:1420", []byte(`{}`)))
	if response.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var accepted struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &accepted); err != nil || accepted.ID == "" {
		t.Fatalf("job=%#v err=%v", accepted, err)
	}
	stream := httptest.NewRecorder()
	handler.ServeHTTP(stream, request(http.MethodGet, "/api/v3/jobs/"+accepted.ID+"/events", token, "http://127.0.0.1:1420", nil))
	if stream.Code != http.StatusOK || !bytes.Contains(stream.Body.Bytes(), []byte("event: job")) || !bytes.Contains(stream.Body.Bytes(), []byte(`"state":"succeeded"`)) {
		t.Fatalf("status=%d body=%s", stream.Code, stream.Body.String())
	}
	if contentType := stream.Header().Get("Content-Type"); contentType != "text/event-stream" {
		t.Fatalf("content-type=%q", contentType)
	}
}

func TestBackupDirectoryMustBeExplicitlyConfigured(t *testing.T) {
	handler := testHandler(t)
	token := "0123456789012345678901234567890123456789012"
	read := httptest.NewRecorder()
	handler.ServeHTTP(read, request(http.MethodGet, "/api/v3/backup-settings", token, "http://127.0.0.1:1420", nil))
	if read.Code != http.StatusOK || read.Body.String() != "{\"backupDirectory\":\"\"}\n" {
		t.Fatalf("default settings status=%d body=%s", read.Code, read.Body.String())
	}
	directory := t.TempDir()
	body, err := json.Marshal(map[string]string{"backupDirectory": directory})
	if err != nil {
		t.Fatal(err)
	}
	updated := httptest.NewRecorder()
	handler.ServeHTTP(updated, request(http.MethodPut, "/api/v3/backup-settings", token, "http://127.0.0.1:1420", body))
	var configured backup.Settings
	decodeErr := json.Unmarshal(updated.Body.Bytes(), &configured)
	if updated.Code != http.StatusOK || decodeErr != nil || configured.BackupDirectory != directory {
		t.Fatalf("updated settings status=%d body=%s", updated.Code, updated.Body.String())
	}
}

func TestPaginationBoundsReturnValidationProblems(t *testing.T) {
	handler := testHandler(t)
	token := "0123456789012345678901234567890123456789012"
	for _, query := range []string{"limit=-1", "limit=0", "limit=201", "limit=abc", "limit=999999999999999999999999", "offset=-1", "offset=1000001", "offset=abc"} {
		t.Run(query, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request(http.MethodGet, "/api/v3/archive-records?"+query, token, "", nil))
			assertProblem(t, response, http.StatusUnprocessableEntity, "validation_failed")
		})
	}
	for _, query := range []string{"", "limit=1&offset=0", "limit=200&offset=1000000"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodGet, "/api/v3/archive-records?"+query, token, "", nil))
		var page app.ArchiveRecordPage
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil || response.Code != http.StatusOK || page.Items == nil || page.Limit < 1 || page.Limit > 200 {
			t.Fatalf("valid query %q: status=%d page=%#v err=%v", query, response.Code, page, err)
		}
	}
}

func TestMissingAndDeletedResourceRoutesShareNotFoundContract(t *testing.T) {
	handler, store := testHandlerWithStore(t)
	token := "0123456789012345678901234567890123456789012"
	owner, err := store.CreateArchive(context.Background(), archive.Input{CollectionID: "template", Title: "deleted owner"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.TrashArchive(context.Background(), owner.ID); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"missing", owner.ID} {
		for _, scenario := range []struct{ method, suffix, body string }{
			{http.MethodGet, "", ""}, {http.MethodGet, "/attachments", ""}, {http.MethodGet, "/relations", ""}, {http.MethodGet, "/activity", ""},
			{http.MethodPost, "/attachments", `{"paths":["unused-source.txt"]}`},
			{http.MethodPost, "/relations", `{"targetId":"target","relationType":"related","notes":""}`},
		} {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request(scenario.method, "/api/v3/archive-records/"+id+scenario.suffix, token, "", []byte(scenario.body)))
			assertProblem(t, response, http.StatusNotFound, "not_found")
		}
	}
	for _, scenario := range []struct{ method, path string }{
		{http.MethodGet, "/api/v3/tasks/missing"}, {http.MethodDelete, "/api/v3/tasks/missing"},
		{http.MethodDelete, "/api/v3/attachments/missing"}, {http.MethodGet, "/api/v3/attachments/missing/open-target"},
		{http.MethodDelete, "/api/v3/relations/missing"}, {http.MethodGet, "/api/v3/jobs/missing"}, {http.MethodGet, "/api/v3/jobs/missing/events"},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request(scenario.method, scenario.path, token, "", nil))
		assertProblem(t, response, http.StatusNotFound, "not_found")
	}
}

func TestCalendarAndDashboardContractsUseLocalDayProjection(t *testing.T) {
	handler, store := testHandlerWithStore(t)
	token := "0123456789012345678901234567890123456789012"
	ctx := context.Background()
	timezone := "Pacific/Kiritimati"
	location, err := time.LoadLocation(timezone)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().In(location)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location)
	end := start.AddDate(0, 0, 1)
	for _, scenario := range []struct {
		title, status string
		from, to      time.Time
	}{
		{"midnight-end", "todo", start.Add(-time.Hour), start},
		{"scheduled-today", "todo", start.Add(time.Hour), start.Add(2 * time.Hour)},
		{"scheduled-completed", "done", start.Add(time.Hour), start.Add(2 * time.Hour)},
		{"scheduled-tomorrow", "todo", end, end.Add(time.Hour)},
	} {
		if _, err := store.CreateTask(ctx, task.Input{Title: scenario.title, Status: scenario.status, Priority: "normal", StartsAt: &scenario.from, EndsAt: &scenario.to, Timezone: timezone}); err != nil {
			t.Fatal(err)
		}
	}
	due := end.Format("2006-01-02")
	if _, err := store.CreateTask(ctx, task.Input{Title: "due-tomorrow", Status: "todo", Priority: "normal", DueOn: &due}); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	query := url.Values{"view": {"calendar"}, "from": {start.UTC().Format(time.RFC3339)}, "to": {end.UTC().Format(time.RFC3339)}}
	handler.ServeHTTP(response, request(http.MethodGet, "/api/v3/tasks?"+query.Encode(), token, "", nil))
	var calendar []task.Task
	if err := json.Unmarshal(response.Body.Bytes(), &calendar); err != nil || response.Code != http.StatusOK {
		t.Fatalf("calendar status=%d err=%v body=%s", response.Code, err, response.Body.String())
	}
	assertTaskTitles(t, calendar, []string{"scheduled-completed", "scheduled-today"})
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request(http.MethodGet, "/api/v3/dashboard?timezone="+url.QueryEscape(timezone), token, "", nil))
	var dashboard app.Dashboard
	if err := json.Unmarshal(response.Body.Bytes(), &dashboard); err != nil || response.Code != http.StatusOK {
		t.Fatalf("dashboard status=%d err=%v", response.Code, err)
	}
	assertTaskTitles(t, dashboard.TodayTasks, []string{"scheduled-today"})
	assertTaskTitles(t, dashboard.TomorrowTasks, []string{"due-tomorrow", "scheduled-tomorrow"})
	assertTaskTitles(t, dashboard.OverdueTasks, []string{"midnight-end"})
}

func TestAttachmentImportAcceptedJobAndRestorePreflightFailureContracts(t *testing.T) {
	handler, store := testHandlerWithStore(t)
	token := "0123456789012345678901234567890123456789012"
	owner, err := store.CreateArchive(context.Background(), archive.Input{CollectionID: "template", Title: "attachment owner"})
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(t.TempDir(), "payload.txt")
	if err := os.WriteFile(source, []byte("attachment payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(map[string]any{"paths": []string{source}})
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request(http.MethodPost, "/api/v3/archive-records/"+owner.ID+"/attachments", token, "", body))
	var accepted struct{ ID, State string }
	if err := json.Unmarshal(response.Body.Bytes(), &accepted); err != nil || response.Code != http.StatusAccepted || accepted.ID == "" {
		t.Fatalf("accepted status=%d body=%s err=%v", response.Code, response.Body.String(), err)
	}
	stream := httptest.NewRecorder()
	handler.ServeHTTP(stream, request(http.MethodGet, "/api/v3/jobs/"+accepted.ID+"/events", token, "", nil))
	if stream.Code != http.StatusOK || stream.Header().Get("Content-Type") != "text/event-stream" || !bytes.Contains(stream.Body.Bytes(), []byte(`"state":"succeeded"`)) {
		t.Fatalf("job stream status=%d body=%s", stream.Code, stream.Body.String())
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request(http.MethodGet, "/api/v3/archive-records/"+owner.ID+"/attachments", token, "", nil))
	var attachments []attachment.Attachment
	if err := json.Unmarshal(response.Body.Bytes(), &attachments); err != nil || len(attachments) != 1 || attachments[0].Size != 18 {
		t.Fatalf("attachments=%#v err=%v", attachments, err)
	}
	body, err = json.Marshal(map[string]string{"source": source})
	if err != nil {
		t.Fatal(err)
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request(http.MethodPost, "/api/v3/restores/preflight", token, "", body))
	assertProblem(t, response, http.StatusUnprocessableEntity, "restore_preflight_failed")
	if bytes.Contains(response.Body.Bytes(), []byte(source)) {
		t.Fatal("preflight problem exposed source path")
	}
}

func assertTaskTitles(t *testing.T, items []task.Task, want []string) {
	t.Helper()
	titles := make([]string, 0, len(items))
	for _, item := range items {
		titles = append(titles, item.Title)
	}
	slices.Sort(titles)
	if !slices.Equal(titles, want) {
		t.Fatalf("titles=%v, want %v", titles, want)
	}
}

func assertProblem(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	var problem workbenchapi.Problem
	if err := json.Unmarshal(response.Body.Bytes(), &problem); err != nil || response.Code != status || problem.Status != status || problem.Code != code || problem.TraceID == "" || response.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("problem status=%d body=%s decode=%v, want %d/%s", response.Code, response.Body.String(), err, status, code)
	}
}
