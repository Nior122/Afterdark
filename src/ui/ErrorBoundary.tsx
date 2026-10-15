/**
 * Error boundary.
 *
 * A WebGL app has a handful of failure modes that throw during render — no WebGL2,
 * a context lost mid-session, a driver that refuses a texture format — and React's
 * default behaviour is to unmount the whole tree and leave a blank page. On a phone,
 * with no console, that is indistinguishable from a broken site.
 *
 * So: catch, explain in one sentence, offer the two things that actually help (reload,
 * or drop to Lite quality and try again), and never show a raw stack to the user.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { hideSplash } from '../lib/splash'
import { devWarn } from '../lib/util'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  liteTried: boolean
}

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, liteTried: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    devWarn('unhandled render error', error, info.componentStack)
    hideSplash()
  }

  private readonly reload = (): void => {
    window.location.reload()
  }

  private readonly tryLite = (): void => {
    try {
      // Preferences are read at boot, before the first render, so this survives a reload.
      window.localStorage.setItem('faceverify.lite', '1')
    } catch {
      // Private browsing modes can refuse storage; the reload is still worth trying.
    }
    this.setState({ error: null, liteTried: true })
    window.location.reload()
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const webgl = /webgl|context|gpu/i.test(error.message)

    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5 bg-studio-950 px-6 text-center text-slate-200">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-400 to-violet-600 text-2xl">
          !
        </div>
        <div className="max-w-sm space-y-2">
          <h1 className="text-[19px] font-semibold text-white">
            {webgl ? 'This device could not start 3D' : 'Something went wrong'}
          </h1>
          <p className="text-[14px] leading-relaxed text-slate-400">
            {webgl
              ? 'Faceverify needs WebGL to render the head. Try Lite quality, or update your browser and reload.'
              : 'The app hit an unexpected problem. Reloading usually fixes it — nothing you uploaded was sent anywhere.'}
          </p>
        </div>

        <div className="flex w-full max-w-xs flex-col gap-2">
          <button
            type="button"
            onClick={this.reload}
            className="h-12 rounded-2xl bg-white text-[15px] font-semibold text-slate-900 active:scale-[0.98]"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={this.tryLite}
            className="h-12 rounded-2xl bg-white/10 text-[15px] font-medium text-slate-200 active:scale-[0.98]"
          >
            Retry in Lite quality
          </button>
        </div>

        {/* The message is kept in the DOM (not only the console) because it is the one
            piece of information that makes a bug report actionable. */}
        <p className="max-w-xs break-words text-[11px] leading-relaxed text-slate-600">{error.message}</p>
      </div>
    )
  }
}
