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
 * Site configuration, owned by the Worker and read at runtime.
 *
 *   mode        'public' = normal tube catalogue; 'direct' = every video opens
 *               only from its own /v/<id>/ link, home page is a neutral page
 *               (or a redirect, see `redirectUrl`).
 *   redirectUrl where the home page sends visitors while `mode` is 'direct'
 *               (enforced by functions/_middleware.ts as a real 302).
 *   ads         owner-pasted ad code per slot, plus an on/off switch.
 *
 * Everything is fetched from `GET /api/settings`, so the owner can change any
 * of it from the Telegram bot or the dashboard without a rebuild.
 */

export type SiteMode = 'public' | 'direct'

export const AD_SLOT_NAMES = ['header', 'native', 'sidebar', 'footer', 'video', 'popunder'] as const
export type AdSlotName = (typeof AD_SLOT_NAMES)[number]

export interface AdConfig {
  /** Global switch — nothing renders while this is off. */
  enabled: boolean
  /** Per-slot switch: a slot shows only when `enabled` and its own flag are on. */
  slotsOn: Record<AdSlotName, boolean>
  /** Outline mode: sites draw dashed boxes where slots sit, running no ad code. */
  preview: boolean
  header: string
  native: string
  sidebar: string
  footer: string
  video: string
  popunder: string
}

export const EMPTY_ADS: AdConfig = {
  enabled: false,
  slotsOn: { header: true, native: true, sidebar: true, footer: true, video: true, popunder: true },
  preview: false,
  header: '',
  native: '',
  sidebar: '',
  footer: '',
  video: '',
  popunder: '',
}

const FEED_BASE = (import.meta.env.VITE_TELEGRAM_FEED_URL as string | undefined)?.replace(
  /\/+$/,
  '',
)

const CACHE_KEY = 'afterdark.mode.v1'

export interface SiteSettings {
  mode: SiteMode
  redirectUrl: string
  ads: AdConfig
}

/** Last known mode, so a reload does not flash the wrong layout. */
export function cachedMode(): SiteMode | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY)
    return raw === 'direct' || raw === 'public' ? raw : null
  } catch {
    return null
  }
}

export function normaliseAds(value: unknown): AdConfig {
  // Copy the per-slot defaults too: EMPTY_ADS.slotsOn is shared otherwise.
  const ads: AdConfig = { ...EMPTY_ADS, slotsOn: { ...EMPTY_ADS.slotsOn } }
  if (!value || typeof value !== 'object') return ads
  const record = value as Record<string, unknown>
  ads.enabled = Boolean(record.enabled)
  ads.preview = Boolean(record.preview)
  const slotsOn = (record.slotsOn && typeof record.slotsOn === 'object' ? record.slotsOn : {}) as Record<string, unknown>
  for (const slot of AD_SLOT_NAMES) {
    const text = record[slot]
    ads[slot] = typeof text === 'string' ? text : ''
    // Workers from before per-slot toggles default every slot to on.
    ads.slotsOn[slot] = typeof slotsOn[slot] === 'boolean' ? slotsOn[slot] : true
  }
  return ads
}

export async function fetchSiteSettings(): Promise<SiteSettings | null> {
  if (!FEED_BASE) return { mode: 'public', redirectUrl: '', ads: { ...EMPTY_ADS } }
  try {
    const response = await fetch(`${FEED_BASE}/api/settings`, { cache: 'no-store' })
    if (!response.ok) return null
    const data = (await response.json()) as {
      mode?: string
      redirectUrl?: unknown
      ads?: unknown
    }
    if (data.mode !== 'direct' && data.mode !== 'public') return null
    try {
      window.sessionStorage.setItem(CACHE_KEY, data.mode)
    } catch {
      /* storage blocked — the in-memory value is still correct */
    }
    return {
      mode: data.mode,
      redirectUrl: typeof data.redirectUrl === 'string' ? data.redirectUrl : '',
      ads: normaliseAds(data.ads),
    }
  } catch {
    return null
  }
}

/** Kept for callers that only care about the mode. */
export async function fetchSiteMode(): Promise<SiteMode | null> {
  return (await fetchSiteSettings())?.mode ?? null
}

interface SettingsValue {
  /** null while the first request is in flight. */
  mode: SiteMode | null
  isDirect: boolean
  redirectUrl: string
  ads: AdConfig
  refresh: () => Promise<void>
}

const SettingsContext = createContext<SettingsValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<SiteMode | null>(() => cachedMode())
  const [redirectUrl, setRedirectUrl] = useState('')
  const [ads, setAds] = useState<AdConfig>(() => ({ ...EMPTY_ADS }))

  const refresh = useCallback(async () => {
    const next = await fetchSiteSettings()
    if (next) {
      setMode(next.mode)
      setRedirectUrl(next.redirectUrl)
      setAds(next.ads)
      return
    }
    // Unreachable Worker: keep the cached mode, never guess 'direct'.
    setMode((current) => current ?? 'public')
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
    () => ({ mode, isDirect: mode === 'direct', redirectUrl, ads, refresh }),
    [mode, redirectUrl, ads, refresh],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSiteSettings(): SettingsValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSiteSettings must be used inside <SettingsProvider>')
  return ctx
}

export const FEED_ORIGIN = FEED_BASE ?? ''
