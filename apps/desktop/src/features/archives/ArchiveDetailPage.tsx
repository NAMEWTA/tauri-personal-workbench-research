import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, Eye, EyeOff, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { trashArchive, updateArchive } from '../../generated/api/sdk.gen'
import type { Archive, ArchiveInput } from '../../generated/api/types.gen'
import { ErrorState, LoadingState } from '../../components/ui/StateView'
import { requireData } from '../../lib/http/client'
import { archiveKeys, archiveQuery, archiveTypesQuery } from './queries'
import { ArchiveResources } from './ArchiveResources'
import { ArchiveFieldControl } from './ArchiveFieldControl'

export function ArchiveDetailPage() {
  const { archiveId } = useParams({ from: '/archives/$archiveId' })
  const query = useQuery(archiveQuery(archiveId))
  if (query.isPending)
    return (
      <div className="page">
        <LoadingState />
      </div>
    )
  if (query.isError)
    return (
      <div className="page">
        <ErrorState error={query.error} />
      </div>
    )
  return <ArchiveEditor key={query.data.updatedAt} archive={query.data} />
}

function ArchiveEditor({ archive }: { archive: Archive }) {
  const archiveId = archive.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [revealed, setRevealed] = useState(false)
  const definitions = useQuery(archiveTypesQuery)
  const [draft, setDraft] = useState<ArchiveInput>({
    typeId: archive.typeId,
    title: archive.title,
    summary: archive.summary,
    body: archive.body,
    fields: archive.fields,
  })
  useEffect(() => () => setRevealed(false), [])
  const save = useMutation({
    mutationFn: async (input: ArchiveInput) =>
      requireData(
        (await updateArchive({ path: { archiveId }, body: input, throwOnError: true })).data,
      ),
    onSuccess: async (data) => {
      queryClient.setQueryData(archiveKeys.detail(archiveId), data)
      await queryClient.invalidateQueries({ queryKey: archiveKeys.all })
    },
  })
  const remove = useMutation({
    mutationFn: async () => {
      await trashArchive({ path: { archiveId }, throwOnError: true })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: archiveKeys.all })
      void navigate({ to: '/archives' })
    },
  })
  const fieldDefinitions = definitions.data?.find((item) => item.id === draft.typeId)?.fields ?? []
  const fieldByKey = new Map(fieldDefinitions.map((field) => [field.key, field]))
  const fieldKeys = Array.from(
    new Set([...fieldDefinitions.map((field) => field.key), ...Object.keys(draft.fields ?? {})]),
  )
  const sensitive = fieldDefinitions.filter((field) => field.sensitive)
  return (
    <div className="page archive-detail">
      <div className="page-header">
        <div>
          <button className="back-link" onClick={() => history.back()}>
            <ArrowLeft size={15} />
            档案
          </button>
          <h1>{archive.title}</h1>
        </div>
        <div className="header-actions">
          <button
            className="button danger-quiet"
            onClick={() => {
              if (confirm('将此档案移至回收站？')) remove.mutate()
            }}
          >
            <Trash2 size={16} />
            删除
          </button>
          <button
            className="button primary"
            disabled={save.isPending}
            onClick={() => save.mutate(draft)}
          >
            <Save size={16} />
            保存
          </button>
        </div>
      </div>
      <div className="detail-layout">
        <section className="editor-section">
          <label>
            名称
            <input
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label>
            摘要
            <textarea
              rows={3}
              value={draft.summary ?? ''}
              onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
            />
          </label>
          <label>
            正文
            <textarea
              className="markdown-editor"
              rows={15}
              value={draft.body ?? ''}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              placeholder="使用 Markdown 记录详细内容"
            />
          </label>
        </section>
        <aside className="properties-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{archive.typeName}</span>
              <h2>属性</h2>
            </div>
            {sensitive.length > 0 && (
              <button
                className="icon-button"
                onClick={() => setRevealed((value) => !value)}
                aria-label={revealed ? '隐藏敏感字段' : '显示敏感字段'}
              >
                {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            )}
          </div>
          {fieldKeys.length === 0 ? (
            <p className="quiet-empty">暂无自定义属性。</p>
          ) : (
            <details className="field-group" open>
              <summary>扩展属性</summary>
              <div>
                {fieldKeys.map((key) => {
                  const definition = fieldByKey.get(key)
                  const value = draft.fields?.[key]
                  return (
                    <label key={key}>
                      {definition?.label ?? key}
                      {definition ? (
                        <ArchiveFieldControl
                          field={definition}
                          value={value}
                          revealed={revealed}
                          onChange={(next) =>
                            setDraft({ ...draft, fields: { ...draft.fields, [key]: next } })
                          }
                        />
                      ) : (
                        <input value={String(value ?? '')} readOnly />
                      )}
                    </label>
                  )
                })}
              </div>
            </details>
          )}
        </aside>
      </div>
      <ArchiveResources archiveId={archiveId} />
    </div>
  )
}
