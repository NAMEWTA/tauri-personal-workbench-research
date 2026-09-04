import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Archive, CheckSquare2, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { search } from '../../generated/api/sdk.gen'
import type { SearchResult } from '../../generated/api/types.gen'
import { requireData } from '../../lib/http/client'
import { useLayoutStore } from '../../stores/layout'
import { preferencesKey, usePreferences } from '../../features/settings/preferences'
import { updatePreferences } from '../../generated/api/sdk.gen'
import { ErrorState } from '../ui/StateView'

const icons = { archive: Archive, task: CheckSquare2, attachment: Archive }
const groupLabels = { archive: '档案', task: '任务', attachment: '附件' }
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const preferences = usePreferences()
  const selectTask = useLayoutStore((state) => state.selectTask)
  const recent = preferences.data?.recentSearches ?? []
  const saveRecent = useMutation({
    mutationFn: async (recentSearches: SearchResult[]) =>
      requireData((await updatePreferences({ body: { recentSearches }, throwOnError: true })).data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: preferencesKey }),
  })
  const results = useQuery({
    queryKey: ['search', query],
    queryFn: async () =>
      requireData((await search({ query: { q: query }, throwOnError: true })).data),
    enabled: open && query.trim().length > 0,
  })

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0)
  }, [open])
  if (!open) return null

  const select = (item: SearchResult) => {
    const next = [
      item,
      ...recent.filter((value) => value.id !== item.id || value.type !== item.type),
    ].slice(0, 8)
    saveRecent.mutate(next)
    onClose()
    if (item.type === 'archive' || item.type === 'attachment')
      void navigate({ to: '/archives/$archiveId', params: { archiveId: item.id } })
    else {
      void navigate({ to: '/tasks' })
      selectTask(item.id)
    }
  }
  const renderItem = (item: SearchResult) => {
    const Icon = icons[item.type]
    return (
      <button key={`${item.type}-${item.id}`} onClick={() => select(item)}>
        <Icon size={17} />
        <span>
          <strong>{item.title}</strong>
          <small>{item.subtitle || groupLabels[item.type]}</small>
        </span>
      </button>
    )
  }
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input">
          <Search size={19} />
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入关键词"
            aria-label="搜索关键词"
          />
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>
        <div className="palette-results">
          {query === '' && recent.length === 0 && <p className="palette-hint">暂无最近打开项。</p>}
          {query === '' && recent.length > 0 && (
            <div className="palette-group">
              <span>最近打开</span>
              {recent.map(renderItem)}
            </div>
          )}
          {results.isFetching && <p className="palette-hint">正在搜索…</p>}
          {results.isError && (
            <ErrorState error={results.error} retry={() => void results.refetch()} />
          )}
          {query !== '' &&
            (Object.keys(groupLabels) as Array<SearchResult['type']>).map((type) => {
              const items = results.data?.filter((item) => item.type === type) ?? []
              return items.length ? (
                <div className="palette-group" key={type}>
                  <span>{groupLabels[type]}</span>
                  {items.map(renderItem)}
                </div>
              ) : null
            })}
          {results.data?.length === 0 && <p className="palette-hint">没有找到匹配内容。</p>}
        </div>
      </section>
    </div>
  )
}
