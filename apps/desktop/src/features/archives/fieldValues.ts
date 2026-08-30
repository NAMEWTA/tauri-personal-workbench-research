import type { ArchiveFieldDefinition } from '../../generated/api/types.gen'

export function initialFieldValue(field: ArchiveFieldDefinition): unknown {
  if (field.defaultValue !== undefined && field.defaultValue !== null) return field.defaultValue
  return field.valueType === 'boolean' ? false : ''
}
