import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  Film,
  Globe,
  Layers,
  Loader2,
  LogOut,
  Megaphone,
  Pencil,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { CATEGORIES } from '../data/seed'
import {
  admin,
  adminConfigured,
  AdminError,
  getToken,
  setToken,
  type AdminDraft,
  type AdminSettings,
  type AdminVideo,
} from '../lib/admin'
import { applyNeutralMeta } from '../lib/meta'
import { adminPath, deployBase, videoPath, videoUrl } from '../lib/site'
import {
  AD_SLOT_NAMES,
  EMPTY_ADS,
  useSiteSettings,
  type AdConfig,
  type AdSlotName,
} from '../lib/settings'

/**
 * Owner dashboard.
 *
 * A web page mirror of everything the Telegram bot can do: switch the site
 * mode, manage published videos (rename / recategorise / delete, in bulk or
 * one by one), scrape links into drafts (one at a time or up to 20 at once),
 * review and publish them, and trigger a rebuild. It talks to the Worker's
 * admin API with the `ADMIN_TOKEN` the owner set there; the token is held in
 * sessionStorage for this tab only. Everything it changes lives in KV and is
 * read at runtime by the site — no rebuild to apply.
 */

type Tab = 'videos' | 'add' | 'drafts' | 'ads'
type SortKey = 'views' | 'newest' | 'title'

const CATEGORY_OPTIONS = [...CATEGORIES]
/** Videos per page in the bulk-management table. */
const VIDEOS_PAGE_SIZE = 20
/** Per-URL status flow of the bulk scrape, matching the Worker's responses. */
const MAX_SCRAPE_URLS = 20
type ScrapeStatus = 'queued' | 'scraping' | 'scraped' | 'blocked' | 'duplicate'
interface ScrapeRow {
  url: string
  status: ScrapeStatus
  /** Drafts created (scraped) or skipped (duplicate). */
  count: number
  message: string
}

function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

