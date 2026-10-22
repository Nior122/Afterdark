import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from './lib/router'
import App from './App'
import { StoreProvider } from './lib/store'
import { ThemeProvider } from './lib/theme'
import AgeGate from './components/AgeGate'
import './index.css'

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
