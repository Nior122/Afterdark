# GridWatch

A YouTube-style video platform UI built with **React 19 + TypeScript + Vite + Tailwind CSS v4**.

The home feed is a close recreation of the supplied design (sidebar, category chips, ad-tagged
recommendations, trending row), and the rest of the product is wired up so videos can actually be
added and watched. **No database, no file storage, no backend** — videos are added by pasting a URL
and the list is kept in `localStorage`.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build on http://localhost:4173
```

Node 18+ is required.

## Adding a video (no upload, no storage)

Click **Create** in the header (or "Add video" on the Library / your channel page) and paste a link:

| Link type | What happens |
| --- | --- |
| `youtube.com/watch?v=…`, `youtu.be/…`, Shorts, `/embed/…` | Plays inline in the YouTube privacy-enhanced player; title and thumbnail auto-detected |
| `vimeo.com/123456` | Plays inline in the Vimeo player |
| `https://…/clip.mp4` (mp4, webm, ogg, mov, m4v) | Plays in the native HTML5 player |
| Any other page | Shows the thumbnail with an "Open original" button |

Fields: URL (required), title (required, auto-filled for YouTube links), optional thumbnail URL,
category and optional duration (`8:31` or seconds). Everything is stored in the browser only —
`localStorage` key `gridwatch.store.v1` — and can be wiped by clearing site data. Uploaded videos are
tagged **Yours** and can be deleted from their card menu or the watch page.

## Screens

| Route | Description |
| --- | --- |
| `/` | Home feed: recommended + trending ad rows, more videos, per-category rows |
| `/browse/:category` | Category feed (`Tech`, `Gaming`, `Music`, …) |
| `/explore` | Category tiles and discovery rows |
| `/trending` | Videos sorted by view count |
| `/subscriptions` | Subscribed channels + their uploads (subscribe/unsubscribe works) |
| `/library` | History / Watch later / Liked / Your channel shortcuts + your uploads |
| `/history`, `/watch-later`, `/liked` | Collections, all persisted |
| `/results?q=…` | Search across videos, channels and categories |
| `/channel/:id` | Channel banner, tabs (Home / Videos / About), subscribe |
| `/watch/:id` | Player, like/save/share, expandable description, comments, "Up next" rail |
| `*` | 404 |

## Project structure

```
public/
  avatars/       channel + advertiser avatars (SVG/JPG)
  thumbnails/    seeded video thumbnails
  favicon.svg
src/
  components/    Header, Sidebar, CategoryBar, VideoCard/Grid/Row, CreateModal, KebabMenu…
  data/seed.ts   channels, ads, demo videos, categories
  lib/store.tsx  React context store persisted to localStorage
  lib/video.ts   URL parsing (YouTube/Vimeo/direct files), view + duration formatting
  lib/hooks.ts   click-outside, escape, page title
  pages/         one component per route
```

## Notes

- The UI is fully responsive: 4-column feed at ≥1168 px, 3/2/1 columns below, off-canvas sidebar on
  mobile, and the watch page switches to a side rail at ≥1184 px.
- Ads are part of the seeded demo data and are labelled `Ad` with the purple sponsor line shown in
  the reference design.
- Inter is bundled locally via `@fontsource-variable/inter`, so no external font request is needed.
- The light theme is fixed (no dark mode) to match the reference.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on `0.0.0.0:5173` |
| `npm run build` | `tsc -b` type-check, then production build |
| `npm run preview` | Preview the production build |

## Deployment

The app is a static single-page build — `npm run build` emits `dist/` with no server requirements.
Routing uses a **HashRouter** (`/#/watch/…`) so the build works on any static host, including GitHub
Pages sub-paths, with zero rewrite configuration.

### GitHub Pages (included workflow)

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. Merge this work into `main` (or run the workflow manually from the Actions tab)
3. The site appears at `https://<user>.github.io/<repo>/`

### Vercel

`vercel.json` is already configured (Vite framework preset, `dist` output, SPA rewrites, asset caching).

```bash
npm i -g vercel
vercel          # preview deployment
vercel --prod   # production
```

Or import the repository at <https://vercel.com/new> and press Deploy — no environment variables are
needed.

### Netlify

`netlify.toml` is already configured (build command, `dist` publish dir, SPA redirect, headers).
Import the repo at <https://app.netlify.com/start>, or:

```bash
npm i -g netlify-cli
netlify deploy --prod --dir=dist
```

### Any static host (S3, Cloudflare Pages, Firebase Hosting, nginx)

Upload the contents of `dist/` after `npm run build`. Because of the hash router, deep links resolve
to `index.html` automatically.

### Production checks

```bash
npm run build          # tsc -b + vite build
npm run preview        # serve dist/ at http://localhost:4173
```

- No environment variables, API keys, database or object storage are required.
- Videos added in the UI are stored per-browser in `localStorage`; deployments start with the seeded
  demo feed on a fresh browser.
- YouTube embeds use `youtube-nocookie.com`; generic embed links are rendered in a sandboxed iframe
  with `referrerPolicy="no-referrer"`.

## Deployment status

- Clean production build (Vite 6, ~90 kB gzipped main chunk, React split into its own chunk).
- Works from the domain root **and** from a sub-path (relative `base`, hashed asset URLs).
- `npm run preview` verified: images, fonts, hash routing and deep links all load with zero console errors.

## Changelog

- `0c3834b` deployment config for GitHub Pages / Vercel / Netlify.
- `d766358` sandboxed generic embed players + branded placeholder poster.
- `875ac5e` initial GridWatch build: home feed, watch page, create-by-URL, search, library.

## Hosting cheat-sheet

| Host | What to do |
| --- | --- |
| GitHub Pages | Settings → Pages → Source **GitHub Actions**, then merge into `main` (workflow deploys automatically) |
| Vercel | Import repo at vercel.com/new → Deploy (settings read from `vercel.json`) |
| Netlify | Import repo at app.netlify.com/start (settings read from `netlify.toml`) |
| Cloudflare Pages | Build `npm run build`, output `dist` |
| Any web server | Copy `dist/` — hash routing needs no rewrites |
