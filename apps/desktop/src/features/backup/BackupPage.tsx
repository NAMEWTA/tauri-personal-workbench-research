import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { ArchiveRestore, DatabaseBackup, FolderOpen, Plus, Square, X } from 'lucide-react'
import {
  createBackup,
  createRestore,
  getBackupSettings,
  listBackups,
  preflightRestore,
  updateBackupSettings,
} from '../../generated/api/sdk.gen'
import { requireData } from '../../lib/http/client'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateView'
import { useJob } from '../jobs/useJob'

export function BackupPage() {
  const [jobId, setJobId] = useState<string>()
  const queryClient = useQueryClient()
  const tauriAvailable = '__TAURI_INTERNALS__' in window
  const query = useQuery({
    queryKey: ['backups'],
    queryFn: async () => requireData((await listBackups({ throwOnError: true })).data),
  })
  const settings = useQuery({
    queryKey: ['backup-settings'],
    queryFn: async () => requireData((await getBackupSettings({ throwOnError: true })).data),
  })
  const job = useJob(jobId)
  useEffect(() => {
    if (job.query.data?.state === 'succeeded' || job.query.data?.state === 'failed')
      void queryClient.invalidateQueries({ queryKey: ['backups'] })
  }, [job.query.data?.state, queryClient])
  const create = useMutation({
    mutationFn: async () => requireData((await createBackup({ throwOnError: true })).data),
    onSuccess: (value) => setJobId(value.id),
  })
  const configure = useMutation({
    mutationFn: async () => {
      if (!tauriAvailable) throw new Error('备份目录选择仅支持桌面端')
      const backupDirectory = await invoke<string | null>('select_backup_destination')
      if (!backupDirectory) return undefined
      return requireData(
        (await updateBackupSettings({ body: { backupDirectory }, throwOnError: true })).data,
      )
    },
    onSuccess: (value) => {
      if (value) queryClient.setQueryData(['backup-settings'], value)
    },
  })
  const disable = useMutation({
    mutationFn: async () =>
      requireData(
        (await updateBackupSettings({ body: { backupDirectory: '' }, throwOnError: true })).data,
      ),
    onSuccess: (value) => queryClient.setQueryData(['backup-settings'], value),
  })
  const restore = useMutation({
    mutationFn: async () => {
      if (!tauriAvailable) throw new Error('备份恢复仅支持桌面端')
      const source = await invoke<string | null>('select_backup_file')
      if (!source) return undefined
      const report = requireData(
        (await preflightRestore({ body: { source }, throwOnError: true })).data,
      )
      const size = (report.totalSize / 1024 / 1024).toFixed(1)
      const confirmed = window.confirm(
        `恢复“${report.workspaceName}”到新工作区？\nSchema ${report.schemaVersion} · ${report.fileCount} 个文件 · ${size} MB`,
      )
      if (!confirmed) return undefined
      const destination = await invoke<string | null>('select_workspace_directory')
      if (!destination) return undefined
      return requireData(
        (await createRestore({ body: { source, destination }, throwOnError: true })).data,
      )
    },
    onSuccess: (value) => {
      if (value) setJobId(value.id)
    },
  })
  const backupDirectory = settings.data?.backupDirectory ?? ''
  const running = create.isPending || restore.isPending || job.active
  const latestSuccess = query.data?.find((item) => item.state === 'succeeded')
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <span className="eyebrow">数据保护</span>
          <h1>备份</h1>
        </div>
        <button
          className="button primary"
          onClick={() => create.mutate()}
          disabled={running || !backupDirectory}
        >
          <Plus size={16} />
          {running ? '正在创建' : '立即备份'}
        </button>
      </div>
      <div className="backup-summary">
        <DatabaseBackup size={25} />
        <div>
          <strong>本地 ZIP 备份</strong>
          <span>{backupDirectory || '未配置备份目录'}</span>
        </div>
        <button
          className="button"
          onClick={() => configure.mutate()}
          disabled={!tauriAvailable || configure.isPending || running}
          title={tauriAvailable ? '选择备份目录' : '请在桌面端使用'}
        >
          <FolderOpen size={15} />
          {backupDirectory ? '更改目录' : '选择目录'}
        </button>
        {backupDirectory && (
          <button
            className="icon-button"
            onClick={() => disable.mutate()}
            disabled={disable.isPending || running}
            aria-label="停用自动备份"
            title="停用自动备份"
          >
            <X size={15} />
          </button>
        )}
      </div>
      {settings.isPending && <LoadingState label="正在读取备份设置…" />}
      <dl className="backup-policy">
        <div>
          <dt>上次成功</dt>
          <dd>
            {latestSuccess
              ? new Intl.DateTimeFormat('zh-CN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(latestSuccess.finishedAt ?? latestSuccess.startedAt))
              : '尚未备份'}
          </dd>
        </div>
        <div>
          <dt>自动计划</dt>
          <dd>{backupDirectory ? '每日首次启动 5 分钟后' : '未启用'}</dd>
        </div>
        <div>
          <dt>保留数量</dt>
          <dd>最近 10 份成功备份</dd>
        </div>
      </dl>
      {job.query.data && job.active && (
        <div className="job-progress">
          <div style={{ width: `${job.query.data.progress}%` }} />
          <span>
            {job.query.data.stage} · {job.query.data.progress}%
          </span>
          <button
            className="icon-button job-cancel"
            onClick={() => job.cancel.mutate()}
            disabled={job.cancel.isPending}
            aria-label="取消后台任务"
            title="取消后台任务"
          >
            <Square size={13} />
          </button>
        </div>
      )}
      <section>
        <div className="section-heading">
          <h2>备份历史</h2>
          <button
            className="button"
            onClick={() => restore.mutate()}
            disabled={!tauriAvailable || running}
            title={tauriAvailable ? '恢复到新工作区' : '请在桌面端使用'}
          >
            <ArchiveRestore size={15} />
            {restore.isPending ? '正在预检' : '恢复'}
          </button>
        </div>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data.length === 0 ? (
          <EmptyState
            title="还没有备份"
            detail={
              backupDirectory ? '创建第一份备份以保护当前工作区。' : '选择备份目录后即可启用。'
            }
          />
        ) : (
          <div className="backup-list">
            {query.data.map((item) => (
              <div key={item.id}>
                <span className={`backup-state ${item.state}`} />
                <span>
                  <strong>
                    {item.state === 'succeeded'
                      ? '备份成功'
                      : item.state === 'running'
                        ? '正在备份'
                        : '备份失败'}
                  </strong>
                  <small>
                    {new Intl.DateTimeFormat('zh-CN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(item.startedAt))}
                  </small>
                </span>
                <span>{item.size ? `${(item.size / 1024 / 1024).toFixed(1)} MB` : '—'}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      {(configure.isError || disable.isError || create.isError) && (
        <p className="form-error">备份目录不可用，请重新选择。</p>
      )}
      {restore.isError && <p className="form-error">备份未通过预检或目标目录不可用。</p>}
      {settings.isError && (
        <ErrorState error={settings.error} retry={() => void settings.refetch()} />
      )}
      {job.query.isError && <p className="form-error">后台任务状态读取失败，请重试。</p>}
      {job.cancel.isError && <p className="form-error">取消后台任务失败，请重试。</p>}
    </div>
  )
}
