import { client } from '../../generated/api/client.gen'

export type BackendConnection = {
  baseUrl: string
  token: string
  protocolVersion: number
  serviceVersion: string
}

let requestInterceptor: number | undefined
let unauthorizedHandler: (() => void) | undefined

export function configureApi(connection: BackendConnection, onUnauthorized: () => void) {
  unauthorizedHandler = onUnauthorized
  client.setConfig({
    baseUrl: connection.baseUrl,
    auth: connection.token,
    throwOnError: true,
  })
  if (requestInterceptor !== undefined) client.interceptors.request.eject(requestInterceptor)
  requestInterceptor = client.interceptors.request.use((request) => {
    request.headers.set('X-Request-ID', crypto.randomUUID())
    return request
  })
}

client.interceptors.response.use((response) => {
  if (response.status === 401) unauthorizedHandler?.()
  return response
})

export function clearApi() {
  client.setConfig({ baseUrl: '', auth: undefined })
  unauthorizedHandler = undefined
}

export function requireData<T>(data: T | undefined): T {
  if (data === undefined) throw new Error('服务返回了空响应')
  return data
}
