#!/usr/bin/env node
/**
 * DOM check: mounts the real app in jsdom and asserts behaviour that static
 * HTML cannot show — the mode gate, the standalone video page and the
 * dashboard sign-in.
 *
 *   npm i --no-save jsdom      # once; kept out of package.json on purpose
 *   npm run verify:dom
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { JSDOM } = require('jsdom')

const root = path.join(__dirname, '..')
const bundle = path.join(root, 'node_modules', '.tmp', 'dom-app.cjs')

execFileSync(
  path.join(root, 'node_modules', '.bin', 'esbuild'),
  [
    path.join(__dirname, 'dom-entry.tsx'),
    '--bundle',
    '--platform=browser',
    '--format=cjs',
    '--jsx=automatic',
    `--outfile=${bundle}`,
    '--loader:.css=empty',
    '--log-level=warning',
    '--define:import.meta.env={"VITE_SITE_URL":"https://afterdark.test","VITE_TELEGRAM_FEED_URL":"https://worker.test","BASE_URL":"/"}',
  ],
  { stdio: 'inherit' },
)

let mode = 'public'
// Optional payloads the admin endpoints answer with (portrait-thumb checks).
let adminVideos = []
let adminDrafts = []
const requests = []
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function setupDom(pathname, accepted = true, session = null) {
  const dom = new JSDOM(
    '<!doctype html><html><head><base href="/"></head><body><div id="root"></div></body></html>',
    { url: `https://afterdark.test${pathname}`, pretendToBeVisual: true },
  )
  const { window } = dom
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  // The age gate now lives inside the router, so it is part of every page.
  // Default the harness to a returning visitor; one scenario tests the gate.
  if (accepted) window.localStorage.setItem('afterdark.age.v1', 'yes')
  // The admin token lives in sessionStorage (see lib/admin.ts), not localStorage.
  for (const [key, value] of Object.entries(session || {})) window.sessionStorage.setItem(key, value)
  window.scrollTo = () => {}
  window.HTMLElement.prototype.scrollIntoView = () => {}
  for (const key of [
    'window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'CustomEvent',
    'MutationObserver', 'getComputedStyle', 'sessionStorage', 'localStorage',
  ]) {
    global[key] = key === 'window' ? window : window[key]
  }
  global.window = window
  global.document = window.document
  global.IS_REACT_ACT_ENVIRONMENT = true
  return dom
}

function mockFetch() {
  global.fetch = async (input) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith('/api/settings')) return new Response(JSON.stringify({ mode }), { status: 200 })
    if (url.endsWith('/api/videos')) return new Response(JSON.stringify({ videos: [] }), { status: 200 })
    if (url.endsWith('/api/admin/settings')) {
      return new Response(
        JSON.stringify({ mode, modes: ['public', 'direct'], github: false, feedUrl: 'https://worker.test' }),
        { status: 200 },
      )
    }
    if (url.endsWith('/api/admin/videos')) return new Response(JSON.stringify({ videos: adminVideos, total: adminVideos.length }), { status: 200 })
    if (url.endsWith('/api/admin/drafts')) return new Response(JSON.stringify({ drafts: adminDrafts }), { status: 200 })
    return new Response('{}', { status: 200 })
  }
}

function mountApp(pathname, currentMode, accepted = true, session = null) {
  mode = currentMode
  const dom = setupDom(pathname, accepted, session)
  mockFetch()
  delete require.cache[require.resolve(bundle)]
  require(bundle).mount(dom.window.document.getElementById('root'))
  return dom
}

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${name}`)
  else {
    failures += 1
    console.log(`  ✗ ${name} ${detail}`)
  }
}

async function run() {
  let dom = mountApp('/', 'direct')
  await wait(500)
  let text = dom.window.document.body.textContent
  check('direct mode: settings requested', requests.some((url) => url.endsWith('/api/settings')))
  check('direct mode: catalogue hidden', !/Latest videos|Popular categories/i.test(text), text.slice(0, 120))
  check('direct mode: neutral message', /isn’t available|not available/i.test(text), text.slice(0, 160))
  check('direct mode: no links', dom.window.document.querySelectorAll('a').length === 0)
  check('direct mode: no video ids', !dom.window.document.body.innerHTML.includes('v-pov-tatum-christine'))

  dom = mountApp('/', 'public', false)
  await wait(700)
  text = dom.window.document.body.textContent
  check('first visit: age gate renders (no blank page)', /18\+ only/i.test(text), text.slice(0, 120))

  dom = mountApp('/', 'public')
  await wait(700)
  text = dom.window.document.body.textContent
  check('public mode: catalogue renders', /Latest videos|Popular categories/i.test(text), text.slice(0, 200))
  check('public mode: has internal links', dom.window.document.querySelectorAll('a').length > 0)

  dom = mountApp('/v/v-pov-tatum-christine/', 'direct')
  await wait(600)
  text = dom.window.document.body.textContent
  check('video page: renders its title', /Tatum Christine/.test(text), text.slice(0, 120))
  // The owner's Telegram CTA (a[data-cta]) is an intentional outbound link;
  // the invariant is about site navigation leaking onto standalone pages.
  check('video page: no anchors', dom.window.document.querySelectorAll('a:not([data-cta])').length === 0)
  check('video page: no related rail', !/Up next|Related/i.test(text))

  dom = mountApp('/admin/', 'public')
  await wait(500)
  text = dom.window.document.body.textContent
  check('dashboard: renders sign-in', /Owner sign-in|ADMIN_TOKEN/i.test(text), text.slice(0, 160))
  check('dashboard: token field present', Boolean(dom.window.document.querySelector('input[type="password"]')))

  // Signed-in dashboard with portrait media: both the Videos rows and the
  // Drafts cards must frame a taller-than-wide thumb portrait (56x96 video /
  // 56x80 draft, letterboxed) instead of cropping it into a landscape band.
  const portraitThumb = { width: 400, height: 711 }
  adminVideos = [{
    id: 'w-domportrait', title: 'Dom Portrait Video', category: 'POV', tags: ['POV'],
    durationSec: 2465, kind: 'link', tooLarge: false, views: 3,
    sourceUrl: 'https://t.me/testchannel/1343', streamUrl: null,
    thumbUrl: 'https://source.test/portrait.jpg', description: '', site: 't.me',
    createdAt: Date.now(), updatedAt: null, ...portraitThumb,
  }]
  adminDrafts = [{
    id: 'd-domportrait', title: 'Dom Portrait Draft', category: 'POV', tags: [],
    durationSec: 61, sourceUrl: 'https://t.me/testchannel/9001',
    thumbUrl: 'https://source.test/portrait.jpg', description: '', site: 't.me',
    createdAt: Date.now(), ...portraitThumb,
  }]
  dom = mountApp('/admin/', 'public', true, { 'afterdark.admin.v1': 'dom-admin-token' })
  await wait(700)
  const thumbImg = (el) => (el.getAttribute('src') || '').includes('portrait.jpg')
  let imgs = Array.from(dom.window.document.querySelectorAll('img')).filter(thumbImg)
  check(
    'dashboard videos tab: portrait thumb framed portrait',
    imgs.some((el) => /h-24 w-14/.test(el.className) && /object-contain/.test(el.className)),
    imgs.map((el) => el.className).join(' | ').slice(0, 200),
  )
  const draftsButton = Array.from(dom.window.document.querySelectorAll('button')).find(
    (button) => /^Drafts/.test((button.textContent || '').trim()),
  )
  check('dashboard: drafts tab button found', Boolean(draftsButton))
  draftsButton?.click()
  await wait(500)
  imgs = Array.from(dom.window.document.querySelectorAll('img')).filter(thumbImg)
  check(
    'dashboard drafts tab: portrait draft thumb framed portrait',
    imgs.some((el) => /h-20 w-14/.test(el.className) && /object-contain/.test(el.className)),
    imgs.map((el) => el.className).join(' | ').slice(0, 200),
  )
  check('dashboard drafts tab: draft duration shown', /1:01/.test(dom.window.document.body.textContent), '')
  adminVideos = []
  adminDrafts = []

  console.log(failures ? `\n${failures} check(s) failed` : '\nall DOM checks passed')
  process.exit(failures ? 1 : 0)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
