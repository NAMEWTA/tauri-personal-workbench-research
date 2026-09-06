import { Save, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { trashTask } from '../../generated/api/sdk.gen'
import type { Task, TaskInput } from '../../generated/api/types.gen'
import { useUpdateTask } from './mutations'
import { taskKeys } from './queries'
import { ArchivePicker } from '../archives/ArchivePicker'
import { useLayoutStore } from '../../stores/layout'
import { useNavigate } from '@tanstack/react-router'

export function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const [recordTitle, setRecordTitle] = useState(task.recordTitle)
  const [draft, setDraft] = useState<TaskInput>({
    title: task.title,
    status: task.status,
    priority: task.priority,
    timezone: task.timezone,
    allDay: false,
    dueOn: task.dueOn,
    dueAt: task.dueAt,
    recordId: task.recordId,
    notes: task.notes,
    recurrence: task.recurrence ?? '',
    reminders: task.reminders ?? [],
    parentId: task.parentId,
    estimateMinutes: task.estimateMinutes,
  })
  const update = useUpdateTask()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const setEditorDirty = useLayoutStore((state) => state.setEditorDirty)
  const remove = useMutation({
    mutationFn: async () => {
      await trashTask({ path: { taskId: task.id }, throwOnError: true })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.all })
      setEditorDirty(false)
      onClose()
    },
  })
  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify({
      title: task.title,
      status: task.status,
      priority: task.priority,
      timezone: task.timezone,
      allDay: false,
      dueOn: task.dueOn,
      dueAt: task.dueAt,
      recordId: task.recordId,
      notes: task.notes,
      recurrence: task.recurrence ?? '',
      reminders: task.reminders ?? [],
      parentId: task.parentId,
      estimateMinutes: task.estimateMinutes,
    })
  useEffect(() => {
    setEditorDirty(dirty)
    return () => setEditorDirty(false)
  }, [dirty, setEditorDirty])
  return (
    <form
      className="task-editor inspector-editor"
      onSubmit={(event) => {
        event.preventDefault()
        update.mutate({ task, changes: draft }, { onSuccess: () => setEditorDirty(false) })
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
      <div className="field-pair">
        <label>
          截止日期
          <input
            type="date"
            value={draft.dueOn ?? ''}
            onChange={(event) => setDraft({ ...draft, dueOn: event.target.value || null })}
          />
        </label>
        <label>
          截止时间
          <input
            type="time"
            value={draft.dueAt ? new Date(draft.dueAt).toISOString().slice(11, 16) : ''}
            onChange={(event) =>
              setDraft({
                ...draft,
                dueAt:
                  event.target.value && draft.dueOn
                    ? new Date(`${draft.dueOn}T${event.target.value}:00`).toISOString()
                    : null,
              })
            }
          />
        </label>
      </div>
      <div className="field-pair">
        <label>
          重复规则
          <select
            value={draft.recurrence ?? ''}
            onChange={(event) => setDraft({ ...draft, recurrence: event.target.value })}
          >
            <option value="">不重复</option>
            <option value="FREQ=DAILY">每天</option>
            <option value="FREQ=WEEKLY">每周</option>
            <option value="FREQ=MONTHLY">每月</option>
          </select>
        </label>
        <label>
          预计分钟
          <input
            type="number"
            min={1}
            value={draft.estimateMinutes ?? ''}
            onChange={(event) =>
              setDraft({
                ...draft,
                estimateMinutes: event.target.value ? Number(event.target.value) : null,
              })
            }
          />
        </label>
      </div>
      <div className="picker-field">
        <span>关联档案</span>
        <ArchivePicker
          value={draft.recordId}
          valueTitle={recordTitle}
          onChange={(id, title) => {
            setRecordTitle(title ?? '')
            setDraft({ ...draft, recordId: id })
          }}
          onOpen={(id) => void navigate({ to: '/archives/$recordId', params: { recordId: id } })}
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
      {update.isError && <p className="form-error">保存失败，请重试。</p>}
      {remove.isError && <p className="form-error">删除失败，请重试。</p>}
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
        <button className="button primary" disabled={!draft.title.trim() || update.isPending}>
          <Save size={16} />
          保存
        </button>
      </div>
    </form>
  )
}
