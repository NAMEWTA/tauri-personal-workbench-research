import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Archive, Grid2X2, List, Plus, Search, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateView'
import { ArchiveForm } from './ArchiveForm'
import { archiveTypesQuery, archivesQuery } from './queries'

export function ArchivesPage() {
  const [q, setQ] = useState('')
  const [typeId, setTypeId] = useState('')
  const [sort, setSort] = useState<'updated' | 'title'>('updated')
  const [offset, setOffset] = useState(0)
  const [mode, setMode] = useState<'table' | 'grid'>('table')
  const [form, setForm] = useState(false)
  const limit = 50
  const types = useQuery(archiveTypesQuery)
  const query = useQuery(archivesQuery(q, typeId, sort, limit, offset))
  const items = query.data?.items ?? []
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <span className="eyebrow">统一资料库</span>
          <h1>档案</h1>
        </div>
        <div className="header-actions">
          <Link className="button" to="/archive-types">
            <Settings2 size={16} />
            档案类型
          </Link>
          <button className="button primary" onClick={() => setForm(true)}>
            <Plus size={16} />
            新建档案
          </button>
        </div>
      </div>
      <div className="filter-bar">
        <label className="search-field">
          <Search size={16} />
          <input
            value={q}
            onChange={(event) => {
              setQ(event.target.value)
              setOffset(0)
            }}
            placeholder="搜索名称或摘要"
            aria-label="搜索档案"
          />
        </label>
        <select
          aria-label="档案排序"
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
        >
          <option value="updated">最近更新</option>
          <option value="title">按名称</option>
        </select>
        <div className="icon-segment">
          <button
            className={mode === 'table' ? 'active' : ''}
            onClick={() => setMode('table')}
            aria-label="列表视图"
          >
            <List size={17} />
          </button>
          <button
            className={mode === 'grid' ? 'active' : ''}
            onClick={() => setMode('grid')}
            aria-label="卡片视图"
          >
            <Grid2X2 size={17} />
          </button>
        </div>
      </div>
      <div className="segmented archive-type-tabs" aria-label="档案类型">
        <button
          className={!typeId ? 'active' : ''}
          onClick={() => {
            setTypeId('')
            setOffset(0)
          }}
        >
          全部
        </button>
        {types.data?.map((item) => (
          <button
            key={item.id}
            className={typeId === item.id ? 'active' : ''}
            onClick={() => {
              setTypeId(item.id)
              setOffset(0)
            }}
          >
            {item.name}
          </button>
        ))}
      </div>
      <section className="list-section">
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title="没有匹配的档案" detail="选择一种档案类型来集中管理资料。" />
        ) : (
          <div className={`archive-list ${mode}`}>
            {items.map((item) => (
              <Link key={item.id} to="/archives/$archiveId" params={{ archiveId: item.id }}>
                <span
                  className="archive-icon"
                  style={{ backgroundColor: `${item.typeColor}20`, color: item.typeColor }}
                >
                  <Archive size={18} />
                </span>
                <span className="archive-title">
                  <strong>{item.title}</strong>
                  <small>{item.summary || '暂无摘要'}</small>
                </span>
                <span className="archive-type">{item.typeName}</span>
                <time>
                  {new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(
                    new Date(item.updatedAt),
                  )}
                </time>
              </Link>
            ))}
          </div>
        )}
      </section>
      {query.data && query.data.total > limit && (
        <div className="pagination">
          <span>共 {query.data.total} 条</span>
          <button
            className="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            上一页
          </button>
          <button
            className="button"
            disabled={offset + limit >= query.data.total}
            onClick={() => setOffset(offset + limit)}
          >
            下一页
          </button>
        </div>
      )}
      {form && <ArchiveForm onClose={() => setForm(false)} />}
    </div>
  )
}
