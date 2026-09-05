import { queryOptions } from '@tanstack/react-query'
import {
  getArchiveRecord,
  listArchiveRecords,
  listArchiveCollections,
} from '../../generated/api/sdk.gen'
import { requireData } from '../../lib/http/client'
export const archiveKeys = {
  all: ['archives'] as const,
  list: (q: string, type = '', sort = 'updated', limit = 50, offset = 0) =>
    ['archives', 'list', q, type, sort, limit, offset] as const,
  detail: (id: string) => ['archives', 'detail', id] as const,
  types: ['archives', 'types'] as const,
}
export const archivesQuery = (q: string, type = '', sort = 'updated', limit = 50, offset = 0) =>
  queryOptions({
    queryKey: archiveKeys.list(q, type, sort, limit, offset),
    queryFn: async () =>
      requireData(
        (
          await listArchiveRecords({
            query: {
              q,
              collectionId: type || undefined,
              sort: sort as 'updated' | 'title',
              limit,
              offset,
            },
            throwOnError: true,
          })
        ).data,
      ),
  })
export const archiveQuery = (id: string) =>
  queryOptions({
    queryKey: archiveKeys.detail(id),
    queryFn: async () =>
      requireData((await getArchiveRecord({ path: { recordId: id }, throwOnError: true })).data),
  })
export const archiveTypesQuery = queryOptions({
  queryKey: archiveKeys.types,
  queryFn: async () => requireData((await listArchiveCollections({ throwOnError: true })).data),
  staleTime: 30_000,
})
