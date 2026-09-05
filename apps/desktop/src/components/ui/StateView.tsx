import { AlertCircle, Inbox, RefreshCw } from 'lucide-react'
import { safeErrorMessage } from './error-message'

export function LoadingState({ label = '正在读取…' }: { label?: string }) {
  return (
    <div className="state-view" aria-live="polite">
      <span className="spinner" />
      {label}
    </div>
  )
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="state-view empty">
      <Inbox size={24} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="state-view error">
      <AlertCircle size={24} />
      <strong>读取失败</strong>
      <span>{safeErrorMessage(error)}</span>
      {retry && (
        <button className="button" type="button" onClick={retry}>
          <RefreshCw size={15} />
          重试
        </button>
      )}
    </div>
  )
}
