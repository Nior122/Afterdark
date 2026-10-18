import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from './lib/router'
import App from './App'
import { StoreProvider } from './lib/store'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </RouterProvider>
  </StrictMode>,
)
