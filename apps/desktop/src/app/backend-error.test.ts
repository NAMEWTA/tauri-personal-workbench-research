import { isIncompatibleWorkspaceError, safeBackendErrorMessage } from './backend-error'

describe('backend startup error summaries', () => {
  it.each([
    'workspace schema 1 is incompatible with the current workspace schema 2',
    'workspace schema is incompatible',
    '旧数据库结构不受支持',
    { message: 'unsupported workspace schema version' },
  ])('recognizes an incompatible workspace: %s', (error) => {
    expect(isIncompatibleWorkspaceError(error)).toBe(true)
    expect(safeBackendErrorMessage(error)).toBe(
      '旧工作区格式不受当前版本支持，请创建或选择当前格式的工作区。',
    )
  })

  it('never exposes paths, SQL, tokens, or raw backend details', () => {
    const error = new Error(
      'open C:\\Users\\private\\workbench.sqlite3: SELECT token FROM secrets: token=abc',
    )
    const message = safeBackendErrorMessage(error)
    expect(message).toBe('本地服务暂时不可用，请稍后重试，或创建或选择当前格式的工作区。')
    expect(message).not.toContain('workbench.sqlite3')
    expect(message).not.toContain('token')
    expect(message).not.toContain('SELECT')
  })

  it('handles recovery errors represented as strings or unknown values', () => {
    expect(safeBackendErrorMessage('schema version is unsupported')).toContain('旧工作区格式')
    expect(safeBackendErrorMessage(undefined)).toContain('本地服务暂时不可用')
  })
})
