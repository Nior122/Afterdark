#!/usr/bin/env node
/**
 * Tests functions/_middleware.ts — the redirect/direct-mode gate.
 *
 *   npm run verify:middleware
 *
 * The middleware is bundled with esbuild and driven with fake Pages contexts,
 * so the rules are checked without deploying: which URLs redirect, which never
 * do, and that a video page added after the build still gets a 200.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = join(root, 'node_modules', '.tmp', 'middleware.cjs')
await mkdir(dirname(outfile), { recursive: true })
await build({
  entryPoints: [join(root, 'functions/_middleware.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  logLevel: 'warning',
})
const { onRequest } = await import(pathToFileURL(outfile).href)

const WORKER = 'https://worker.test'
const SITE = 'https://site.test'

let passed = 0
let failed = 0
const check = (name, condition, extra = '') => {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.log(`  ✗ ${name} ${extra}`)
  }
}

/** Make a context; `next` returns 200 unless `missing` says 404. */
function context(path, { settings = null, accept = 'text/html', method = 'GET', missing = [], shell = true, slash308 = false } = {}) {
  const url = `${SITE}${path}`
  return {
    request: new Request(url, { method, headers: { accept } }),
    env: {
      VITE_TELEGRAM_FEED_URL: WORKER,
      ASSETS: {
        fetch: async () =>
          shell
            ? new Response('<!doctype html><html><body>SHELL</body></html>', {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
              })
            : new Response('missing', { status: 404 }),
      },
    },
    // `slash308` impersonates Pages' trailing-slash normalization, which a
    // static site would answer for '/admin' with a browser-cacheable 308.
    next: async () =>
      slash308 && path === '/admin'
        ? new Response(null, { status: 308, headers: { Location: `${url}/` } })
        : new Response('STATIC', { status: missing.includes(path) ? 404 : 200 }),
    _settings: settings,
  }
}

const realFetch = globalThis.fetch
function withSettings(settings) {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url === `${WORKER}/api/settings`) return Response.json(settings)
    return new Response('unexpected fetch ' + url, { status: 500 })
  }
}

const run = async (path, options) => {
  withSettings(options?.settings ?? null)
  return onRequest(context(path, options))
}

// ---------------------------------------------------------------- public ----
console.log('— public mode never redirects')
{
  const settings = { mode: 'public', redirectUrl: 'https://ads.example.com/offer', ads: { enabled: false } }
  const home = await run('/', { settings })
  check('home passes through', home.status === 200 && !home.headers.get('location'), `${home.status}`)
  const browse = await run('/browse/POV', { settings })
  check('category page passes through', browse.status === 200)
}

// ---------------------------------------------------------------- direct ----
console.log('— direct mode + redirect URL')
{
  const settings = { mode: 'direct', redirectUrl: 'https://ads.example.com/offer', ads: { enabled: false } }
  const home = await run('/', { settings })
  check('home answers a real 302', home.status === 302, `${home.status}`)
  check('302 points at the configured URL', home.headers.get('location') === 'https://ads.example.com/offer')
  check('302 is not cacheable', (home.headers.get('cache-control') || '').includes('no-store'))
  check('302 varies on Accept', (home.headers.get('vary') || '').includes('Accept'))

  for (const path of ['/browse/POV', '/explore', '/trending', '/results?q=x', '/nonsense']) {
    const response = await run(path, { settings })
    check(`${path} redirects too`, response.status === 302, `${response.status}`)
  }

  const video = await run('/v/v-pov-kat-mar10/', { settings })
  check('prerendered video page is never redirected', video.status === 200, `${video.status}`)

  const newVideo = await run('/v/tg-new-video/', { settings, missing: ['/v/tg-new-video/'] })
  check('video added after the build gets a 200', newVideo.status === 200, `${newVideo.status}`)
  check('fallback shell is served', (await newVideo.text()).includes('SHELL'))
  check('fallback is noindex', (newVideo.headers.get('x-robots-tag') || '').includes('noindex'))

  for (const path of ['/admin/', '/admin', '/assets/index.js', '/sitemap.xml', '/robots.txt', '/favicon.svg', '/thumbnails/x.jpg', '/avatars/a.svg']) {
    const response = await run(path, { settings })
    check(`${path} never redirects`, response.status === 200, `${response.status}`)
  }

  const assets = await run('/assets/index.js', { settings, accept: '*/*' })
  check('asset requests pass through', assets.status === 200)
}

