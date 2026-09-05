import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createTask, updateTask } from '../../generated/api/sdk.gen'
import type { Task, TaskInput } from '../../generated/api/types.gen'
import { requireData } from '../../lib/http/client'
import { invalidateWorkbenchQueries } from '../../app/queryKeys'

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: TaskInput) =>
      requireData((await createTask({ body, throwOnError: true })).data),
    onSuccess: async () => {
      await invalidateWorkbenchQueries(queryClient)
    },
  })
}
export function useUpdateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ task, changes }: { task: Task; changes: Partial<TaskInput> }) =>
      requireData(
        (
          await updateTask({
            path: { taskId: task.id },
            body: {
              title: task.title,
              status: task.status,
              priority: task.priority,
              startsAt: task.startsAt,
              endsAt: task.endsAt,
              dueOn: task.dueOn,
              allDay: task.allDay,
              timezone: task.timezone,
              recordId: task.recordId,
              notes: task.notes,
              recurrence: task.recurrence ?? '',
              reminders: task.reminders ?? [],
              parentId: task.parentId,
              estimateMinutes: task.estimateMinutes,
              ...changes,
            },
            throwOnError: true,
          })
        ).data,
      ),
    onSuccess: async () => {
      await invalidateWorkbenchQueries(queryClient)
    },
  })
}
