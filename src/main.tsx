import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Root from './Root'
import { SettingsProvider } from './lib/settings'
import { StoreProvider } from './lib/store'
import { ThemeProvider } from './lib/theme'
import AgeGate from './components/AgeGate'
import './index.css'

// Compatibility: the previous direct-link version used clean /v/<id>/ URLs and
// the catalogue uses /#/watch/<id>. Hash links from the catalogue are handled
// by the hash router, so the only redirect needed here is the legacy
// /#/watch/<id> shape when the site has no catalogue route for it.
const legacyWatch = /^#\/watch\/([^/?#]+)/.exec(window.location.hash)
if (legacyWatch) {
  const id = legacyWatch[1]
  window.location.replace(`${import.meta.env.BASE_URL}v/${encodeURIComponent(id)}/`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <SettingsProvider>
        <StoreProvider>
          <AgeGate>
            <Root />
          </AgeGate>
        </StoreProvider>
      </SettingsProvider>
    </ThemeProvider>
  </StrictMode>,
)
