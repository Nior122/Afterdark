import { AD_SLOT_NAMES, EMPTY_ADS, FEED_ORIGIN, type AdConfig, type SiteMode } from './settings'

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

export const admin = {
  settings: () => request<AdminSettings>('settings'),
  setMode: (mode: SiteMode) =>
    request<{ ok: true } & AdminSettings>('settings', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  /** Empty string turns the home-page redirect off. */
  setRedirect: (redirectUrl: string) =>
    request<{ ok: true } & AdminSettings>('settings', {
      method: 'POST',
      body: JSON.stringify({ redirectUrl }),
    }),
  /** Partial ad update: send only the slots that changed, plus `enabled`. */
  setAds: (ads: Partial<AdConfig>) =>
    request<{ ok: true } & AdminSettings>('settings', {
      method: 'POST',
      body: JSON.stringify({ ads }),
    }),
  clearAds: (enabled = false) =>
    request<{ ok: true } & AdminSettings>('ads/clear', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
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
  drafts: () => request<{ drafts: AdminDraft[] }>('drafts'),
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
