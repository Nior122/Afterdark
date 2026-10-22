import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom'
import App from './App'
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

/** The catalogue, gated by the site mode. */
function CatalogueRoot() {
  const { mode } = useSiteSettings()

  // Wait for the mode before painting: in direct mode the catalogue must never
  // flash a home feed full of links.
  if (mode === null) return <div className="min-h-screen bg-surface" aria-busy="true" />
  if (mode === 'direct') return <NotFoundPage />
  return <App />
}

export default function Root() {
  const kind = routeKind()

  if (kind === 'video') {
    return (
      <BrowserRouter basename={basename()}>
        <Routes>
          <Route path="/v/:id" element={<DirectVideoPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    )
  }

  if (kind === 'admin') {
    return (
      <BrowserRouter basename={basename()}>
        <Routes>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <HashRouter>
      <CatalogueRoot />
    </HashRouter>
  )
}
