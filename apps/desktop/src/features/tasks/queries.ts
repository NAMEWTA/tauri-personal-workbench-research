import { queryOptions } from '@tanstack/react-query'
import { getTask, listTasks } from '../../generated/api/sdk.gen'
import type { ListTasksData } from '../../generated/api/types.gen'
import { requireData } from '../../lib/http/client'

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

export const taskKeys = {
  all: ['tasks'] as const,
  list: (view: NonNullable<ListTasksData['query']>['view']) => ['tasks', view] as const,
  detail: (id: string) => ['tasks', 'detail', id] as const,
}
export const tasksQuery = (view: NonNullable<ListTasksData['query']>['view']) =>
  queryOptions({
    queryKey: taskKeys.list(view),
    queryFn: async () =>
      requireData((await listTasks({ query: { view, timezone }, throwOnError: true })).data),
  })

export const taskQuery = (id: string) =>
  queryOptions({
    queryKey: taskKeys.detail(id),
    queryFn: async () =>
      requireData((await getTask({ path: { taskId: id }, throwOnError: true })).data),
  })
