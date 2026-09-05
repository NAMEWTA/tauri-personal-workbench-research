import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommandPalette } from './CommandPalette'
import { search } from '../../generated/api/sdk.gen'
import type { SearchResult } from '../../generated/api/types.gen'

type SearchResponse = Awaited<ReturnType<typeof search<true>>>
const searchResponse = (data: SearchResult[]): SearchResponse => ({
  data,
  request: new Request('http://127.0.0.1/api/v3/search'),
  response: new Response(),
})

vi.mock('../../generated/api/sdk.gen', () => ({ search: vi.fn(), updatePreferences: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../features/settings/preferences', () => ({
  preferencesKey: ['preferences'],
  usePreferences: () => ({ data: { recentSearches: [] } }),
}))

describe('CommandPalette', () => {
  let client: QueryClient
  const renderPalette = () =>
    render(
      <QueryClientProvider client={client}>
        <CommandPalette open onClose={vi.fn()} />
      </QueryClientProvider>,
    )
  const advance = async (duration = 250) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(duration)
    })
  beforeEach(() => {
    vi.useFakeTimers()
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    vi.mocked(search).mockResolvedValue(searchResponse([]))
  })
  afterEach(() => {
    cleanup()
    client.clear()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('waits for two characters and the debounce interval before searching', async () => {
    renderPalette()
    const input = screen.getByRole('textbox', { name: '搜索关键词' })
    fireEvent.change(input, { target: { value: 'a' } })
    await advance()
    expect(search).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: ' ab ' } })
    await advance(249)
    expect(search).not.toHaveBeenCalled()
    await advance(1)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ query: { q: 'ab' }, signal: expect.any(AbortSignal) }),
    )
  })

  it('aborts an obsolete request and prevents its late response replacing new results', async () => {
    const pending: Array<{ signal: AbortSignal; resolve: (results: SearchResult[]) => void }> = []
    vi.mocked(search).mockImplementation(
      (options) =>
        new Promise<SearchResponse>((resolve) => {
          pending.push({
            signal: options.signal!,
            resolve: (data) => resolve(searchResponse(data)),
          })
        }),
    )
    renderPalette()
    const input = screen.getByRole('textbox', { name: '搜索关键词' })
    fireEvent.change(input, { target: { value: 'before' } })
    await advance()
    fireEvent.change(input, { target: { value: 'after' } })
    await advance()
    expect(pending).toHaveLength(2)
    expect(pending[0]!.signal.aborted).toBe(true)
    await act(async () => {
      pending[1]!.resolve([{ id: 'new', type: 'task', title: '新结果', subtitle: '' }])
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByText('新结果')).toBeInTheDocument()
    await act(async () => {
      pending[0]!.resolve([{ id: 'old', type: 'task', title: '旧结果', subtitle: '' }])
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByText('新结果')).toBeInTheDocument()
    expect(screen.queryByText('旧结果')).not.toBeInTheDocument()
  })

  it('aborts an active request when the palette closes', async () => {
    let signal: AbortSignal | undefined
    vi.mocked(search).mockImplementation((options) => {
      signal = options.signal ?? undefined
      return new Promise<SearchResponse>(() => {})
    })
    const { rerender } = renderPalette()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索关键词' }), {
      target: { value: 'pending' },
    })
    await advance()
    expect(signal?.aborted).toBe(false)
    rerender(
      <QueryClientProvider client={client}>
        <CommandPalette open={false} onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(signal?.aborted).toBe(true)
  })
})
