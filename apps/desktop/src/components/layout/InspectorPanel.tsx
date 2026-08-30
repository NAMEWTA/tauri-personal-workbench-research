import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Archive, MousePointer2 } from 'lucide-react'
import { ErrorState, LoadingState } from '../ui/StateView'
import { archiveQuery } from '../../features/archives/queries'
import { TaskEditor } from '../../features/tasks/TaskEditor'
import { taskQuery } from '../../features/tasks/queries'
import { useLayoutStore } from '../../stores/layout'

export function InspectorPanel() {
  const selection = useLayoutStore((state) => state.selection)
  const clearSelection = useLayoutStore((state) => state.clearSelection)
  if (!selection) {
    return (
      <div className="inspector-empty">
        <MousePointer2 size={22} />
        <strong>未选择内容</strong>
        <span>选择任务或档案后在此查看详情。</span>
      </div>
    )
  }
  return selection.kind === 'task' ? (
    <TaskInspector id={selection.id} onClose={clearSelection} />
  ) : (
    <ArchiveInspector id={selection.id} />
  )
}

function TaskInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useQuery(taskQuery(id))
  if (query.isPending) return <LoadingState label="正在读取任务…" />
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />
  return (
    <TaskEditor
      key={`${query.data.id}-${query.data.updatedAt}`}
      task={query.data}
      onClose={onClose}
    />
  )
}

function ArchiveInspector({ id }: { id: string }) {
  const query = useQuery(archiveQuery(id))
  if (query.isPending) return <LoadingState label="正在读取档案…" />
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />
  return (
    <div className="archive-inspector">
      <span className="eyebrow">{query.data.typeName}</span>
      <h2>{query.data.title}</h2>
      <p>{query.data.summary || '暂无摘要'}</p>
      <Link to="/archives/$archiveId" params={{ archiveId: id }} className="button primary">
        <Archive size={15} />
        打开档案
      </Link>
    </div>
  )
}
