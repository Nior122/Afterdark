import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/**
 * Theme state lives here and nowhere else: components use the semantic colour
 * tokens from index.css, so switching themes only toggles the `.dark` class on
 * <html> and every surface follows.
 *
 * A stored value also means "the user chose explicitly" — while nothing is
 * stored the app keeps following the OS preference.
 */

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'afterdark.theme.v1'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function readStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === 'light' || raw === 'dark' ? raw : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

interface ThemeValue {
  theme: Theme
  isDark: boolean
  /** Whether the current theme came from an explicit choice rather than the OS. */
  isManual: boolean
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  /** Forget the explicit choice and follow the OS again. */
  resetToSystem: () => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme() ?? systemTheme())
  // Captured once at mount: presence of the storage key is the manual flag.
  const manualRef = useRef<boolean>(readStoredTheme() !== null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia(DARK_QUERY)
    const onChange = (event: MediaQueryListEvent) => {
      // Do not override a choice the user made in the app.
      if (manualRef.current) return
      setThemeState(event.matches ? 'dark' : 'light')
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    manualRef.current = true
    setThemeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage may be unavailable — the theme still applies for this session */
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [setTheme, theme])

  const resetToSystem = useCallback(() => {
    manualRef.current = false
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setThemeState(systemTheme())
  }, [])

  const value = useMemo<ThemeValue>(
    () => ({
      theme,
      isDark: theme === 'dark',
      isManual: manualRef.current,
      setTheme,
      toggleTheme,
      resetToSystem,
    }),
    [theme, setTheme, toggleTheme, resetToSystem],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
