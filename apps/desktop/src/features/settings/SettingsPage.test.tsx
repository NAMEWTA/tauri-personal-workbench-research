import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { SettingsPage } from './SettingsPage'
import { PreferencesFlushContext } from './preferences-context'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../app/backend-context', () => ({
  useBackend: () => ({
    meta: { workspaceName: '当前工作区', schemaVersion: 2, serviceVersion: '0.2.9' },
    connection: { protocolVersion: 3 },
  }),
}))
vi.mock('../../generated/api/sdk.gen', () => ({
  getSearchStatus: async () => ({ data: { healthy: true } }),
  rebuildSearch: vi.fn(),
}))
vi.mock('../jobs/useJob', () => ({
  useJob: () => ({ query: { data: undefined }, active: false, cancel: { isError: false } }),
}))

describe('workspace preference persistence', () => {
  let client: QueryClient
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'list_recent_workspaces') return []
      if (command === 'backend_diagnostics') return { state: 'running' }
      if (command === 'select_workspace_directory') return 'D:\\next-workspace'
      return new Promise<never>(() => {})
    })
  })
  afterEach(() => {
    cleanup()
    client.clear()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const renderSettings = (flush: () => Promise<void>) =>
    render(
      <QueryClientProvider client={client}>
        <PreferencesFlushContext.Provider value={flush}>
          <SettingsPage />
        </PreferencesFlushContext.Provider>
      </QueryClientProvider>,
    )

  it('waits for the latest preferences to persist before stopping the current workspace', async () => {
    let finish!: () => void
    const flush = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    renderSettings(flush)
    fireEvent.click(screen.getByRole('button', { name: '新建或打开' }))
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1))
    expect(invoke).not.toHaveBeenCalledWith('open_workspace', expect.anything())
    await act(async () => {
      finish()
    })
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('open_workspace', { path: 'D:\\next-workspace' }),
    )
  })

  it('keeps the current workspace open if saving preferences fails', async () => {
    renderSettings(async () => {
      throw new Error('save failed')
    })
    fireEvent.click(screen.getByRole('button', { name: '新建或打开' }))
    expect(await screen.findByText('工作区无法打开，已恢复原连接。')).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalledWith('open_workspace', expect.anything())
  })
})
