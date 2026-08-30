import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createTask, updateTask } from '../../generated/api/sdk.gen'
import type { Task, TaskInput } from '../../generated/api/types.gen'
import { requireData } from '../../lib/http/client'
import { taskKeys } from './queries'

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: TaskInput) =>
      requireData((await createTask({ body, throwOnError: true })).data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.all })
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      await queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] })
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
              allDay: task.allDay,
              timezone: task.timezone,
              archiveId: task.archiveId,
              notes: task.notes,
              ...changes,
            },
            throwOnError: true,
          })
        ).data,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.all })
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      await queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] })
    },
  })
}
