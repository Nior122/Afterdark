/**
 * Entry point for scripts/verify-dom.cjs — mounts the real app so the DOM
 * check can assert what visitors actually get. Bundled on demand by the check.
 */
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import Root from '../src/Root'
import { SettingsProvider } from '../src/lib/settings'
import { StoreProvider } from '../src/lib/store'
import { ThemeProvider } from '../src/lib/theme'

export function mount(container: HTMLElement) {
  const root = createRoot(container)
  act(() => {
    root.render(
      <ThemeProvider>
        <SettingsProvider>
          <StoreProvider>
            <Root />
          </StoreProvider>
        </SettingsProvider>
      </ThemeProvider>,
    )
  })
  return root
}
