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
const requests = []
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function setupDom(pathname, accepted = true) {
  const dom = new JSDOM(
    '<!doctype html><html><head><base href="/"></head><body><div id="root"></div></body></html>',
    { url: `https://afterdark.test${pathname}`, pretendToBeVisual: true },
  )
  const { window } = dom
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  // The age gate now lives inside the router, so it is part of every page.
  // Default the harness to a returning visitor; one scenario tests the gate.
  if (accepted) window.localStorage.setItem('afterdark.age.v1', 'yes')
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
    if (url.endsWith('/api/admin/videos')) return new Response(JSON.stringify({ videos: [], total: 0 }), { status: 200 })
    if (url.endsWith('/api/admin/drafts')) return new Response(JSON.stringify({ drafts: [] }), { status: 200 })
    return new Response('{}', { status: 200 })
  }
}

function mountApp(pathname, currentMode, accepted = true) {
  mode = currentMode
  const dom = setupDom(pathname, accepted)
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
  check('video page: no anchors', dom.window.document.querySelectorAll('a').length === 0)
  check('video page: no related rail', !/Up next|Related/i.test(text))

  dom = mountApp('/admin/', 'public')
  await wait(500)
  text = dom.window.document.body.textContent
  check('dashboard: renders sign-in', /Owner sign-in|ADMIN_TOKEN/i.test(text), text.slice(0, 160))
  check('dashboard: token field present', Boolean(dom.window.document.querySelector('input[type="password"]')))

  console.log(failures ? `\n${failures} check(s) failed` : '\nall DOM checks passed')
  process.exit(failures ? 1 : 0)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
