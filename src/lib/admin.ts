import { AD_SLOT_NAMES, EMPTY_ADS, FEED_ORIGIN, normaliseAds, type AdConfig, type SiteMode } from './settings'

/**
 * Client for the Worker's admin API (worker/worker.js).
 *
 * Auth is a single bearer token — the `ADMIN_TOKEN` secret the owner sets on
 * the Worker. It is kept in sessionStorage only (never in the bundle, never in
 * a URL), and every request fails closed with a readable message.
 */

export interface AdminVideo {
  id: string
  title: string
  category: string
  tags: string[]
  durationSec: number
  /** Media pixel dimensions when known — the dashboard frames portrait thumbs portrait. */
  width?: number
  height?: number
  kind: 'telegram' | 'link'
  tooLarge?: boolean
  /** Real view count from the Worker's counter (0 until the first view). */
  views: number
  sourceUrl: string | null
  streamUrl: string | null
  thumbUrl: string | null
  description: string
  site?: string
  createdAt: number | null
  updatedAt: number | null
}

export interface AdminDraft {
  id: string
  batchId?: string
  title: string
  category: string
  tags: string[]
  durationSec: number
  width?: number
  height?: number
  sourceUrl: string
  thumbUrl: string
  description: string
  site?: string
  pageUrl?: string
  createdAt: number
}

export interface AdminSettings {
  mode: SiteMode
  modes: SiteMode[]
  redirectUrl: string
  ads: AdConfig
  slots: string[]
  updatedAt: number | null
  adsUpdatedAt: number | null
  github: boolean
  feedUrl: string
}

export { AD_SLOT_NAMES, EMPTY_ADS }

const TOKEN_KEY = 'afterdark.admin.v1'

export class AdminError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function getToken(): string {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setToken(token: string): void {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token)
    else window.sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage blocked — the caller keeps it in memory for this page view */
  }
}

export function adminConfigured(): boolean {
  return Boolean(FEED_ORIGIN)
}

/**
 * Every dashboard call has a deadline. A Worker whose origin accepts the
 * connection but never answers (a sleeping host, a wrong URL that still
 * resolves) would otherwise leave the sign-in button stuck on "Checking…"
 * and every panel on a spinner — the page looks dead even though it loaded
 * fine. With a timer the UI says what failed and what to check instead.
 */
const REQUEST_TIMEOUT_MS = 15_000
/** Scrapes fetch a remote page inside the Worker, which may take its time. */
const SCRAPE_TIMEOUT_MS = 30_000

