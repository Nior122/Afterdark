#!/usr/bin/env node
/**
 * Runs the *built* bundle in jsdom, the way a browser does.
 *
 *   npm i --no-save jsdom        # once; deliberately not a dependency
 *   npm run verify:bundle        # after `npm run build`
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
 * dashboard.
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

/** Only the Worker is simulated; asset/module requests must resolve normally. */
const onlyWorker = (behaviour) => (input, init) => {
  const url = String(input)
  if (!url.includes('workers.dev') && !url.includes('/api/')) {
    return Promise.resolve(new Response('/* stub */', { status: 200, headers: { 'Content-Type': 'text/javascript' } }))
  }
  return behaviour(url, init)
}

const okWorker = (mode) => onlyWorker((url) => {
  if (url.endsWith('/api/settings')) return Promise.resolve(new Response(JSON.stringify({ mode }), { status: 200 }))
  if (url.endsWith('/api/videos')) return Promise.resolve(new Response(JSON.stringify({ videos: [] }), { status: 200 }))
  if (url.includes('/api/admin/')) return Promise.resolve(new Response(JSON.stringify({ mode, modes: ['public', 'direct'], videos: [], drafts: [] }), { status: 200 }))
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
    name: 'video page renders standalone',
    path: '/v/v-pov-kat-mar10/',
    fetch: okWorker('public'),
    accepted: true,
    expect: (text) => /Kat Mar10/i.test(text),
    noAnchors: true,
  },
  {
    name: 'dashboard shows sign-in, never age-gated',
    path: '/admin/',
    fetch: okWorker('public'),
    expect: (text) => /Owner sign-in|ADMIN_TOKEN/i.test(text),
  },
]

let failures = 0

for (const [index, scenario] of scenarios.entries()) {
  const dom = new JSDOM(shell, { url: urlFor(scenario.path), pretendToBeVisual: true })
  const { window } = dom
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.scrollTo = () => {}
  if (scenario.accepted) window.localStorage.setItem('afterdark.age.v1', 'yes')

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
