import { useQuery } from '@tanstack/react-query'
import { ListFilter } from 'lucide-react'
import { useState } from 'react'
import type { ListTasksData, Task } from '../../generated/api/types.gen'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateView'
import { QuickTaskForm } from './QuickTaskForm'
import { TaskRow } from './TaskRow'
import { tasksQuery } from './queries'
import { useLayoutStore } from '../../stores/layout'

type View = NonNullable<ListTasksData['query']>['view']
const views: Array<{ value: View; label: string }> = [
  { value: 'today', label: '今天' },
  { value: 'tomorrow', label: '明天' },
  { value: 'all', label: '全部' },
  { value: 'completed', label: '已完成' },
]
const priorities: Array<{ value: 'all' | Task['priority']; label: string }> = [
  { value: 'all', label: '全部优先级' },
  { value: 'urgent', label: '紧急' },
  { value: 'high', label: '高优先级' },
  { value: 'normal', label: '普通' },
  { value: 'low', label: '低优先级' },
]
export function TasksPage() {
  const [view, setView] = useState<View>('all')
  const [priority, setPriority] = useState<'all' | Task['priority']>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const selectTask = useLayoutStore((state) => state.selectTask)
  const query = useQuery(tasksQuery(view))
  const filteredTasks =
    query.data?.filter((task) => priority === 'all' || task.priority === priority) ?? []
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <span className="eyebrow">工作安排</span>
          <h1>任务</h1>
        </div>
        <div className="task-filter">
          <button
            type="button"
            className={`icon-button ${priority !== 'all' ? 'active' : ''}`}
            aria-label="筛选任务"
            aria-expanded={filterOpen}
            aria-controls="task-priority-filter"
            title="筛选任务"
            onClick={() => setFilterOpen((open) => !open)}
          >
            <ListFilter size={18} />
          </button>
          {filterOpen && (
            <div
              id="task-priority-filter"
              className="task-filter-menu"
              role="menu"
              aria-label="任务优先级"
            >
              {priorities.map((item) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={priority === item.value}
                  className={priority === item.value ? 'active' : ''}
                  key={item.value}
                  onClick={() => {
                    setPriority(item.value)
                    setFilterOpen(false)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <QuickTaskForm />
      <div className="segmented" aria-label="任务视图">
        {views.map((item) => (
          <button
            key={item.value}
            className={view === item.value ? 'active' : ''}
            onClick={() => setView(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="tasks-layout">
        <section className="list-section">
          {query.isPending ? (
            <LoadingState />
          ) : query.isError ? (
            <ErrorState error={query.error} retry={() => void query.refetch()} />
          ) : query.data.length === 0 ? (
            <EmptyState title="这里还没有任务" detail="添加一项任务后，它会显示在当前视图。" />
          ) : filteredTasks.length === 0 ? (
            <EmptyState title="没有匹配任务" detail="尝试选择其他优先级，或清除当前筛选。" />
          ) : (
            <div className="task-list">
              {filteredTasks.map((item) => (
                <TaskRow key={item.id} task={item} onSelect={() => selectTask(item.id)} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
