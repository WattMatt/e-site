'use client'

import { Component, type ReactNode } from 'react'
import { ErrorState } from '@/components/ui/ErrorState'

interface Props { children: ReactNode; fallback?: ReactNode }
interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Report to Sentry if configured
    if (typeof window !== 'undefined' && (window as any).__SENTRY__) {
      ;(window as any).__SENTRY__.captureException(error, { extra: info })
    }
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div
          style={{
            minHeight: '100vh',
            background: 'var(--c-base)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ErrorState
            title="Something went wrong"
            description="An unexpected error occurred. Our team has been notified."
            detail={this.state.error?.message}
            action={
              <button
                onClick={() => window.location.reload()}
                className="btn-primary-amber"
              >
                Reload page
              </button>
            }
          />
        </div>
      )
    }
    return this.props.children
  }
}