function relative(timestamp: number | null): string {
  if (!timestamp) return '—'
  const days = Math.round((Date.now() - timestamp) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

export default function AdminPage() {
  const { refresh: refreshMode } = useSiteSettings()
  const [token, setTokenState] = useState(() => getToken())
  const [signedIn, setSignedIn] = useState(false)
  const [checking, setChecking] = useState(false)
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [videos, setVideos] = useState<AdminVideo[]>([])
  const [viewsTotal, setViewsTotal] = useState(0)
  const [drafts, setDrafts] = useState<AdminDraft[]>([])
  const [tab, setTab] = useState<Tab>('videos')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [redirectDraft, setRedirectDraft] = useState('')
  const [adDraft, setAdDraft] = useState<AdConfig>(() => ({ ...EMPTY_ADS }))
  // Unsaved ad edits must not be overwritten by a background refresh.
  const [adsDirty, setAdsDirty] = useState(false)

  useEffect(() => {
    applyNeutralMeta()
    document.title = 'AfterDark — dashboard'
  }, [])

  const refreshVideos = useCallback(async () => {
    const next = await admin.videos()
    setVideos(next.videos)
    setViewsTotal(next.viewsTotal)
  }, [])

  const refreshDrafts = useCallback(async () => {
    const next = await admin.drafts()
    setDrafts(next.drafts)
  }, [])

  const loadAll = useCallback(async () => {
    const [nextSettings, nextVideos, nextDrafts] = await Promise.all([
      admin.settings(),
      admin.videos(),
      admin.drafts(),
    ])
    setSettings(nextSettings)
    setVideos(nextVideos.videos)
    setViewsTotal(nextVideos.viewsTotal)
    setDrafts(nextDrafts.drafts)
    setRedirectDraft(nextSettings.redirectUrl || '')
    setAdDraft((current) => (adsDirty ? current : { ...EMPTY_ADS, ...nextSettings.ads }))
  }, [adsDirty])

  const signIn = useCallback(
    async (value: string) => {
      setChecking(true)
      setError('')
      try {
        setToken(value)
        await loadAll()
        setTokenState(value)
        setSignedIn(true)
      } catch (cause) {
        setToken('')
        setSignedIn(false)
        setError(cause instanceof AdminError ? cause.message : 'Could not reach the bot Worker.')
      } finally {
        setChecking(false)
      }
    },
    [loadAll],
  )

  useEffect(() => {
    if (token) void signIn(token)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Runs an action with the shared busy/error/notice plumbing; true on success. */
  const run = useCallback(
    async (label: string, action: () => Promise<void>): Promise<boolean> => {
      setBusy(label)
      setError('')
      setNotice('')
      try {
        await action()
        return true
      } catch (cause) {
        setError(cause instanceof AdminError ? cause.message : String(cause))
        return false
      } finally {
        setBusy('')
      }
    },
    [],
  )

  const switchMode = (mode: 'public' | 'direct') =>
    run('mode', async () => {
      const result = await admin.setMode(mode)
      setSettings((current) => (current ? { ...current, mode: result.mode } : current))
      await refreshMode()
      setNotice(
        mode === 'direct'
          ? 'Direct-link mode is on: the home page and menus are hidden, and each video is reachable only by its own link.'
          : 'Public catalogue is back, with the home feed and related videos.',
      )
    })

  const saveRedirect = () =>
    run('redirect', async () => {
      const result = await admin.setRedirect(redirectDraft.trim())
      setSettings(result)
      setRedirectDraft(result.redirectUrl || '')
      setNotice(
        result.redirectUrl
          ? 'Redirect saved. It applies whenever the site is in direct-link mode.'
          : 'Redirect cleared. In direct-link mode the home page shows a neutral 18+ page.',
      )
    })

  const saveAds = () =>
    run('ads', async () => {
      const result = await admin.setAds(adDraft)
      setSettings(result)
      setAdDraft({ ...EMPTY_ADS, ...result.ads })
      setAdsDirty(false)
      setNotice(
        result.ads.enabled
          ? 'Ad code saved and switched on. Reload the site to see it.'
          : 'Ad code saved. Switch ads on when you are ready for them to show.',
      )
    })

  const toggleAds = () =>
    run('ads-toggle', async () => {
      const result = await admin.setAds({ enabled: !(settings?.ads.enabled ?? false) })
      setSettings(result)
      setAdDraft({ ...EMPTY_ADS, ...result.ads })
      setAdsDirty(false)
      setNotice(result.ads.enabled ? 'Ads are ON across the site.' : 'Ads are OFF. Your code is kept.')
    })

  /** Per-slot enable — applied immediately, like the global switch. */
  const toggleAdSlot = (slot: AdSlotName) =>
    run(`ads-slot:${slot}`, async () => {
      const next = { ...adDraft.slotsOn, [slot]: !adDraft.slotsOn[slot] }
      const result = await admin.setAds({ slotsOn: next })
      setSettings(result)
      setAdDraft((current) => ({ ...current, slotsOn: result.ads.slotsOn }))
      setNotice(
        result.ads.slotsOn[slot]
          ? `Slot “${slot}” is enabled (while ads are on).`
          : `Slot “${slot}” is hidden even while ads are on.`,
      )
    })

  /** Dashed-outline placement preview across the live site; runs no ad code. */
  const toggleAdPreview = () =>
    run('ads-preview', async () => {
      const result = await admin.setAds({ preview: !adDraft.preview })
      setSettings(result)
      setAdDraft((current) => ({ ...current, preview: result.ads.preview }))
      setNotice(
        result.ads.preview
          ? 'Preview outlines are ON: every slot is drawn as a dashed box on the site, and no ad code executes. Reload an open tab to see it.'
          : 'Preview outlines are off — live slots render their ad code again.',
      )
    })

  const clearAds = () =>
    run('ads-clear', async () => {
      const result = await admin.clearAds(false)
      setSettings(result)
      setAdDraft({ ...EMPTY_ADS, ...result.ads })
      setAdsDirty(false)
      setNotice('All ad slots cleared.')
    })

  function updateAd(slot: AdSlotName, value: string) {
    setAdDraft((current) => ({ ...current, [slot]: value }))
    setAdsDirty(true)
  }

  async function handleSignIn(event: FormEvent) {
    event.preventDefault()
    await signIn(token.trim())
  }

  function signOut() {
    setToken('')
    setTokenState('')
    setSignedIn(false)
    setSettings(null)
    setVideos([])
    setViewsTotal(0)
    setDrafts([])
    setNotice('')
    setError('')
  }

  if (!adminConfigured()) {
    return (
      <Shell>
        <Notice tone="warn">
          No bot Worker is configured for this build. Set <Code>VITE_TELEGRAM_FEED_URL</Code> to your
          worker origin and rebuild the site — the dashboard then reads videos and drafts from it.
        </Notice>
      </Shell>
    )
  }

  if (!signedIn) {
    return (
      <Shell>
        <form onSubmit={handleSignIn} className="mx-auto mt-10 w-full max-w-sm rounded-2xl border border-line bg-panel p-6">
          <div className="flex items-center gap-2 text-[15px] font-bold text-ink">
            <ShieldCheck size={18} className="text-brand-600" /> Owner sign-in
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            Enter the <Code>ADMIN_TOKEN</Code> you set on the Worker. It stays in this tab only.
          </p>
          <input
            type="password"
            value={token}
            onChange={(event) => setTokenState(event.target.value)}
            placeholder="ADMIN_TOKEN"
            autoFocus
            className="mt-4 h-11 w-full rounded-lg border border-line bg-surface px-3 text-[14px] text-ink"
          />
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] font-medium text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={checking || !token.trim()}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-600 text-[13.5px] font-semibold text-white disabled:opacity-50"
          >
            {checking ? <Loader2 size={16} className="animate-spin" /> : null}
            {checking ? 'Checking…' : 'Sign in'}
          </button>
        </form>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-[-0.02em] text-ink">Dashboard</h1>
          <p className="text-[12.5px] text-muted">
            {videos.length} published · {viewsTotal.toLocaleString()} view{viewsTotal === 1 ? '' : 's'} ·{' '}
            {drafts.length} draft{drafts.length === 1 ? '' : 's'} ·{' '}
            <a className="text-brand-600 hover:underline" href={adminPath()}>
              {adminPath().replace(/^\/+/, '')}
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => run('rebuild', async () => {
              const result = await admin.rebuild()
              setNotice(result.message)
            })}
            disabled={busy === 'rebuild'}
            className="flex h-9 items-center gap-1.5 rounded-full bg-raise px-3.5 text-[12.5px] font-semibold text-ink hover:bg-sunken"
          >
            {busy === 'rebuild' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Rebuild site
          </button>
          <button
            type="button"
            onClick={signOut}
            className="flex h-9 items-center gap-1.5 rounded-full bg-raise px-3.5 text-[12.5px] font-semibold text-ink hover:bg-sunken"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      {/* Mode switch */}
      <section className="mt-5 rounded-2xl border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-[14px] font-bold text-ink">
              <Globe size={15} className="text-brand-600" /> Site mode
            </h2>
            <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-muted">
              {settings?.mode === 'direct'
                ? 'Direct links only — no home page, no menus, no related videos. Google/Bing discover pages through sitemap.xml.'
                : 'Public catalogue — home feed, categories, search and related videos are visible.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[12px] font-semibold ${settings?.mode === 'direct' ? 'text-brand-600' : 'text-muted'}`}>
              {settings?.mode === 'direct' ? 'Direct links only' : 'Public catalogue'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={settings?.mode === 'direct'}
              aria-label="Toggle direct-link mode"
              onClick={() => switchMode(settings?.mode === 'direct' ? 'public' : 'direct')}
              disabled={busy === 'mode' || !settings}
              className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${
                settings?.mode === 'direct' ? 'bg-brand-600' : 'bg-faint'
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  settings?.mode === 'direct' ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>
        </div>
        {settings?.mode === 'direct' && (
          <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-[12px] text-brand-700">
            Videos added after the last build are not in <Code>sitemap.xml</Code> yet — press{' '}
            <strong>Rebuild site</strong> to add them.
          </p>
        )}

        {/* Home-page redirect: what happens to every non-video URL in direct mode */}
        <div className="mt-4 border-t border-line pt-4">
          <label htmlFor="redirect-url" className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <ExternalLink size={14} className="text-brand-600" /> Home-page redirect
          </label>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            While the site is in <strong>direct-link</strong> mode, anyone opening the bare domain (or any
            page that is not a video link) is sent here with a real 302. Video links, the dashboard,
            sitemap and robots are never redirected. Leave it empty to show the neutral 18+ page instead.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="redirect-url"
              type="url"
              inputMode="url"
              placeholder="https://example.com/offer"
              value={redirectDraft}
              onChange={(event) => setRedirectDraft(event.target.value)}
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-brand-500"
            />
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={saveRedirect}
                disabled={busy === 'redirect'}
                className="flex h-10 items-center gap-1.5 rounded-lg bg-action px-3.5 text-[12.5px] font-semibold text-on-action disabled:opacity-50"
              >
                {busy === 'redirect' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setRedirectDraft('')
                  void run('redirect', async () => {
                    const result = await admin.setRedirect('')
                    setSettings(result)
                    setNotice('Redirect cleared — direct mode shows the neutral 18+ page.')
                  })
                }}
                disabled={busy === 'redirect' || !settings?.redirectUrl}
                className="h-10 rounded-lg border border-line px-3 text-[12.5px] font-semibold text-muted disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>
          <p className="mt-1.5 text-[11.5px] text-muted">
            Active: {settings?.redirectUrl ? <span className="font-semibold text-ink">{settings.redirectUrl}</span> : 'off'}
          </p>
        </div>
      </section>

      {/* Tabs */}
      <div className="mt-6 flex items-center gap-2 border-b border-line pb-2">
        {(['videos', 'add', 'drafts', 'ads'] as Tab[]).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold capitalize ${
              tab === name ? 'bg-action text-on-action' : 'text-muted hover:bg-raise hover:text-ink'
            }`}
          >
            {name === 'drafts'
              ? `Drafts (${drafts.length})`
              : name === 'add'
                ? 'Add from link'
                : name === 'ads'
                  ? `Ads${settings?.ads.enabled ? ' ✓' : ''}`
                  : `Videos (${videos.length})`}
          </button>
        ))}
      </div>

      {tab === 'videos' && (
        <VideoManager
          videos={videos}
          viewsTotal={viewsTotal}
          busy={busy}
          onSave={(id, patch) =>
            run(`save:${id}`, async () => {
              await admin.updateVideo(id, patch)
              await refreshVideos()
              setNotice('Saved.')
            })
          }
          onDelete={(id) =>
            run(`delete:${id}`, async () => {
              await admin.deleteVideo(id)
              await refreshVideos()
              setNotice('Deleted.')
            })
          }
          onBulkDelete={(ids) =>
            run('bulk-delete', async () => {
              const result = await admin.bulkDeleteVideos(ids)
              await refreshVideos()
              setNotice(
                `Deleted ${result.deleted.length} video${result.deleted.length === 1 ? '' : 's'}` +
                  (result.missing.length ? ` · ${result.missing.length} were already gone` : '') +
                  '.',
              )
            })
          }
          onBulkCategory={(ids, category) =>
            run('bulk-category', async () => {
              const result = await admin.bulkPatchVideos(ids, { category })
              await refreshVideos()
              setNotice(
                `Moved ${result.updated.length} video${result.updated.length === 1 ? '' : 's'} to ${category}` +
                  (result.missing.length ? ` · ${result.missing.length} were already gone` : '') +
                  '.',
              )
            })
          }
        />
      )}

      {tab === 'add' && (
        <ScrapePanel
          onRefresh={async () => {
            await refreshDrafts()
            await refreshVideos()
          }}
          setTab={setTab}
          notify={setNotice}
          fail={setError}
        />
      )}

      {tab === 'ads' && (
        <section className="mt-4 rounded-2xl border border-line bg-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-1.5 text-[14px] font-bold text-ink">
                <Megaphone size={15} className="text-brand-600" /> Ad code
              </h2>
              <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">
                Paste each network's code into the slot where it should appear. It is injected exactly as
                given, on every page, in both modes — popunders, native units, banners, iframes. Slots
                reserve their height, so the page does not jump when an ad loads.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-[12px] font-semibold ${settings?.ads.enabled ? 'text-brand-600' : 'text-muted'}`}>
                  {settings?.ads.enabled ? 'Ads on' : 'Ads off'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(settings?.ads.enabled)}
                  aria-label="Toggle ads"
                  onClick={toggleAds}
                  disabled={busy === 'ads-toggle'}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${
                    settings?.ads.enabled ? 'bg-brand-600' : 'bg-faint'
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      settings?.ads.enabled ? 'left-6' : 'left-1'
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[12px] font-semibold ${settings?.ads.preview ? 'text-amber-600' : 'text-muted'}`}>
                  {settings?.ads.preview ? 'Preview on' : 'Preview off'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(settings?.ads.preview)}
                  aria-label="Toggle slot preview outlines"
                  onClick={toggleAdPreview}
                  disabled={busy === 'ads-preview'}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${
                    settings?.ads.preview ? 'bg-amber-500' : 'bg-faint'
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      settings?.ads.preview ? 'left-6' : 'left-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
          {settings?.ads.preview && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-700">
              <strong>Preview outlines are on.</strong> Open pages draw a dashed box wherever each slot
              sits (labelled with the slot's state), and <em>no ad code executes</em>. Switch the preview
              off when the layout is right.
            </p>
          )}

          <div className="mt-4 grid gap-4">
            {(
              [
                ['header', 'Header banner', 'Full-width leaderboard under the site header.'],
                ['native', 'Native / in-feed', 'Between sections at the end of the content column.'],
                ['sidebar', 'Sidebar', 'In the left navigation, under the links.'],
                ['footer', 'Footer', 'Above the footer, on every page.'],
                ['video', 'Video page', 'Under the player on /v/<id>/ pages.'],
                ['popunder', 'Popunder / interstitial', 'One global script. Fires once per page view.'],
              ] as [AdSlotName, string, string][]
            ).map(([slot, label, hint]) => (
              <div key={slot}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={`ad-${slot}`} className="text-[12.5px] font-semibold text-ink">
                    {label}
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={adDraft.slotsOn[slot]}
                      aria-label={`Enable the ${slot} slot`}
                      onClick={() => toggleAdSlot(slot)}
                      disabled={busy === `ads-slot:${slot}` || !adDraft[slot].trim()}
                      className="flex items-center gap-1.5 text-[11.5px] font-semibold disabled:opacity-40"
                      title={
                        adDraft[slot].trim()
                          ? 'Show or hide this slot on the site (saved immediately)'
                          : 'This slot has no code yet — paste some to enable the switch'
                      }
                    >
                      <span
                        className={`relative block h-5 w-9 shrink-0 rounded-full transition ${
                          adDraft.slotsOn[slot] ? 'bg-brand-600' : 'bg-faint'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-all ${
                            adDraft.slotsOn[slot] ? 'left-[18px]' : 'left-0.5'
                          }`}
                        />
                      </span>
                      <span className={adDraft.slotsOn[slot] ? 'text-brand-600' : 'text-muted'}>
                        {adDraft.slotsOn[slot] ? 'shown' : 'hidden'}
                      </span>
                    </button>
                    <span className="text-[11px] text-muted">
                      {adDraft[slot].length ? `${adDraft[slot].length} chars` : 'empty'}
                    </span>
                  </div>
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted">{hint}</p>
                <textarea
                  id={`ad-${slot}`}
                  value={adDraft[slot]}
                  onChange={(event) => updateAd(slot, event.target.value)}
                  rows={slot === 'popunder' ? 3 : 3}
                  spellCheck={false}
                  placeholder={slot === 'popunder' ? '<script src="…"></script>' : '<script>…</script> or <iframe …>'}
                  className="mt-1.5 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink outline-none focus:border-brand-500"
                />
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={saveAds}
              disabled={busy === 'ads'}
              className="flex h-10 items-center gap-1.5 rounded-lg bg-action px-4 text-[12.5px] font-semibold text-on-action disabled:opacity-50"
            >
              {busy === 'ads' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save ad code
            </button>
            <button
              type="button"
              onClick={clearAds}
              disabled={busy === 'ads-clear'}
              className="flex h-10 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] font-semibold text-muted disabled:opacity-40"
            >
              <Trash2 size={13} /> Clear all slots
            </button>
            {adsDirty && (
              <span className="text-[11.5px] font-semibold text-brand-700">Unsaved changes</span>
            )}
            <span className="ml-auto text-[11.5px] text-muted">
              {settings?.slots?.length ?? AD_SLOT_NAMES.length} slots · 20 KB per slot
            </span>
          </div>

          <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-[12px] leading-relaxed text-brand-700">
            A slot renders only when <strong>both</strong> switches are on: the global toggle and the
            slot's own <em>shown/hidden</em> switch. Ads also show on video links in direct mode; the
            <em> preview outlines</em> switch above draws each slot's placement instead of running its
            code. The dashboard itself stays ad-free so you always have a page that loads without
            third-party scripts. The bot can switch everything on or off with <Code>/ads on</Code> /{' '}
            <Code>/ads off</Code>.
          </p>
        </section>
      )}

      {tab === 'drafts' && (
        <DraftList
          drafts={drafts}
          busy={busy}
          onPublish={(id) =>
            run(`publish:${id}`, async () => {
              await admin.publishDraft(id)
              await refreshDrafts()
              await refreshVideos()
              setNotice('Published.')
            })
          }
          onDiscard={(id) =>
            run(`discard:${id}`, async () => {
              await admin.discardDraft(id)
              await refreshDrafts()
              setNotice('Draft discarded.')
            })
          }
          onSave={(id, patch) =>
            run(`draft:${id}`, async () => {
              await admin.updateDraft(id, patch)
              await refreshDrafts()
              setNotice('Draft updated.')
            })
          }
          onPublishAll={() =>
            run('publish-all', async () => {
              const result = await admin.publishAllDrafts()
              await refreshDrafts()
              await refreshVideos()
              setNotice(`Published ${result.published.length} video${result.published.length === 1 ? '' : 's'}.`)
            })
          }
          onDiscardAll={() =>
            run('discard-all', async () => {
              const result = await admin.discardDrafts()
              await refreshDrafts()
              setNotice(`Discarded ${result.discarded.length} draft${result.discarded.length === 1 ? '' : 's'}. Nothing was published.`)
            })
          }
        />
      )}
    </Shell>
  )
}

/* ------------------------------ video manager ----------------------------- */

/**
 * Published videos with real view counts. Search, category filter and
 * sorting (views / newest / title) all run client-side over the admin list;
 * checkbox selection drives the bulk bar (delete, recategorise). Each row
 * carries its thumbnail, views, added date, a copy-link and an open-page
 * action, plus the existing inline rename / category / delete controls.
 */
function VideoManager({
  videos,
  viewsTotal,
  busy,
  onSave,
  onDelete,
  onBulkDelete,
  onBulkCategory,
}: {
  videos: AdminVideo[]
  viewsTotal: number
  busy: string
  onSave: (id: string, patch: { title?: string; category?: string }) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
  onBulkDelete: (ids: string[]) => Promise<boolean>
  onBulkCategory: (ids: string[], category: string) => Promise<boolean>
}) {
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [bulkCategory, setBulkCategory] = useState('')
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [copiedId, setCopiedId] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = videos.filter((video) => {
      if (categoryFilter && video.category !== categoryFilter) return false
      if (!needle) return true
      return [video.id, video.title, video.category, video.site || '', (video.tags || []).join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
    return list.sort((a, b) => {
      if (sort === 'views') return b.views - a.views || (b.createdAt || 0) - (a.createdAt || 0)
      if (sort === 'title') return a.title.localeCompare(b.title)
      return (b.createdAt || 0) - (a.createdAt || 0)
    })
  }, [videos, query, categoryFilter, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / VIDEOS_PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const rows = filtered.slice((current - 1) * VIDEOS_PAGE_SIZE, current * VIDEOS_PAGE_SIZE)
  const selectedIds = useMemo(() => [...selected], [selected])
  const allFilteredSelected = filtered.length > 0 && filtered.every((video) => selected.has(video.id))

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      if (filtered.every((video) => prev.has(video.id))) return new Set()
      const next = new Set(prev)
      for (const video of filtered) next.add(video.id)
      return next
    })
  }

  async function copyLink(video: AdminVideo) {
    const link = videoUrl(video.id)
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      window.prompt('Copy this link', link)
    }
    setCopiedId(video.id)
    window.setTimeout(() => setCopiedId(''), 1600)
  }

  async function bulkDelete() {
    const ok = await onBulkDelete(selectedIds)
    if (ok) {
      setSelected(new Set())
      setConfirmBulkDelete(false)
    }
  }

  async function bulkRecategorise() {
    if (!bulkCategory) return
    const ok = await onBulkCategory(selectedIds, bulkCategory)
    if (ok) {
      setSelected(new Set())
      setBulkCategory('')
    }
  }

  if (!videos.length) {
    return (
      <p className="mt-4 rounded-2xl border border-line bg-panel p-6 text-[13px] text-muted">
        Nothing published by the bot yet. Forward a video to the bot, or add some from links.
      </p>
    )
  }

  const openHref = (id: string) => `${deployBase().replace(/\/$/, '')}${videoPath(id)}`

  return (
    <div className="mt-4">
      {/* Toolbar: search, filters, sorting, totals */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            placeholder="Search title, id, tag or site…"
            aria-label="Search videos"
            className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-3 text-[12.5px] text-ink outline-none focus:border-brand-500"
          />
        </div>
        <select
          value={categoryFilter}
          aria-label="Filter by category"
          onChange={(event) => {
            setCategoryFilter(event.target.value)
            setPage(1)
          }}
          className="h-9 rounded-lg border border-line bg-surface px-2 text-[12.5px] text-ink"
        >
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <select
          value={sort}
          aria-label="Sort videos"
          onChange={(event) => {
            setSort(event.target.value as SortKey)
            setPage(1)
          }}
          className="h-9 rounded-lg border border-line bg-surface px-2 text-[12.5px] text-ink"
        >
          <option value="newest">Newest first</option>
          <option value="views">Most views</option>
          <option value="title">Title A–Z</option>
        </select>
        <p className="ml-auto text-[11.5px] text-muted">
          {filtered.length === videos.length
            ? `${videos.length} video${videos.length === 1 ? '' : 's'}`
            : `${filtered.length} of ${videos.length}`}{' '}
          · <Eye size={11} className="inline -mt-0.5" />{' '}
          <span className="font-semibold text-ink">{viewsTotal.toLocaleString()}</span> views total
        </p>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
          <Layers size={14} className="text-brand-600" />
          <span className="text-[12px] font-bold text-brand-700">{selected.size} selected</span>
          <select
            value={bulkCategory}
            aria-label="Category for the selection"
            onChange={(event) => setBulkCategory(event.target.value)}
            className="h-8 rounded-md border border-line bg-surface px-2 text-[12px] text-ink"
          >
            <option value="">Recategorise to…</option>
            {CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void bulkRecategorise()}
            disabled={!bulkCategory || busy === 'bulk-category'}
            className="flex h-8 items-center gap-1.5 rounded-full bg-brand-600 px-3 text-[11.5px] font-semibold text-white disabled:opacity-50"
          >
            {busy === 'bulk-category' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Move
          </button>
          {confirmBulkDelete ? (
            <>
              <button
                type="button"
                onClick={() => void bulkDelete()}
                disabled={busy === 'bulk-delete'}
                className="flex h-8 items-center gap-1.5 rounded-full bg-red-600 px-3 text-[11.5px] font-semibold text-white disabled:opacity-50"
              >
                {busy === 'bulk-delete' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Confirm delete {selected.size}
              </button>
              <button
                type="button"
                onClick={() => setConfirmBulkDelete(false)}
                className="h-8 rounded-full px-2 text-[11.5px] font-semibold text-muted hover:text-ink"
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmBulkDelete(true)}
              className="flex h-8 items-center gap-1.5 rounded-full border border-red-200 px-3 text-[11.5px] font-semibold text-red-600 hover:bg-red-50"
            >
              <Trash2 size={12} /> Delete…
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-[11.5px] font-semibold text-muted hover:text-ink"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Rows */}
      <div className="mt-3 divide-y divide-line rounded-2xl border border-line bg-panel">
        <label className="flex items-center gap-3 bg-raise/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={toggleAllFiltered}
            aria-label="Select all shown videos"
            className="h-4 w-4 accent-brand-600"
          />
          {allFilteredSelected ? 'Deselect all' : 'Select all'}
          {filtered.length !== videos.length && <span className="font-normal normal-case">({filtered.length} shown)</span>}
        </label>

        {rows.map((video) => {
          const isEditing = editing === video.id
          return (
            <div key={video.id} className="flex flex-wrap items-start gap-3 p-3">
              <input
                type="checkbox"
                checked={selected.has(video.id)}
                onChange={() => toggle(video.id)}
                aria-label={`Select ${video.title}`}
                className="mt-3 h-4 w-4 shrink-0 accent-brand-600"
              />
              {video.thumbUrl ? (
                <img
                  src={video.thumbUrl}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-14 w-24 shrink-0 rounded-lg bg-raise object-cover"
                />
              ) : (
                <span className="grid h-14 w-24 shrink-0 place-items-center rounded-lg bg-raise text-muted">
                  <Film size={16} />
                </span>
              )}

              <div className="min-w-[200px] flex-1">
                {isEditing ? (
                  <input
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    autoFocus
                    className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-ink"
                  />
                ) : (
                  <p className="text-[13.5px] font-semibold leading-snug text-ink">{video.title}</p>
                )}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
                  <span className="rounded bg-raise px-1.5 py-0.5 font-mono text-[10.5px]">{video.id}</span>
                  <span>{video.kind === 'link' ? 'link' : 'telegram'}</span>
                  {video.durationSec ? <span>{formatDuration(video.durationSec)}</span> : null}
                  <span className="inline-flex items-center gap-1">
                    <Eye size={11} />
                    {video.views.toLocaleString()} view{video.views === 1 ? '' : 's'}
                  </span>
                  <span title={video.createdAt ? new Date(video.createdAt).toLocaleString() : undefined}>
                    added {relative(video.createdAt)}
                  </span>
                  {video.tooLarge && <span className="text-amber-600">too large for the feed</span>}
                  {video.sourceUrl && (
                    <a
                      href={video.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-0.5 text-brand-600 hover:underline"
                    >
                      source <ExternalLink size={10} />
                    </a>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <CategorySelect
                  value={video.category}
                  onChange={(category) => void onSave(video.id, { category })}
                />
                {isEditing ? (
                  <>
                    <IconButton
                      label="Save title"
                      onClick={() => {
                        const title = draftTitle.trim()
                        if (title) void onSave(video.id, { title })
                        setEditing(null)
                      }}
                    >
                      <Save size={15} />
                    </IconButton>
                    <IconButton label="Cancel" onClick={() => setEditing(null)}>
                      <X size={15} />
                    </IconButton>
                  </>
                ) : (
                  <IconButton
                    label="Rename"
                    onClick={() => {
                      setEditing(video.id)
                      setDraftTitle(video.title)
                    }}
                  >
                    <Pencil size={15} />
                  </IconButton>
                )}
                <IconButton label="Copy link to this video page" onClick={() => void copyLink(video)}>
                  {copiedId === video.id ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
                </IconButton>
                <a
                  href={openHref(video.id)}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="Open video page"
                  aria-label={`Open ${video.title} in a new tab`}
                  className="grid h-8 w-8 place-items-center rounded-full bg-raise text-ink hover:bg-sunken"
                >
                  <ExternalLink size={15} />
                </a>

                {confirming === video.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void onDelete(video.id)
                        setConfirming(null)
                        setSelected((prev) => {
                          const next = new Set(prev)
                          next.delete(video.id)
                          return next
                        })
                      }}
                      className="h-8 rounded-full bg-red-600 px-3 text-[11.5px] font-semibold text-white"
                    >
                      {busy === `delete:${video.id}` ? 'Deleting…' : 'Delete'}
                    </button>
                    <IconButton label="Keep" onClick={() => setConfirming(null)}>
                      <X size={15} />
                    </IconButton>
                  </>
                ) : (
                  <IconButton label="Delete" onClick={() => setConfirming(video.id)} danger>
                    <Trash2 size={15} />
                  </IconButton>
                )}
              </div>
            </div>
          )
        })}

        {!rows.length && (
          <p className="p-6 text-center text-[12.5px] text-muted">
            No videos match this search and filter.
          </p>
        )}

        {pageCount > 1 && (
          <div className="flex items-center justify-between bg-raise/50 px-3 py-2 text-[11.5px] text-muted">
            <span>
              page {current} of {pageCount} · showing {rows.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous page"
                disabled={current <= 1}
                onClick={() => setPage(current - 1)}
                className="grid h-7 w-7 place-items-center rounded-full bg-surface hover:bg-sunken disabled:opacity-40"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                aria-label="Next page"
                disabled={current >= pageCount}
                onClick={() => setPage(current + 1)}
                className="grid h-7 w-7 place-items-center rounded-full bg-surface hover:bg-sunken disabled:opacity-40"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------- bulk scrape -------------------------------- */

/**
 * “Add from link” as a bulk job: paste up to 20 URLs (one per line) or a
 * single gallery URL, and each entry is scraped sequentially through the same
 * Worker endpoint the bot uses. Per URL the panel shows queued → scraping →
 * scraped (with the draft count), blocked (the page refused us) or duplicate
 * (its source is already on the site or in drafts). When the run ends, publish
 * everything that came in, review it draft by draft, or discard the batch —
 * the drafts themselves stay owned by the review flow either way.
 */
function ScrapePanel({
  onRefresh,
  setTab,
  notify,
  fail,
}: {
  onRefresh: () => Promise<void>
  setTab: (tab: Tab) => void
  notify: (message: string) => void
  fail: (message: string) => void
}) {
  const [input, setInput] = useState('')
  const [rows, setRows] = useState<ScrapeRow[]>([])
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)
  const [action, setAction] = useState('')
  const collected = useRef<string[]>([])

  const urls = useMemo(() => parseScrapeUrls(input), [input])
  const targets = urls.slice(0, MAX_SCRAPE_URLS)
  const overflow = Math.max(0, urls.length - targets.length)

  function updateRow(index: number, patch: Partial<ScrapeRow>) {
    setRows((prev) => prev.map((row, position) => (position === index ? { ...row, ...patch } : row)))
  }

  async function start() {
    if (!targets.length || running) return
    setRunning(true)
    setFinished(false)
    collected.current = []
    setRows(targets.map((url) => ({ url, status: 'queued', count: 0, message: '' })))
    let draftCount = 0
    let scraped = 0
    let duplicates = 0
    let blocked = 0
    for (const [index, url] of targets.entries()) {
      updateRow(index, { status: 'scraping' })
      try {
        const result = await admin.scrape(url)
        const made = result.drafts.length
        collected.current.push(...result.drafts.map((draft) => draft.id))
        draftCount += made
        if (made) {
          scraped += 1
          updateRow(index, {
            status: 'scraped',
            count: made,
            message: [result.site, result.duplicates ? `${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} skipped` : '']
              .filter(Boolean)
              .join(' · '),
          })
        } else {
          duplicates += 1
          updateRow(index, {
            status: 'duplicate',
            count: result.duplicates || 0,
            message: 'everything here is already on the site or in drafts',
          })
        }
      } catch (cause) {
        blocked += 1
        updateRow(index, {
          status: 'blocked',
          message: cause instanceof AdminError ? cause.message : String(cause),
        })
      }
    }
    await onRefresh().catch(() => {})
    setRunning(false)
    setFinished(true)
    notify(
      `Bulk scrape done: ${scraped} scraped (${draftCount} draft${draftCount === 1 ? '' : 's'}), ${duplicates} duplicate, ${blocked} blocked. Nothing is public until published.`,
    )
  }

  function reset() {
    setRows([])
    setFinished(false)
    collected.current = []
    setInput('')
  }

  const summary = useMemo(() => {
    const scraped = rows.filter((row) => row.status === 'scraped').length
    const duplicates = rows.filter((row) => row.status === 'duplicate').length
    const blocked = rows.filter((row) => row.status === 'blocked').length
    return { scraped, duplicates, blocked, done: rows.filter((row) => row.status !== 'queued' && row.status !== 'scraping').length }
  }, [rows])

  async function publishBatch() {
    setAction('publish')
    try {
      const result = await admin.publishAllDrafts(collected.current)
      await onRefresh()
      notify(`Published ${result.published.length} video${result.published.length === 1 ? '' : 's'} from this batch.`)
      reset()
    } catch (cause) {
      fail(cause instanceof AdminError ? cause.message : String(cause))
    } finally {
      setAction('')
    }
  }

  async function discardBatch() {
    setAction('discard')
    try {
      const result = await admin.discardDrafts(collected.current)
      await onRefresh()
      notify(`Discarded ${result.discarded.length} draft${result.discarded.length === 1 ? '' : 's'} — nothing was published.`)
      reset()
    } catch (cause) {
      fail(cause instanceof AdminError ? cause.message : String(cause))
    } finally {
      setAction('')
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-4">
      <h2 className="flex items-center gap-1.5 text-[14px] font-bold text-ink">
        <Search size={15} className="text-brand-600" /> Scrape links in bulk
      </h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        One URL per line — up to <strong>{MAX_SCRAPE_URLS}</strong> — or a single gallery page, which
        turns into one draft per video found on it. URLs are scraped one after another so a blocked
        page never aborts the rest. Nothing is published until you confirm it.
      </p>
      <textarea
        value={input}
        onChange={(event) => setInput(event.target.value)}
        rows={5}
        spellCheck={false}
        placeholder={'https://example.com/video/abc\nhttps://example.com/gallery/latest'}
        aria-label="URLs to scrape, one per line"
        className="mt-3 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-brand-500"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void start()}
          disabled={running || !targets.length}
          className="flex h-10 items-center gap-2 rounded-full bg-brand-600 px-5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {running ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          {running ? `Scraping ${summary.done}/${targets.length}…` : `Scrape ${targets.length || ''} link${targets.length === 1 ? '' : 's'}`}
        </button>
        <span className="text-[11.5px] text-muted">
          {urls.length
            ? `${targets.length} URL${targets.length === 1 ? '' : 's'} ready${overflow ? ` · ${overflow} over the limit are skipped` : ''}`
            : 'paste at least one http(s) link'}
        </span>
      </div>

      {rows.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
          {rows.map((row, index) => (
            <li key={`${row.url}-${index}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <code className="max-h-4 min-w-[200px] flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-muted" title={row.url}>
                {row.url}
              </code>
              <ScrapeStatusChip status={row.status} count={row.count} />
              {row.message && <span className="max-w-full truncate text-[11px] text-muted">{row.message}</span>}
            </li>
          ))}
        </ul>
      )}

      {finished && collected.current.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-raise px-3 py-2">
          <span className="text-[12px] font-semibold text-ink">
            {collected.current.length} draft{collected.current.length === 1 ? '' : 's'} from this batch
          </span>
          <button
            type="button"
            onClick={() => void publishBatch()}
            disabled={action !== ''}
            className="flex h-9 items-center gap-1.5 rounded-full bg-brand-600 px-4 text-[12.5px] font-semibold text-white disabled:opacity-50"
          >
            {action === 'publish' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Publish all
          </button>
          <button
            type="button"
            onClick={() => setTab('drafts')}
            disabled={action !== ''}
            className="h-9 rounded-full bg-surface px-4 text-[12.5px] font-semibold text-ink disabled:opacity-50"
          >
            Review each
          </button>
          <button
            type="button"
            onClick={() => void discardBatch()}
            disabled={action !== ''}
            className="flex h-9 items-center gap-1.5 rounded-full border border-line px-4 text-[12.5px] font-semibold text-red-600 disabled:opacity-50"
          >
            {action === 'discard' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            Discard batch
          </button>
        </div>
      )}
    </section>
  )
}

function parseScrapeUrls(value: string): string[] {
  const seen = new Set<string>()
  for (const piece of value.split(/\s+/)) {
    const url = piece.trim().replace(/[,;]+$/, '')
    if (url && /^https?:\/\//i.test(url)) seen.add(url)
  }
  return [...seen]
}

const SCRAPE_STATUS_STYLE: Record<ScrapeStatus, string> = {
  queued: 'bg-raise text-muted',
  scraping: 'bg-brand-100 text-brand-700',
  scraped: 'bg-emerald-100 text-emerald-700',
  duplicate: 'bg-amber-100 text-amber-700',
  blocked: 'bg-red-100 text-red-600',
}

function ScrapeStatusChip({ status, count }: { status: ScrapeStatus; count: number }) {
  const label =
    status === 'scraped'
      ? `scraped · ${count}`
      : status === 'duplicate'
        ? count
          ? `duplicate · ${count}`
          : 'duplicate'
        : status === 'scraping'
          ? 'scraping…'
          : status
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${SCRAPE_STATUS_STYLE[status]}`}
      data-scrape-status={status}
    >
      {status === 'scraping' && <Loader2 size={10} className="animate-spin" />}
      {label}
    </span>
  )
}

/* -------------------------------- pieces ---------------------------------- */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-[1000px]">{children}</div>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-raise px-1 py-0.5 text-[11.5px]">{children}</code>
}

function Notice({ tone, children }: { tone: 'ok' | 'error' | 'warn'; children: React.ReactNode }) {
  const styles =
    tone === 'ok'
      ? 'bg-emerald-50 text-emerald-700'
      : tone === 'error'
        ? 'bg-red-50 text-red-600'
        : 'bg-amber-50 text-amber-700'
  return <p className={`mt-3 rounded-lg px-3 py-2 text-[12.5px] font-medium ${styles}`}>{children}</p>
}

function CategorySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-md border border-line bg-surface px-2 text-[12px] text-ink"
    >
      {CATEGORY_OPTIONS.map((category) => (
        <option key={category} value={category}>
          {category}
        </option>
      ))}
    </select>
  )
}

function DraftList({
  drafts,
  busy,
  onPublish,
  onDiscard,
  onSave,
  onPublishAll,
  onDiscardAll,
}: {
  drafts: AdminDraft[]
  busy: string
  onPublish: (id: string) => void
  onDiscard: (id: string) => void
  onSave: (id: string, patch: { title?: string; category?: string }) => void
  onPublishAll: () => void
  onDiscardAll: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const batches = useMemo(() => new Set(drafts.map((draft) => draft.batchId)).size, [drafts])

  if (!drafts.length) {
    return (
      <p className="mt-4 rounded-2xl border border-line bg-panel p-6 text-[13px] text-muted">
        No drafts waiting. Use <strong>Add from link</strong> to scrape a page or a whole batch of
        links — nothing is published until you confirm it here.
      </p>
    )
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted">
          {drafts.length} draft{drafts.length === 1 ? '' : 's'}
          {batches > 1 ? ` in ${batches} batches` : ''} · nothing is public until published
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDiscardAll}
            disabled={busy === 'discard-all'}
            className="flex h-9 items-center gap-1.5 rounded-full border border-line px-4 text-[12.5px] font-semibold text-red-600 disabled:opacity-50"
          >
            <Trash2 size={14} /> Discard all
          </button>
          <button
            type="button"
            onClick={onPublishAll}
            disabled={busy === 'publish-all'}
            className="flex h-9 items-center gap-1.5 rounded-full bg-brand-600 px-4 text-[12.5px] font-semibold text-white disabled:opacity-50"
          >
            {busy === 'publish-all' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Publish all
          </button>
        </div>
      </div>

      <div className="mt-3 divide-y divide-line rounded-2xl border border-line bg-panel">
        {drafts.map((draft) => {
          const isEditing = editing === draft.id
          return (
            <div key={draft.id} className="flex flex-wrap items-start gap-3 p-3">
              {draft.thumbUrl ? (
                <img
                  src={draft.thumbUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-14 w-20 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="grid h-14 w-20 shrink-0 place-items-center rounded-lg bg-raise text-muted">
                  <Film size={16} />
                </span>
              )}

              <div className="min-w-[200px] flex-1">
                {isEditing ? (
                  <input
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    autoFocus
                    className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-ink"
                  />
                ) : (
                  <p className="text-[13.5px] font-semibold leading-snug text-ink">{draft.title}</p>
                )}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
                  {draft.site && <span>{draft.site}</span>}
                  {draft.durationSec ? <span>{formatDuration(draft.durationSec)}</span> : null}
                  <a
                    href={draft.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex max-w-[320px] items-center gap-0.5 truncate text-brand-600 hover:underline"
                  >
                    {draft.sourceUrl} <ExternalLink size={10} />
                  </a>
                </p>
                {draft.description && (
                  <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted">{draft.description}</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <CategorySelect value={draft.category} onChange={(category) => onSave(draft.id, { category })} />
                {isEditing ? (
                  <>
                    <IconButton
                      label="Save title"
                      onClick={() => {
                        const title = draftTitle.trim()
                        if (title) onSave(draft.id, { title })
                        setEditing(null)
                      }}
                    >
                      <Save size={15} />
                    </IconButton>
                    <IconButton label="Cancel" onClick={() => setEditing(null)}>
                      <X size={15} />
                    </IconButton>
                  </>
                ) : (
                  <IconButton
                    label="Edit title"
                    onClick={() => {
                      setEditing(draft.id)
                      setDraftTitle(draft.title)
                    }}
                  >
                    <Pencil size={15} />
                  </IconButton>
                )}
                <button
                  type="button"
                  onClick={() => onPublish(draft.id)}
                  disabled={busy === `publish:${draft.id}`}
                  className="h-8 rounded-full bg-emerald-600 px-3 text-[11.5px] font-semibold text-white disabled:opacity-50"
                >
                  {busy === `publish:${draft.id}` ? 'Publishing…' : 'Publish'}
                </button>
                <IconButton label="Discard" onClick={() => onDiscard(draft.id)} danger>
                  <Trash2 size={15} />
                </IconButton>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  children,
  danger = false,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`grid h-8 w-8 place-items-center rounded-full bg-raise hover:bg-sunken ${
        danger ? 'text-red-600' : 'text-ink'
      }`}
    >
      {children}
    </button>
  )
}
