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
