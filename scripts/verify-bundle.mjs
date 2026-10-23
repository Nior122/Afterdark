#!/usr/bin/env node
/**
 * Runs the *built* bundle in jsdom, the way a browser does.
 *
 *   npm i --no-save jsdom        # once; deliberately not a dependency
 *   VITE_TELEGRAM_FEED_URL=https://worker.test npm run build   # the scenarios
 *     expect a Worker origin to point at, so the bundle must be built with it
 *   npm run verify:bundle        # after that build
 *
 * Why this exists: `verify` inspects static HTML and `verify:render` renders
 * components in isolation, so both missed a crash where the age gate rendered
 * the wordmark — a react-router <Link> — outside any router. Every URL,
 * including /admin/, rendered an empty <div id="root"> over a dark body: a
 * black screen with a 200 status. This check mounts the real production
 * bundle, first visit (no localStorage), and fails if the page is empty.
 *
 * Scenarios covered: first visit, returning visitor, direct mode, an
 * unreachable Worker, a Worker that never answers, a video page and the
 * dashboard; the ads pipeline (global toggle, per-slot switch, preview
 * outlines); the view counter POST (/api/videos/:id/view with a browser
 * session id); and the dashboard's admin list with views, total and the
 * bulk-management controls.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const assetDir = join(dist, 'assets')
const bundleName = readdirSync(assetDir).find((file) => /^index-.*\.js$/.test(file))
if (!bundleName) {
  console.error('No bundle in dist/assets — run `npm run build` first.')
  process.exit(1)
}
const shell = readFileSync(join(dist, 'index.html'), 'utf8')

// The build's own <base href> decides the path the app is mounted under, so
// the probe must visit URLs underneath it ("/" vs "/Afterdark/").
const basePath = (/<base\s+href="([^"]*)"/i.exec(shell)?.[1] || '/').replace(/^\/+/, '/')
const origin = 'https://site.test'
const urlFor = (path) => `${origin}${basePath}${path.replace(/^\/+/, '')}`

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Every Worker request the bundle makes, so scenarios can assert on it. */
const apiCalls = []

/** Only the Worker is simulated; asset/module requests must resolve normally. */
const onlyWorker = (behaviour) => (input, init) => {
  const url = String(input)
  if (!url.includes('workers.dev') && !url.includes('/api/')) {
    return Promise.resolve(new Response('/* stub */', { status: 200, headers: { 'Content-Type': 'text/javascript' } }))
  }
  apiCalls.push({
    url,
    method: String(init?.method || 'GET').toUpperCase(),
    body: typeof init?.body === 'string' ? init.body : '',
  })
  return behaviour(url, init)
}

const adsFixture = {
  enabled: true,
  preview: false,
  header: '<div id="ad-header-probe">HEADER AD</div>',
  native: '<div id="ad-native-probe">NATIVE AD</div>',
  sidebar: '',
  footer: '',
  video: '<div id="ad-video-probe">VIDEO AD</div>',
  popunder: '<script>window.__popunderProbe = true</script>',
}

const adsFixture_ = { ...adsFixture, enabled: false, header: '', native: '', sidebar: '', footer: '', video: '', popunder: '' }

const okWorker = (mode, extra = {}) => onlyWorker((url) => {
  if (url.endsWith('/api/settings')) {
    return Promise.resolve(new Response(JSON.stringify({ mode, redirectUrl: '', ads: { ...adsFixture_, ...(extra.ads || {}) } }), { status: 200 }))
  }
  if (url.endsWith('/api/videos')) return Promise.resolve(new Response(JSON.stringify({ videos: [] }), { status: 200 }))
  if (url.includes('/api/admin/')) return Promise.resolve(new Response(JSON.stringify({ mode, modes: ['public', 'direct'], videos: [], drafts: [] }), { status: 200 }))
  return Promise.resolve(new Response('{}', { status: 200 }))
})

/**
 * Worker double for the signed-in dashboard: answers the admin endpoints the
 * Videos tab drives, with view counts so the total/sort UI can be asserted.
 */
