export function validateLocalBackendUrl(rawUrl: string): void {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('本地开发后端地址无效')
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error('开发后端只能连接本机回环地址')
  }
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('开发后端必须显式提供 sidecar 端口')
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error('开发后端只能连接本机 sidecar 根地址')
  }
}
