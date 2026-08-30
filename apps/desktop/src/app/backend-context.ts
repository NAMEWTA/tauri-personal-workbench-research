import { createContext, useContext } from 'react'
import type { Meta } from '../generated/api/types.gen'
import type { BackendConnection } from '../lib/http/client'

export type BackendState = { connection: BackendConnection; meta: Meta }
export const BackendContext = createContext<BackendState | null>(null)

export function useBackend() {
  const value = useContext(BackendContext)
  if (!value) throw new Error('BackendContext is unavailable')
  return value
}
