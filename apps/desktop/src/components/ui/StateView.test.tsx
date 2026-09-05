import { fireEvent, render, screen } from '@testing-library/react'
import { EmptyState, ErrorState, LoadingState } from './StateView'

describe('StateView', () => {
  it('announces loading', () => {
    render(<LoadingState label="读取档案" />)
    expect(screen.getByText('读取档案')).toBeInTheDocument()
  })
  it('shows empty state details', () => {
    render(<EmptyState title="没有档案" detail="新建第一份档案" />)
    expect(screen.getByText('没有档案')).toBeInTheDocument()
    expect(screen.getByText('新建第一份档案')).toBeInTheDocument()
  })
  it('shows safe error text', () => {
    const detail = 'SELECT secret FROM records at C:\\private\\workspace.db token=private-token'
    render(<ErrorState error={new Error(detail)} />)
    expect(screen.getByText('服务暂时不可用，请稍后重试。')).toBeInTheDocument()
    expect(screen.queryByText(detail)).not.toBeInTheDocument()
  })
  it.each([
    [401, '没有权限执行此操作。'],
    [403, '没有权限执行此操作。'],
    [404, '请求的内容不存在。'],
    [422, '请求参数无效。'],
    [500, '服务暂时不可用，请稍后重试。'],
  ])('uses a safe message for status %s and keeps retry available', (status, message) => {
    const retry = vi.fn()
    render(<ErrorState error={{ status, detail: 'SQL and private path' }} retry={retry} />)
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByText('SQL and private path')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
