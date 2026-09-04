import type { Preferences, PreferencesUpdate, RecentSearch } from '../../generated/api/types.gen'

export const legacyLayoutStorageKey = 'workbench-layout'
export const legacyRecentSearchesStorageKey = 'workbench-recent-search-results'

type LegacyStorage = Pick<Storage, 'getItem' | 'removeItem'>

const themes = new Set<Preferences['theme']>(['light', 'dark', 'system'])

function getStorage(storage?: LegacyStorage): LegacyStorage | undefined {
  if (storage) return storage
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function parse(raw: string | null): unknown {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function readLayout(
  raw: string | null,
): Pick<PreferencesUpdate, 'theme' | 'sidebarCollapsed' | 'inspectorWidth'> {
  const parsed = record(parse(raw))
  const state = record(parsed?.state) ?? parsed
  if (!state) return {}
  const result: Pick<PreferencesUpdate, 'theme' | 'sidebarCollapsed' | 'inspectorWidth'> = {}
  if (typeof state.theme === 'string' && themes.has(state.theme as Preferences['theme'])) {
    result.theme = state.theme as Preferences['theme']
  }
  if (typeof state.sidebarCollapsed === 'boolean') result.sidebarCollapsed = state.sidebarCollapsed
  if (typeof state.inspectorWidth === 'number' && Number.isFinite(state.inspectorWidth)) {
    result.inspectorWidth = Math.min(480, Math.max(300, Math.round(state.inspectorWidth)))
  }
  return result
}

function readRecentSearches(raw: string | null): RecentSearch[] | undefined {
  const parsed = parse(raw)
  const values = Array.isArray(parsed) ? parsed : record(record(parsed)?.state)?.recentSearches
  if (!Array.isArray(values)) return undefined
  const result = values
    .filter((value): value is Record<string, unknown> => {
      const item = record(value)
      return (
        item !== undefined &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.subtitle === 'string' &&
        (item.type === 'archive' || item.type === 'task' || item.type === 'attachment')
      )
    })
    .slice(0, 8)
    .map((item) => ({
      id: item.id as string,
      type: item.type as RecentSearch['type'],
      title: item.title as string,
      subtitle: item.subtitle as string,
    }))
  return result
}

export function hasLegacyPreferences(storage?: LegacyStorage): boolean {
  const source = getStorage(storage)
  if (!source) return false
  try {
    return (
      source.getItem(legacyLayoutStorageKey) !== null ||
      source.getItem(legacyRecentSearchesStorageKey) !== null
    )
  } catch {
    return false
  }
}

export function hasInvalidLegacyPreferences(storage?: LegacyStorage): boolean {
  const source = getStorage(storage)
  if (!source) return false
  try {
    const layoutRaw = source.getItem(legacyLayoutStorageKey)
    const recentRaw = source.getItem(legacyRecentSearchesStorageKey)
    return !isLegacyLayoutPayload(layoutRaw) || !isLegacyRecentSearchesPayload(recentRaw)
  } catch {
    return true
  }
}

function isLegacyLayoutPayload(raw: string | null): boolean {
  if (raw === null) return true
  return record(parse(raw)) !== undefined
}

function isLegacyRecentSearchesPayload(raw: string | null): boolean {
  if (raw === null) return true
  const parsed = parse(raw)
  return Array.isArray(parsed) || record(parsed) !== undefined
}

export function readLegacyPreferences(storage?: LegacyStorage): PreferencesUpdate | undefined {
  const source = getStorage(storage)
  if (!source) return undefined
  try {
    const update: PreferencesUpdate = readLayout(source.getItem(legacyLayoutStorageKey))
    const recentSearches = readRecentSearches(source.getItem(legacyRecentSearchesStorageKey))
    if (recentSearches !== undefined) update.recentSearches = recentSearches
    return Object.keys(update).length > 0 ? update : undefined
  } catch {
    return undefined
  }
}

export function mergeLegacyPreferences(
  current: Preferences,
  legacy: PreferencesUpdate,
  localLayoutChanged = false,
): PreferencesUpdate {
  const update: PreferencesUpdate = {}
  if (!localLayoutChanged) {
    if (current.theme === 'system' && legacy.theme !== undefined && legacy.theme !== current.theme)
      update.theme = legacy.theme
    if (
      !current.sidebarCollapsed &&
      legacy.sidebarCollapsed !== undefined &&
      legacy.sidebarCollapsed !== current.sidebarCollapsed
    )
      update.sidebarCollapsed = legacy.sidebarCollapsed
    if (
      current.inspectorWidth === 344 &&
      legacy.inspectorWidth !== undefined &&
      legacy.inspectorWidth !== current.inspectorWidth
    )
      update.inspectorWidth = legacy.inspectorWidth
  }
  if (current.recentSearches.length === 0 && legacy.recentSearches?.length) {
    update.recentSearches = legacy.recentSearches
  }
  return update
}

export function clearLegacyPreferences(storage?: LegacyStorage): void {
  const source = getStorage(storage)
  if (!source) return
  try {
    source.removeItem(legacyLayoutStorageKey)
    source.removeItem(legacyRecentSearchesStorageKey)
  } catch {
    // Browser storage can be unavailable or read-only; SQLite remains authoritative.
  }
}
