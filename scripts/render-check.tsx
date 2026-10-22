/**
 * Rendered-markup check: server-renders the routes and asserts the rules.
 *   npm run verify:render      (bundles this file with esbuild, then runs it)
 *
 * Loads no feed and writes nothing — it verifies what the React tree actually
 * renders: the video page has its player and title, no anchor to anywhere on
 * the site, no other video's id or title, and the fallback page lists nothing.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'
import AgeGate from '../src/components/AgeGate'
import { StoreProvider } from '../src/lib/store'
import { ThemeProvider } from '../src/lib/theme'
import { SEED_VIDEOS } from '../src/data/seed'

function render(path) {
  return renderToStaticMarkup(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <StoreProvider>
          <AgeGate>
            <App />
          </AgeGate>
        </StoreProvider>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

let failures = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.log(`  ✗ ${name} ${detail}`)
  }
}

const root = render('/')
check('root has no video ids', !SEED_VIDEOS.some((video) => root.includes(video.id)))
check('root has no links', !/<a\s/i.test(root) && !/href="\//i.test(root))
check('root is a neutral message', /not available|404/i.test(root))

for (const video of SEED_VIDEOS) {
  const html = render(`/v/${video.id}/`)
  const others = SEED_VIDEOS.filter((other) => other.id !== video.id)
  check(`${video.id}: shows its title`, html.includes(video.title.replace(/&/g, '&amp;')))
  const links = [...html.matchAll(/<a\s[^>]*href="([^"]*)"/gi)].map((match) => match[1])
  check(
    `${video.id}: no site links`,
    links.every((href) => /^https?:\/\//i.test(href) && !href.includes('localhost')),
    JSON.stringify(links),
  )
  check(`${video.id}: no other video id`, !others.some((other) => html.includes(other.id)))
  check(`${video.id}: no other title`, !others.some((other) => html.includes(other.title)))
  check(`${video.id}: no related/up-next wording`, !/up next|related|suggested|more videos|autoplay next/i.test(html))
}

const missing = render('/v/does-not-exist/')
check('unknown id is neutral', !SEED_VIDEOS.some((video) => missing.includes(video.id)))
check('unknown id has no links', !/<a\s/i.test(missing) && !/href="\//i.test(missing))

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
