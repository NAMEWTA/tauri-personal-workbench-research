import { useEffect } from 'react'

export function useTheme(theme: 'light' | 'dark' | 'system' | 'paper') {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'paper'
          ? 'paper'
          : theme === 'dark' || (theme === 'system' && media.matches)
            ? 'dark'
            : 'light'
    }
    apply()
    if (theme === 'system') media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}
