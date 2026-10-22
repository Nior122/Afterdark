import { FEED_ORIGIN, type SiteMode } from './settings'

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
  updatedAt: number | null
  github: boolean
  feedUrl: string
}

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!FEED_ORIGIN) {
    throw new AdminError(
      'This site has no bot Worker configured, so there is no dashboard data. ' +
        'Set VITE_TELEGRAM_FEED_URL to the Worker origin and rebuild the site.',
      0,
    )
  }
  const response = await fetch(`${FEED_ORIGIN}/api/admin/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(init.headers || {}),
    },
    cache: 'no-store',
  })
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

export const admin = {
  settings: () => request<AdminSettings>('settings'),
  setMode: (mode: SiteMode) =>
    request<{ ok: true; mode: SiteMode }>('settings', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  videos: () => request<{ videos: AdminVideo[]; total: number }>('videos'),
  updateVideo: (id: string, patch: Partial<Pick<AdminVideo, 'title' | 'category' | 'description' | 'tags'>>) =>
    request<{ ok: true }>(`videos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteVideo: (id: string) =>
    request<{ ok: true }>(`videos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  drafts: () => request<{ drafts: AdminDraft[] }>('drafts'),
  scrape: (url: string) =>
    request<{ ok: true; drafts: AdminDraft[]; site?: string; pageTitle?: string }>('scrape', {
      method: 'POST',
      body: JSON.stringify({ url }),
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
