import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, FileSearch, FolderOpen, RefreshCw } from 'lucide-react'
import { getMeta } from '../generated/api/sdk.gen'
import { clearApi, configureApi, requireData, type BackendConnection } from '../lib/http/client'
import { BackendContext } from './backend-context'
import { validateLocalBackendUrl } from './backend-url'
import { queryClient } from './queryClient'
import { safeBackendErrorMessage } from './backend-error'

type BackendDiagnostics = { state: string; detail?: unknown }

async function connectionInfo(): Promise<BackendConnection> {
  if (
    import.meta.env.DEV &&
    (import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_BACKEND_TOKEN)
  ) {
    const rawUrl = import.meta.env.VITE_BACKEND_URL
    const token = import.meta.env.VITE_BACKEND_TOKEN
    if (!rawUrl || !token) throw new Error('本地开发后端必须同时提供地址和令牌')
    validateLocalBackendUrl(rawUrl)
    return {
      baseUrl: rawUrl,
      token,
      protocolVersion: 3,
      serviceVersion: 'development',
    }
  }
  if (!('__TAURI_INTERNALS__' in window)) {
    throw new Error('桌面端宿主不可用，请使用 Tauri 应用启动。')
  }
  return invoke<BackendConnection>('backend_connection_info')
}

function BackendBootstrap({ children }: { children: ReactNode }) {
  const [generation, setGeneration] = useState(0)
  const [recoveryError, setRecoveryError] = useState('')
  const [startupNoticeDismissed, setStartupNoticeDismissed] = useState(false)
  const tauriAvailable = '__TAURI_INTERNALS__' in window
  const query = useQuery({
    queryKey: ['backend', generation],
    queryFn: async () => {
      const connection = await connectionInfo()
      configureApi(connection, () => setGeneration((value) => value + 1))
      const response = await getMeta({ throwOnError: true })
      const meta = requireData(response.data)
      if (meta.apiVersion !== connection.protocolVersion) throw new Error('前后端协议版本不一致')
      return { connection, meta }
    },
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const diagnostics = useQuery({
    queryKey: ['backend-diagnostics', generation],
    queryFn: () =>
      tauriAvailable
        ? invoke<BackendDiagnostics>('backend_diagnostics')
        : Promise.resolve<BackendDiagnostics>({ state: '仅 Web 预览' }),
    enabled: query.isError,
  })
  const startupNoticeQuery = useQuery({
    queryKey: ['startup-notice'],
    queryFn: () => invoke<string | null>('get_startup_notice'),
    enabled: tauriAvailable && query.isSuccess,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  const recover = async (command: 'retry_backend' | 'open_workspace') => {
    setRecoveryError('')
    try {
      if (!tauriAvailable) throw new Error('恢复本地服务仅支持桌面端')
      if (command === 'open_workspace') {
        const path = await invoke<string | null>('select_workspace_directory')
        if (!path) return
        await invoke(command, { path })
      } else {
        await invoke(command)
      }
      queryClient.clear()
      clearApi()
      setGeneration((value) => value + 1)
    } catch (error) {
      setRecoveryError(safeBackendErrorMessage(error))
    }
  }

  useEffect(() => () => clearApi(), [])

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let disposed = false
    const unlisteners: UnlistenFn[] = []
    const reconnect = () => {
      queryClient.clear()
      clearApi()
      setGeneration((value) => value + 1)
    }
    for (const eventName of ['backend-restarted', 'backend-lost']) {
      void listen(eventName, reconnect).then((unlisten) => {
        if (disposed) unlisten()
        else unlisteners.push(unlisten)
      })
    }
    return () => {
      disposed = true
      unlisteners.forEach((unlisten) => unlisten())
    }
  }, [])

  if (query.isPending) {
    return (
      <main className="gate-screen" aria-live="polite">
        <div className="brand-mark large">工</div>
        <h1>个人工作台</h1>
        <p>正在打开本地工作区…</p>
        <span className="loading-line" />
      </main>
    )
  }
  if (query.isError) {
    const detail =
      diagnostics.data?.state === 'failed' && typeof diagnostics.data.detail === 'string'
        ? safeBackendErrorMessage(diagnostics.data.detail)
        : safeBackendErrorMessage(query.error)
    return (
      <main className="gate-screen diagnostic-screen">
        <AlertTriangle size={28} aria-hidden="true" />
        <h1>本地服务未能启动</h1>
        <p>{detail}</p>
        <div className="diagnostic-actions">
          <button className="button primary" onClick={() => void recover('retry_backend')}>
            <RefreshCw size={16} />
            重试
          </button>
          <button className="button" onClick={() => void recover('open_workspace')}>
            <FolderOpen size={16} />
            新建或打开工作区
          </button>
          <button
            className="button"
            onClick={() => void invoke('reveal_log_directory')}
            disabled={!tauriAvailable}
            title={tauriAvailable ? '打开日志目录' : '请在桌面端使用'}
          >
            <FileSearch size={16} />
            打开日志
          </button>
        </div>
        {recoveryError && <span className="form-error">{recoveryError}</span>}
      </main>
    )
  }
  return (
    <BackendContext.Provider value={query.data}>
      <div className="backend-surface">
        {startupNoticeQuery.data && !startupNoticeDismissed && (
          <div className="startup-notice" role="status">
            <span>{startupNoticeQuery.data}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭提示"
              onClick={() => setStartupNoticeDismissed(true)}
            >
              ×
            </button>
          </div>
        )}
        <div className="backend-content">{children}</div>
      </div>
    </BackendContext.Provider>
  )
}

export function BackendGate({ children }: { children: ReactNode }) {
  const value = useMemo(() => children, [children])
  return <BackendBootstrap>{value}</BackendBootstrap>
}
