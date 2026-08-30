import { Link, Outlet, useLocation } from '@tanstack/react-router'
import {
  Archive,
  CalendarDays,
  CheckSquare2,
  ChevronLeft,
  DatabaseBackup,
  Menu,
  PanelRight,
  Search,
  Settings,
  SunMedium,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useBackend } from '../../app/backend-context'
import { useLayoutStore } from '../../stores/layout'
import { CommandPalette } from './CommandPalette'
import { InspectorPanel } from './InspectorPanel'

const navigation = [
  { to: '/today', label: '今日', icon: SunMedium },
  { to: '/tasks', label: '任务', icon: CheckSquare2 },
  { to: '/calendar', label: '日历', icon: CalendarDays },
  { to: '/archives', label: '档案', icon: Archive },
  { to: '/backup', label: '备份', icon: DatabaseBackup },
  { to: '/trash', label: '回收站', icon: Trash2 },
] as const

export function AppShell() {
  const { meta } = useBackend()
  const location = useLocation()
  const {
    sidebarCollapsed,
    inspectorOpen,
    inspectorWidth,
    selection,
    theme,
    toggleSidebar,
    toggleInspector,
    setInspectorWidth,
  } = useLayoutStore()
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const dark =
      theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [theme])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const active = location.pathname.startsWith('/settings')
    ? { label: '设置' }
    : navigation.find((item) => location.pathname.startsWith(item.to))

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${inspectorOpen ? 'inspector-visible' : ''}`}
      style={{ '--inspector-width': `${inspectorWidth}px` } as React.CSSProperties}
    >
      <header className="command-bar">
        <button
          className="icon-button"
          onClick={toggleSidebar}
          title="切换侧栏"
          aria-label="切换侧栏"
        >
          <Menu size={18} />
        </button>
        <div className="command-title">
          <span>{active?.label ?? '个人工作台'}</span>
          <small>{meta.workspaceName}</small>
        </div>
        <button className="search-trigger" onClick={() => setPaletteOpen(true)}>
          <Search size={16} />
          <span>搜索档案和任务</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button
          className={`icon-button ${inspectorOpen ? 'active' : ''}`}
          onClick={toggleInspector}
          disabled={!selection}
          title={selection ? '切换检查器' : '选择任务或档案后查看详情'}
          aria-label="切换检查器"
        >
          <PanelRight size={18} />
        </button>
      </header>
      <aside className="sidebar">
        <div className="workspace-brand">
          <span className="brand-mark">工</span>
          <div>
            <strong>个人工作台</strong>
            <small>{meta.workspaceName}</small>
          </div>
        </div>
        <nav aria-label="主导航">
          {navigation.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} activeProps={{ className: 'active' }} title={label}>
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          ))}
          <Link
            to="/settings/$section"
            params={{ section: 'general' }}
            activeProps={{ className: 'active' }}
            title="设置"
          >
            <Settings size={18} />
            <span>设置</span>
          </Link>
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" />
          <span>本地服务 {meta.serviceVersion}</span>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
      {inspectorOpen && (
        <aside className="inspector">
          <div
            className="inspector-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整检查器宽度"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              const startX = event.clientX
              const startWidth = inspectorWidth
              const move = (moveEvent: PointerEvent) =>
                setInspectorWidth(startWidth + startX - moveEvent.clientX)
              const stop = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', stop)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', stop)
            }}
          />
          <div className="inspector-heading">
            <strong>检查器</strong>
            <button className="icon-button" onClick={toggleInspector} aria-label="关闭检查器">
              <ChevronLeft size={17} />
            </button>
          </div>
          <div className="inspector-body">
            <InspectorPanel />
          </div>
        </aside>
      )}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