console.log('— direct mode without a URL, and failure modes')
{
  const noUrl = await run('/', { settings: { mode: 'direct', redirectUrl: '', ads: { enabled: false } } })
  check('no URL set -> neutral page, no redirect', noUrl.status === 200)

  const offline = await run('/', { settings: null })
  check('worker unreachable -> no redirect', offline.status === 200)

  const self = await run('/', { settings: { mode: 'direct', redirectUrl: `${SITE}/loop`, ads: { enabled: false } } })
  check('self-redirect is ignored (no loop)', self.status === 200)

  const bad = await run('/', { settings: { mode: 'direct', redirectUrl: 'javascript:alert(1)', ads: { enabled: false } } })
  check('non-http URL is ignored', bad.status === 200)
}

console.log('— the dashboard is never redirected or bounced')
{
  const settings = { mode: 'direct', redirectUrl: 'https://elsewhere.example/go', ads: { enabled: false } }
  let settingsCalls = 0
  globalThis.fetch = async () => {
    settingsCalls += 1
    return Response.json(settings)
  }
  const direct = await onRequest(context('/admin', { slash308: true }))
  const directHtml = await direct.text()
  globalThis.fetch = realFetch

  check('GET /admin answers 200 — no 308 the browser could cache', direct.status === 200, `${direct.status}`)
  check('the dashboard file is served directly', directHtml.includes('SHELL'))
  check('the admin path never waits on the Worker', settingsCalls === 0, `${settingsCalls} fetch(es)`)
  check('admin replies are not cacheable', (direct.headers.get('cache-control') || '').includes('no-store'))
  check('admin stays noindex', (direct.headers.get('x-robots-tag') || '').includes('noindex'))

  const slashed = await run('/admin/', { settings })
  check('GET /admin/ is a direct 200 too', slashed.status === 200, `${slashed.status}`)

  const head = await run('/admin', { settings, method: 'HEAD' })
  check('HEAD /admin answers 200 without a body', head.status === 200 && (await head.text()) === '')

  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url === `${WORKER}/api/settings`) return Promise.reject(new Error('offline'))
    return new Response('unexpected fetch ' + url, { status: 500 })
  }
  const offline = await onRequest(context('/admin', { slash308: true }))
  check('the dashboard loads even while the Worker is offline', offline.status === 200)
  globalThis.fetch = realFetch

  const noFile = await onRequest(context('/admin', { shell: false, slash308: true }))
  check('without a prerendered dashboard file the normal site flow applies', noFile.status === 308, `${noFile.status}`)
}

console.log('— a hung Worker is cut off, never waited on')
{
  // Black-holed origin: the request only settles when the caller aborts it.
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url !== `${WORKER}/api/settings`) return new Response('unexpected fetch ' + url, { status: 500 })
    return new Promise((_resolve, reject) => {
      const signal = init && init.signal
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }
    })
  }
  const startedAt = Date.now()
  const raced = await Promise.race([
    onRequest(context('/', { settings: null })),
    new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 6000)),
  ])
  const elapsed = Date.now() - startedAt
  check('hung Worker is cut off instead of hanging the navigation', raced !== 'TIMEOUT' && raced.status === 200,
    raced === 'TIMEOUT' ? 'the page request was still waiting' : '')
  check('cutoff happens within the timeout budget', elapsed < 5000, `${elapsed}ms`)
}

console.log('— no feed origin configured')
{
  globalThis.fetch = realFetch
  const bare = {
    request: new Request(`${SITE}/`, { headers: { accept: 'text/html' } }),
    env: {},
    next: async () => new Response('STATIC', { status: 200 }),
  }
  const response = await onRequest(bare)
  check('no Worker configured -> site behaves as before', response.status === 200)
}

globalThis.fetch = realFetch
console.log(`\n${failed ? `${failed} check(s) failed` : `all ${passed} checks passed`}`)
process.exit(failed ? 1 : 0)
