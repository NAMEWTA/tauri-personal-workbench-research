import { CalendarClock, Circle, CircleCheck, Flag } from 'lucide-react'
import type { Task } from '../../generated/api/types.gen'
import { useUpdateTask } from './mutations'
import { useLayoutStore } from '../../stores/layout'

const dateText = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : ''

export function TaskRow({
  task,
  onSelect,
  onToggle,
}: {
  task: Task
  onSelect?: () => void
  onToggle?: (task: Task, status: Task['status']) => void
}) {
  const update = useUpdateTask()
  const selectTask = useLayoutStore((state) => state.selectTask)
  const done = task.status === 'done'
  return (
    <div
      className={`task-row ${done ? 'completed' : ''}`}
      onClick={() => (onSelect ? onSelect() : selectTask(task.id))}
    >
      <button
        className="task-check"
        aria-label={done ? '标记未完成' : '完成任务'}
        onClick={(event) => {
          event.stopPropagation()
          const status = done ? 'todo' : 'done'
          if (onToggle) onToggle(task, status)
          else update.mutate({ task, changes: { status } })
        }}
      >
        {done ? <CircleCheck size={20} /> : <Circle size={20} />}
      </button>
      <div className="task-copy">
        <button className="task-title-button" onClick={onSelect}>
          {task.title}
        </button>
        <div>
          {task.priority !== 'normal' && (
            <span className={`priority ${task.priority}`}>
              <Flag size={12} />
              {task.priority === 'urgent' ? '紧急' : task.priority === 'high' ? '高' : '低'}
            </span>
          )}
          {task.startsAt && (
            <span>
              <CalendarClock size={12} />
              {dateText(task.startsAt)}
            </span>
          )}
          {task.endsAt && (
            <span className="task-due">
              <CalendarClock size={12} />至 {dateText(task.endsAt)}
            </span>
          )}
        </div>
      </div>
      <span className={`status-label ${task.status}`}>
        {task.status === 'todo' ? '待办' : task.status === 'doing' ? '进行中' : '已完成'}
      </span>
    </div>
  )
}
