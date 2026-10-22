import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last line of defence. Without this, any render error unmounts the whole tree
 * and the visitor sees the empty dark page — indistinguishable from "the site
 * is broken", with no clue and no way out. A crash now shows a readable
 * message, the error text, and a reload button.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the details in the console for bug reports; never a blank screen.
    console.error('Render error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <main className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col justify-center px-6 py-16">
        <h1 className="text-[20px] font-bold tracking-[-0.01em] text-ink">Something went wrong</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          This page could not be displayed. Reloading usually fixes it; if it keeps happening, the
          site needs a rebuild.
        </p>
        <pre className="mt-4 max-h-40 overflow-auto rounded-xl border border-line bg-panel px-3 py-2 text-[11.5px] leading-relaxed text-muted">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 h-11 w-fit rounded-full bg-action px-6 text-[14px] font-semibold text-on-action transition hover:opacity-90"
        >
          Reload page
        </button>
      </main>
    )
  }
}
