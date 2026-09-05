import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createTask } from '../../generated/api/sdk.gen'
import type { TaskInput } from '../../generated/api/types.gen'
import { useCreateTask } from './mutations'
import { invalidateWorkbenchQueries } from '../../app/queryKeys'

vi.mock('../../generated/api/sdk.gen', () => ({ createTask: vi.fn(), updateTask: vi.fn() }))

describe('workbench mutation projections', () => {
  let client: QueryClient
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  })
  afterEach(() => {
    cleanup()
    client.clear()
    vi.clearAllMocks()
  })

  it('refreshes the active dated dashboard when creating a task', async () => {
    const dashboard = vi.fn().mockResolvedValueOnce(['before']).mockResolvedValue(['after'])
    vi.mocked(createTask).mockResolvedValue({ data: { id: 'created' } } as Awaited<
      ReturnType<typeof createTask>
    >)
    const { result } = renderHook(
      () => ({
        dashboard: useQuery({ queryKey: ['dashboard', '2026-09-05'], queryFn: dashboard }),
        create: useCreateTask(),
      }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    )
    await waitFor(() => expect(result.current.dashboard.data).toEqual(['before']))
    await act(async () => {
      await result.current.create.mutateAsync({ title: '新任务' } as TaskInput)
    })
    await waitFor(() => expect(result.current.dashboard.data).toEqual(['after']))
    expect(dashboard).toHaveBeenCalledTimes(2)
  })

  it('invalidates archive details and all dated dashboard projections while preserving preferences', async () => {
    const affected = [
      ['dashboard', '2026-09-05'],
      ['dashboard', '2026-09-06'],
      ['archives', 'detail', 'record-1'],
      ['calendar-tasks', 'from', 'to'],
      ['trash'],
    ]
    for (const key of affected) client.setQueryData(key, ['cached'])
    client.setQueryData(['preferences'], { theme: 'dark' })
    await invalidateWorkbenchQueries(client)
    for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(client.getQueryState(['preferences'])?.isInvalidated).toBe(false)
  })
})
