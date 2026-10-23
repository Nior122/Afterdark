import { useEffect, useState } from 'react'
import { BrowserRouter, HashRouter, Route, Routes, useParams } from 'react-router-dom'
import App from './App'
import AgeGate from './components/AgeGate'
import ErrorBoundary from './components/ErrorBoundary'
import DirectVideoPage from './pages/DirectVideoPage'
import NotFoundPage from './pages/NotFoundPage'
import AdminPage from './pages/AdminPage'
import { deployBase } from './lib/site'
import { useSiteSettings } from './lib/settings'

/**
 * Picks the app for the URL. Exactly one router is mounted at a time.
 *
 *   /v/<id>/   own prerendered file → path router → standalone video page
 *   /admin/    own prerendered file → path router → owner dashboard
 *   anything else → the catalogue's hash routes, or the neutral 404 when the
 *                   owner has switched the site to direct-link mode
 *
 * Important: everything that can render a <Link> must live *inside* a router.
 * The age gate is therefore mounted inside each branch, not above this
 * component (it renders the wordmark, which links home).
 */
type RouteKind = 'video' | 'admin' | 'site'

function routeKind(): RouteKind {
  const base = deployBase()
  const path = window.location.pathname
  const relative = (path.startsWith(base) ? path.slice(base.length) : path).replace(/^\/+/, '')
  if (relative === 'v' || relative.startsWith('v/')) return 'video'
  if (relative === 'admin' || relative.startsWith('admin/')) return 'admin'
  return 'site'
}

function basename(): string {
  const base = deployBase().replace(/\/+$/, '')
  return base || '/'
}

/** How long the catalogue may wait for the mode before assuming "public". */
const MODE_WAIT_MS = 1500

/**
 * A shared /v/<id>/ link while the site is in direct mode shows the clean
 * standalone page — that is what link-only mode is for. Once the owner flips
 * the site to public, the same link follows the mode and opens the full watch
 * experience (header, up-next, share), because the refresh on mount / tab
 * focus reports 'public'. The hop is one-way: the legacy #/watch shim in
 * main.tsx stays quiet while the site is public, so the two cannot ping-pong.
 */
function VideoRoute() {
  const { id } = useParams()
  const { mode } = useSiteSettings()

  useEffect(() => {
    if (mode === 'public' && id) {
      window.location.replace(`${deployBase()}#/watch/${encodeURIComponent(id)}`)
    }
  }, [mode, id])

  if (mode === 'public') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface text-[13px] text-muted" aria-busy="true">
        Opening this video on the site…
      </div>
    )
  }
  return <DirectVideoPage />
}

/** The catalogue, gated by the site mode. */
function CatalogueRoot() {
  const { mode } = useSiteSettings()
  const [waited, setWaited] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), MODE_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [])

  // Direct mode must never flash a feed full of links, so a known 'direct'
  // wins immediately. While the mode is unknown we wait — but only briefly:
  // an unreachable Worker must not leave a permanently empty page.
  if (mode === 'direct') return <NotFoundPage />
  if (mode === null && !waited) return <div className="min-h-screen bg-surface" aria-busy="true" />
  return <AgeGate><App /></AgeGate>
}

export default function Root() {
  const kind = routeKind()

  if (kind === 'video') {
    return (
      <ErrorBoundary>
        <BrowserRouter basename={basename()}>
          <Routes>
            <Route path="/v/:id" element={<AgeGate><VideoRoute /></AgeGate>} />
            <Route path="*" element={<AgeGate><NotFoundPage /></AgeGate>} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    )
  }

  if (kind === 'admin') {
    // The dashboard is owner-only and has nothing adult in it, so it is not
    // age-gated — an owner can always manage the site.
    return (
      <ErrorBoundary>
        <BrowserRouter basename={basename()}>
          <Routes>
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <HashRouter>
        <CatalogueRoot />
      </HashRouter>
    </ErrorBoundary>
  )
}
