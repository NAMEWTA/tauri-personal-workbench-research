import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useBlocker, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, Eye, EyeOff, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { trashArchiveRecord, updateArchiveRecord } from '../../generated/api/sdk.gen'
import type { ArchiveRecord, ArchiveRecordInput } from '../../generated/api/types.gen'
import { ErrorState, LoadingState } from '../../components/ui/StateView'
import { requireData } from '../../lib/http/client'
import { archiveKeys, archiveQuery, archiveTypesQuery } from './queries'
import { ArchiveResources } from './ArchiveResources'
import { ArchiveFieldControl } from './ArchiveFieldControl'
import { useLayoutStore } from '../../stores/layout'

export function ArchiveDetailPage() {
  const { recordId } = useParams({ from: '/archives/$recordId' })
  const query = useQuery(archiveQuery(recordId))
  if (query.isPending)
    return (
      <div className="page">
        <LoadingState />
      </div>
    )
  if (query.isError)
    return (
      <div className="page">
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      </div>
    )
  return <ArchiveEditor key={query.data.updatedAt} archive={query.data} />
}

function ArchiveEditor({ archive }: { archive: ArchiveRecord }) {
  const recordId = archive.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setEditorDirty = useLayoutStore((state) => state.setEditorDirty)
  const [revealed, setRevealed] = useState(false)
  const definitions = useQuery(archiveTypesQuery)
  const [draft, setDraft] = useState<ArchiveRecordInput>({
    collectionId: archive.collectionId,
    title: archive.title,
    summary: archive.summary,
    body: archive.body,
    fields: archive.fields,
  })
  useEffect(() => () => setRevealed(false), [])
  const save = useMutation({
    mutationFn: async (input: ArchiveRecordInput) =>
      requireData(
        (await updateArchiveRecord({ path: { recordId }, body: input, throwOnError: true })).data,
      ),
    onSuccess: async (data) => {
      queryClient.setQueryData(archiveKeys.detail(recordId), data)
      await queryClient.invalidateQueries({ queryKey: archiveKeys.all })
    },
  })
  const remove = useMutation({
    mutationFn: async () => {
      await trashArchiveRecord({ path: { recordId }, throwOnError: true })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: archiveKeys.all })
      void navigate({ to: '/archives' })
    },
  })
  const fieldDefinitions =
    definitions.data?.find((item) => item.id === draft.collectionId)?.fields ?? []
  const fieldByKey = new Map(fieldDefinitions.map((field) => [field.key, field]))
  const fieldKeys = Array.from(
    new Set([...fieldDefinitions.map((field) => field.key), ...Object.keys(draft.fields ?? {})]),
  )
  const sensitive = fieldDefinitions.filter((field) => field.sensitive)
  const dirty = !sameArchiveDraft(draft, archive)
  useEffect(() => {
    setEditorDirty(dirty)
    return () => setEditorDirty(false)
  }, [dirty, setEditorDirty])
  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm('当前档案有未保存更改，确定离开吗？'),
    enableBeforeUnload: () => dirty,
  })
  return (
    <div className="page archive-detail">
      <div className="page-header">
        <div>
          <button className="back-link" onClick={() => void navigate({ to: '/archives' })}>
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
            disabled={remove.isPending}
          >
            <Trash2 size={16} />
            {remove.isPending ? '删除中' : '删除'}
          </button>
          <button
            className="button primary"
            disabled={save.isPending}
            onClick={() => save.mutate(draft)}
          >
            <Save size={16} />
            {save.isPending ? '保存中' : '保存'}
          </button>
        </div>
      </div>
      {save.isError && <p className="form-error">保存失败，请检查字段内容后重试。</p>}
      {remove.isError && <p className="form-error">删除失败，请稍后重试。</p>}
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
              <span className="eyebrow">{archive.collectionName}</span>
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
          {definitions.isPending ? (
            <LoadingState label="正在读取属性定义…" />
          ) : definitions.isError ? (
            <ErrorState error={definitions.error} retry={() => void definitions.refetch()} />
          ) : fieldKeys.length === 0 ? (
            <p className="quiet-empty">暂无自定义属性。</p>
          ) : (
            Array.from(
              fieldKeys
                .reduce((groups, key) => {
                  const definition = fieldByKey.get(key)
                  const group = definition?.group || '扩展属性'
                  const current = groups.get(group) ?? []
                  current.push(key)
                  groups.set(group, current)
                  return groups
                }, new Map<string, string[]>())
                .entries(),
            ).map(([group, keys]) => (
              <details className="field-group" open key={group}>
                <summary>{group}</summary>
                <div>
                  {keys.map((key) => {
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
            ))
          )}
        </aside>
      </div>
      <ArchiveResources recordId={recordId} />
    </div>
  )
}

function sameArchiveDraft(draft: ArchiveRecordInput, archive: ArchiveRecord) {
  return (
    draft.collectionId === archive.collectionId &&
    draft.title === archive.title &&
    (draft.summary ?? '') === archive.summary &&
    (draft.body ?? '') === archive.body &&
    JSON.stringify(draft.fields ?? {}) === JSON.stringify(archive.fields ?? {})
  )
}
