package app

import (
	"context"

	"github.com/personal-workbench/workbenchd/internal/archive"
	"github.com/personal-workbench/workbenchd/internal/attachment"
	"github.com/personal-workbench/workbenchd/internal/backup"
	"github.com/personal-workbench/workbenchd/internal/job"
	"github.com/personal-workbench/workbenchd/internal/preferences"
	"github.com/personal-workbench/workbenchd/internal/relation"
	"github.com/personal-workbench/workbenchd/internal/task"
)

// Repository is the persistence composition used by the application facade.
// The domain interfaces keep repository mocks and implementations narrow.
type Repository interface {
	WorkspaceRepository
	PreferencesRepository
	ArchiveRepository
	TaskRepository
	SearchRepository
	TrashRepository
	RelationRepository
}

type WorkspaceRepository interface {
	WorkspaceMeta(context.Context) (string, int, error)
}

type PreferencesRepository interface {
	Preferences(context.Context) (preferences.Values, error)
	UpdatePreferences(context.Context, preferences.Update) (preferences.Values, error)
}

type ArchiveRepository interface {
	ListArchiveCollections(context.Context) ([]archive.CollectionDefinition, error)
	GetArchiveCollection(context.Context, string) (archive.CollectionDefinition, error)
	CreateArchiveCollection(context.Context, archive.CollectionInput) (archive.CollectionDefinition, error)
	UpdateArchiveCollection(context.Context, string, archive.CollectionInput) (archive.CollectionDefinition, error)
	DeleteArchiveCollection(context.Context, string) error
	CreateArchiveField(context.Context, string, archive.FieldInput) (archive.FieldDefinition, error)
	UpdateArchiveField(context.Context, string, archive.FieldInput) (archive.FieldDefinition, error)
	DeleteArchiveField(context.Context, string) error
	ListArchiveRecords(context.Context, string, string, string, int, int) (ArchiveRecordPage, error)
	GetArchive(context.Context, string) (archive.Archive, error)
	CreateArchive(context.Context, archive.Input) (archive.Archive, error)
	UpdateArchive(context.Context, string, archive.Input) (archive.Archive, error)
	TrashArchive(context.Context, string) error
	ListActivity(context.Context, string, string) ([]Activity, error)
}

type TaskRepository interface {
	ListTasks(context.Context, task.Filter) ([]task.Task, error)
	GetTask(context.Context, string) (task.Task, error)
	CreateTask(context.Context, task.Input) (task.Task, error)
	UpdateTask(context.Context, string, task.Input) (task.Task, error)
	TrashTask(context.Context, string) error
}

type SearchRepository interface {
	Search(context.Context, string) ([]SearchResult, error)
	SearchHealthy(context.Context) bool
	RebuildSearch(context.Context, func(int, string)) error
}

type TrashRepository interface {
	ListTrash(context.Context) ([]TrashEntry, error)
	RestoreTrash(context.Context, string) error
}

type RelationRepository interface {
	ListRelations(context.Context, string) ([]relation.Relation, error)
	CreateRelation(context.Context, string, relation.Input) (relation.Relation, error)
	DeleteRelation(context.Context, string) error
}

// APIService is the small composition boundary consumed by HTTP handlers.
// Concrete wiring remains in Service so domain services can be split without
// exposing persistence details to the transport layer.
type APIService interface {
	WorkspaceService
	PreferencesService
	ArchiveService
	TaskService
	AttachmentService
	BackupService
	SearchService
	JobService
	TrashService
	RelationService
}

type WorkspaceService interface {
	WorkspaceMeta(context.Context) (string, int, error)
	Dashboard(context.Context, string) (Dashboard, error)
}

type PreferencesService interface {
	Preferences(context.Context) (preferences.Values, error)
	UpdatePreferences(context.Context, preferences.Update) (preferences.Values, error)
}

type ArchiveService interface {
	ListArchiveCollections(context.Context) ([]archive.CollectionDefinition, error)
	GetArchiveCollection(context.Context, string) (archive.CollectionDefinition, error)
	CreateArchiveCollection(context.Context, archive.CollectionInput) (archive.CollectionDefinition, error)
	UpdateArchiveCollection(context.Context, string, archive.CollectionInput) (archive.CollectionDefinition, error)
	DeleteArchiveCollection(context.Context, string) error
	CreateArchiveField(context.Context, string, archive.FieldInput) (archive.FieldDefinition, error)
	UpdateArchiveField(context.Context, string, archive.FieldInput) (archive.FieldDefinition, error)
	DeleteArchiveField(context.Context, string) error
	ListArchiveRecords(context.Context, string, string, string, int, int) (ArchiveRecordPage, error)
	GetArchive(context.Context, string) (archive.Archive, error)
	CreateArchive(context.Context, archive.Input) (archive.Archive, error)
	UpdateArchive(context.Context, string, archive.Input) (archive.Archive, error)
	TrashArchive(context.Context, string) error
	ListActivity(context.Context, string, string) ([]Activity, error)
}

type TaskService interface {
	ListTasks(context.Context, task.Filter) ([]task.Task, error)
	GetTask(context.Context, string) (task.Task, error)
	CreateTask(context.Context, task.Input) (task.Task, error)
	UpdateTask(context.Context, string, task.Input) (task.Task, error)
	TrashTask(context.Context, string) error
}

type AttachmentService interface {
	ListAttachments(context.Context, string) ([]attachment.Attachment, error)
	ImportAttachments(context.Context, string, []string) ([]attachment.Attachment, error)
	StartAttachmentImport(context.Context, string, []string) (job.Job, error)
	DeleteAttachment(context.Context, string) error
	AttachmentOpenTarget(context.Context, string) (string, error)
}

type BackupService interface {
	ListBackups(context.Context) ([]backup.Run, error)
	BackupSettings(context.Context) (backup.Settings, error)
	ConfigureBackups(context.Context, string) (backup.Settings, error)
	StartBackup() (job.Job, error)
	PreflightRestore(context.Context, string) (backup.RestoreReport, error)
	StartRestore(string, string) (job.Job, error)
}

type SearchService interface {
	Search(context.Context, string) ([]SearchResult, error)
	SearchHealthy(context.Context) bool
	StartSearchRebuild() (job.Job, error)
}

type JobService interface {
	GetJob(string) (job.Job, bool)
	CancelJob(string) (job.Job, bool)
	SubscribeJob(string) (<-chan job.Job, func(), bool)
}

type TrashService interface {
	ListTrash(context.Context) ([]TrashEntry, error)
	RestoreTrash(context.Context, string) error
}

type RelationService interface {
	ListRelations(context.Context, string) ([]relation.Relation, error)
	CreateRelation(context.Context, string, relation.Input) (relation.Relation, error)
	DeleteRelation(context.Context, string) error
}
