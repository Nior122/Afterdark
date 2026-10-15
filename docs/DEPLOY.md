# Deploying Faceverify

**No deployment was performed for this project.** There are no hosting credentials in the
build environment and no CLI for either host is installed, so there is no live URL to hand
over. What follows is the complete, tested-as-far-as-possible procedure — the config files it
depends on (`vercel.json`, `public/_redirects`, `public/_headers`) are in the repository and
are verified to be copied into `dist/` by the build.

Either host is free at this size. Cloudflare Pages is the better fit for this app because
its free tier has unmetered bandwidth, which matters when a single new Live-mode user pulls
~16.8 MiB of tracker assets.

## 0. Prerequisites

* The build passes locally: `npm ci && npm run build && npm test`
* HTTPS, always. `getUserMedia` refuses to run over plain HTTP — both hosts provide TLS by
  default, and `localhost` is exempt for development only.

## 1. Push the branch to GitHub

```bash
git remote -v                        # expect origin → github.com/Nior122/Faceverify
git push origin arena/9a652a63-faceverify
gh pr create --fill --base main      # optional: review before it reaches main
```

The app is a static SPA. Nothing server-side is required, no environment variables are
required, and no secrets exist in the repository.

Optional environment variables, only if you adopt a hosted avatar provider
(`docs/PROVIDERS.md`):

| Variable | Effect when set | Effect when unset |
| --- | --- | --- |
| `VITE_AVATURN_SUBDOMAIN` | Enables the Avaturn provider in the photo picker — **it uploads the selfie**, and the picker discloses that before it opens | Avaturn is absent from the picker |
| `VITE_LAM_ENDPOINT` | Enables the LAM hook (not implemented — `src/avatar/providers/lam.ts` throws a clear "not implemented" error) | LAM is absent from the picker |

## 2a. Cloudflare Pages

Dashboard → Workers & Pages → Create → Pages → Connect to Git → pick the repository:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 20 or newer (set `NODE_VERSION=20` as a build variable if the default is older) |

Or from the CLI:

```bash
npm run build
npx wrangler pages deploy dist --project-name faceverify
```

`public/_redirects` and `public/_headers` are copied into `dist/` by Vite and picked up
automatically:

* `_redirects` — SPA fallback to `/index.html`. The legal pages are hash routes
  (`/#/privacy`, `/#/terms`), so they survive a refresh on their own; the rewrite is there
  for any other deep path.
* `_headers` — `Permissions-Policy: camera=(self), microphone=(self)`, which is required for
  the camera to work at all inside a cross-origin iframe and is good hygiene otherwise.

## 2b. Vercel

Dashboard → Add New → Project → import the repository. Vercel reads `vercel.json`:

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |

Or:

```bash
npm run build
npx vercel deploy --prod dist
```

`vercel.json` carries the equivalent SPA rewrite and the same `Permissions-Policy` header,
because Vercel does not read Cloudflare's `_headers` file.

## 3. Pre-deploy checklist

Run from the repository root; every line must pass before deploying.

```bash
npm run typecheck            # tsc -b, strict
npx eslint .                 # 0 errors
npm test                     # node:test
npm run build                # tsc -b && vite build
node tools/realism-probe.mjs # regenerates the before/after renders (optional)
node tools/perf-probe.mjs    # per-frame JS cost (optional)
```

* [ ] `dist/` contains `sw.js`, `manifest.webmanifest`, `models/facecap.glb`,
      `mediapipe/face_landmarker.task`, `mediapipe/wasm/vision_wasm_internal.wasm`
* [ ] `dist/_headers` exists (Cloudflare) or the headers are in `vercel.json`
* [ ] The build log contains **no** `[INEFFECTIVE_DYNAMIC_IMPORT]` warning
* [ ] `dist/` is ~35 MB on disk; the service-worker precache is ~3.0 MiB of it

## 4. Post-deploy verification (the first real browser check)

Nothing in this repository has been run in a browser. These are the checks that close that
gap, in the order that finds problems fastest. Do them on a real phone as well as a desktop.

1. **Load the URL.** No console errors. The head appears within a couple of seconds on 4G.
2. **Install.** Chrome: the install prompt appears (or *Settings → Install app*). iOS Safari:
   *Share → Add to Home Screen*, then launch it from the home screen — a standalone window,
   no Safari chrome.
3. **Offline shell.** Load once, go offline, reload: the shell and the avatar come back from
   the cache.
4. **Manual mode.** Joystick yaw and pitch move the head and spring back on release; hold the
   eye button to blink; the gaze pad moves both eyes; Split separates them; the mouth slider
   opens the jaw; smile crosses over into a frown at the left end; pucker purses the lips.
5. **Live mode.** Tap the mode switch → the permission prompt appears (and *only* then).
   Deny it once: the app must explain what happened and offer a retry, not freeze. Then allow
   it, look straight at the camera for a second during calibration, and check: the head
   follows yaw/pitch/roll as a mirror; blinks register; the mouth opens; ±40° turns look
   believable; nothing jitters at rest; covering the face for a second eases the avatar to
   neutral with a "centre your face" hint rather than freezing it.
6. **Frame rate.** Settings → *Currently N fps*, and repeat on a mid-range Android (see
   [PERFORMANCE.md](PERFORMANCE.md)).
7. **Recording.** Tap Record in Live mode, talk for 15 s, stop. A preview appears with a
   working **Share** and **Download**. Confirm the downloaded file actually plays, that it has
   audio when microphone recording was enabled, and that the watermark is in the frames when
   it was on.
8. **Privacy.** *Settings → Your data → Delete my avatar* — the avatar goes, the page
   returns to the default head, and IndexedDB is empty in DevTools → Application.
9. **Legal.** `/#/privacy` and `/#/terms` load, are readable, and the back button returns
   to the app.

## 5. Rollback

Both hosts keep every previous deployment: Cloudflare → *Deployments → ⋯ → Rollback*;
Vercel → *Deployments → ⋯ → Promote to Production*. A rollback is instant and does not
require a rebuild.

## 6. Cost

Everything here is on a free tier.

| Item | Free tier | Notes |
| --- | --- | --- |
| Cloudflare Pages | Unlimited bandwidth, 500 builds/month | The reason it is the recommended host |
| Vercel Hobby | 100 GB/month bandwidth | ~6,000 first-time Live-mode users, or effectively unlimited repeat visits |
| MediaPipe WASM + model | Self-hosted from your own origin | No Google-hosted CDN, no API key, no quota |
| Sample head model | `facecap.glb` | **Licence unresolved for commercial use** — see `docs/PROVIDERS.md#asset-licences` |
| Avaturn (optional) | — | Free tier is the iframe widget only, and it uploads the selfie. API access is **$800/month** for up to 1,000 avatars, then $0.15 each. Not enabled by default, and it must be disclosed to users before use. |
