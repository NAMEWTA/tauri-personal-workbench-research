import { invoke } from '@tauri-apps/api/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  ExternalLink,
  FilePlus2,
  History,
  Link2,
  ListTodo,
  Paperclip,
  Search,
  Square,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  createArchiveRelation,
  deleteAttachment,
  deleteRelation,
  getAttachmentOpenTarget,
  importArchiveAttachments,
  listArchiveActivity,
  listArchiveAttachments,
  listArchiveRelations,
  listTasks,
} from '../../generated/api/sdk.gen'
import { requireData } from '../../lib/http/client'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { useLayoutStore } from '../../stores/layout'
import { useJob } from '../jobs/useJob'
import { TaskRow } from '../tasks/TaskRow'
import { archiveTypesQuery, archivesQuery } from './queries'

const activityLabel: Record<string, string> = {
  create: '创建档案',
  update: '更新档案',
  relation_create: '添加关系',
  relation_delete: '移除关系',
  trash: '移至回收站',
  restore: '从回收站恢复',
  attachment_import: '导入附件',
  attachment_remove: '移除附件',
  attachment_restore: '恢复附件',
}
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

export function ArchiveResources({ archiveId }: { archiveId: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const selectTask = useLayoutStore((state) => state.selectTask)
  const [targetId, setTargetId] = useState('')
  const [targetTypeId, setTargetTypeId] = useState('')
  const [targetQuery, setTargetQuery] = useState('')
  const debouncedTargetQuery = useDebouncedValue(targetQuery)
  const [relationType, setRelationType] = useState('关联')
  const [attachmentJobId, setAttachmentJobId] = useState<string>()
  const attachmentJob = useJob(attachmentJobId)
  const types = useQuery(archiveTypesQuery)
  const archives = useQuery(archivesQuery(debouncedTargetQuery, targetTypeId, 'title', 30))
  const relations = useQuery({
    queryKey: ['archive-relations', archiveId],
    queryFn: async () =>
      requireData((await listArchiveRelations({ path: { archiveId }, throwOnError: true })).data),
  })
  const attachments = useQuery({
    queryKey: ['archive-attachments', archiveId],
    queryFn: async () =>
      requireData((await listArchiveAttachments({ path: { archiveId }, throwOnError: true })).data),
  })
  const tasks = useQuery({
    queryKey: ['archive-tasks', archiveId],
    queryFn: async () => {
      const [open, completed] = await Promise.all([
        listTasks({ query: { view: 'all', timezone, archiveId }, throwOnError: true }),
        listTasks({ query: { view: 'completed', timezone, archiveId }, throwOnError: true }),
      ])
      return [...requireData(open.data), ...requireData(completed.data)]
    },
  })
  const activity = useQuery({
    queryKey: ['archive-activity', archiveId],
    queryFn: async () =>
      requireData((await listArchiveActivity({ path: { archiveId }, throwOnError: true })).data),
  })
  useEffect(() => {
    if (attachmentJob.query.data?.state === 'succeeded') {
      void queryClient.invalidateQueries({ queryKey: ['archive-attachments', archiveId] })
      void queryClient.invalidateQueries({ queryKey: ['archive-activity', archiveId] })
    }
  }, [archiveId, attachmentJob.query.data?.state, queryClient])
  const addRelation = useMutation({
    mutationFn: async () =>
      requireData(
        (
          await createArchiveRelation({
            path: { archiveId },
            body: { targetId, relationType },
            throwOnError: true,
          })
        ).data,
      ),
    onSuccess: async () => {
      setTargetId('')
      await queryClient.invalidateQueries({ queryKey: ['archive-relations', archiveId] })
    },
  })
  const removeRelation = useMutation({
    mutationFn: async (relationId: string) => {
      await deleteRelation({ path: { relationId }, throwOnError: true })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['archive-relations', archiveId] })
    },
  })
  const importFiles = useMutation({
    mutationFn: async () => {
      const paths = await invoke<string[]>('select_attachment_files')
      if (paths.length === 0) return undefined
      return requireData(
        (
          await importArchiveAttachments({
            path: { archiveId },
            body: { paths },
            throwOnError: true,
          })
        ).data,
      )
    },
    onSuccess: (value) => {
      if (value) setAttachmentJobId(value.id)
    },
  })
  const removeAttachment = useMutation({
    mutationFn: async (attachmentId: string) => {
      await deleteAttachment({ path: { attachmentId }, throwOnError: true })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['archive-attachments', archiveId] })
    },
  })
  const openAttachment = useMutation({
    mutationFn: async (attachmentId: string) => {
      const target = requireData(
        (await getAttachmentOpenTarget({ path: { attachmentId }, throwOnError: true })).data,
      )
      await invoke('open_managed_file', { path: target.path })
    },
  })
  const candidates = archives.data?.items.filter((item) => item.id !== archiveId) ?? []

  return (
    <div className="resource-grid">
      <section>
        <div className="section-heading">
          <h2>
            <Link2 size={16} />
            关系
          </h2>
        </div>
        <form
          className="relation-picker"
          onSubmit={(event) => {
            event.preventDefault()
            if (targetId) addRelation.mutate()
          }}
        >
          <div className="segmented picker-types">
            <button
              type="button"
              className={!targetTypeId ? 'active' : ''}
              onClick={() => setTargetTypeId('')}
            >
              全部
            </button>
            {types.data?.map((item) => (
              <button
                type="button"
                key={item.id}
                className={targetTypeId === item.id ? 'active' : ''}
                onClick={() => setTargetTypeId(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
          <label className="search-field compact-search">
            <Search size={14} />
            <input
              value={targetQuery}
              onChange={(event) => setTargetQuery(event.target.value)}
              placeholder="搜索档案标题"
            />
          </label>
          <div className="relation-candidates">
            {candidates.map((item) => (
              <button
                type="button"
                key={item.id}
                className={targetId === item.id ? 'active' : ''}
                onClick={() => setTargetId(item.id)}
              >
                <strong>{item.title}</strong>
                <small>{item.typeName}</small>
              </button>
            ))}
          </div>
          <div className="relation-form">
            <input
              aria-label="关系类型"
              value={relationType}
              onChange={(event) => setRelationType(event.target.value)}
            />
            <button className="button" disabled={!targetId}>
              建立关联
            </button>
          </div>
        </form>
        {relations.data?.length ? (
          <div className="resource-list">
            {relations.data.map((item) => (
              <div key={item.id}>
                <button
                  className="resource-link"
                  onClick={() =>
                    void navigate({
                      to: '/archives/$archiveId',
                      params: { archiveId: item.targetId },
                    })
                  }
                >
                  <strong>{item.targetTitle}</strong>
                  <small>
                    {item.targetTypeName} · {item.relationType}
                  </small>
                </button>
                <button
                  className="icon-button"
                  onClick={() => removeRelation.mutate(item.id)}
                  aria-label="移除关系"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="quiet-empty">暂无关联档案。</p>
        )}
      </section>
      <section>
        <div className="section-heading">
          <h2>
            <Paperclip size={16} />
            附件
          </h2>
          <button
            className="button"
            onClick={() =>
              attachmentJob.active ? attachmentJob.cancel.mutate() : importFiles.mutate()
            }
            disabled={importFiles.isPending || attachmentJob.cancel.isPending}
          >
            {attachmentJob.active ? <Square size={13} /> : <FilePlus2 size={15} />}
            {attachmentJob.active ? `${attachmentJob.query.data?.progress ?? 0}%` : '导入'}
          </button>
        </div>
        {attachments.data?.length ? (
          <div className="resource-list">
            {attachments.data.map((item) => (
              <div key={item.id}>
                <span>
                  <strong>{item.displayName}</strong>
                  <small>
                    {(item.size / 1024).toFixed(1)} KB · {item.mediaType}
                  </small>
                </span>
                <div className="resource-actions">
                  <button
                    className="icon-button"
                    onClick={() => openAttachment.mutate(item.id)}
                    aria-label="打开附件"
                  >
                    <ExternalLink size={15} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => removeAttachment.mutate(item.id)}
                    aria-label="移除附件"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="quiet-empty">暂无托管附件。</p>
        )}
      </section>
      <section className="resource-tasks">
        <div className="section-heading">
          <h2>
            <ListTodo size={16} />
            任务
          </h2>
        </div>
        {tasks.data?.length ? (
          <div className="task-list">
            {tasks.data.map((item) => (
              <TaskRow
                key={item.id}
                task={item}
                onSelect={() => {
                  selectTask(item.id)
                }}
              />
            ))}
          </div>
        ) : (
          <p className="quiet-empty">暂无关联任务。</p>
        )}
      </section>
      <section className="resource-activity">
        <div className="section-heading">
          <h2>
            <History size={16} />
            活动
          </h2>
        </div>
        {activity.data?.length ? (
          <div className="resource-list">
            {activity.data.map((item) => (
              <div key={item.id}>
                <span>
                  <strong>{activityLabel[item.action] ?? item.action}</strong>
                  <small>
                    {new Intl.DateTimeFormat('zh-CN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(item.changedAt))}
                  </small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="quiet-empty">暂无活动记录。</p>
        )}
      </section>
    </div>
  )
}
