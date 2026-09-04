import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Search, X } from 'lucide-react'
import { useState } from 'react'
import { ErrorState, LoadingState } from '../../components/ui/StateView'
import { archiveTypesQuery, archivesQuery } from './queries'
import { useDebouncedValue } from '../../lib/useDebouncedValue'

export function ArchivePicker({
  value,
  valueTitle,
  onChange,
  onOpen,
}: {
  value?: string | null
  valueTitle?: string
  onChange: (id: string | null, title?: string) => void
  onOpen?: (id: string) => void
}) {
  const [typeId, setTypeId] = useState('')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query)
  const types = useQuery(archiveTypesQuery)
  const archives = useQuery(archivesQuery(debouncedQuery, typeId, 'title', 30))
  return (
    <div className="archive-picker">
      {value && (
        <div className="picker-selection">
          <strong>{valueTitle || '已关联档案'}</strong>
          <div>
            {onOpen && (
              <button
                type="button"
                className="icon-button"
                onClick={() => onOpen(value)}
                aria-label="打开档案"
              >
                <ExternalLink size={14} />
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              onClick={() => onChange(null)}
              aria-label="取消关联"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      {types.isPending ? (
        <div className="picker-state">
          <LoadingState label="正在读取档案类型…" />
        </div>
      ) : types.isError ? (
        <div className="picker-state">
          <ErrorState error={types.error} retry={() => void types.refetch()} />
        </div>
      ) : (
        <div className="segmented picker-types" aria-label="按档案类型筛选">
          <button type="button" className={!typeId ? 'active' : ''} onClick={() => setTypeId('')}>
            全部
          </button>
          {types.data.map((item) => (
            <button
              type="button"
              key={item.id}
              className={typeId === item.id ? 'active' : ''}
              onClick={() => setTypeId(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      <label className="search-field compact-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="按档案标题搜索"
        />
      </label>
      <div className="picker-results">
        {archives.isPending ? (
          <LoadingState label="正在搜索档案…" />
        ) : archives.isError ? (
          <ErrorState error={archives.error} retry={() => void archives.refetch()} />
        ) : (
          <>
            {archives.data.items.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === value ? 'active' : ''}
                onClick={() => onChange(item.id, item.title)}
              >
                <span style={{ backgroundColor: item.typeColor }} />
                <strong>{item.title}</strong>
                <small>{item.typeName}</small>
              </button>
            ))}
            {archives.data.items.length === 0 && <p className="quiet-empty">没有匹配档案。</p>}
          </>
        )}
      </div>
    </div>
  )
}
