import { describe, expect, it } from 'vitest'
import { initialTaskDraft, taskDraftFromCalendarSelection } from './calendar-draft'
describe('calendar task drafts', () => {
  it('uses the selected local day as the single deadline', () => {
    const draft = initialTaskDraft(new Date('2026-09-04T10:07:31.000Z'))
    expect(draft.dueOn).toMatch(/^2026-09-0[45]$/)
    expect(draft.dueAt).toBeNull()
  })
  it('preserves the selected calendar day', () => {
    const draft = taskDraftFromCalendarSelection(new Date('2026-09-09T03:30:00.000Z'))
    expect(draft.dueOn).toMatch(/^2026-09-0[89]$/)
    expect(draft.title).toBe('')
  })
})
