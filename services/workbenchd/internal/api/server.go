package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/personal-workbench/workbenchd/internal/app"
	"github.com/personal-workbench/workbenchd/internal/archive"
	"github.com/personal-workbench/workbenchd/internal/preferences"
	"github.com/personal-workbench/workbenchd/internal/relation"
	"github.com/personal-workbench/workbenchd/internal/task"
)

type Config struct {
	Token          string
	AllowedOrigins []string
	ServiceVersion string
	Shutdown       func()
}

type Server struct {
	service *app.Service
	config  Config
	logger  *slog.Logger
}

func NewHandler(service *app.Service, config Config, logger *slog.Logger) http.Handler {
	s := &Server{service: service, config: config, logger: logger}
	root := chi.NewRouter()
	root.Use(recoverer(logger), requestIDs, securityHeaders, validateHost, cors(config.AllowedOrigins))
	root.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"alive": true})
	})
	root.Group(func(protected chi.Router) {
		protected.Use(authenticate(config.Token), bodyLimit(2<<20), timeout(30*time.Second), accessLog(logger))
		protected.Route("/api/v3", func(r chi.Router) {
			r.Get("/meta", s.meta)
			r.Get("/preferences", s.preferences)
			r.Patch("/preferences", s.updatePreferences)
			r.Get("/dashboard", s.dashboard)
			r.Get("/archive-records", s.listArchives)
			r.Get("/archive-collections", s.listArchiveTypes)
			r.Post("/archive-collections", s.createArchiveType)
			r.Route("/archive-collections/{collectionId}", func(r chi.Router) {
				r.Get("/", s.getArchiveType)
				r.Patch("/", s.updateArchiveType)
				r.Delete("/", s.deleteArchiveType)
				r.Post("/fields", s.createArchiveField)
			})
			r.Patch("/archive-fields/{fieldId}", s.updateArchiveField)
			r.Delete("/archive-fields/{fieldId}", s.deleteArchiveField)
			r.Post("/archive-records", s.createArchive)
			r.Route("/archive-records/{recordId}", func(r chi.Router) {
				r.Get("/", s.getArchive)
				r.Patch("/", s.updateArchive)
				r.Delete("/", s.trashArchive)
			})
			r.Get("/archive-records/{recordId}/relations", s.listRelations)
			r.Post("/archive-records/{recordId}/relations", s.createRelation)
			r.Delete("/relations/{relationId}", s.deleteRelation)
			r.Get("/archive-records/{recordId}/attachments", s.listAttachments)
			r.Post("/archive-records/{recordId}/attachments", s.importAttachments)
			r.Get("/archive-records/{recordId}/activity", s.listArchiveActivity)
			r.Delete("/attachments/{attachmentId}", s.deleteAttachment)
			r.Get("/attachments/{attachmentId}/open-target", s.attachmentOpenTarget)
			r.Get("/tasks", s.listTasks)
			r.Post("/tasks", s.createTask)
			r.Route("/tasks/{taskId}", func(r chi.Router) {
				r.Get("/", s.getTask)
				r.Patch("/", s.updateTask)
				r.Delete("/", s.trashTask)
			})
			r.Get("/search", s.search)
			r.Get("/search/status", s.searchStatus)
			r.Post("/search/rebuild", s.rebuildSearch)
			r.Get("/trash", s.listTrash)
			r.Post("/trash/{trashId}/restore", s.restoreTrash)
			r.Get("/backups", s.listBackups)
			r.Post("/backups", s.createBackup)
			r.Get("/backup-settings", s.backupSettings)
			r.Put("/backup-settings", s.configureBackups)
			r.Post("/restores/preflight", s.preflightRestore)
			r.Post("/restores", s.createRestore)
			r.Get("/jobs/{jobId}", s.getJob)
			r.Get("/jobs/{jobId}/events", s.jobEvents)
			r.Delete("/jobs/{jobId}", s.cancelJob)
		})
		protected.Post("/internal/shutdown", s.shutdown)
	})
	return root
}

func (s *Server) meta(w http.ResponseWriter, r *http.Request) {
	name, schemaVersion, err := s.service.WorkspaceMeta(r.Context())
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiVersion": 3, "serviceVersion": s.config.ServiceVersion, "workspaceName": name, "schemaVersion": schemaVersion})
}

