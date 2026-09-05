import type { QueryClient } from '@tanstack/react-query'

export const queryKeys = {
  dashboard: ['dashboard'] as const,
  calendar: ['calendar-tasks'] as const,
  archiveTasks: ['archive-tasks'] as const,
  trash: ['trash'] as const,
  archives: ['archives'] as const,
  archiveRelations: ['archive-relations'] as const,
  archiveAttachments: ['archive-attachments'] as const,
  archiveActivity: ['archive-activity'] as const,
  tasks: ['tasks'] as const,
}

/** 刷新任务或档案变更影响到的各个视图。 */
export async function invalidateWorkbenchQueries(queryClient: QueryClient) {
  await Promise.all(
    [
      queryKeys.tasks,
      queryKeys.dashboard,
      queryKeys.calendar,
      queryKeys.archiveTasks,
      queryKeys.archives,
      queryKeys.trash,
      queryKeys.archiveRelations,
      queryKeys.archiveAttachments,
      queryKeys.archiveActivity,
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  )
}
