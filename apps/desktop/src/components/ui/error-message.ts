export function safeErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '请稍后重试。'
  const status = 'status' in error ? Number((error as { status?: unknown }).status) : undefined
  if (status === 401 || status === 403) return '没有权限执行此操作。'
  if (status === 404) return '请求的内容不存在。'
  if (status && status >= 400 && status < 500) return '请求参数无效。'
  return '服务暂时不可用，请稍后重试。'
}
