import type { TaskInput } from '../../generated/api/types.gen'
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
const dayKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date)
export function initialTaskDraft(now = new Date()): TaskInput {
  return {
    title: '',
    status: 'todo',
    priority: 'normal',
    timezone,
    allDay: false,
    dueOn: dayKey(now),
    dueAt: null,
    notes: '',
  }
}
export function taskDraftFromCalendarSelection(start: Date): TaskInput {
  return { ...initialTaskDraft(start), dueOn: dayKey(start) }
}
