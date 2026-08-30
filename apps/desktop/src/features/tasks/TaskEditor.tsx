import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Save, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { trashTask } from '../../generated/api/sdk.gen'
import type { Task, TaskInput } from '../../generated/api/types.gen'
import { ArchivePicker } from '../archives/ArchivePicker'
import { useUpdateTask } from './mutations'
import { taskKeys } from './queries'

const localTime = (value?: string | null) =>
  value
    ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16)
    : ''

export function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const [archiveTitle, setArchiveTitle] = useState(task.archiveTitle)
  const [draft, setDraft] = useState<TaskInput>({
    title: task.title,
    status: task.status,
    priority: task.priority,
    startsAt: task.startsAt,
    endsAt: task.endsAt,
    allDay: task.allDay,
    timezone: task.timezone,
    archiveId: task.archiveId,
    notes: task.notes,
  })
  const update = useUpdateTask()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const scheduled = Boolean(draft.startsAt && draft.endsAt)
  const remove = useMutation({
    mutationFn: async () => {
      await trashTask({ path: { taskId: task.id }, throwOnError: true })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.all })
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    },
  })
  const setTime = (key: 'startsAt' | 'endsAt', value: string) =>
    setDraft({ ...draft, [key]: value ? new Date(value).toISOString() : null })
  const toggleSchedule = (enabled: boolean) => {
    if (!enabled) {
      setDraft({ ...draft, startsAt: null, endsAt: null, allDay: false })
      return
    }
    const start = new Date()
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0)
    const end = new Date(start.getTime() + 60 * 60_000)
    setDraft({ ...draft, startsAt: start.toISOString(), endsAt: end.toISOString() })
  }
  return (
    <form
      className="task-editor inspector-editor"
      onSubmit={(event) => {
        event.preventDefault()
        update.mutate({ task, changes: draft })
      }}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">任务详情</span>
          <h2>{task.title}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭任务详情">
          <X size={16} />
        </button>
      </div>
      <label>
        标题
        <input
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </label>
      <div className="field-pair">
        <label>
          状态
          <select
            value={draft.status}
            onChange={(event) =>
              setDraft({ ...draft, status: event.target.value as TaskInput['status'] })
            }
          >
            <option value="todo">待办</option>
            <option value="doing">进行中</option>
            <option value="done">已完成</option>
          </select>
        </label>
        <label>
          优先级
          <select
            value={draft.priority}
            onChange={(event) =>
              setDraft({ ...draft, priority: event.target.value as TaskInput['priority'] })
            }
          >
            <option value="low">低</option>
            <option value="normal">普通</option>
            <option value="high">高</option>
            <option value="urgent">紧急</option>
          </select>
        </label>
      </div>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={scheduled}
          onChange={(event) => toggleSchedule(event.target.checked)}
        />
        安排到日历
      </label>
      {scheduled && (
        <>
          <div className="field-pair">
            <label>
              开始时间
              <input
                type="datetime-local"
                value={localTime(draft.startsAt)}
                onChange={(event) => setTime('startsAt', event.target.value)}
              />
            </label>
            <label>
              结束时间
              <input
                type="datetime-local"
                value={localTime(draft.endsAt)}
                onChange={(event) => setTime('endsAt', event.target.value)}
              />
            </label>
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={draft.allDay}
              onChange={(event) => setDraft({ ...draft, allDay: event.target.checked })}
            />
            全天任务
          </label>
        </>
      )}
      <div className="picker-field">
        <span>关联档案</span>
        <ArchivePicker
          value={draft.archiveId}
          valueTitle={archiveTitle}
          onChange={(id, title) => {
            setArchiveTitle(title ?? '')
            setDraft({ ...draft, archiveId: id })
          }}
          onOpen={(id) => void navigate({ to: '/archives/$archiveId', params: { archiveId: id } })}
        />
      </div>
      <label>
        备注
        <textarea
          rows={6}
          value={draft.notes ?? ''}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
        />
      </label>
      {update.isError && <p className="form-error">保存失败，请检查标题和时间范围。</p>}
      <div className="editor-actions">
        <button
          type="button"
          className="button danger-quiet"
          disabled={remove.isPending}
          onClick={() => {
            if (confirm('将此任务移至回收站？')) remove.mutate()
          }}
        >
          <Trash2 size={15} />
          删除
        </button>
        <button
          className="button primary"
          disabled={
            !draft.title.trim() ||
            update.isPending ||
            (scheduled && (!draft.startsAt || !draft.endsAt))
          }
        >
          <Save size={16} />
          保存
        </button>
      </div>
    </form>
  )
}
