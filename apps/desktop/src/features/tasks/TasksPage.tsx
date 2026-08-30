import { useQuery } from '@tanstack/react-query'
import { ListFilter } from 'lucide-react'
import { useState } from 'react'
import type { ListTasksData } from '../../generated/api/types.gen'
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
export function TasksPage() {
  const [view, setView] = useState<View>('all')
  const selectTask = useLayoutStore((state) => state.selectTask)
  const query = useQuery(tasksQuery(view))
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <span className="eyebrow">工作安排</span>
          <h1>任务</h1>
        </div>
        <button className="icon-button" aria-label="筛选任务" title="筛选任务">
          <ListFilter size={18} />
        </button>
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
          ) : (
            <div className="task-list">
              {query.data.map((item) => (
                <TaskRow key={item.id} task={item} onSelect={() => selectTask(item.id)} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
