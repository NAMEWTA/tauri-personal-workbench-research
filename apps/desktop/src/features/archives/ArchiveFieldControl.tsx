import type { ArchiveFieldDefinition } from '../../generated/api/types.gen'
import { isoDateTimeValue, localDateTimeValue } from './fieldValues'

export function ArchiveFieldControl({
  field,
  value,
  revealed = false,
  onChange,
}: {
  field: ArchiveFieldDefinition
  value: unknown
  revealed?: boolean
  onChange: (value: unknown) => void
}) {
  if (field.valueType === 'multiline') {
    return (
      <textarea
        rows={3}
        required={field.required}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }
  if (field.valueType === 'select') {
    return (
      <select
        required={field.required}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">请选择</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  }
  if (field.valueType === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
      />
    )
  }
  return (
    <input
      required={field.required}
      type={
        field.sensitive && !revealed
          ? 'password'
          : field.valueType === 'date'
            ? 'date'
            : field.valueType === 'datetime'
              ? 'datetime-local'
              : field.valueType === 'number'
                ? 'number'
                : 'text'
      }
      value={field.valueType === 'datetime' ? localDateTimeValue(value) : String(value ?? '')}
      onChange={(event) =>
        onChange(
          field.valueType === 'number' && event.target.value !== ''
            ? Number(event.target.value)
            : field.valueType === 'datetime'
              ? isoDateTimeValue(event.target.value)
              : event.target.value,
        )
      }
    />
  )
}
