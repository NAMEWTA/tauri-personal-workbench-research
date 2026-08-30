package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/personal-workbench/workbenchd/internal/app"
)

type Problem struct {
	Status      int               `json:"status"`
	Code        string            `json:"code"`
	Title       string            `json:"title"`
	Detail      string            `json:"detail"`
	TraceID     string            `json:"traceId"`
	FieldErrors map[string]string `json:"fieldErrors,omitempty"`
}

func writeProblem(w http.ResponseWriter, r *http.Request, status int, code, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Problem{Status: status, Code: code, Title: title, Detail: detail, TraceID: requestID(r.Context())})
}

func writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, app.ErrNotFound) {
		writeProblem(w, r, http.StatusNotFound, "not_found", "未找到", "请求的内容不存在或已被删除。")
		return
	}
	if errors.Is(err, app.ErrValidation) {
		writeProblem(w, r, http.StatusUnprocessableEntity, "validation_failed", "内容有误", "请检查必填字段和字段格式。")
		return
	}
	if errors.Is(err, app.ErrConflict) {
		writeProblem(w, r, http.StatusConflict, "operation_conflict", "操作冲突", "备份或恢复任务已在运行。")
		return
	}
	writeProblem(w, r, http.StatusInternalServerError, "internal_error", "服务错误", "操作未能完成，请稍后重试。")
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
