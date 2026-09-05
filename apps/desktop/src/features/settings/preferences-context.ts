import { createContext, useContext } from 'react'

export const PreferencesFlushContext = createContext<(() => Promise<void>) | undefined>(undefined)

export function useFlushPreferences() {
  const flush = useContext(PreferencesFlushContext)
  if (!flush) throw new Error('PreferencesFlushContext is unavailable')
  return flush
}
