import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from './lib/router'
import App from './App'
import { StoreProvider } from './lib/store'
import { ThemeProvider } from './lib/theme'
import AgeGate from './components/AgeGate'
import './index.css'

// Compatibility: the previous version of the site used hash routes
// (`/#/watch/<id>`). Those links are in the wild, so send them to the new
// canonical `/v/<id>/` page instead of a 404. No in-app navigation is added.
const legacyWatch = /^#\/watch\/([^/?#]+)/.exec(window.location.hash)
if (legacyWatch) {
  const id = legacyWatch[1]
  window.location.replace(`${import.meta.env.BASE_URL}v/${encodeURIComponent(id)}/`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider>
        <StoreProvider>
          <AgeGate>
            <App />
          </AgeGate>
        </StoreProvider>
      </RouterProvider>
    </ThemeProvider>
  </StrictMode>,
)
