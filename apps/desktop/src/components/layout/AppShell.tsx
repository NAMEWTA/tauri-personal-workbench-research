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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBackend } from '../../app/backend-context'
import { useLayoutStore } from '../../stores/layout'
import { usePreferences, useUpdatePreferences } from '../../features/settings/preferences'
import type { PreferencesUpdate } from '../../generated/api/types.gen'
import {
  clearLegacyPreferences,
  hasLegacyPreferences,
  hasInvalidLegacyPreferences,
  mergeLegacyPreferences,
  readLegacyPreferences,
} from '../../features/settings/legacy-preferences'
import { CommandPalette } from './CommandPalette'
import { InspectorPanel } from './InspectorPanel'
import { ReminderScheduler } from '../../features/tasks/ReminderScheduler'

const navigation = [
  { to: '/today', label: '今日', icon: SunMedium },
  { to: '/tasks', label: '任务', icon: CheckSquare2 },
  { to: '/calendar', label: '日历', icon: CalendarDays },
  { to: '/archives', label: '档案', icon: Archive },
  { to: '/backup', label: '备份', icon: DatabaseBackup },
  { to: '/trash', label: '回收站', icon: Trash2 },
] as const

type LayoutPreferences = {
  theme: 'light' | 'dark' | 'system'
  sidebarCollapsed: boolean
  inspectorWidth: number
}

function selectLayoutPreferences(
  state: ReturnType<typeof useLayoutStore.getState>,
): LayoutPreferences {
  return {
    theme: state.theme,
    sidebarCollapsed: state.sidebarCollapsed,
    inspectorWidth: state.inspectorWidth,
  }
}

function sameLayoutPreferences(first: LayoutPreferences, second: LayoutPreferences) {
  return (
    first.theme === second.theme &&
    first.sidebarCollapsed === second.sidebarCollapsed &&
    first.inspectorWidth === second.inspectorWidth
  )
}

export function AppShell() {
  const { meta } = useBackend()
  const preferences = usePreferences()
  const {
    mutate: savePreferences,
    isPending: preferencesSavePending,
    isError: preferencesSaveError,
  } = useUpdatePreferences()
  const applyingPreferences = useRef(false)
  const preferencesReady = useRef(false)
  const localChangeBeforeHydration = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
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

  const queuePreferencesSave = useCallback(
    (next: LayoutPreferences) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        savePreferences(next)
        saveTimer.current = undefined
      }, 250)
    },
    [savePreferences],
  )

  useEffect(() => {
    let previous = selectLayoutPreferences(useLayoutStore.getState())
    const unsubscribe = useLayoutStore.subscribe((state) => {
      const next = selectLayoutPreferences(state)
      if (sameLayoutPreferences(previous, next)) return
      previous = next
      if (applyingPreferences.current) return
      if (!preferencesReady.current) {
        localChangeBeforeHydration.current = true
        return
      }
      queuePreferencesSave(next)
    })
    return () => {
      unsubscribe()
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [queuePreferencesSave])

  useEffect(() => {
    if (!preferences.data || preferencesReady.current) return
    const current = selectLayoutPreferences(useLayoutStore.getState())
    const serverPreferences: LayoutPreferences = {
      theme: preferences.data.theme,
      sidebarCollapsed: preferences.data.sidebarCollapsed,
      inspectorWidth: preferences.data.inspectorWidth,
    }
    const legacyExists = hasLegacyPreferences()
    const legacyInvalid = hasInvalidLegacyPreferences()
    const legacy = legacyExists ? readLegacyPreferences() : undefined
    const localChanged = localChangeBeforeHydration.current
    const migrated = legacy
      ? mergeLegacyPreferences(preferences.data, legacy, localChanged)
      : undefined
    const clearMigratedLegacy = () => {
      if (!legacyInvalid) clearLegacyPreferences()
    }
    preferencesReady.current = true
    localChangeBeforeHydration.current = false
    if (localChanged) {
      const update: PreferencesUpdate = sameLayoutPreferences(current, serverPreferences)
        ? {}
        : current
      if (migrated?.recentSearches?.length) update.recentSearches = migrated.recentSearches
      if (Object.keys(update).length > 0) {
        savePreferences(update, { onSuccess: clearMigratedLegacy })
      } else if (legacyExists && !legacyInvalid) {
        clearLegacyPreferences()
      }
      return
    }
    if (!legacy) {
      if (legacyExists && !legacyInvalid) clearLegacyPreferences()
      if (sameLayoutPreferences(current, serverPreferences)) return
      applyingPreferences.current = true
      useLayoutStore.getState().applyPreferences(serverPreferences)
      applyingPreferences.current = false
      return
    }
    const next: LayoutPreferences = {
      theme: migrated?.theme ?? serverPreferences.theme,
      sidebarCollapsed: migrated?.sidebarCollapsed ?? serverPreferences.sidebarCollapsed,
      inspectorWidth: migrated?.inspectorWidth ?? serverPreferences.inspectorWidth,
    }
    if (!sameLayoutPreferences(current, next)) {
      applyingPreferences.current = true
      useLayoutStore.getState().applyPreferences(next)
      applyingPreferences.current = false
    }
    if (migrated && Object.keys(migrated).length > 0) {
      savePreferences(migrated, { onSuccess: clearMigratedLegacy })
    } else if (legacyExists && !legacyInvalid) {
      clearLegacyPreferences()
    }
  }, [preferences.data, queuePreferencesSave, savePreferences])

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

  const active =
    location.pathname.startsWith('/settings') || location.pathname === '/diagnostics'
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
        {preferencesSavePending && (
          <span className="save-status" role="status" aria-live="polite">
            保存中
          </span>
        )}
        {preferencesSaveError && (
          <span className="save-status error" role="alert">
            偏好保存失败
          </span>
        )}
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
            className={location.pathname === '/diagnostics' ? 'active' : undefined}
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
      <ReminderScheduler />
    </div>
  )
}
