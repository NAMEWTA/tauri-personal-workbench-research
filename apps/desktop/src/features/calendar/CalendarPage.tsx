import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { Draggable } from '@fullcalendar/interaction'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { listTasks } from '../../generated/api/sdk.gen'
import type { TaskInput } from '../../generated/api/types.gen'
import { requireData } from '../../lib/http/client'
import { ErrorState, LoadingState } from '../../components/ui/StateView'
import { ArchivePicker } from '../archives/ArchivePicker'
import { useCreateTask, useUpdateTask } from '../tasks/mutations'
import { tasksQuery } from '../tasks/queries'
import { useLayoutStore } from '../../stores/layout'
import { initialTaskDraft, taskDraftFromCalendarSelection } from './calendar-draft'

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
const localInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

export default function CalendarPage() {
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<TaskInput>(initialTaskDraft)
  const [recordTitle, setArchiveTitle] = useState('')
  const [range, setRange] = useState(() => {
    const now = new Date()
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
    }
  })
  const selectTask = useLayoutStore((state) => state.selectTask)
  const query = useQuery({
    queryKey: ['calendar-tasks', range.from, range.to],
    queryFn: async () =>
      requireData(
        (
          await listTasks({
            query: { view: 'calendar', timezone, from: range.from, to: range.to },
            throwOnError: true,
          })
        ).data,
      ),
  })
  const inbox = useQuery(tasksQuery('inbox'))
  const unplannedRef = useRef<HTMLDivElement>(null)
  const create = useCreateTask()
  const update = useUpdateTask()
  useEffect(() => {
    if (!unplannedRef.current) return
    const draggable = new Draggable(unplannedRef.current, {
      itemSelector: '.calendar-unplanned-item',
      eventData: (element) => ({
        id: element.getAttribute('data-task-id') ?? undefined,
        title: element.textContent ?? '',
        duration: '01:00',
      }),
    })
    return () => draggable.destroy()
  }, [inbox.data])
  const setTime = (key: 'startsAt' | 'endsAt', value: string) =>
    setDraft({ ...draft, [key]: value ? new Date(value).toISOString() : null })
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
            if (!creating) setDraft(initialTaskDraft())
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
                setDraft(initialTaskDraft())
                setArchiveTitle('')
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
            开始
            <input
              type="datetime-local"
              value={localInput(new Date(draft.startsAt!))}
              onChange={(event) => setTime('startsAt', event.target.value)}
            />
          </label>
          <label>
            结束
            <input
              type="datetime-local"
              value={localInput(new Date(draft.endsAt!))}
              onChange={(event) => setTime('endsAt', event.target.value)}
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={draft.allDay}
              onChange={(event) => setDraft({ ...draft, allDay: event.target.checked })}
            />
            全天
          </label>
          <div className="calendar-picker">
            <span>关联档案</span>
            <ArchivePicker
              value={draft.recordId}
              valueTitle={recordTitle}
              onChange={(id, title) => {
                setArchiveTitle(title ?? '')
                setDraft({ ...draft, recordId: id })
              }}
            />
          </div>
          <button className="button primary" disabled={!draft.title.trim() || create.isPending}>
            创建任务
          </button>
          {create.isError && <p className="form-error">创建失败，请检查时间范围后重试。</p>}
        </form>
      )}
      {update.isError && <p className="form-error">日历任务更新失败，已恢复原时间。</p>}
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <div className="calendar-workspace">
          <aside className="calendar-unplanned" ref={unplannedRef}>
            <div className="section-heading">
              <h2>未排程</h2>
              <span>{inbox.data?.length ?? 0}</span>
            </div>
            {inbox.data?.length ? (
              inbox.data.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className="calendar-unplanned-item"
                  data-task-id={task.id}
                  onClick={() => selectTask(task.id)}
                >
                  {task.title}
                </button>
              ))
            ) : (
              <p className="quiet-empty">没有未排程任务</p>
            )}
          </aside>
          <div className="calendar-surface">
            <FullCalendar
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView="dayGridMonth"
              locale="zh-cn"
              height="auto"
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay',
              }}
              buttonText={{ today: '今天', month: '月', week: '周', day: '日' }}
              datesSet={(info) =>
                setRange({ from: info.start.toISOString(), to: info.end.toISOString() })
              }
              events={query.data.map((item) => ({
                id: item.id,
                title: item.title,
                start: item.startsAt!,
                end: item.endsAt!,
                allDay: item.allDay,
                classNames: ['calendar-entry', `calendar-priority-${item.priority}`],
              }))}
              selectable
              select={(info) => {
                setDraft(taskDraftFromCalendarSelection(info.start, info.end, info.allDay))
                setArchiveTitle('')
                setCreating(true)
              }}
              editable
              eventClick={(info) => selectTask(info.event.id)}
              eventDrop={(info) => {
                const item = query.data.find((task) => task.id === info.event.id)
                if (!item || !info.event.start) return info.revert()
                const duration =
                  new Date(item.endsAt!).getTime() - new Date(item.startsAt!).getTime()
                update.mutate(
                  {
                    task: item,
                    changes: {
                      startsAt: info.event.start.toISOString(),
                      endsAt: (
                        info.event.end ?? new Date(info.event.start.getTime() + duration)
                      ).toISOString(),
                      allDay: info.event.allDay,
                    },
                  },
                  { onError: info.revert },
                )
              }}
              eventResize={(info) => {
                const item = query.data.find((task) => task.id === info.event.id)
                if (!item || !info.event.start || !info.event.end) return info.revert()
                update.mutate(
                  {
                    task: item,
                    changes: {
                      startsAt: info.event.start.toISOString(),
                      endsAt: info.event.end.toISOString(),
                      allDay: info.event.allDay,
                    },
                  },
                  { onError: info.revert },
                )
              }}
              eventReceive={(info) => {
                const item = inbox.data?.find((task) => task.id === info.event.id)
                if (!item || !info.event.start) return info.revert()
                const end = info.event.end ?? new Date(info.event.start.getTime() + 60 * 60_000)
                update.mutate(
                  {
                    task: item,
                    changes: {
                      startsAt: info.event.start.toISOString(),
                      endsAt: end.toISOString(),
                      allDay: info.event.allDay,
                    },
                  },
                  { onError: info.revert },
                )
              }}
              dayMaxEvents
            />
          </div>
        </div>
      )}
    </div>
  )
}