func (s *Server) preferences(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.Preferences(r.Context())
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) updatePreferences(w http.ResponseWriter, r *http.Request) {
	var input preferences.Update
	if !decode(w, r, &input) {
		return
	}
	if err := input.Validate(); err != nil {
		invalid(w, r)
		return
	}
	result, err := s.service.UpdatePreferences(r.Context(), input)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.Dashboard(r.Context(), r.URL.Query().Get("timezone"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) listArchives(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 50)
	offset := queryInt(r, "offset", 0)
	result, err := s.service.ListArchiveRecords(r.Context(), r.URL.Query().Get("q"), r.URL.Query().Get("collectionId"), r.URL.Query().Get("sort"), limit, offset)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) listArchiveTypes(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.ListArchiveCollections(r.Context())
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) getArchiveType(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.GetArchiveCollection(r.Context(), chi.URLParam(r, "collectionId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) createArchiveType(w http.ResponseWriter, r *http.Request) {
	var input archive.CollectionInput
	if !decode(w, r, &input) {
		return
	}
	if !input.Valid() {
		invalid(w, r)
		return
	}
	result, err := s.service.CreateArchiveCollection(r.Context(), input)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) updateArchiveType(w http.ResponseWriter, r *http.Request) {
	var input archive.CollectionInput
	if !decode(w, r, &input) {
		return
	}
	if !input.Valid() {
		invalid(w, r)
		return
	}
	result, err := s.service.UpdateArchiveCollection(r.Context(), chi.URLParam(r, "collectionId"), input)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) deleteArchiveType(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeleteArchiveCollection(r.Context(), chi.URLParam(r, "collectionId")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) createArchiveField(w http.ResponseWriter, r *http.Request) {
	var input archive.FieldInput
	if !decode(w, r, &input) {
		return
	}
	if !input.Valid() {
		invalid(w, r)
		return
	}
	result, err := s.service.CreateArchiveField(r.Context(), chi.URLParam(r, "collectionId"), input)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) updateArchiveField(w http.ResponseWriter, r *http.Request) {
	var input archive.FieldInput
	if !decode(w, r, &input) {
		return
	}
	if !input.Valid() {
		invalid(w, r)
		return
	}
	result, err := s.service.UpdateArchiveField(r.Context(), chi.URLParam(r, "fieldId"), input)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) deleteArchiveField(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeleteArchiveField(r.Context(), chi.URLParam(r, "fieldId")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getArchive(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.GetArchive(r.Context(), chi.URLParam(r, "recordId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) createArchive(w http.ResponseWriter, r *http.Request) {
	var input archive.Input
	if !decode(w, r, &input) {
		return
	}
	if !input.Valid() {
		invalid(w, r)
		return
	}
	result, err := s.service.CreateArchive(r.Context(), input)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}
func (s *Server) updateArchive(w http.ResponseWriter, r *http.Request) {
	var input archive.Input
	if !decode(w, r, &input) {
		return
	}
	if !input.Valid() {
		invalid(w, r)
		return
	}
	result, err := s.service.UpdateArchive(r.Context(), chi.URLParam(r, "recordId"), input)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) trashArchive(w http.ResponseWriter, r *http.Request) {
	if err := s.service.TrashArchive(r.Context(), chi.URLParam(r, "recordId")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) listRelations(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.ListRelations(r.Context(), chi.URLParam(r, "recordId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) createRelation(w http.ResponseWriter, r *http.Request) {
	var input relation.Input
	if !decode(w, r, &input) {
		return
	}
	if !input.Valid() {
		invalid(w, r)
		return
	}
	result, err := s.service.CreateRelation(r.Context(), chi.URLParam(r, "recordId"), input)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}
func (s *Server) deleteRelation(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeleteRelation(r.Context(), chi.URLParam(r, "relationId")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) listAttachments(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.ListAttachments(r.Context(), chi.URLParam(r, "recordId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) importAttachments(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Paths []string `json:"paths"`
	}
	if !decode(w, r, &input) {
		return
	}
	if len(input.Paths) == 0 || len(input.Paths) > 20 {
		invalid(w, r)
		return
	}
	result, err := s.service.StartAttachmentImport(chi.URLParam(r, "recordId"), input.Paths)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, result)
}
func (s *Server) listArchiveActivity(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.ListActivity(r.Context(), "archive", chi.URLParam(r, "recordId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) deleteAttachment(w http.ResponseWriter, r *http.Request) {
	if err := s.service.DeleteAttachment(r.Context(), chi.URLParam(r, "attachmentId")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) attachmentOpenTarget(w http.ResponseWriter, r *http.Request) {
	path, err := s.service.AttachmentOpenTarget(r.Context(), chi.URLParam(r, "attachmentId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": path})
}

func (s *Server) listTasks(w http.ResponseWriter, r *http.Request) {
	from, ok := queryTime(w, r, "from")
	if !ok {
		return
	}
	to, ok := queryTime(w, r, "to")
	if !ok {
		return
	}
	result, err := s.service.ListTasks(r.Context(), task.Filter{
		View:               r.URL.Query().Get("view"),
		Timezone:           r.URL.Query().Get("timezone"),
		Query:              r.URL.Query().Get("q"),
		RecordID:           r.URL.Query().Get("recordId"),
		DueFrom:            r.URL.Query().Get("dueFrom"),
		DueTo:              r.URL.Query().Get("dueTo"),
		IncludeUnscheduled: r.URL.Query().Get("includeUnscheduled") == "true",
		From:               from,
		To:                 to,
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) getTask(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.GetTask(r.Context(), chi.URLParam(r, "taskId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) createTask(w http.ResponseWriter, r *http.Request) {
	var input task.Input
	if !decode(w, r, &input) {
		return
	}
	if !input.Valid() {
		invalid(w, r)
		return
	}
	result, err := s.service.CreateTask(r.Context(), input)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}
func (s *Server) updateTask(w http.ResponseWriter, r *http.Request) {
	var input task.Input
	if !decode(w, r, &input) {
		return
	}
	if !input.Valid() {
		invalid(w, r)
		return
	}
	result, err := s.service.UpdateTask(r.Context(), chi.URLParam(r, "taskId"), input)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) trashTask(w http.ResponseWriter, r *http.Request) {
	if err := s.service.TrashTask(r.Context(), chi.URLParam(r, "taskId")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		invalid(w, r)
		return
	}
	result, err := s.service.Search(r.Context(), q)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) searchStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"healthy": s.service.SearchHealthy(r.Context())})
}
func (s *Server) rebuildSearch(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.StartSearchRebuild()
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, result)
}
func (s *Server) listTrash(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.ListTrash(r.Context())
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) restoreTrash(w http.ResponseWriter, r *http.Request) {
	if err := s.service.RestoreTrash(r.Context(), chi.URLParam(r, "trashId")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) listBackups(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.ListBackups(r.Context())
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) backupSettings(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.BackupSettings(r.Context())
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) configureBackups(w http.ResponseWriter, r *http.Request) {
	var input struct {
		BackupDirectory string `json:"backupDirectory"`
	}
	if !decode(w, r, &input) {
		return
	}
	result, err := s.service.ConfigureBackups(r.Context(), input.BackupDirectory)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) createBackup(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.StartBackup()
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, result)
}
func (s *Server) preflightRestore(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Source string `json:"source"`
	}
	if !decode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Source) == "" {
		invalid(w, r)
		return
	}
	result, err := s.service.PreflightRestore(r.Context(), input.Source)
	if err != nil {
		writeProblem(w, r, http.StatusUnprocessableEntity, "restore_preflight_failed", "备份不可恢复", "备份文件未通过安全与完整性检查。")
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) createRestore(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Source      string `json:"source"`
		Destination string `json:"destination"`
	}
	if !decode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Source) == "" || strings.TrimSpace(input.Destination) == "" {
		invalid(w, r)
		return
	}
	result, err := s.service.StartRestore(input.Source, input.Destination)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, result)
}
func (s *Server) getJob(w http.ResponseWriter, r *http.Request) {
	result, ok := s.service.GetJob(chi.URLParam(r, "jobId"))
	if !ok {
		writeProblem(w, r, http.StatusNotFound, "not_found", "未找到", "后台任务不存在。")
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) cancelJob(w http.ResponseWriter, r *http.Request) {
	result, ok := s.service.CancelJob(chi.URLParam(r, "jobId"))
	if !ok {
		writeProblem(w, r, http.StatusNotFound, "not_found", "未找到", "后台任务不存在。")
		return
	}
	writeJSON(w, http.StatusAccepted, result)
}
func (s *Server) jobEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeProblem(w, r, http.StatusInternalServerError, "stream_unavailable", "服务错误", "当前连接不支持进度事件。")
		return
	}
	updates, unsubscribe, ok := s.service.SubscribeJob(chi.URLParam(r, "jobId"))
	if !ok {
		writeProblem(w, r, http.StatusNotFound, "not_found", "未找到", "后台任务不存在。")
		return
	}
	defer unsubscribe()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			_, _ = io.WriteString(w, ": keepalive\n\n")
			flusher.Flush()
		case item := <-updates:
			raw, err := json.Marshal(item)
			if err != nil {
				return
			}
			_, _ = fmt.Fprintf(w, "event: job\ndata: %s\n\n", raw)
			flusher.Flush()
			if item.Terminal() {
				return
			}
		}
	}
}
func (s *Server) shutdown(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusAccepted)
	go s.config.Shutdown()
}

func decode(w http.ResponseWriter, r *http.Request, destination any) bool {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeProblem(w, r, http.StatusRequestEntityTooLarge, "payload_too_large", "请求过大", "请求内容超过允许大小。")
			return false
		}
		if errors.Is(err, io.EOF) {
			invalid(w, r)
		} else {
			writeProblem(w, r, http.StatusBadRequest, "invalid_json", "请求无效", "JSON 内容无法解析。")
		}
		return false
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		writeProblem(w, r, http.StatusBadRequest, "invalid_json", "请求无效", "请求只能包含一个 JSON 对象。")
		return false
	}
	return true
}
func invalid(w http.ResponseWriter, r *http.Request) {
	writeProblem(w, r, http.StatusUnprocessableEntity, "validation_failed", "内容有误", "请检查必填字段和字段格式。")
}
func queryInt(r *http.Request, name string, fallback int) int {
	value, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil {
		return fallback
	}
	return value
}
func queryTime(w http.ResponseWriter, r *http.Request, name string) (*time.Time, bool) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return nil, true
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		invalid(w, r)
		return nil, false
	}
	return &parsed, true
}
