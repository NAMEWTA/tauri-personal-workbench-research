package app

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/personal-workbench/workbenchd/internal/archive"
	"github.com/personal-workbench/workbenchd/internal/attachment"
	"github.com/personal-workbench/workbenchd/internal/backup"
	"github.com/personal-workbench/workbenchd/internal/job"
	"github.com/personal-workbench/workbenchd/internal/preferences"
	"github.com/personal-workbench/workbenchd/internal/relation"
	"github.com/personal-workbench/workbenchd/internal/task"
)

var ErrNotFound = errors.New("not found")
var ErrValidation = errors.New("validation failed")
var ErrConflict = errors.New("conflict")

type ArchivePage struct {
	Items  []archive.Archive `json:"items"`
	Total  int               `json:"total"`
	Limit  int               `json:"limit"`
	Offset int               `json:"offset"`
}

type SearchResult struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
}

type TrashEntry struct {
	ID         string    `json:"id"`
	EntityID   string    `json:"entityId"`
	EntityType string    `json:"entityType"`
	Title      string    `json:"title"`
	DeletedAt  time.Time `json:"deletedAt"`
}

type Dashboard struct {
	OverdueTasks   []task.Task       `json:"overdueTasks"`
	TodayTasks     []task.Task       `json:"todayTasks"`
	TomorrowTasks  []task.Task       `json:"tomorrowTasks"`
	RecentArchives []archive.Archive `json:"recentArchives"`
}

type Activity struct {
	ID        string    `json:"id"`
	Action    string    `json:"action"`
	ChangedAt time.Time `json:"changedAt"`
}

type Repository interface {
	WorkspaceMeta(context.Context) (string, int, error)
	Preferences(context.Context) (preferences.Values, error)
	UpdatePreferences(context.Context, preferences.Update) (preferences.Values, error)
	ListArchiveTypes(context.Context) ([]archive.TypeDefinition, error)
	GetArchiveType(context.Context, string) (archive.TypeDefinition, error)
	CreateArchiveType(context.Context, archive.TypeInput) (archive.TypeDefinition, error)
	UpdateArchiveType(context.Context, string, archive.TypeInput) (archive.TypeDefinition, error)
	DeleteArchiveType(context.Context, string) error
	CreateArchiveField(context.Context, string, archive.FieldInput) (archive.FieldDefinition, error)
	UpdateArchiveField(context.Context, string, archive.FieldInput) (archive.FieldDefinition, error)
	DeleteArchiveField(context.Context, string) error
	ListArchives(context.Context, string, string, string, int, int) (ArchivePage, error)
	GetArchive(context.Context, string) (archive.Archive, error)
	CreateArchive(context.Context, archive.Input) (archive.Archive, error)
	UpdateArchive(context.Context, string, archive.Input) (archive.Archive, error)
	TrashArchive(context.Context, string) error
	ListTasks(context.Context, task.Filter) ([]task.Task, error)
	GetTask(context.Context, string) (task.Task, error)
	CreateTask(context.Context, task.Input) (task.Task, error)
	UpdateTask(context.Context, string, task.Input) (task.Task, error)
	TrashTask(context.Context, string) error
	Search(context.Context, string) ([]SearchResult, error)
	SearchHealthy(context.Context) bool
	RebuildSearch(context.Context, func(int, string)) error
	ListTrash(context.Context) ([]TrashEntry, error)
	RestoreTrash(context.Context, string) error
	ListRelations(context.Context, string) ([]relation.Relation, error)
	CreateRelation(context.Context, string, relation.Input) (relation.Relation, error)
	DeleteRelation(context.Context, string) error
	ListActivity(context.Context, string, string) ([]Activity, error)
}

type Service struct {
	repo                Repository
	backups             *backup.Manager
	jobs                *job.Manager
	attachments         *attachment.Manager
	operationMu         sync.Mutex
	dataOperationActive bool
}

func New(repo Repository, backups *backup.Manager, attachments *attachment.Manager) *Service {
	return &Service{repo: repo, backups: backups, jobs: job.NewManager(backups.DB()), attachments: attachments}
}