const dashboardWorker = (mode) => onlyWorker((url, init) => {
  if (init?.method === 'POST' && /\/api\/admin\/videos\/bulk-(delete|patch)$/.test(url)) {
    return Promise.resolve(new Response(JSON.stringify({ ok: true, deleted: [], missing: [], updated: [] }), { status: 200 }))
  }
  if (url.endsWith('/api/admin/settings')) {
    return Promise.resolve(new Response(JSON.stringify({
      mode, modes: ['public', 'direct'], redirectUrl: '', ads: { ...adsFixture_ },
      slots: ['header', 'native', 'sidebar', 'footer', 'video', 'popunder'],
      updatedAt: null, adsUpdatedAt: null, github: false, feedUrl: origin,
    }), { status: 200 }))
  }
  if (url.endsWith('/api/admin/videos')) {
    return Promise.resolve(new Response(JSON.stringify({
      videos: [{
        id: 'w-viewfixture', title: 'Views Fixture Video', category: 'POV', tags: ['POV'],
        durationSec: 120, kind: 'link', tooLarge: false, views: 1234,
        sourceUrl: 'https://source.test/video/1', thumbUrl: 'https://source.test/t.jpg',
        streamUrl: null, description: '', site: 'source.test', createdAt: Date.now(), updatedAt: null,
      }],
      total: 1,
      viewsTotal: 1234,
    }), { status: 200 }))
  }
  if (url.endsWith('/api/admin/drafts')) return Promise.resolve(new Response(JSON.stringify({ drafts: [] }), { status: 200 }))
  if (url.endsWith('/api/settings')) return Promise.resolve(new Response(JSON.stringify({ mode, redirectUrl: '', ads: { ...adsFixture_ } }), { status: 200 }))
  if (url.endsWith('/api/videos')) return Promise.resolve(new Response(JSON.stringify({ videos: [] }), { status: 200 }))
  return Promise.resolve(new Response('{}', { status: 200 }))
})

