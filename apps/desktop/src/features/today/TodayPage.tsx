import { useQuery } from '@tanstack/react-query'
import { Archive, ArrowRight } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getDashboard } from '../../generated/api/sdk.gen'
import type { Task } from '../../generated/api/types.gen'
import { requireData } from '../../lib/http/client'
import { ErrorState, LoadingState } from '../../components/ui/StateView'
import { QuickTaskForm } from '../tasks/QuickTaskForm'
import { TaskRow } from '../tasks/TaskRow'
import { useUpdateTask } from '../tasks/mutations'

const date = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date())
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
export function TodayPage() {
  const update = useUpdateTask()
  const [undoTask, setUndoTask] = useState<Task>()
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () =>
      requireData((await getDashboard({ query: { timezone }, throwOnError: true })).data),
  })
  useEffect(() => {
    if (!undoTask) return
    const timer = window.setTimeout(() => setUndoTask(undefined), 5_000)
    return () => window.clearTimeout(timer)
  }, [undoTask])
  const toggle = (task: Task, status: Task['status']) => {
    update.mutate(
      { task, changes: { status } },
      { onSuccess: () => setUndoTask(status === 'done' ? task : undefined) },
    )
  }
  return (
    <div className="page today-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">{date}</span>
          <h1>今日</h1>
        </div>
      </div>
      <QuickTaskForm />
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <div className="today-grid">
          <section>
            <div className="section-heading">
              <h2>需要关注</h2>
              <Link to="/tasks">
                查看全部
                <ArrowRight size={14} />
              </Link>
            </div>
            {query.data.overdueTasks.length === 0 && query.data.todayTasks.length === 0 ? (
              <p className="quiet-empty">今天没有待处理事项。</p>
            ) : (
              <div className="task-list">
                {query.data.overdueTasks.map((item) => (
                  <TaskRow key={item.id} task={item} onToggle={toggle} />
                ))}
                {query.data.todayTasks.map((item) => (
                  <TaskRow key={item.id} task={item} onToggle={toggle} />
                ))}
              </div>
            )}
          </section>
          <section>
            <div className="section-heading">
              <h2>明天</h2>
              <Link to="/tasks">
                所有任务
                <ArrowRight size={14} />
              </Link>
            </div>
            {query.data.tomorrowTasks.length === 0 ? (
              <p className="quiet-empty">明天暂无安排。</p>
            ) : (
              <div className="task-list">
                {query.data.tomorrowTasks.map((item) => (
                  <TaskRow key={item.id} task={item} onToggle={toggle} />
                ))}
              </div>
            )}
          </section>
          <section className="wide">
            <div className="section-heading">
              <h2>最近档案</h2>
              <Link to="/archives">
                所有档案
                <ArrowRight size={14} />
              </Link>
            </div>
            {query.data.recentArchives.length === 0 ? (
              <p className="quiet-empty">最近没有档案。</p>
            ) : (
              <div className="recent-archives">
                {query.data.recentArchives.map((item) => (
                  <Link key={item.id} to="/archives/$archiveId" params={{ archiveId: item.id }}>
                    <span
                      className="archive-icon"
                      style={{ backgroundColor: `${item.typeColor}20`, color: item.typeColor }}
                    >
                      <Archive size={17} />
                    </span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.summary || '暂无摘要'}</small>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      {undoTask && (
        <div className="undo-toast" role="status">
          <span>已完成“{undoTask.title}”</span>
          <button
            onClick={() => {
              update.mutate({
                task: { ...undoTask, status: 'done' },
                changes: { status: undoTask.status },
              })
              setUndoTask(undefined)
            }}
          >
            撤销
          </button>
        </div>
      )}
    </div>
  )
}
