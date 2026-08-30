import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { getMeta } from '../generated/api/sdk.gen'
import { clearApi, configureApi, requireData, type BackendConnection } from '../lib/http/client'
import { BackendContext } from './backend-context'
import { queryClient } from './queryClient'

async function connectionInfo(): Promise<BackendConnection> {
  if (
    import.meta.env.DEV &&
    import.meta.env.VITE_BACKEND_URL &&
    import.meta.env.VITE_BACKEND_TOKEN
  ) {
    return {
      baseUrl: import.meta.env.VITE_BACKEND_URL,
      token: import.meta.env.VITE_BACKEND_TOKEN,
      protocolVersion: 2,
      serviceVersion: 'development',
    }
  }
  return invoke<BackendConnection>('backend_connection_info')
}

function BackendBootstrap({ children }: { children: ReactNode }) {
  const [generation, setGeneration] = useState(0)
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
    return (
      <main className="gate-screen diagnostic-screen">
        <AlertTriangle size={28} aria-hidden="true" />
        <h1>本地服务未能启动</h1>
        <p>{query.error instanceof Error ? query.error.message : '无法连接工作区服务。'}</p>
        <button className="button primary" onClick={() => void query.refetch()}>
          <RefreshCw size={16} />
          重试
        </button>
      </main>
    )
  }
  return <BackendContext.Provider value={query.data}>{children}</BackendContext.Provider>
}

export function BackendGate({ children }: { children: ReactNode }) {
  const value = useMemo(() => children, [children])
  return <BackendBootstrap>{value}</BackendBootstrap>
}
