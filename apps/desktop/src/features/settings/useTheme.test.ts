import { act, cleanup, renderHook } from '@testing-library/react'
import { useTheme } from './useTheme'

describe('useTheme', () => {
  let media: EventTarget & { matches: boolean }

  beforeEach(() => {
    media = Object.assign(new EventTarget(), { matches: false })
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media),
    )
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    delete document.documentElement.dataset.theme
  })

  it('tracks system changes and removes its listener on unmount', () => {
    const { unmount } = renderHook(() => useTheme('system'))
    expect(document.documentElement.dataset.theme).toBe('light')
    act(() => {
      media.matches = true
      media.dispatchEvent(new Event('change'))
    })
    expect(document.documentElement.dataset.theme).toBe('dark')
    unmount()
    act(() => {
      media.matches = false
      media.dispatchEvent(new Event('change'))
    })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('keeps an explicit theme and resumes following the system when selected', () => {
    const { rerender } = renderHook(
      ({ theme }: { theme: 'light' | 'dark' | 'system' }) => useTheme(theme),
      { initialProps: { theme: 'dark' } },
    )
    act(() => {
      media.dispatchEvent(new Event('change'))
    })
    expect(document.documentElement.dataset.theme).toBe('dark')
    rerender({ theme: 'system' })
    expect(document.documentElement.dataset.theme).toBe('light')
    rerender({ theme: 'light' })
    act(() => {
      media.matches = true
      media.dispatchEvent(new Event('change'))
    })
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
