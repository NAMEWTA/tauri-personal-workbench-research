import { describe, expect, it } from 'vitest'
import { initialTaskDraft, taskDraftFromCalendarSelection } from './calendar-draft'

describe('calendar task drafts', () => {
  it('rounds manual creation to the next quarter hour', () => {
    const draft = initialTaskDraft(new Date('2026-09-04T10:07:31.000Z'))
    expect(draft.startsAt).toBe('2026-09-04T10:15:00.000Z')
    expect(draft.endsAt).toBe('2026-09-04T11:15:00.000Z')
    expect(draft.allDay).toBe(false)
  })

  it('preserves a selected calendar range in the task draft', () => {
    const start = new Date('2026-09-09T03:30:00.000Z')
    const end = new Date('2026-09-09T04:45:00.000Z')
    const draft = taskDraftFromCalendarSelection(start, end, true)
    expect(draft.startsAt).toBe(start.toISOString())
    expect(draft.endsAt).toBe(end.toISOString())
    expect(draft.allDay).toBe(true)
    expect(draft.title).toBe('')
  })
})
