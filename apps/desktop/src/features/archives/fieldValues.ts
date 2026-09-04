import type { ArchiveFieldDefinition } from '../../generated/api/types.gen'

export function initialFieldValue(field: ArchiveFieldDefinition): unknown {
  if (field.defaultValue !== undefined && field.defaultValue !== null) return field.defaultValue
  return field.valueType === 'boolean' ? false : ''
}

export function localDateTimeValue(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export function isoDateTimeValue(value: string): string {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}
