import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/**
 * Site mode, controlled from the Telegram bot or the admin dashboard.
 *
 *   'public' — the normal tube catalogue: home feed, categories, related videos.
 *   'direct' — every video opens only from its own `/v/<id>/` link. The home
 *              page and menus are hidden, nothing links to another video, and
 *              search engines find pages through sitemap.xml.
 *
 * The value lives in the Worker's KV (`cfg:mode`) and is fetched at runtime,
 * so switching modes needs no rebuild. If the feed is not configured, or the
 * request fails, the site stays in 'public' exactly as before.
 */

export type SiteMode = 'public' | 'direct'

const FEED_BASE = (import.meta.env.VITE_TELEGRAM_FEED_URL as string | undefined)?.replace(
  /\/+$/,
  '',
)

const CACHE_KEY = 'afterdark.mode.v1'

/** Last known mode, so a reload does not flash the wrong layout. */
function cachedMode(): SiteMode | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY)
    return raw === 'direct' || raw === 'public' ? raw : null
  } catch {
    return null
  }
}

export async function fetchSiteMode(): Promise<SiteMode | null> {
  if (!FEED_BASE) return 'public'
  try {
    const response = await fetch(`${FEED_BASE}/api/settings`, { cache: 'no-store' })
    if (!response.ok) return null
    const data = (await response.json()) as { mode?: string }
    if (data.mode !== 'direct' && data.mode !== 'public') return null
    try {
      window.sessionStorage.setItem(CACHE_KEY, data.mode)
    } catch {
      /* storage blocked — the in-memory value is still correct */
    }
    return data.mode
  } catch {
    return null
  }
}

interface SettingsValue {
  /** null while the first request is in flight. */
  mode: SiteMode | null
  isDirect: boolean
  refresh: () => Promise<void>
}

const SettingsContext = createContext<SettingsValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<SiteMode | null>(() => cachedMode())

  const refresh = useCallback(async () => {
    const next = await fetchSiteMode()
    if (next) setMode(next)
    else setMode((current) => current ?? 'public')
  }, [])

  useEffect(() => {
    void refresh()
    // Pick up a switch made in the bot/dashboard without a hard reload.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => void refresh(), 5 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [refresh])

  const value = useMemo<SettingsValue>(
    () => ({ mode, isDirect: mode === 'direct', refresh }),
    [mode, refresh],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSiteSettings(): SettingsValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSiteSettings must be used inside <SettingsProvider>')
  return ctx
}

export const FEED_ORIGIN = FEED_BASE ?? ''
