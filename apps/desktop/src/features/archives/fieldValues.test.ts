import { describe, expect, it } from 'vitest'
import { isoDateTimeValue, localDateTimeValue } from './fieldValues'

describe('archive datetime field values', () => {
  it('converts a datetime-local value to RFC3339 for the API', () => {
    const local = '2030-06-01T12:34'
    const iso = isoDateTimeValue(local)

    expect(iso).toBe(new Date(local).toISOString())
    expect(localDateTimeValue(iso)).toBe(local)
  })

  it('clears invalid or empty values instead of submitting malformed timestamps', () => {
    expect(isoDateTimeValue('')).toBe('')
    expect(isoDateTimeValue('not-a-date')).toBe('')
    expect(localDateTimeValue(null)).toBe('')
    expect(localDateTimeValue('not-a-date')).toBe('')
  })
})