func (s *Service) WorkspaceMeta(ctx context.Context) (string, int, error) {
	return s.repo.WorkspaceMeta(ctx)
}
func (s *Service) Preferences(ctx context.Context) (preferences.Values, error) {
	return s.repo.Preferences(ctx)
}
func (s *Service) UpdatePreferences(ctx context.Context, update preferences.Update) (preferences.Values, error) {
	return s.repo.UpdatePreferences(ctx, update)
}
func (s *Service) ListArchiveTypes(ctx context.Context) ([]archive.TypeDefinition, error) {
	return s.repo.ListArchiveTypes(ctx)
}
func (s *Service) GetArchiveType(ctx context.Context, id string) (archive.TypeDefinition, error) {
	return s.repo.GetArchiveType(ctx, id)
}
func (s *Service) CreateArchiveType(ctx context.Context, input archive.TypeInput) (archive.TypeDefinition, error) {
	return s.repo.CreateArchiveType(ctx, input)
}
func (s *Service) UpdateArchiveType(ctx context.Context, id string, input archive.TypeInput) (archive.TypeDefinition, error) {
	return s.repo.UpdateArchiveType(ctx, id, input)
}
func (s *Service) DeleteArchiveType(ctx context.Context, id string) error {
	return s.repo.DeleteArchiveType(ctx, id)
}
func (s *Service) CreateArchiveField(ctx context.Context, typeID string, input archive.FieldInput) (archive.FieldDefinition, error) {
	return s.repo.CreateArchiveField(ctx, typeID, input)
}
func (s *Service) UpdateArchiveField(ctx context.Context, id string, input archive.FieldInput) (archive.FieldDefinition, error) {
	return s.repo.UpdateArchiveField(ctx, id, input)
}
func (s *Service) DeleteArchiveField(ctx context.Context, id string) error {
	return s.repo.DeleteArchiveField(ctx, id)
}
func (s *Service) ListArchives(ctx context.Context, query, typeID, sortBy string, limit, offset int) (ArchivePage, error) {
	return s.repo.ListArchives(ctx, query, typeID, sortBy, limit, offset)
}
func (s *Service) GetArchive(ctx context.Context, id string) (archive.Archive, error) {
	return s.repo.GetArchive(ctx, id)
}
func (s *Service) CreateArchive(ctx context.Context, input archive.Input) (archive.Archive, error) {
	return s.repo.CreateArchive(ctx, input)
}
func (s *Service) UpdateArchive(ctx context.Context, id string, input archive.Input) (archive.Archive, error) {
	return s.repo.UpdateArchive(ctx, id, input)
}
func (s *Service) TrashArchive(ctx context.Context, id string) error {
	return s.repo.TrashArchive(ctx, id)
}
func (s *Service) ListTasks(ctx context.Context, filter task.Filter) ([]task.Task, error) {
	return s.repo.ListTasks(ctx, filter)
}
func (s *Service) GetTask(ctx context.Context, id string) (task.Task, error) {
	return s.repo.GetTask(ctx, id)
}
func (s *Service) CreateTask(ctx context.Context, input task.Input) (task.Task, error) {
	return s.repo.CreateTask(ctx, input)
}
func (s *Service) UpdateTask(ctx context.Context, id string, input task.Input) (task.Task, error) {
	return s.repo.UpdateTask(ctx, id, input)
}
func (s *Service) TrashTask(ctx context.Context, id string) error {
	return s.repo.TrashTask(ctx, id)
}
func (s *Service) Search(ctx context.Context, query string) ([]SearchResult, error) {
	return s.repo.Search(ctx, query)
}
func (s *Service) SearchHealthy(ctx context.Context) bool { return s.repo.SearchHealthy(ctx) }
func (s *Service) StartSearchRebuild() (job.Job, error) {
	return s.jobs.Start("search_rebuild", func(ctx context.Context, progress func(int, string)) error {
		return s.repo.RebuildSearch(ctx, progress)
	})
}
func (s *Service) ListTrash(ctx context.Context) ([]TrashEntry, error) {
	return s.repo.ListTrash(ctx)
}
func (s *Service) RestoreTrash(ctx context.Context, id string) error {
	return s.repo.RestoreTrash(ctx, id)
}
func (s *Service) ListBackups(ctx context.Context) ([]backup.Run, error) {
	return s.backups.List(ctx)
}

func (s *Service) BackupSettings(ctx context.Context) (backup.Settings, error) {
	return s.backups.Settings(ctx)
}

func (s *Service) ConfigureBackups(ctx context.Context, directory string) (backup.Settings, error) {
	return s.backups.Configure(ctx, directory)
}

func (s *Service) StartBackup() (job.Job, error) {
	if !s.reserveDataOperation() {
		return job.Job{}, fmt.Errorf("%w: backup or restore already running", ErrConflict)
	}
	item, err := s.jobs.Start("backup", func(ctx context.Context, progress func(int, string)) error {
		defer s.releaseDataOperation()
		_, err := s.backups.Create(ctx, "", progress)
		return err
	})
	if err != nil {
		s.releaseDataOperation()
	}
	return item, err
}

