import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Check,
  ExternalLink,
  Film,
  Globe,
  Megaphone,
  Loader2,
  LogOut,
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
import { adminPath } from '../lib/site'
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
 * mode, manage published videos (rename / recategorise / delete), scrape links
 * into drafts, review and publish them, and trigger a rebuild. It talks to the
 * Worker's admin API with the `ADMIN_TOKEN` the owner set there; the token is
 * held in sessionStorage for this tab only.
 */

type Tab = 'videos' | 'add' | 'drafts' | 'ads'

const CATEGORY_OPTIONS = [...CATEGORIES]

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
  const [drafts, setDrafts] = useState<AdminDraft[]>([])
  const [tab, setTab] = useState<Tab>('videos')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [scrapeUrl, setScrapeUrl] = useState('')
  const [redirectDraft, setRedirectDraft] = useState('')
  const [adDraft, setAdDraft] = useState<AdConfig>(() => ({ ...EMPTY_ADS }))
  // Unsaved ad edits must not be overwritten by a background refresh.
  const [adsDirty, setAdsDirty] = useState(false)

  useEffect(() => {
    applyNeutralMeta()
    document.title = 'AfterDark — dashboard'
  }, [])

  const loadAll = useCallback(async () => {
    const [nextSettings, nextVideos, nextDrafts] = await Promise.all([
      admin.settings(),
      admin.videos(),
      admin.drafts(),
    ])
    setSettings(nextSettings)
    setVideos(nextVideos.videos)
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

  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setBusy(label)
      setError('')
      setNotice('')
      try {
        await action()
      } catch (cause) {
        setError(cause instanceof AdminError ? cause.message : String(cause))
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
            {videos.length} published · {drafts.length} draft{drafts.length === 1 ? '' : 's'} ·{' '}
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
        <VideoTable
          videos={videos}
          busy={busy}
          onSave={(id, patch) =>
            run(`save:${id}`, async () => {
              await admin.updateVideo(id, patch)
              setVideos(await admin.videos().then((result) => result.videos))
              setNotice('Saved.')
            })
          }
          onDelete={(id) =>
            run(`delete:${id}`, async () => {
              await admin.deleteVideo(id)
              setVideos(await admin.videos().then((result) => result.videos))
              setNotice('Deleted.')
            })
          }
        />
      )}

      {tab === 'add' && (
        <section className="mt-4 rounded-2xl border border-line bg-panel p-4">
          <h2 className="flex items-center gap-1.5 text-[14px] font-bold text-ink">
            <Search size={15} className="text-brand-600" /> Scrape a page
          </h2>
          <p className="mt-1 text-[12.5px] text-muted">
            Paste a video or gallery URL. Nothing is published until you confirm it in Drafts.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const url = scrapeUrl.trim()
              if (!url) return
              void run('scrape', async () => {
                const result = await admin.scrape(url)
                setDrafts(await admin.drafts().then((data) => data.drafts))
                setScrapeUrl('')
                setTab('drafts')
                setNotice(
                  `Found ${result.drafts.length} video${result.drafts.length === 1 ? '' : 's'}${
                    result.site ? ` on ${result.site}` : ''
                  }. Review and publish below.`,
                )
              })
            }}
            className="mt-3 flex flex-wrap gap-2"
          >
            <input
              value={scrapeUrl}
              onChange={(event) => setScrapeUrl(event.target.value)}
              placeholder="https://example.com/video/…"
              spellCheck={false}
              className="h-11 min-w-[260px] flex-1 rounded-lg border border-line bg-surface px-3 text-[13.5px] text-ink"
            />
            <button
              type="submit"
              disabled={busy === 'scrape' || !scrapeUrl.trim()}
              className="flex h-11 items-center gap-2 rounded-full bg-brand-600 px-5 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {busy === 'scrape' ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              Scrape
            </button>
          </form>
        </section>
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
          </div>

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
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`ad-${slot}`} className="text-[12.5px] font-semibold text-ink">
                    {label}
                  </label>
                  <span className="text-[11px] text-muted">
                    {adDraft[slot].length ? `${adDraft[slot].length} chars` : 'empty'}
                  </span>
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
            Ads also show on video links in direct mode, and on the dashboard? No — the dashboard stays
            clean so you always have a page that loads without third-party scripts. The bot can switch
            them on or off with <Code>/ads on</Code> / <Code>/ads off</Code>.
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
              setDrafts(await admin.drafts().then((data) => data.drafts))
              setVideos(await admin.videos().then((data) => data.videos))
              setNotice('Published.')
            })
          }
          onDiscard={(id) =>
            run(`discard:${id}`, async () => {
              await admin.discardDraft(id)
              setDrafts(await admin.drafts().then((data) => data.drafts))
              setNotice('Draft discarded.')
            })
          }
          onSave={(id, patch) =>
            run(`draft:${id}`, async () => {
              await admin.updateDraft(id, patch)
              setDrafts(await admin.drafts().then((data) => data.drafts))
              setNotice('Draft updated.')
            })
          }
          onPublishAll={() =>
            run('publish-all', async () => {
              const result = await admin.publishAllDrafts()
              setDrafts(await admin.drafts().then((data) => data.drafts))
              setVideos(await admin.videos().then((data) => data.videos))
              setNotice(`Published ${result.published.length} video${result.published.length === 1 ? '' : 's'}.`)
            })
          }
        />
      )}
    </Shell>
  )
}

/* ------------------------------- pieces ---------------------------------- */

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

function VideoTable({
  videos,
  busy,
  onSave,
  onDelete,
}: {
  videos: AdminVideo[]
  busy: string
  onSave: (id: string, patch: { title?: string; category?: string }) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)

  if (!videos.length) {
    return (
      <p className="mt-4 rounded-2xl border border-line bg-panel p-6 text-[13px] text-muted">
        Nothing published by the bot yet. Forward a video to the bot, or add one from a link.
      </p>
    )
  }

  return (
    <div className="mt-4 divide-y divide-line rounded-2xl border border-line bg-panel">
      {videos.map((video) => {
        const isEditing = editing === video.id
        return (
          <div key={video.id} className="flex flex-wrap items-start gap-3 p-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-raise text-muted">
              <Film size={16} />
            </span>

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
                <span>added {relative(video.createdAt)}</span>
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
                onChange={(category) => onSave(video.id, { category })}
              />
              {isEditing ? (
                <>
                  <IconButton
                    label="Save title"
                    onClick={() => {
                      const title = draftTitle.trim()
                      if (title) onSave(video.id, { title })
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

              {confirming === video.id ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(video.id)
                      setConfirming(null)
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
    </div>
  )
}

function DraftList({
  drafts,
  busy,
  onPublish,
  onDiscard,
  onSave,
  onPublishAll,
}: {
  drafts: AdminDraft[]
  busy: string
  onPublish: (id: string) => void
  onDiscard: (id: string) => void
  onSave: (id: string, patch: { title?: string; category?: string }) => void
  onPublishAll: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const batches = useMemo(() => new Set(drafts.map((draft) => draft.batchId)).size, [drafts])

  if (!drafts.length) {
    return (
      <p className="mt-4 rounded-2xl border border-line bg-panel p-6 text-[13px] text-muted">
        No drafts waiting. Use <strong>Add from link</strong> to scrape a page — nothing is published
        until you confirm it here.
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
