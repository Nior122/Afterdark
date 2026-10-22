/**
 * Rendered-markup check (no browser needed).
 *   npm run verify:render
 *
 * Server-renders the standalone video page for every catalogue video and
 * asserts the rules the static HTML cannot prove on its own: no anchors, no
 * other video's id or title, and no related/up-next wording.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { StrictMode } from 'react'
import DirectVideoPage from '../src/pages/DirectVideoPage'
import { StoreProvider } from '../src/lib/store'
import { SettingsProvider } from '../src/lib/settings'
import { ThemeProvider } from '../src/lib/theme'
import { SEED_VIDEOS } from '../src/data/seed'

function render(id: string) {
  return renderToStaticMarkup(
    <StrictMode>
      <ThemeProvider>
        <SettingsProvider>
        <MemoryRouter initialEntries={[`/v/${id}/`]}>
          <StoreProvider>
            <Routes>
              <Route path="/v/:id" element={<DirectVideoPage />} />
            </Routes>
          </StoreProvider>
        </MemoryRouter>
        </SettingsProvider>
      </ThemeProvider>
    </StrictMode>,
  )
}

let failures = 0
function check(name, condition, detail = '') {
  if (condition) console.log(`  ✓ ${name}`)
  else {
    failures += 1
    console.log(`  ✗ ${name} ${detail}`)
  }
}

for (const video of SEED_VIDEOS) {
  const html = render(video.id)
  const others = SEED_VIDEOS.filter((other) => other.id !== video.id)
  const anchors = [...html.matchAll(/<a\s[^>]*href="([^"]*)"/gi)].map((match) => match[1])

  check(`${video.id}: renders its title`, html.includes(video.title.replace(/&/g, '&amp;').replace(/"/g, '&quot;')))
  check(`${video.id}: has a player`, /<video|iframe|<button/.test(html))
  check(`${video.id}: no anchors`, anchors.length === 0, JSON.stringify(anchors))
  check(`${video.id}: no other video id`, !others.some((other) => html.includes(other.id)))
  check(`${video.id}: no related/up-next wording`, !/up next|related|suggested|more videos|autoplay next/i.test(html))
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
