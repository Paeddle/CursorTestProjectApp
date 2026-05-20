import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App failed to render', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            fontFamily: 'system-ui, sans-serif',
            maxWidth: 520,
            margin: '2rem auto',
            padding: '1.25rem',
            lineHeight: 1.5,
          }}
        >
          <h1 style={{ marginTop: 0 }}>App failed to load</h1>
          <p>
            Try a <strong>hard refresh</strong> (Ctrl+F5). If the page stays blank, your browser may
            be using an old cached copy of the site.
          </p>
          <pre
            style={{
              background: '#f1f5f9',
              padding: '0.75rem',
              borderRadius: 8,
              overflow: 'auto',
              fontSize: '0.85rem',
            }}
          >
            {this.state.error.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}
