import { act, cleanup, render } from '@testing-library/react'
import { ReminderScheduler } from './ReminderScheduler'

const { query } = vi.hoisted(() => ({
  query: { data: [] as Array<{ id: string; title: string; reminders: string[] }> },
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => query,
  queryOptions: (options: unknown) => options,
}))

describe('ReminderScheduler', () => {
  let permission: NotificationPermission
  let notify: ReturnType<typeof vi.fn<(title: string, options: NotificationOptions) => void>>
  let requestPermission: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T15:59:30Z'))
    permission = 'granted'
    notify = vi.fn()
    requestPermission = vi.fn()
    class TestNotification {
      static get permission() {
        return permission
      }
      static requestPermission = requestPermission
      constructor(title: string, options: NotificationOptions) {
        notify(title, options)
      }
    }
    vi.stubGlobal('Notification', TestNotification)
    query.data = [{ id: 'task-1', title: '待办提醒', reminders: ['2026-09-05T15:59:00Z'] }]
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('sends a due reminder as soon as the permission request is granted', async () => {
    permission = 'default'
    let grant!: (value: NotificationPermission) => void
    requestPermission.mockReturnValue(
      new Promise<NotificationPermission>((resolve) => {
        grant = resolve
      }),
    )
    render(<ReminderScheduler />)
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(notify).not.toHaveBeenCalled()
    await act(async () => {
      permission = 'granted'
      grant(permission)
    })
    expect(notify).toHaveBeenCalledWith('待办提醒', { body: '任务提醒时间到了。' })
  })

  it('preserves denied reminders and sends them after external reauthorization', () => {
    permission = 'denied'
    render(<ReminderScheduler />)
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(requestPermission).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    permission = 'granted'
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(notify).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(90_000)
    })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('retries a failed notification constructor without duplicating a successful delivery', () => {
    notify.mockImplementationOnce(() => {
      throw new Error('notification unavailable')
    })
    render(<ReminderScheduler />)
    expect(notify).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(notify).toHaveBeenCalledTimes(2)
    act(() => {
      vi.advanceTimersByTime(90_000)
    })
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('waits for a reminder across midnight and cleans up its interval', () => {
    query.data[0]!.reminders = ['2026-09-05T16:00:00Z', 'invalid']
    const { unmount } = render(<ReminderScheduler />)
    expect(notify).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(notify).toHaveBeenCalledTimes(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not dispatch after unmount when a pending permission request resolves', async () => {
    permission = 'default'
    let grant!: (value: NotificationPermission) => void
    requestPermission.mockReturnValue(
      new Promise<NotificationPermission>((resolve) => {
        grant = resolve
      }),
    )
    const { unmount } = render(<ReminderScheduler />)
    unmount()
    await act(async () => {
      permission = 'granted'
      grant(permission)
    })
    expect(notify).not.toHaveBeenCalled()
  })
})
