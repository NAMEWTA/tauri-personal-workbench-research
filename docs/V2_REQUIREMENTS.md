# Personal Workbench V2 Requirements

## Unified task and calendar model

- A task is the only schedulable entity.
- A task may be unscheduled or have one start/end work interval.
- A task may also have an independent due date, recurrence rule, reminders, estimate, and parent task.
- Calendar views are projections of scheduled tasks; creating an item in the calendar creates a task.
- Task views are ordered: Today, Tomorrow, All, Completed.
- All contains every non-completed task, including unscheduled tasks.
- Task details use the global inspector from every page.

## Archive associations

- A task may reference one primary archive record.
- Archive selection supports archive-type filtering and fuzzy title search.
- Archive references and archive-to-archive relations are navigable.
- An archive exposes one combined associated-items section backed by tasks.

## Custom archive schema

- An archive type is a user-created archive collection, not a fixed code enum.
- The first workspace contains only one empty “模板档案” collection.
- Each collection owns ordered field definitions with groups, validation, options, defaults, and sensitivity metadata.
- Each collection contains multiple archive records, and every record form renders from the collection fields.

## Inspector behavior

- Selecting a task automatically opens the inspector.
- Calendar, Today, Tasks, and Archive pages share one task editor.
- Creating from a calendar range pre-fills the task interval.
- The inspector becomes an overlay drawer below 1120 px.
- No empty placeholder inspector is shown.

## Compatibility

V2 is a development reset. It does not migrate V1 databases or accept V1 backups. The database is rebuilt from a single V2 baseline migration.