func (s *Service) PreflightRestore(ctx context.Context, source string) (backup.RestoreReport, error) {
	return s.backups.Preflight(ctx, source)
}

func (s *Service) StartRestore(source, destination string) (job.Job, error) {
	if !s.reserveDataOperation() {
		return job.Job{}, fmt.Errorf("%w: backup or restore already running", ErrConflict)
	}
	item, err := s.jobs.Start("restore", func(ctx context.Context, progress func(int, string)) error {
		defer s.releaseDataOperation()
		return s.backups.RestoreToNewWorkspace(ctx, source, destination, progress)
	})
	if err != nil {
		s.releaseDataOperation()
	}
	return item, err
}

func (s *Service) reserveDataOperation() bool {
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	if s.dataOperationActive {
		return false
	}
	s.dataOperationActive = true
	return true
}
func (s *Service) releaseDataOperation() {
	s.operationMu.Lock()
	s.dataOperationActive = false
	s.operationMu.Unlock()
}
func (s *Service) GetJob(id string) (job.Job, bool)    { return s.jobs.Get(id) }
func (s *Service) CancelJob(id string) (job.Job, bool) { return s.jobs.Cancel(id) }
func (s *Service) SubscribeJob(id string) (<-chan job.Job, func(), bool) {
	return s.jobs.Subscribe(id)
}

func (s *Service) ScheduleAutomaticBackup(ctx context.Context, delay time.Duration) {
	go func() {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		due, err := s.backups.NeedsAutomaticBackup(ctx, time.Now())
		if err == nil && due {
			_, _ = s.StartBackup()
		}
	}()
}
func (s *Service) Shutdown(ctx context.Context) error { return s.jobs.Shutdown(ctx) }
func (s *Service) ListRelations(ctx context.Context, id string) ([]relation.Relation, error) {
	return s.repo.ListRelations(ctx, id)
}
func (s *Service) CreateRelation(ctx context.Context, id string, input relation.Input) (relation.Relation, error) {
	return s.repo.CreateRelation(ctx, id, input)
}
func (s *Service) DeleteRelation(ctx context.Context, id string) error {
	return s.repo.DeleteRelation(ctx, id)
}
func (s *Service) ListAttachments(ctx context.Context, id string) ([]attachment.Attachment, error) {
	return s.attachments.List(ctx, id)
}
func (s *Service) ImportAttachments(ctx context.Context, id string, paths []string) ([]attachment.Attachment, error) {
	return s.attachments.Import(ctx, id, paths)
}
func (s *Service) StartAttachmentImport(id string, paths []string) (job.Job, error) {
	return s.jobs.Start("attachment", func(ctx context.Context, progress func(int, string)) error {
		_, err := s.attachments.ImportWithProgress(ctx, id, paths, progress)
		return err
	})
}
func (s *Service) DeleteAttachment(ctx context.Context, id string) error {
	err := s.attachments.Delete(ctx, id)
	if errors.Is(err, attachment.ErrNotFound) {
		return ErrNotFound
	}
	return err
}
func (s *Service) AttachmentOpenTarget(ctx context.Context, id string) (string, error) {
	path, err := s.attachments.OpenTarget(ctx, id)
	if errors.Is(err, attachment.ErrNotFound) {
		return "", ErrNotFound
	}
	return path, err
}
func (s *Service) ListActivity(ctx context.Context, entityType, id string) ([]Activity, error) {
	return s.repo.ListActivity(ctx, entityType, id)
}

func (s *Service) Dashboard(ctx context.Context, timezone string) (Dashboard, error) {
	location := time.Local
	var err error
	if timezone != "" {
		location, err = time.LoadLocation(timezone)
		if err != nil {
			return Dashboard{}, ErrValidation
		}
	}
	today, err := s.repo.ListTasks(ctx, task.Filter{View: "today", Timezone: timezone})
	if err != nil {
		return Dashboard{}, err
	}
	tomorrow, err := s.repo.ListTasks(ctx, task.Filter{View: "tomorrow", Timezone: timezone})
	if err != nil {
		return Dashboard{}, err
	}
	archives, err := s.repo.ListArchives(ctx, "", "", "updated", 6, 0)
	if err != nil {
		return Dashboard{}, err
	}
	now := time.Now().In(location)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location).UTC()
	result := Dashboard{OverdueTasks: []task.Task{}, TodayTasks: []task.Task{}, TomorrowTasks: tomorrow, RecentArchives: archives.Items}
	for _, item := range today {
		if item.EndsAt != nil && item.EndsAt.Before(start) {
			result.OverdueTasks = append(result.OverdueTasks, item)
			continue
		}
		result.TodayTasks = append(result.TodayTasks, item)
	}
	return result, nil
}
