import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { ArchiveRestore, DatabaseBackup, Plus, Square } from 'lucide-react'
import {
  createBackup,
  createRestore,
  listBackups,
  preflightRestore,
} from '../../generated/api/sdk.gen'
import { requireData } from '../../lib/http/client'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateView'
import { useJob } from '../jobs/useJob'

export function BackupPage() {
  const [jobId, setJobId] = useState<string>()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['backups'],
    queryFn: async () => requireData((await listBackups({ throwOnError: true })).data),
  })
  const job = useJob(jobId)
  useEffect(() => {
    if (job.query.data?.state === 'succeeded' || job.query.data?.state === 'failed')
      void queryClient.invalidateQueries({ queryKey: ['backups'] })
  }, [job.query.data?.state, queryClient])
  const create = useMutation({
    mutationFn: async () =>
      requireData((await createBackup({ body: {}, throwOnError: true })).data),
    onSuccess: (value) => setJobId(value.id),
  })
  const restore = useMutation({
    mutationFn: async () => {
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
  const running = create.isPending || restore.isPending || job.active
  const latestSuccess = query.data?.find((item) => item.state === 'succeeded')
  const backupDirectory = latestSuccess?.path
    ? latestSuccess.path.slice(
        0,
        Math.max(latestSuccess.path.lastIndexOf('/'), latestSuccess.path.lastIndexOf('\\')),
      )
    : '工作区 backups 目录'
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <span className="eyebrow">数据保护</span>
          <h1>备份</h1>
        </div>
        <button className="button primary" onClick={() => create.mutate()} disabled={running}>
          <Plus size={16} />
          {running ? '正在创建' : '立即备份'}
        </button>
      </div>
      <div className="backup-summary">
        <DatabaseBackup size={25} />
        <div>
          <strong>本地 ZIP 备份</strong>
          <span>{backupDirectory}</span>
        </div>
      </div>
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
          <dd>每日首次启动 5 分钟后</dd>
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
          <button className="button" onClick={() => restore.mutate()} disabled={running}>
            <ArchiveRestore size={15} />
            {restore.isPending ? '正在预检' : '恢复'}
          </button>
        </div>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data.length === 0 ? (
          <EmptyState title="还没有备份" detail="创建第一份备份以保护当前工作区。" />
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
      {restore.isError && <p className="form-error">备份未通过预检或目标目录不可用。</p>}
    </div>
  )
}
