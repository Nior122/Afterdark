import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { SITE_URL } from './site'

/**
 * Clean, real URLs (`/v/<id>/`) instead of the old hash routes.
 *
 * The router needs to know where the app is mounted. Every production build
 * injects `<base href="…">` (see scripts/prerender.mjs), which is exactly the
 * deployment path — `/` on a custom domain, `/Faceverify/` on GitHub Pages —
 * so routes match regardless of where the site is hosted. Without a base tag
 * (dev server, or a video page reached through 404.html) the app falls back to
 * the path of SITE_URL, then to the origin root.
 */
function basename(): string {
  const fromBaseTag =
    typeof document !== 'undefined'
      ? document.querySelector('base')?.getAttribute('href') ?? ''
      : ''
  const candidate = fromBaseTag || SITE_URL || '/'
  try {
    const path = new URL(candidate, window.location.origin).pathname.replace(/\/+$/, '')
    return path || '/'
  } catch {
    return '/'
  }
}

export function RouterProvider({ children }: { children: ReactNode }) {
  return <BrowserRouter basename={basename()}>{children}</BrowserRouter>
}
