import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { listTrash, restoreTrash } from '../../generated/api/sdk.gen'
import { requireData } from '../../lib/http/client'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateView'

export function TrashPage() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['trash'],
    queryFn: async () => requireData((await listTrash({ throwOnError: true })).data),
  })
  const restore = useMutation({
    mutationFn: async (id: string) => {
      await restoreTrash({ path: { trashId: id }, throwOnError: true })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['trash'] })
      await queryClient.invalidateQueries({ queryKey: ['archives'] })
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      await queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] })
      await queryClient.invalidateQueries({ queryKey: ['archive-attachments'] })
      await queryClient.invalidateQueries({ queryKey: ['archive-activity'] })
    },
  })
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <span className="eyebrow">可恢复项目</span>
          <h1>回收站</h1>
        </div>
      </div>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : query.data.length === 0 ? (
        <EmptyState title="回收站为空" detail="删除的档案、任务和附件会保留在这里。" />
      ) : (
        <div className="trash-list">
          {query.data.map((item) => (
            <div key={item.id}>
              <span>
                <strong>{item.title}</strong>
                <small>
                  {item.entityType === 'archive'
                    ? '档案'
                    : item.entityType === 'task'
                      ? '任务'
                      : '附件'}{' '}
                  ·{' '}
                  {new Intl.DateTimeFormat('zh-CN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(item.deletedAt))}
                </small>
              </span>
              <button className="button" onClick={() => restore.mutate(item.id)}>
                <RotateCcw size={15} />
                恢复
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
