import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Root from './Root'
import { SettingsProvider, cachedMode } from './lib/settings'
import { StoreProvider } from './lib/store'
import { ThemeProvider } from './lib/theme'
import './index.css'

// Compatibility: the previous direct-link version used clean /v/<id>/ URLs and
// the catalogue uses /#/watch/<id>. Hash links from the catalogue are handled
// by the hash router, so the only redirect needed here is the legacy
// /#/watch/<id> shape when the site has no catalogue route for it. While the
// site is known to be public the hash route IS the right home for that link —
// rewriting it would fight /v/'s hop into the watch experience (Root.tsx).
const legacyWatch = /^#\/watch\/([^/?#]+)/.exec(window.location.hash)
if (legacyWatch && cachedMode() !== 'public') {
  const id = legacyWatch[1]
  window.location.replace(`${import.meta.env.BASE_URL}v/${encodeURIComponent(id)}/`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <SettingsProvider>
        <StoreProvider>
          {/* The router (and the age gate) live inside Root: the gate renders
              the wordmark, which needs router context. */}
          <Root />
        </StoreProvider>
      </SettingsProvider>
    </ThemeProvider>
  </StrictMode>,
)