const scenarios = [
  {
    name: 'first visit (no localStorage) shows the age gate',
    path: '/',
    fetch: okWorker('public'),
    expect: (text) => /18\+ only/i.test(text),
  },
  {
    name: 'returning visitor sees the catalogue',
    path: '/',
    fetch: okWorker('public'),
    accepted: true,
    expect: (text) => /Latest videos|Popular categories/i.test(text),
  },
  {
    name: 'direct mode hides the catalogue',
    path: '/',
    fetch: okWorker('direct'),
    accepted: true,
    expect: (text) => !/Latest videos|Popular categories/i.test(text),
  },
  {
    name: 'unreachable Worker still paints the gate',
    path: '/',
    fetch: onlyWorker(() => Promise.reject(new Error('network down'))),
    expect: (text) => /18\+ only/i.test(text),
  },
  {
    name: 'Worker that never answers still paints',
    path: '/',
    fetch: onlyWorker(() => new Promise(() => {})),
    expect: (text) => /18\+ only/i.test(text),
  },
  {
    name: 'video page renders standalone in direct mode',
    path: '/v/v-pov-kat-mar10/',
    fetch: okWorker('direct'),
    accepted: true,
    expect: (text) => /Kat Mar10/i.test(text),
    noAnchors: true,
  },
  {
    name: 'video page reports a view to the Worker (per-session dedupe is server-side)',
    path: '/v/v-pov-kat-mar10/',
    fetch: okWorker('direct'),
    accepted: true,
    noAnchors: true,
    expect: (text) => /Kat Mar10/i.test(text),
    probe: (calls) => [
      ['POST /api/videos/:id/view fired', calls.some(
        (call) => call.method === 'POST' && /\/api\/videos\/v-pov-kat-mar10\/view$/.test(call.url),
      )],
      ['view POST carries a browser session id', calls.some(
        (call) => call.method === 'POST' && /\/view$/.test(call.url) && /"session":"s-/.test(call.body),
      )],
    ],
  },
  {
    name: 'a shared /v/ link follows the site into public mode instead of staying standalone',
    path: '/v/v-pov-kat-mar10/',
    fetch: okWorker('public'),
    accepted: true,
    expect: (text) => /Opening this video on the site/i.test(text),
  },
  {
    name: 'caption-less bot videos show no "Source" line on video pages',
    path: '/v/tg-nodesc/',
    fetch: onlyWorker((url) => {
      if (url.endsWith('/api/settings')) {
        return Promise.resolve(new Response(JSON.stringify({ mode: 'direct', redirectUrl: '', ads: { ...adsFixture_ } }), { status: 200 }))
      }
      if (url.endsWith('/api/videos')) {
        return Promise.resolve(new Response(JSON.stringify({
          videos: [{
            id: 'tg-nodesc', title: 'Bare Upload', description: '', category: 'Homemade',
            tags: ['Homemade'], durationSec: 9, kind: 'telegram',
            streamUrl: 'https://worker.test/api/videos/tg-nodesc/stream.mp4',
            thumbUrl: null, sourceUrl: null, site: 'Telegram', createdAt: Date.now(), updatedAt: null,
          }],
        }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    }),
    accepted: true,
    expect: (text) =>
      /Bare Upload/.test(text) &&
      /Homemade · 0:09/.test(text) &&
      !/Source:/i.test(text),
  },
  {
    name: 'the watch page never prints the Worker’s own stream URL',
    path: '#/watch/tg-leaktest',
    accepted: true,
    fetch: onlyWorker((url) => {
      if (url.endsWith('/api/settings')) {
        return Promise.resolve(new Response(JSON.stringify({ mode: 'public', redirectUrl: '', ads: { ...adsFixture_ } }), { status: 200 }))
      }
      if (url.endsWith('/api/videos')) {
        return Promise.resolve(new Response(JSON.stringify({
          videos: [{
            id: 'tg-leaktest', title: 'Caption Only Video', description: 'my private caption',
            category: 'POV', tags: ['POV'], durationSec: 8, kind: 'telegram',
            streamUrl: 'https://worker.test/api/videos/tg-leaktest/stream.mp4',
            thumbUrl: null, sourceUrl: null, createdAt: Date.now(), updatedAt: null,
          }],
        }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    }),
    expect: (text) =>
      /Caption Only Video/.test(text) &&
      /my private caption/.test(text) &&
      !/stream\.mp4/.test(text) &&
      !/Copy page link/i.test(text),
    probe: (calls) => [
      ['view still reported from the watch page', calls.some(
        (call) => call.method === 'POST' && /\/api\/videos\/tg-leaktest\/view$/.test(call.url),
      )],
    ],
  },
  {
    name: 'dashboard shows sign-in, never age-gated',
    path: '/admin/',
    fetch: okWorker('public'),
    expect: (text) => /Owner sign-in|ADMIN_TOKEN/i.test(text),
  },
  {
    name: 'dashboard is reachable in direct mode too',
    path: '/admin/',
    fetch: okWorker('direct'),
    expect: (text) => /Owner sign-in|ADMIN_TOKEN/i.test(text),
  },
  {
    name: 'a stalled Worker turns sign-in into a message, not a permanent spinner',
    path: '/admin/',
    session: { 'afterdark.admin.v1': 'probe-admin-token' },
    fetch: (() => {
      const base = dashboardWorker('public')
      return onlyWorker((url, init) => {
        // signIn() probes GET /api/admin/settings; reject the way the browser
        // rejects a fetch whose AbortSignal.timeout fires.
        if (url.endsWith('/api/admin/settings')) {
          return Promise.reject(Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' }))
        }
        return base(url, init)
      })
    })(),
    expect: (text) => /did not answer within/i.test(text) && !/Checking…/.test(text),
  },
  {
    name: 'signed-in dashboard lists views, the total and bulk controls',
    path: '/admin/',
    fetch: dashboardWorker('public'),
    accepted: true,
    session: { 'afterdark.admin.v1': 'probe-admin-token' },
    expect: (text) =>
      /Views Fixture Video/.test(text) &&
      /1,234 views total/.test(text) &&
      /Most views/.test(text),
    probes: (window) => [
      ['sort select present', Boolean(window.document.querySelector('select[aria-label="Sort videos"]'))],
      ['category filter present', Boolean(window.document.querySelector('select[aria-label="Filter by category"]'))],
      ['search field present', Boolean(window.document.querySelector('input[aria-label="Search videos"]'))],
      ['select-all checkbox present', Boolean(window.document.querySelector('input[type="checkbox"][aria-label="Select all shown videos"]'))],
      ['per-row copy-link action', Boolean(window.document.querySelector('button[aria-label="Copy link to this video page"]'))],
      ['per-row open-page action', Boolean(window.document.querySelector('a[target="_blank"][href$="/v/w-viewfixture/"]'))],
    ],
  },
  {
    name: 'signed-in dashboard survives a Worker from before the ads fields',
    path: '/admin/',
    accepted: true,
    session: { 'afterdark.admin.v1': 'probe-admin-token' },
    fetch: onlyWorker((url) => {
      // The pre-ads Worker shape: no `ads`, no `slots`, no `total`/`views`,
      // no `adsUpdatedAt`. The client normalises it — it must not crash the
      // ErrorBoundary over the dashboard (that crash read as "admin is
      // redirecting to an error page" from the owner's side).
      if (url.endsWith('/api/admin/settings')) {
        return Promise.resolve(new Response(JSON.stringify({
          mode: 'public', modes: ['public', 'direct'], redirectUrl: '',
          updatedAt: null, github: false, feedUrl: origin,
        }), { status: 200 }))
      }
      if (url.endsWith('/api/admin/videos')) {
        return Promise.resolve(new Response(JSON.stringify({
          videos: [{
            id: 'w-oldfixture', title: 'Old Worker Fixture', category: 'POV', tags: [],
            durationSec: 60, kind: 'link', sourceUrl: 'https://source.test/v1', thumbUrl: null,
            streamUrl: null, description: '', site: 'source.test', createdAt: Date.now(), updatedAt: null,
          }],
        }), { status: 200 }))
      }
      if (url.endsWith('/api/admin/drafts')) return Promise.resolve(new Response(JSON.stringify({ drafts: [] }), { status: 200 }))
      if (url.endsWith('/api/settings')) return Promise.resolve(new Response(JSON.stringify({ mode: 'public', redirectUrl: '' }), { status: 200 }))
      if (url.endsWith('/api/videos')) return Promise.resolve(new Response(JSON.stringify({ videos: [] }), { status: 200 }))
      return Promise.resolve(new Response('{}', { status: 200 }))
    }),
    expect: (text) =>
      !/Something went wrong/i.test(text) &&
      /Old Worker Fixture/.test(text) &&
      /Ads/i.test(text) &&
      // The banner must name the staleness and how to fix it — not just
      // silently show defaults that never save.
      /predates the dashboard/i.test(text) &&
      /wrangler deploy/i.test(text),
    probes: (window) => [
      ['videos total falls back to the list length', !/views total/i.test(window.document.body.textContent || '') || /0 views total/.test(window.document.body.textContent || '')],
    ],
  },
  {
    name: 'ad slots render the owner code',
    path: '/',
    fetch: okWorker('public', { ads: adsFixture }),
    accepted: true,
    expect: (text) => /HEADER AD/.test(text) && /NATIVE AD/.test(text),
    probes: (window) => [
      ['header slot injected', Boolean(window.document.querySelector('[data-ad-slot="header"] #ad-header-probe'))],
      ['native slot injected', Boolean(window.document.querySelector('[data-ad-slot="native"] #ad-native-probe'))],
      ['no empty sidebar slot', !window.document.querySelector('[data-ad-slot="sidebar"]')],
    ],
  },
  {
    name: 'ads switched off render nothing',
    path: '/',
    fetch: okWorker('public', { ads: { ...adsFixture, enabled: false } }),
    accepted: true,
    expect: (text) => !/HEADER AD/.test(text),
    probes: (window) => [['no ad containers at all', window.document.querySelectorAll('[data-ad-slot]').length === 0]],
  },
  {
    name: 'per-slot switch hides just that slot',
    path: '/',
    fetch: okWorker('public', { ads: { ...adsFixture, slotsOn: { header: false, native: true } } }),
    accepted: true,
    expect: (text) => !/HEADER AD/.test(text) && /NATIVE AD/.test(text),
    probes: (window) => [
      ['disabled header not rendered', !window.document.querySelector('[data-ad-slot="header"]')],
      ['enabled native still renders', Boolean(window.document.querySelector('[data-ad-slot="native"] #ad-native-probe'))],
    ],
  },
  {
    name: 'preview mode outlines every slot and runs no ad code',
    path: '/',
    fetch: okWorker('public', { ads: { ...adsFixture, preview: true } }),
    accepted: true,
    expect: (text) => !/HEADER AD/.test(text) && !/NATIVE AD/.test(text) && /Ad slot/i.test(text),
    probes: (window) => [
      ['header outlined', Boolean(window.document.querySelector('[data-ad-preview="header"]'))],
      ['native outlined', Boolean(window.document.querySelector('[data-ad-preview="native"]'))],
      ['empty sidebar outlined too', Boolean(window.document.querySelector('[data-ad-preview="sidebar"]'))],
      ['no live ad containers while previewing', window.document.querySelectorAll('[data-ad-slot]').length === 0],
      ['popunder script not injected', !window.__popunderProbe],
    ],
  },
  {
    name: 'video page shows its own ad slot',
    path: '/v/v-pov-kat-mar10/',
    fetch: okWorker('direct', { ads: adsFixture }),
    accepted: true,
    expect: (text) => /VIDEO AD/.test(text),
    probes: (window) => [
      ['video slot injected', Boolean(window.document.querySelector('[data-ad-slot="video"] #ad-video-probe'))],
    ],
  },
  {
    name: 'video page in direct mode outlines its slot while previewing',
    path: '/v/v-pov-kat-mar10/',
    fetch: okWorker('direct', { ads: { ...adsFixture, preview: true, video: '' } }),
    accepted: true,
    expect: (text) => /Kat Mar10/.test(text) && /Ad slot/i.test(text),
    probes: (window) => [
      ['video slot outlined', Boolean(window.document.querySelector('[data-ad-preview="video"]'))],
    ],
  },
]

let failures = 0

for (const [index, scenario] of scenarios.entries()) {
  const dom = new JSDOM(shell, { url: urlFor(scenario.path), pretendToBeVisual: true })
  const { window } = dom
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.scrollTo = () => {}
  if (scenario.accepted) window.localStorage.setItem('afterdark.age.v1', 'yes')
  for (const [key, value] of Object.entries(scenario.session || {})) window.sessionStorage.setItem(key, value)

  const errors = []
  window.addEventListener('error', (event) => errors.push(String(event.message)))
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))

  for (const key of [
    'window', 'document', 'navigator', 'history', 'HTMLElement', 'Node', 'Event', 'CustomEvent',
    'MutationObserver', 'getComputedStyle', 'sessionStorage', 'localStorage', 'requestAnimationFrame',
    'cancelAnimationFrame', 'IntersectionObserver', 'ResizeObserver',
  ]) {
    const value = key === 'window' ? window : window[key]
    try {
      Object.defineProperty(global, key, { value, configurable: true, writable: true })
    } catch {
      global[key] = value
    }
  }
  global.self = window
  global.fetch = scenario.fetch
  global.IS_REACT_ACT_ENVIRONMENT = false

  const callsBefore = apiCalls.length
  try {
    await import(`${pathToFileURL(join(assetDir, bundleName)).href}?scenario=${index}`)
    await wait(1800)

    const body = window.document.body
    const text = (body.textContent || '').replace(/\s+/g, ' ').trim()
    const anchors = body.querySelectorAll('a').length
    const problems = []

    if (!text) problems.push('page is empty (black screen)')
    if (text && !scenario.expect(text)) problems.push(`unexpected content: ${text.slice(0, 120)}`)
    if (scenario.noAnchors && anchors > 0) problems.push(`${anchors} anchor(s) on a standalone video page`)
    for (const [label, ok] of scenario.probes?.(window) ?? []) {
      if (!ok) problems.push(label)
    }
    // API-call assertions run after the probes; the scenario only sees the
    // requests it caused itself.
    for (const [label, ok] of scenario.probe?.(apiCalls.slice(callsBefore)) ?? []) {
      if (!ok) problems.push(label)
    }
    if (errors.length) problems.push(`errors: ${errors.slice(0, 2).join(' | ')}`)

    if (problems.length) {
      failures += 1
      console.log(`  ✗ ${scenario.name}\n      ${problems.join('\n      ')}`)
    } else {
      console.log(`  ✓ ${scenario.name}`)
    }
  } catch (error) {
    failures += 1
    console.log(`  ✗ ${scenario.name} — threw: ${error?.message || error}`)
  }
}

console.log(failures ? `\n${failures} scenario(s) failed` : `\nall ${scenarios.length} scenarios passed`)
process.exit(failures ? 1 : 0)
