import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { BackendGate } from './BackendContext'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getMeta } from '../generated/api/sdk.gen'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }))
vi.mock('../generated/api/sdk.gen', () => ({ getMeta: vi.fn() }))

describe('BackendGate startup notice', () => {
  beforeEach(() => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'backend_connection_info') {
        return {
          baseUrl: 'http://127.0.0.1:49152',
          token: 'test-token',
          protocolVersion: 3,
          serviceVersion: 'test',
        }
      }
      if (command === 'get_startup_notice')
        return '原工作区的数据格式不受当前版本支持，已为你打开新工作区。原目录和数据已保留，未进行迁移。'
      if (command === 'backend_diagnostics') return { state: 'running' }
      return null
    })
    vi.mocked(getMeta).mockResolvedValue({
      data: { apiVersion: 3, serviceVersion: 'test', workspaceName: '新工作区', schemaVersion: 1 },
      request: new Request('http://127.0.0.1:49152/api/v3/meta'),
      response: new Response(),
    })
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows the native startup preservation notice once and allows dismissing it', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <BackendGate>
            <p>应用内容</p>
          </BackendGate>
        </QueryClientProvider>
      </StrictMode>,
    )
    expect(await screen.findByText('应用内容')).toBeInTheDocument()
    const notice = await screen.findByText(/原工作区的数据格式/)
    expect(notice).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith('get_startup_notice')
    await act(async () => {
      screen.getByRole('button', { name: '关闭提示' }).click()
    })
    await waitFor(() => expect(screen.queryByText(/原工作区的数据格式/)).not.toBeInTheDocument())
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_startup_notice'),
    ).toHaveLength(1)
    client.clear()
  })
})
