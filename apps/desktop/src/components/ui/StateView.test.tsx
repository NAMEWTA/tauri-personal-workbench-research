import { render, screen } from '@testing-library/react'
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
    render(<ErrorState error={new Error('连接失败')} />)
    expect(screen.getByText('连接失败')).toBeInTheDocument()
  })
})
