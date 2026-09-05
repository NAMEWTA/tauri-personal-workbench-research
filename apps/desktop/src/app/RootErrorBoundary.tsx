import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { safeErrorMessage } from '../components/ui/error-message'

type State = { error?: Error }

export class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {}

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('render failure', error.name, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="gate-screen diagnostic-screen">
        <AlertTriangle size={28} />
        <h1>界面遇到问题</h1>
        <p>{safeErrorMessage(this.state.error)}</p>
        <button className="button primary" onClick={() => window.location.reload()}>
          <RotateCcw size={16} />
          重新载入
        </button>
      </main>
    )
  }
}
