import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, X } from 'lucide-react'
import { useState } from 'react'
import { createArchiveRecord } from '../../generated/api/sdk.gen'
import type { ArchiveRecordInput } from '../../generated/api/types.gen'
import { requireData } from '../../lib/http/client'
import { ErrorState, LoadingState } from '../../components/ui/StateView'
import { ArchiveFieldControl } from './ArchiveFieldControl'
import { initialFieldValue } from './fieldValues'
import { archiveTypesQuery } from './queries'
import { invalidateWorkbenchQueries } from '../../app/queryKeys'

export function ArchiveForm({ onClose }: { onClose: () => void }) {
  const definitions = useQuery(archiveTypesQuery)
  const [collectionId, setTypeId] = useState('')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [fields, setFields] = useState<Record<string, unknown>>({})
  const activeTypeId = collectionId || definitions.data?.[0]?.id || ''
  const selectedDefinition = definitions.data?.find((item) => item.id === activeTypeId)
  const queryClient = useQueryClient()
  const effectiveFields = selectedDefinition
    ? Object.fromEntries(
        selectedDefinition.fields.map((field) => [
          field.key,
          fields[field.key] ?? initialFieldValue(field),
        ]),
      )
    : fields
  const selectType = (next: string) => {
    setTypeId(next)
    const definition = definitions.data?.find((item) => item.id === next)
    setFields(
      Object.fromEntries(
        definition?.fields.map((field) => [field.key, initialFieldValue(field)]) ?? [],
      ),
    )
  }
  const mutation = useMutation({
    mutationFn: async (body: ArchiveRecordInput) =>
      requireData((await createArchiveRecord({ body, throwOnError: true })).data),
    onSuccess: async () => {
      await invalidateWorkbenchQueries(queryClient)
      onClose()
    },
  })
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form
        className="dialog archive-dialog"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate({
            collectionId: activeTypeId,
            title: title.trim(),
            summary,
            body: '',
            fields: effectiveFields,
          })
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">新建</span>
            <h2>添加记录</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>
        {definitions.isPending ? (
          <LoadingState label="正在读取档案类型…" />
        ) : definitions.isError ? (
          <ErrorState error={definitions.error} retry={() => void definitions.refetch()} />
        ) : (
          <>
            <label>
              所属集合
              <select value={activeTypeId} onChange={(event) => selectType(event.target.value)}>
                {definitions.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {(selectedDefinition?.fields.length ?? 0) > 0 && (
              <div className="custom-fields">
                {selectedDefinition?.fields.map((field) => (
                  <label key={field.id}>
                    {field.label}
                    {field.required && <span className="required-mark"> *</span>}
                    <ArchiveFieldControl
                      field={field}
                      value={effectiveFields[field.key]}
                      onChange={(value) => setFields({ ...fields, [field.key]: value })}
                    />
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        <label>
          名称
          <input
            autoFocus
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          摘要
          <textarea
            rows={3}
            maxLength={500}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
        {mutation.isError && <p className="form-error">创建失败，请检查必填属性。</p>}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            disabled={!activeTypeId || !title.trim() || mutation.isPending}
          >
            <Save size={16} />
            保存
          </button>
        </div>
      </form>
    </div>
  )
}
