import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { listTasks } from '../../generated/api/sdk.gen'
import type { TaskInput } from '../../generated/api/types.gen'
import { requireData } from '../../lib/http/client'
import { ErrorState, LoadingState } from '../../components/ui/StateView'
import { ArchivePicker } from '../archives/ArchivePicker'
import { useCreateTask, useUpdateTask } from '../tasks/mutations'
import { useLayoutStore } from '../../stores/layout'

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
const dayKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date)
const initialDraft = (date = new Date()): TaskInput => ({
  title: '',
  status: 'todo',
  priority: 'normal',
  timezone,
  allDay: false,
  dueOn: dayKey(date),
  dueAt: null,
  notes: '',
})

export default function CalendarPage() {
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<TaskInput>(initialDraft)
  const [recordTitle, setRecordTitle] = useState('')
  const [range, setRange] = useState({ from: '', to: '' })
  const selectTask = useLayoutStore((state) => state.selectTask)
  const query = useQuery({
    queryKey: ['calendar-tasks', range.from, range.to],
    queryFn: async () =>
      requireData(
        (
          await listTasks({
            query: {
              view: 'calendar',
              timezone,
              dueFrom: range.from.slice(0, 10),
              dueTo: range.to.slice(0, 10),
            },
            throwOnError: true,
          })
        ).data,
      ),
    enabled: Boolean(range.from && range.to),
  })
  const create = useCreateTask()
  const update = useUpdateTask()
  return (
    <div className="page calendar-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">统一任务时间轴</span>
          <h1>日历</h1>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setDraft(initialDraft())
            setCreating((value) => !value)
          }}
        >
          <Plus size={16} />
          新建任务
        </button>
      </div>
      {creating && (
        <form
          className="calendar-form unified-task-form"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate(draft, {
              onSuccess: (task) => {
                setCreating(false)
                selectTask(task.id)
              },
            })
          }}
        >
          <label>
            标题
            <input
              autoFocus
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
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
              onChange={(event) => {
                const value = event.target.value
                setDraft({
                  ...draft,
                  dueAt:
                    value && draft.dueOn
                      ? new Date(`${draft.dueOn}T${value}:00`).toISOString()
                      : null,
                })
              }}
            />
          </label>
          <div className="calendar-picker">
            <span>关联档案</span>
            <ArchivePicker
              value={draft.recordId}
              valueTitle={recordTitle}
              onChange={(id, title) => {
                setRecordTitle(title ?? '')
                setDraft({ ...draft, recordId: id })
              }}
            />
          </div>
          <button className="button primary" disabled={!draft.title.trim() || create.isPending}>
            创建任务
          </button>
          {create.isError && <p className="form-error">创建失败，请重试。</p>}
        </form>
      )}
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <div className="calendar-surface">
          <FullCalendar
            plugins={[dayGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            locale="zh-cn"
            height="auto"
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,dayGridWeek,dayGridDay',
            }}
            buttonText={{ today: '今天', month: '月', week: '周', day: '日' }}
            datesSet={(info) =>
              setRange({ from: info.start.toISOString(), to: info.end.toISOString() })
            }
            events={query.data?.map((item) => ({
              id: item.id,
              title: item.title,
              start: item.dueAt ?? (item.dueOn ? `${item.dueOn}T00:00:00` : undefined),
              allDay: !item.dueAt,
              classNames: [
                'calendar-entry',
                `calendar-priority-${item.priority}`,
                item.status === 'done' ? 'calendar-entry-completed' : '',
              ],
            }))}
            eventOrder="-start"
            eventOrderStrict
            selectable
            select={(info) => {
              setDraft(initialDraft(info.start))
              setCreating(true)
            }}
            eventClick={(info) => selectTask(info.event.id)}
            editable
            eventDrop={(info) => {
              const item = query.data?.find((task) => task.id === info.event.id)
              if (!item || !info.event.start) return info.revert()
              const dueAt = info.event.allDay ? null : info.event.start.toISOString()
              update.mutate(
                { task: item, changes: { dueOn: dayKey(info.event.start), dueAt } },
                { onError: info.revert },
              )
            }}
            dayMaxEvents
          />
        </div>
      )}
    </div>
  )
}
