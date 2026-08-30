import { invoke } from '@tauri-apps/api/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileSearch, FolderOpen, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useBackend } from '../../app/backend-context'
import { getSearchStatus, rebuildSearch } from '../../generated/api/sdk.gen'
import type { Job } from '../../generated/api/types.gen'
import { useJob } from '../jobs/useJob'
import { requireData } from '../../lib/http/client'
import { useLayoutStore } from '../../stores/layout'

type WorkspaceEntry = { path: string; name: string; lastOpened: number }
type BackendDiagnostics = { state: string; detail?: unknown }

export function SettingsPage() {
  const queryClient = useQueryClient()
  const { meta, connection } = useBackend()
  const { theme, setTheme } = useLayoutStore()
  const recent = useQuery({
    queryKey: ['recent-workspaces'],
    queryFn: () => invoke<WorkspaceEntry[]>('list_recent_workspaces'),
  })
  const diagnostics = useQuery({
    queryKey: ['backend-diagnostics'],
    queryFn: () => invoke<BackendDiagnostics>('backend_diagnostics'),
  })
  const searchStatus = useQuery({
    queryKey: ['search-status'],
    queryFn: async () => requireData((await getSearchStatus({ throwOnError: true })).data),
  })
  const [searchJobId, setSearchJobId] = useState<string>()
  const searchJob = useJob(searchJobId)
  const rebuild = useMutation({
    mutationFn: async () => requireData((await rebuildSearch({ throwOnError: true })).data) as Job,
    onSuccess: (value) => setSearchJobId(value.id),
  })
  useEffect(() => {
    if (searchJob.query.data?.state === 'succeeded') {
      void queryClient.invalidateQueries({ queryKey: ['search-status'] })
    }
  }, [queryClient, searchJob.query.data?.state])
  const openWorkspace = useMutation({
    mutationFn: async (path?: string) => {
      const selected = path ?? (await invoke<string | null>('select_workspace_directory'))
      if (!selected) return false
      await invoke('open_workspace', { path: selected })
      return true
    },
    onSuccess: (changed) => {
      if (changed) window.location.reload()
    },
  })
  return (
    <div className="page settings-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">偏好与状态</span>
          <h1>设置</h1>
        </div>
      </div>
      <section>
        <h2>外观</h2>
        <div className="setting-row">
          <div>
            <strong>主题</strong>
            <span>跟随系统或使用固定外观。</span>
          </div>
          <div className="segmented">
            {(['system', 'light', 'dark'] as const).map((value) => (
              <button
                key={value}
                className={theme === value ? 'active' : ''}
                onClick={() => setTheme(value)}
              >
                {value === 'system' ? '跟随系统' : value === 'light' ? '浅色' : '深色'}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section>
        <div className="section-heading">
          <h2>工作区</h2>
          <button
            className="button"
            onClick={() => openWorkspace.mutate(undefined)}
            disabled={openWorkspace.isPending}
          >
            <FolderOpen size={15} />
            新建或打开
          </button>
        </div>
        <dl className="diagnostic-list">
          <div>
            <dt>名称</dt>
            <dd>{meta.workspaceName}</dd>
          </div>
          <div>
            <dt>数据库结构</dt>
            <dd>v{meta.schemaVersion}</dd>
          </div>
          <div>
            <dt>服务版本</dt>
            <dd>{meta.serviceVersion}</dd>
          </div>
          <div>
            <dt>协议版本</dt>
            <dd>{connection.protocolVersion}</dd>
          </div>
          <div>
            <dt>连接状态</dt>
            <dd>
              <span className="status-dot" />
              正常
            </dd>
          </div>
        </dl>
        {recent.data && recent.data.length > 0 && (
          <div className="recent-workspaces">
            <span className="eyebrow">最近打开</span>
            {recent.data.map((item, index) => (
              <button
                key={item.path}
                onClick={() => openWorkspace.mutate(item.path)}
                disabled={index === 0 || openWorkspace.isPending}
              >
                <FolderOpen size={15} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.path}</small>
                </span>
              </button>
            ))}
          </div>
        )}
        {openWorkspace.isError && <p className="form-error">工作区无法打开，已恢复原连接。</p>}
      </section>
      <section>
        <div className="section-heading">
          <h2>诊断</h2>
          <button className="button" onClick={() => void invoke('reveal_log_directory')}>
            <FileSearch size={15} />
            打开日志目录
          </button>
        </div>
        <dl className="diagnostic-list">
          <div>
            <dt>监督状态</dt>
            <dd>{diagnostics.data?.state ?? '读取中'}</dd>
          </div>
          <div>
            <dt>日志策略</dt>
            <dd>单文件 5 MB，保留 3 份历史</dd>
          </div>
          <div>
            <dt>异常恢复</dt>
            <dd>最多自动重启 2 次</dd>
          </div>
          <div>
            <dt>搜索索引</dt>
            <dd>
              {searchStatus.data?.healthy ? '正常' : searchStatus.isLoading ? '读取中' : '需要重建'}
            </dd>
          </div>
        </dl>
        <div className="setting-row">
          <div>
            <strong>全文搜索索引</strong>
            <span>重新扫描档案、任务和附件名称。</span>
          </div>
          {searchJob.active ? (
            <button className="button" onClick={() => searchJob.cancel.mutate()}>
              <X size={15} />
              取消 {searchJob.query.data?.progress ?? 0}%
            </button>
          ) : (
            <button
              className="button"
              onClick={() => rebuild.mutate()}
              disabled={rebuild.isPending}
            >
              <RefreshCw size={15} />
              重建索引
            </button>
          )}
        </div>
        {searchJob.query.data?.state === 'failed' && (
          <p className="form-error">索引重建失败，请查看日志。</p>
        )}
      </section>
    </div>
  )
}
