import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      retry: (count, error) => {
        const status = (error as { status?: number }).status
        return count < 1 && !(status && [400, 401, 403, 404].includes(status))
      },
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    },
    mutations: { networkMode: 'always', retry: false },
  },
})
