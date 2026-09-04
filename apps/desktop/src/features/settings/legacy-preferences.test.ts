import type { Preferences } from '../../generated/api/types.gen'
import {
  clearLegacyPreferences,
  hasInvalidLegacyPreferences,
  legacyLayoutStorageKey,
  legacyRecentSearchesStorageKey,
  mergeLegacyPreferences,
  readLegacyPreferences,
} from './legacy-preferences'

const current: Preferences = {
  theme: 'system',
  sidebarCollapsed: false,
  inspectorWidth: 344,
  recentSearches: [],
}

describe('legacy preference migration', () => {
  beforeEach(() => localStorage.clear())

  it('reads the old Zustand layout and recent-search records with validation', () => {
    localStorage.setItem(
      legacyLayoutStorageKey,
      JSON.stringify({ state: { theme: 'dark', sidebarCollapsed: true, inspectorWidth: 999 } }),
    )
    localStorage.setItem(
      legacyRecentSearchesStorageKey,
      JSON.stringify([
        { id: 'archive-1', type: 'archive', title: '本地档案', subtitle: '档案' },
        { id: 'invalid', type: 'unknown', title: '忽略', subtitle: '忽略' },
      ]),
    )

    expect(readLegacyPreferences()).toEqual({
      theme: 'dark',
      sidebarCollapsed: true,
      inspectorWidth: 480,
      recentSearches: [{ id: 'archive-1', type: 'archive', title: '本地档案', subtitle: '档案' }],
    })
  })

  it('only merges values that are still at their SQLite defaults', () => {
    expect(
      mergeLegacyPreferences(current, {
        theme: 'dark',
        sidebarCollapsed: true,
        inspectorWidth: 400,
        recentSearches: [{ id: 'task-1', type: 'task', title: '本地任务', subtitle: '任务' }],
      }),
    ).toEqual({
      theme: 'dark',
      sidebarCollapsed: true,
      inspectorWidth: 400,
      recentSearches: [{ id: 'task-1', type: 'task', title: '本地任务', subtitle: '任务' }],
    })
    expect(
      mergeLegacyPreferences(
        {
          ...current,
          theme: 'light',
          recentSearches: [{ id: 'existing', type: 'task', title: '已存在', subtitle: '任务' }],
        },
        {
          theme: 'dark',
          recentSearches: [{ id: 'legacy', type: 'task', title: '旧记录', subtitle: '任务' }],
        },
      ),
    ).toEqual({})
    expect(
      mergeLegacyPreferences(
        current,
        {
          theme: 'dark',
          recentSearches: [{ id: 'task-1', type: 'task', title: '任务', subtitle: '任务' }],
        },
        true,
      ),
    ).toEqual({ recentSearches: [{ id: 'task-1', type: 'task', title: '任务', subtitle: '任务' }] })
  })

  it('clears old storage when explicitly requested', () => {
    localStorage.setItem(legacyLayoutStorageKey, '{not-json')
    localStorage.setItem(legacyRecentSearchesStorageKey, '[]')
    clearLegacyPreferences()
    expect(localStorage.getItem(legacyLayoutStorageKey)).toBeNull()
    expect(localStorage.getItem(legacyRecentSearchesStorageKey)).toBeNull()
  })

  it('keeps malformed payloads eligible for a later migration retry', () => {
    localStorage.setItem(legacyLayoutStorageKey, '{not-json')
    localStorage.setItem(legacyRecentSearchesStorageKey, '[]')
    expect(hasInvalidLegacyPreferences()).toBe(true)

    localStorage.setItem(legacyLayoutStorageKey, JSON.stringify({ state: {} }))
    expect(hasInvalidLegacyPreferences()).toBe(false)

    localStorage.setItem(legacyRecentSearchesStorageKey, 'null')
    expect(hasInvalidLegacyPreferences()).toBe(true)

    localStorage.setItem(
      legacyRecentSearchesStorageKey,
      JSON.stringify([{ id: 'task-1', type: 'task', title: '任务', subtitle: '任务' }]),
    )
    expect(hasInvalidLegacyPreferences()).toBe(false)

    localStorage.setItem(legacyLayoutStorageKey, '{still-not-json')
    expect(hasInvalidLegacyPreferences()).toBe(true)
  })
})
