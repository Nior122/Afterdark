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
let feedVideos = []
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
    if (url.endsWith('/api/videos')) return new Response(JSON.stringify({ videos: feedVideos }), { status: 200 })
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
  check('direct mode: catalogue hidden', !/Latest videos|Popular categories|\bShorts\b/i.test(text), text.slice(0, 120))
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

  // More than eight older feed records must not hide newer seeded uploads.
  feedVideos = [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `tg-old-${i}`, title: `Older feed video ${i}`, category: 'Homemade',
      sourceUrl: `https://example.test/embed/old-${i}`, createdAt: Date.parse('2026-09-01T12:00:00Z') - i * 1000,
    })),
    { id: 'tg-newest', title: 'Newest feed video', category: 'Homemade',
      sourceUrl: 'https://example.test/embed/newest', createdAt: Date.parse('2026-11-01T12:00:00Z') },
  ]
  dom = mountApp('/', 'public')
  await wait(700)
  text = dom.window.document.body.textContent
  const feedTitle = text.indexOf('Newest feed video')
  const seededTitle = text.indexOf('Sunday Sex Show 55')
  const oldTitle = text.indexOf('Older feed video 0')
  check('latest: uploads, feed and seeds all reach the page', feedTitle >= 0 && seededTitle >= 0 && oldTitle >= 0)
  check('latest: all catalogue videos shown', text.includes('Older feed video 9') && text.includes('Isabella Clark') && text.includes('Swimming Public Pool'))
  const latestSection = [...dom.window.document.querySelectorAll('section')].find((section) => section.querySelector('h2')?.textContent === 'Latest videos')
  check('latest: chronological grid reads across rows', Boolean(latestSection?.querySelector('.grid')))

  // ---- shorts: sub-minute clips live in their own wall, not in the list ----
  const shortsSection = [...dom.window.document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === 'Shorts')
  check('shorts: the 0:54 clip renders under a Shorts heading',
    Boolean(shortsSection) && /Twerking Aunty/.test(shortsSection.textContent || ''))
  check('shorts: the wall is a uniform grid and the list does not repeat it',
    Boolean(shortsSection?.querySelector('.grid')) && Boolean(latestSection) && !latestSection.textContent.includes('Twerking Aunty'))
  const shortTile = shortsSection?.querySelector('a[href*="/watch/"]')
  check('shorts: a tile links to the usual watch page',
    Boolean(shortTile && shortTile.getAttribute('href')?.includes('v-telegram-twerking-aunty')))
  check('shorts: every wall tile wears the red Short badge',
    Boolean(shortsSection) && shortsSection.querySelectorAll('a[href*="/watch/"]').length > 0 &&
      [...shortsSection.querySelectorAll('a[href*="/watch/"]')].every((a) => a.querySelector('.bg-red-600')) &&
      /short/i.test(shortsSection.querySelector('.bg-red-600')?.textContent || ''),
    shortsSection?.innerHTML.slice(0, 240))
  check('shorts: the long-video list carries no badge', Boolean(latestSection) && !latestSection.querySelector('.bg-red-600'))

  // ---- the two-minute catalogue rotation (src/lib/reshuffle.ts) ----
  const app = require(bundle)
  const src = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
  const shuffled1 = app.seededShuffle(src, app.reshuffleBucket())
  const shuffled2 = app.seededShuffle(src, app.reshuffleBucket())
  check(
    'rotation: one window, one order — and the input is never mutated',
    shuffled1.join() === shuffled2.join() && src.join() === 'a,b,c,d,e,f,g,h,i,j,k,l',
  )
  check('rotation: the next window reshuffles', app.seededShuffle(src, app.reshuffleBucket() + 1).join() !== shuffled1.join())
  check(
    'rotation: windows tick on a fixed two-minute grid',
    app.reshuffleBucket(0) === 0 && app.reshuffleBucket(119999) === 0 && app.reshuffleBucket(120000) === 1 &&
      app.msUntilNextBucket(180000) === 60000,
  )
  // Each card links twice (cover + title) with adjacent identical hrefs —
  // collapsing those leaves the grid's actual card order.
  const idsIn = (section) => {
    const hrefs = [...(section ? section.querySelectorAll('a[href*="/watch/"]') : [])].map((a) => a.getAttribute('href'))
    return hrefs.filter((href, i) => href !== hrefs[i - 1])
  }
  const firstPass = idsIn(latestSection)
  const bucketBefore = app.reshuffleBucket()
  const domB = mountApp('/', 'public')
  await wait(700)
  const bucketAfter = app.reshuffleBucket()
  const sectionB = [...domB.window.document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === 'Latest videos')
  const secondPass = idsIn(sectionB)
  check(
    'rotation: reshuffle drops and duplicates nothing',
    firstPass.length > 8 && new Set(firstPass).size === firstPass.length &&
      firstPass.slice().sort().join() === secondPass.slice().sort().join(),
    `${firstPass.length} vs ${secondPass.length} cards`,
  )
  check(
    'rotation: fresh page loads agree inside a window',
    bucketBefore !== bucketAfter || firstPass.join() === secondPass.join(),
  )

  // ---- anti-capture player guard (src/lib/anticapture.ts) ----
  feedVideos = [{
    id: 'tg-guard-1', title: 'Guarded File Clip', category: 'Homemade',
    sourceUrl: 'https://files.example.test/clip.mp4', createdAt: Date.parse('2026-10-10T00:00:00Z'),
  }]
  const guardDom = mountApp('/#/watch/tg-guard-1', 'public')
  await wait(700)
  const guardVideo = guardDom.window.document.querySelector('[data-capture-guard] video')
  check(
    'guard: player hides the native download button and PiP',
    /nodownload/.test(guardVideo?.getAttribute('controlslist') || '')
      && Boolean(guardVideo?.hasAttribute('disablepictureinpicture')),
    JSON.stringify({ c: guardVideo?.getAttribute('controlslist'), p: guardVideo?.hasAttribute('disablepictureinpicture') }),
  )
  check(
    'guard: no raw video URL text is printed anywhere on the page',
    !guardDom.window.document.body.textContent.includes('files.example.test'),
  )
  check(
    'guard: right-click save paths are disabled on the media element',
    guardVideo?.hasAttribute('controls') && !/[?&]download=/.test(guardVideo?.getAttribute('src') || '')
      && Boolean(guardDom.window.document.querySelector('[data-capture-guard]')),
  )
  feedVideos = []

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
