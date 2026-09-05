import { render, screen } from '@testing-library/react'
import { RootErrorBoundary } from './RootErrorBoundary'

describe('RootErrorBoundary', () => {
  it('renders a recovery action without exposing an internal exception', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const detail = 'SELECT secret FROM records at C:\\private\\workspace.db'
    function BrokenView(): never {
      throw new Error(detail)
    }
    try {
      render(
        <RootErrorBoundary>
          <BrokenView />
        </RootErrorBoundary>,
      )
      expect(screen.getByRole('heading', { name: '界面遇到问题' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '重新载入' })).toBeInTheDocument()
      expect(screen.getByText('服务暂时不可用，请稍后重试。')).toBeInTheDocument()
      expect(screen.queryByText(detail)).not.toBeInTheDocument()
    } finally {
      log.mockRestore()
    }
  })
})
