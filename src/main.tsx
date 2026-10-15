/**
 * Entry point.
 *
 * Deliberately not wrapped in <StrictMode>. StrictMode double-invokes effects in
 * development, which for this app means acquiring the camera twice and constructing the
 * MediaPipe landmarker twice on every mount — that leaks a MediaStream (the second
 * getUserMedia on some Android builds fails outright) and makes development behaviour
 * diverge from production exactly where it matters most. The trade-off is accepted
 * knowingly: every effect in this codebase is written to be safe to re-run on its own.
 */
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppErrorBoundary } from './ui/ErrorBoundary'
import { ToastViewport } from './ui/Toast'
import { armSplashTimeout, hideSplash } from './lib/splash'
import { devWarn } from './lib/util'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

// A stuck splash screen tells the user nothing; a 15-second cap guarantees they always
// end up looking at either the app or the error boundary.
armSplashTimeout()

// Last-ditch reporting. Failures that reach here have already escaped every local
// handler, so they are logged (in development) rather than swallowed silently.
window.addEventListener('error', (event) => devWarn('window error', event.message))
window.addEventListener('unhandledrejection', (event) => devWarn('unhandled rejection', event.reason))

createRoot(container).render(
  <>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    {/* Outside the boundary on purpose: a toast must still be able to appear when the
        main tree has crashed, otherwise the user never learns why. */}
    <ToastViewport />
  </>,
)

// Before React's first commit the splash is still up, which is exactly when a hard
// failure would otherwise leave it up forever.
requestAnimationFrame(() => {
  window.setTimeout(() => {
    if (document.querySelector('canvas') || document.querySelector('[data-app-shell]')) hideSplash()
  }, 1000)
})
