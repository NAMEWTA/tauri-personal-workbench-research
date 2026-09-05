import type { TaskInput } from '../../generated/api/types.gen'

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

export function initialTaskDraft(now = new Date()): TaskInput {
  const start = new Date(now)
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0)
  const end = new Date(start.getTime() + 60 * 60_000)
  return {
    title: '',
    status: 'todo',
    priority: 'normal',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    allDay: false,
    timezone,
    notes: '',
  }
}

export function taskDraftFromCalendarSelection(start: Date, end: Date, allDay: boolean): TaskInput {
  const dueOn = allDay
    ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(start)
    : undefined
  return {
    ...initialTaskDraft(start),
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    allDay,
    dueOn,
  }
}
