// @ts-nocheck
/**
 * ErrorBoundary — Catches React render errors so the app doesn't go black.
 *
 * Displays a recovery UI with the error message and a reload button.
 */

import React from 'react'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#0f1117',
          color: '#F0F0FF',
          fontFamily: 'sans-serif',
          padding: '2rem',
        }}>
          <div style={{
            background: '#1a1d27',
            border: '1px solid #ef4444',
            borderRadius: '12px',
            padding: '2rem',
            maxWidth: '500px',
            width: '100%',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.75rem', color: '#ef4444' }}>
              Something went wrong
            </div>
            <div style={{
              fontSize: '0.875rem',
              color: '#a8a8c0',
              marginBottom: '1rem',
              background: '#111116',
              borderRadius: '8px',
              padding: '0.75rem',
              fontFamily: 'monospace',
              textAlign: 'left',
              maxHeight: '120px',
              overflow: 'auto',
              wordBreak: 'break-word',
            }}>
              {this.state.error?.message || 'Unknown error'}
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.625rem 1.5rem',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: 'pointer',
                marginRight: '0.5rem',
              }}
            >
              Reload App
            </button>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                background: '#22222c',
                color: '#a8a8c0',
                border: '1px solid #2e2e3a',
                borderRadius: '8px',
                padding: '0.625rem 1.5rem',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