function timeoutSignal(ms: number): AbortSignal | undefined {
  const owner = typeof AbortSignal === 'undefined' ? undefined : (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal })
  if (!owner || typeof owner.timeout !== 'function') return undefined
  try {
    return owner.timeout(ms)
  } catch {
    return undefined
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  if (!FEED_ORIGIN) {
    throw new AdminError(
      'This site has no bot Worker configured, so there is no dashboard data. ' +
        'Set VITE_TELEGRAM_FEED_URL to the Worker origin and rebuild the site.',
      0,
    )
  }
  let response: Response
  try {
    response = await fetch(`${FEED_ORIGIN}/api/admin/${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
        ...(init.headers || {}),
      },
      cache: 'no-store',
      signal: timeoutSignal(timeoutMs),
    })
  } catch (cause) {
    const name = (cause as { name?: string } | null)?.name ?? ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new AdminError(
        `The Worker at ${FEED_ORIGIN} did not answer within ${Math.round(timeoutMs / 1000)} s. ` +
          'Check that the Worker is deployed (GET /health should answer) and that this build was made ' +
          'with VITE_TELEGRAM_FEED_URL pointing at it.',
        0,
      )
    }
    throw new AdminError(
      'Could not reach the bot Worker — the request failed before the Worker answered. ' +
        'Check that it is deployed and that VITE_TELEGRAM_FEED_URL matches.',
      0,
    )
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    const message =
      (body as { message?: string } | null)?.message ||
      `Request failed (${response.status})`
    throw new AdminError(message, response.status)
  }
  return body as T
}

/** The Worker accepts at most 200 ids per bulk call; chunk anything larger. */
function chunk<T>(items: T[], size = 200): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

/**
 * A Worker deployed before the site was last rebuilt answers
 * `/api/admin/settings` with fewer fields than the current UI reads (no
 * `ads`/`slots` before the ad feature, no `adsUpdatedAt`…). The dashboard
 * used to trust those shapes and crash on `settings.ads.enabled` — the
 * ErrorBoundary then replaced the whole dashboard with an error card that
 * looked like the admin page itself was broken. Normalising every
 * settings-shaped reply once, here, keeps the UI readable against any Worker
 * version; the owner just sees defaults until they redeploy the Worker.
 */
/** Settings fields added after the Worker API first shipped, oldest last. */
const SETTINGS_VERSION_FIELDS = ['redirectUrl', 'ads', 'slots', 'adsUpdatedAt'] as const

/**
 * Which of those fields the most recent settings reply was missing. A non-empty
 * list means the deployed Worker predates this dashboard: the banner warns the
 * owner up front, and saveSettings() refuses to pretend a toggle persisted.
 * Recomputed on every settings read.
 */
let missingWorkerFields: string[] = []

export function workerMissingFields(): readonly string[] {
  return missingWorkerFields
}

function normaliseSettings(raw: unknown): AdminSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<AdminSettings>
  missingWorkerFields = SETTINGS_VERSION_FIELDS.filter((field) => !(field in source))
  return {
    mode: source.mode === 'direct' ? 'direct' : 'public',
    modes: Array.isArray(source.modes) && source.modes.length ? source.modes : ['public', 'direct'],
    redirectUrl: typeof source.redirectUrl === 'string' ? source.redirectUrl : '',
    ads: normaliseAds(source.ads),
    slots: Array.isArray(source.slots) && source.slots.length ? source.slots : [...AD_SLOT_NAMES],
    updatedAt: Number(source.updatedAt) || null,
    adsUpdatedAt: Number(source.adsUpdatedAt) || null,
    github: Boolean(source.github),
    feedUrl: typeof source.feedUrl === 'string' ? source.feedUrl : '',
  }
}

/**
 * POST a settings patch, then read the settings back and confirm the Worker
 * actually persisted it. An older Worker happily answers a POST while ignoring
 * fields it has never heard of (ads, redirect…), so the toggle would flip back
 * a refresh later and the owner reads that as the site ignoring the dashboard.
 * A save that did not stick must look like a failed save.
 */
async function saveSettings(
  body: Record<string, unknown>,
  verify: (settings: AdminSettings) => boolean,
  what: string,
): Promise<{ ok: true } & AdminSettings> {
  const posted = normaliseSettings(await request<Partial<AdminSettings>>('settings', {
    method: 'POST',
    body: JSON.stringify(body),
  }))
  if (verify(posted)) return { ok: true as const, ...posted }
  // The POST echo did not acknowledge the change. Give the Worker one fresh
  // read (KV can lag across regions for a moment) — and only call it a failed
  // save when that disagrees too. An old Worker that never knew the field in
  // the first place fails both checks and reports honestly.
  let fresh: AdminSettings | null = null
  try {
    fresh = normaliseSettings(await request<Partial<AdminSettings>>('settings'))
  } catch {
    fresh = null
  }
  if (fresh && verify(fresh)) return { ok: true as const, ...fresh }
  throw new AdminError(
    `The Worker did not save the ${what}: it answered, but its reply still holds the old value. ` +
      'This Worker build predates that control — redeploy worker/worker.js (run `wrangler deploy` ' +
      'in the worker/ directory). The bot commands (/mode, /redirect) keep working meanwhile.',
    0,
  )
}

export const admin = {
  settings: async () => normaliseSettings(await request<Partial<AdminSettings>>('settings')),
  setMode: (mode: SiteMode) => saveSettings({ mode }, (s) => s.mode === mode, 'site mode'),
  /** Empty string turns the home-page redirect off. */
  setRedirect: (redirectUrl: string) =>
    saveSettings({ redirectUrl }, (s) => s.redirectUrl === redirectUrl.trim(), 'home-page redirect'),
  /** Partial ad update: send only the slots that changed, plus `enabled`. */
  setAds: (ads: Partial<AdConfig>) =>
    saveSettings({ ads }, (s) => {
      const record = s.ads as unknown as Record<string, unknown>
      return Object.entries(ads).every(([key, value]) => JSON.stringify(record[key]) === JSON.stringify(value))
    }, 'ad settings'),
  clearAds: async (enabled = false) => ({
    ok: true as const,
    ...normaliseSettings(await request<Partial<AdminSettings>>('ads/clear', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    })),
  }),
  videos: async () => {
    const raw = await request<{ videos: AdminVideo[]; total: number; viewsTotal?: number }>('videos')
    // Normalise so the table can sort/read `views` even against a Worker
    // deployed before view counting existed.
    const videos = (raw.videos || []).map((video) => ({ ...video, views: Number(video.views) || 0 }))
    return {
      videos,
      total: raw.total ?? videos.length,
      viewsTotal: Number(raw.viewsTotal) || videos.reduce((sum, video) => sum + video.views, 0),
    }
  },
  updateVideo: (id: string, patch: Partial<Pick<AdminVideo, 'title' | 'category' | 'description' | 'tags'>>) =>
    request<{ ok: true }>(`videos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteVideo: (id: string) =>
    request<{ ok: true }>(`videos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Bulk delete: one call per 200 ids; ids gone mid-flight come back in `missing`. */
  bulkDeleteVideos: async (ids: string[]) => {
    const deleted: string[] = []
    const missing: string[] = []
    for (const part of chunk(ids)) {
      const result = await request<{ ok: true; deleted: string[]; missing: string[] }>('videos/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: part }),
      })
      deleted.push(...result.deleted)
      missing.push(...result.missing)
    }
    return { ok: true as const, deleted, missing }
  },
  /** Bulk recategorise; same chunking as the delete. */
  bulkPatchVideos: async (ids: string[], patch: { category: string }) => {
    const updated: string[] = []
    const missing: string[] = []
    for (const part of chunk(ids)) {
      const result = await request<{ ok: true; updated: string[]; missing: string[] }>('videos/bulk-patch', {
        method: 'POST',
        body: JSON.stringify({ ids: part, ...patch }),
      })
      updated.push(...result.updated)
      missing.push(...result.missing)
    }
    return { ok: true as const, updated, missing }
  },
  drafts: async () => {
    // Same version tolerance as settings: a malformed/absent list renders as
    // empty rather than taking the dashboard down.
    const raw = await request<{ drafts?: AdminDraft[] }>('drafts')
    return { drafts: Array.isArray(raw.drafts) ? raw.drafts : [] }
  },
  scrape: (url: string) =>
    request<{
      ok: true
      drafts: AdminDraft[]
      /** Videos skipped because the same source URL is already published or drafted. */
      duplicates?: number
      site?: string
      pageTitle?: string
    }>('scrape', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }, SCRAPE_TIMEOUT_MS),
  /** Discard the given drafts — or every pending draft when ids are omitted. */
  discardDrafts: (ids?: string[]) =>
    request<{ ok: true; discarded: string[] }>('drafts/discard-all', {
      method: 'POST',
      body: JSON.stringify(ids?.length ? { ids } : {}),
    }),
  updateDraft: (id: string, patch: Partial<Pick<AdminDraft, 'title' | 'category'>>) =>
    request<{ ok: true; draft: AdminDraft }>(`drafts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  publishDraft: (id: string) =>
    request<{ ok: true; video: { id: string; title: string } }>(
      `drafts/${encodeURIComponent(id)}/publish`,
      { method: 'POST', body: '{}' },
    ),
  discardDraft: (id: string) =>
    request<{ ok: true }>(`drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  publishAllDrafts: (ids?: string[]) =>
    request<{ ok: true; published: { id: string; title: string }[] }>('drafts/publish-all', {
      method: 'POST',
      body: JSON.stringify(ids ? { ids } : {}),
    }),
  rebuild: () =>
    request<{ ok: true; message: string }>('rebuild', { method: 'POST', body: '{}' }),
}
