import { act, cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { TodayPage } from './TodayPage'
import { getDashboard } from '../../generated/api/sdk.gen'

vi.mock('../../generated/api/sdk.gen', () => ({ getDashboard: vi.fn() }))
vi.mock('../tasks/QuickTaskForm', () => ({ QuickTaskForm: () => null }))
vi.mock('../tasks/TaskRow', () => ({ TaskRow: () => null }))
vi.mock('../tasks/mutations', () => ({ useUpdateTask: () => ({ mutate: vi.fn() }) }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

describe('TodayPage', () => {
  let client: QueryClient
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 5, 23, 59, 59))
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    vi.mocked(getDashboard).mockResolvedValue({
      request: new Request('http://127.0.0.1/api/v3/dashboard'),
      response: new Response(),
      data: { overdueTasks: [], todayTasks: [], tomorrowTasks: [], recentArchives: [] },
    })
  })
  afterEach(() => {
    cleanup()
    client.clear()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('updates the local date and fetches a new dashboard without remounting at midnight', async () => {
    const format = (date: Date) =>
      new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      }).format(date)
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <TodayPage />
      </QueryClientProvider>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByText(format(new Date(2026, 8, 5)))).toBeInTheDocument()
    expect(getDashboard).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100)
    })
    expect(screen.getByText(format(new Date(2026, 8, 6)))).toBeInTheDocument()
    expect(getDashboard).toHaveBeenCalledTimes(2)
    expect(getDashboard).toHaveBeenLastCalledWith({
      query: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      throwOnError: true,
    })
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(86_400_000)
    })
    expect(getDashboard).toHaveBeenCalledTimes(2)
  })
})
