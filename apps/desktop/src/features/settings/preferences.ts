import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getPreferences, updatePreferences } from '../../generated/api/sdk.gen'
import type { PreferencesUpdate } from '../../generated/api/types.gen'
import { requireData } from '../../lib/http/client'

export const preferencesKey = ['preferences'] as const

export function usePreferences() {
  return useQuery({
    queryKey: preferencesKey,
    queryFn: async () => requireData((await getPreferences({ throwOnError: true })).data),
  })
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: PreferencesUpdate) =>
      requireData((await updatePreferences({ body, throwOnError: true })).data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: preferencesKey }),
  })
}
