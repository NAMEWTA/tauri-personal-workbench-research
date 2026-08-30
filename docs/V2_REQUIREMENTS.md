# Personal Workbench V2 Requirements

## Unified task and calendar model

- A task is the only schedulable entity.
- A task may be unscheduled or have one start/end interval.
- Calendar views are projections of scheduled tasks; creating an item in the calendar creates a task.
- Task views are ordered: Today, Tomorrow, All, Completed.
- All contains every non-completed task, including unscheduled tasks.
- Task details use the global inspector from every page.

## Archive associations

- A task may reference one primary archive.
- Archive selection supports archive-type filtering and fuzzy title search.
- Archive references and archive-to-archive relations are navigable.
- An archive exposes one combined associated-items section backed by tasks.

## Custom archive schema

- Archive types are user-managed records, not code enums.
- Person, Organization, and Event are editable seed templates.
- Users can create additional types such as Project.
- Each type owns ordered field definitions with groups, validation, options, defaults, and sensitivity metadata.
- Archive forms render entirely from field definitions.

## Inspector behavior

- Selecting a task automatically opens the inspector.
- Calendar, Today, Tasks, and Archive pages share one task editor.
- Creating from a calendar range pre-fills the task interval.
- The inspector becomes an overlay drawer below 1120 px.
- No empty placeholder inspector is shown.

## Compatibility

V2 is a development reset. It does not migrate V1 databases or accept V1 backups. The database is rebuilt from a single V2 baseline migration.
