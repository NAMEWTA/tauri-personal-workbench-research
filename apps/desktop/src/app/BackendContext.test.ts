import { configureApi, clearApi } from '../lib/http/client'
import { validateLocalBackendUrl } from './backend-url'

describe('validateLocalBackendUrl', () => {
  it('accepts the sidecar loopback host', () => {
    expect(() => validateLocalBackendUrl('http://127.0.0.1:49152')).not.toThrow()
  })

  it('rejects remote hosts, alternate loopback names, and malformed URLs', () => {
    expect(() => validateLocalBackendUrl('https://example.com')).toThrow('只能连接本机回环地址')
    expect(() => validateLocalBackendUrl('http://localhost:49152')).toThrow('只能连接本机回环地址')
    expect(() => validateLocalBackendUrl('http://[::1]:49152')).toThrow('只能连接本机回环地址')
    expect(() => validateLocalBackendUrl('https://localhost:49152')).toThrow('只能连接本机回环地址')
    expect(() => validateLocalBackendUrl('http://user:secret@127.0.0.1:49152')).toThrow(
      '只能连接本机回环地址',
    )
    expect(() => validateLocalBackendUrl('not-a-url')).toThrow('地址无效')
  })

  it('requires an explicit sidecar port and root path', () => {
    expect(() => validateLocalBackendUrl('http://127.0.0.1')).toThrow('显式提供 sidecar 端口')
    expect(() => validateLocalBackendUrl('http://127.0.0.1:0')).toThrow('显式提供 sidecar 端口')
    expect(() => validateLocalBackendUrl('http://127.0.0.1:65536')).toThrow()
    expect(() => validateLocalBackendUrl('http://127.0.0.1:49152/api')).toThrow('根地址')
    expect(() => validateLocalBackendUrl('http://127.0.0.1:49152/?proxy=1')).toThrow('根地址')
  })

  it('protects the shared API client from remote connections', () => {
    expect(() =>
      configureApi(
        {
          baseUrl: 'https://example.com',
          token: 'token',
          protocolVersion: 2,
          serviceVersion: 'test',
        },
        () => undefined,
      ),
    ).toThrow('只能连接本机回环地址')
    clearApi()
  })
})
