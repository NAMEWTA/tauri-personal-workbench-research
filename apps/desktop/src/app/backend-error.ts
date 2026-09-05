const incompatibleWorkspacePattern =
  /(?:workspace\s+schema|schema\s+(?:is\s+)?incompatible|schema\s+version|数据库结构|工作区格式|不兼容|unsupported\s+(?:workspace|schema))/i

function errorText(error: unknown): string {
  if (typeof error === 'string') return error
  if (!error || typeof error !== 'object') return ''
  const value = error as { message?: unknown; detail?: unknown; error?: unknown }
  return [value.message, value.detail, value.error]
    .filter((item): item is string => typeof item === 'string')
    .join(' ')
}

export function isIncompatibleWorkspaceError(error: unknown): boolean {
  return incompatibleWorkspacePattern.test(errorText(error))
}

export function safeBackendErrorMessage(error: unknown): string {
  if (isIncompatibleWorkspaceError(error)) {
    return '旧工作区格式不受当前版本支持，请创建或选择当前格式的工作区。'
  }
  return '本地服务暂时不可用，请稍后重试，或创建或选择当前格式的工作区。'
}
