import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cancelJob, getJob, getJobEvents } from '../../generated/api/sdk.gen'
import type { Job } from '../../generated/api/types.gen'
import { requireData } from '../../lib/http/client'

const active = (item?: Job) => item?.state === 'queued' || item?.state === 'running'

export function useJob(jobId?: string) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['jobs', jobId],
    queryFn: async () =>
      requireData((await getJob({ path: { jobId: jobId! }, throwOnError: true })).data),
    enabled: Boolean(jobId),
    refetchInterval: (state) => (active(state.state.data) ? 3_000 : false),
  })

  useEffect(() => {
    if (!jobId) return
    const controller = new AbortController()
    void (async () => {
      const { stream } = await getJobEvents({
        path: { jobId },
        signal: controller.signal,
        sseMaxRetryAttempts: 1,
      })
      for await (const update of stream) {
        queryClient.setQueryData(['jobs', jobId], update)
        if (!active(update)) break
      }
    })().catch(() => undefined)
    return () => controller.abort()
  }, [jobId, queryClient])

  const cancel = useMutation({
    mutationFn: async () =>
      requireData((await cancelJob({ path: { jobId: jobId! }, throwOnError: true })).data),
    onSuccess: (value) => queryClient.setQueryData(['jobs', jobId], value),
  })
  return { query, cancel, active: active(query.data) }
}
