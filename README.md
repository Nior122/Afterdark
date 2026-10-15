# Faceverify — 3D Digital Twin

Turn a selfie into a realistic, rigged 3D head, then either animate it by hand or drive it
live with your camera. Mobile-first PWA, built for mid-range Android on metered data:
everything runs on the device, nothing is uploaded, and the tracking model is
self-hosted.

```
Photo ──▶ on-device fit ──▶ rigged ARKit head ──▶ Manual tray ──or──▶ Live camera
                                                     ▲                    │
                                                     └────── Record ◀─────┘
```

## What is in the box

| Mode | What the user gets |
| --- | --- |
| **Manual** | A 104 px joystick for yaw/pitch that springs back to centre, an eye panel (hold-to-blink, gaze pad, Split toggle for independent eyes) and a mouth panel (vertical open slider, smile axis that crosses over into a frown, pucker). Plus a Reset pose button. |
| **Live** | Front camera drives head rotation, blinks, gaze, brows, jaw, mouth and smile. One-second neutral calibration, mirror toggle, camera flip, and a recording button. |
| **Photo** | Upload → validated in-browser → a 1024² (512² in Lite) face texture projected into the rig's UV space → your face on a full ARKit head. |

Recording captures the WebGL canvas (`captureStream` → `MediaRecorder`), prefers
MP4/H.264 where the platform supports it and falls back to WebM/VP9, optionally mixes in
the microphone, optionally adds a watermark (drawn *inside* the scene, so the capture never
reads the drawing buffer back), and shares through the Web Share API with a download
fallback.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 — bind to 0.0.0.0 for LAN/phone testing
npm run build      # type-check, bundle, generate the service worker
npm run preview    # serve dist/ on 4173
npm run lint       # eslint, flat config
npm test           # node:test — filter, env, manual-input and asset unit tests
npm run icons      # regenerate the PWA icons

# verification probes (no browser needed — see docs/REALISM.md, docs/PERFORMANCE.md)
npm run probe:geometry   # software-render the bust from the real geometry
npm run probe:realism    # before/after renders of the lighting + material pass
npm run probe:perf       # per-frame JavaScript cost of the app's own hot path
```

`npm run dev` and `npm run build` both run `predev`/`prebuild`, which stage the runtime
assets (`scripts/fetch-assets.mjs`), generate the studio HDR (`scripts/gen-studio-env.mjs`)
and draw the icons (`scripts/gen-icons.mjs`). Nothing is fetched from a CDN at runtime.

### Assets

| Asset | Where it comes from | Licence |
| --- | --- | --- |
| `public/models/facecap.glb` | Bundled sample head (three.js repo) | **Unresolved for commercial use** — see [docs/PROVIDERS.md](docs/PROVIDERS.md#asset-licences) |
| `public/mediapipe/*` | `@mediapipe/tasks-vision` package + `face_landmarker.task` | Apache-2.0 |
| `public/draco/*`, `public/basis/*` | `three/examples/jsm/libs` | Apache-2.0 |
| `public/hdr/studio.hdr` | Generated in-repo | none needed |

## Architecture

```
src/
  avatar/       provider seam, GLB loader, ARKit channel map, rig driver, idle animator
    providers/  localFit (on-device, default) · avaturn (hosted, opt-in) · lam (hook only)
    local/      procedural bust, hair shell, skin textures, canonical face
  tracking/     MediaPipe landmarker, pose decomposition, One Euro filters, calibration
  render/       the single r3f canvas: studio lighting, adaptive quality
  state/        zustand store (human-speed state) + manualInput singleton (per-frame state)
  features/     photo validation & projection, recording
  ui/           joystick, eye panel, lips panel, sheets, live overlay
  legal/        Terms and Privacy as real pages
```

Three rules hold the performance story together:

1. **Per-frame data never enters React.** Head pose and the 52 expression channels are
   written into a mutable `FaceState` object; the render loop reads it. React re-renders
   only for things a human can perceive — mode changes, sheet opens, tracking status.
2. **Pointer moves never re-render either.** The joystick, sliders and gaze pad write
   straight to the DOM for their own thumb/fill, and to a non-reactive singleton for the
   value. Dragging a slider does not touch the reconciler.
3. **Everything expensive is lazy.** MediaPipe and its WASM load only when Live mode is
   entered; the codecs load only when a compressed model needs them; nothing is
   precached until after the first paint.

### The provider seam

Photo-to-avatar is the one part of the product that could depend on a third party, so it
sits behind `AvatarProvider` (`src/avatar/types.ts`). Providers return bytes, never a
scene graph, so one can run on-device, in an iframe, or on a server without the render
layer caring. Each entry declares its `privacy` class and `cost`, both of which are shown
in the picker before anything runs.

| Provider | Privacy | Cost | Status in this build |
| --- | --- | --- | --- |
| `local-fit` | on-device | free | **Enabled**, default |
| `avaturn` | uploads your photo to Avaturn | free tier is their iframe widget; API needs a paid plan | Enabled only if `VITE_AVATURN_SUBDOMAIN` is set |
| `lam` | uploads your photo to your own GPU server | self-hosted | Hook only, no implementation — set `VITE_LAM_ENDPOINT` and implement `generate()` |

Full findings, including Avaturn's current pricing and terms and the reasoning for not
defaulting to it, are in [docs/PROVIDERS.md](docs/PROVIDERS.md).

### Rendering and realism

One soft studio, one shadow-casting key, `ACESFilmicToneMapping` with `EXPOSURE 0.92`,
sRGB output, a small HDR environment, and a camera-axis catchlight that puts a specular dot
in each cornea. Skin is `MeshPhysicalMaterial` at `roughness 0.55`, `ior 1.4` and
`specularIntensity 0.6` with a warm sheen and an `onBeforeCompile` subsurface term; eyes
are deliberately two-layered (a slightly rough sclera under a near-mirror clearcoat) because
one glossy sphere reads as a marble. The idle animator drifts its blink rate, follows blinks
with the brow, and keeps a tremor so the face is never perfectly still.

What changed in the realism pass, why, and the before/after renders:
**[docs/REALISM.md](docs/REALISM.md)**.

### Tracking

MediaPipe Face Landmarker (`runningMode: 'VIDEO'`, `outputFaceBlendshapes`,
`outputFacialTransformationMatrixes`), GPU delegate with an automatic CPU fallback, driven
by `requestVideoFrameCallback` where available and gated on `video.currentTime` changing.

* The facial transformation matrix is decomposed to a quaternion and filtered as a
  quaternion (SLERP, One Euro) — filtering three Euler angles independently gimbals at the
  poles, which is exactly where a 40° head turn lives.
* Blendshapes go through a per-channel One Euro bank; gaze through its own with different
  presets, because eyes need to be faster than a jaw.
* Mirroring is applied at the source (negate yaw and roll), so the avatar behaves like a
  mirror rather than like a person facing you.
* One-second calibration captures a neutral baseline; the dead zone is 2.2σ (clamped) and
  the gain is capped at 2.6× so a quiet face cannot be amplified into a twitch.
* Loss of tracking >300 ms eases the avatar to neutral and shows "center your face" —
  never a freeze.

### Quality tiers

`lite` (no shadows, 1× DPR, CPU tracker, 512² textures) · `balanced` (default) · `high`.
`AdaptiveQuality` watches the rolling frame time and steps down when frames drop below
24 FPS, and steps back up when there is headroom. Pinning a tier in Settings disables the
watchdog and says so. Lite also releases the GPU delegate to the CPU so rendering keeps
its budget.

## Deploying

**There is no live URL yet** — deploying needs hosting credentials this project does not
have. Full step-by-step instructions, the pre-deploy checklist and the post-deploy
verification list are in **[docs/DEPLOY.md](docs/DEPLOY.md)**.

The app is a static SPA. Any static host works; two one-liners:

```bash
# Cloudflare Pages
npx wrangler pages deploy dist --project-name faceverify

# Vercel
npx vercel deploy --prod dist
```

Both need HTTPS: `getUserMedia` refuses to run otherwise (localhost is exempt). The
service worker is generated at build time, so deploy the built `dist/`, not the source.

**Browser support.** Chrome/Edge 111+ and Safari 16.4+ (WebGL2, `MediaRecorder`,
`createImageBitmap`). iOS Safari needs `playsinline` on the camera element (done) and
`muted` on the preview video (done). Firefox animates and records, but MediaPipe's GPU
delegate falls back to CPU there.

## Privacy

Photos and camera frames are processed in the browser with WASM and WebGL. There is no
account, no analytics, no upload — unless you deliberately enable a provider that uploads,
in which case the picker says so in plain language before it opens. The generated avatar
lives in this browser's IndexedDB and **Settings → Your data → Delete my avatar** removes
it along with the preferences and the cached model files.

## Performance notes

Measured per-frame JavaScript cost is in [docs/PERFORMANCE.md](docs/PERFORMANCE.md),
together with the 6× CPU-throttle procedure and what to expect on a mid-range Android. The
short version: the app's own animation/filtering code costs ~1 µs per frame, the lite tier
updates the rig at 30 Hz while rendering uncapped, and **no frame rate has been measured for
this project** because there is no browser in the environment it was built in.

* First meaningful paint does not include the tracker: MediaPipe's JS, WASM and model
  (~17 MB raw) load only when Live mode is entered, and are excluded from the service
  worker precache but runtime-cached after the first use.
* Model codecs (`draco/`, `basis/`) are excluded from precache for the same reason — they
  are fetched only if a compressed model asks for them.
* `devicePixelRatio` is capped at 2 (and lower per tier); the contact shadow and shadow map
  resolutions scale with the tier.
* The 3D scene, the tracker and the recorder are all torn down when their mode is left;
  the camera track is stopped, not merely paused.

## Known limitations

* **Photo mode is a projection, not a reconstruction.** Your face is painted onto a
  licensed quality base head; the silhouette, hair and profile come from the base model.
  The likeness is in the texture, not the geometry.
* **Sample head licence is unresolved** for commercial use. Replacing `public/models/*.glb`
  with a licensed ARKit head is a file swap.
* Blink and smile detection can lag by a frame at 30 fps on low-end phones; the filters
  trade a few milliseconds of latency for stability.
* Recording is capped at 90 seconds per clip, and Safari records MP4 only.
* Back-camera mode tracks only if a face is visible in the frame; there is no
  face-detection assist for aiming.
* **Nothing here has been run in a browser.** Type-checking, linting, unit tests, the
  production build, the asset graph and the offline renders are all verified; camera
  permission, real recording output, gestures, iOS Safari quirks and frame rate are not.
  [docs/DEPLOY.md §4](docs/DEPLOY.md) is the checklist that closes that gap.
* The before/after renders are software-rasteriser images of the real geometry and the real
  constants, not browser screenshots — no textures, no HDR, no shadows. See
  [docs/REALISM.md](docs/REALISM.md).

## Next three upgrades

1. **Identity geometry (LAM-style)** — `src/avatar/providers/lam.ts` is the whole hook:
   implement `generate()` against a GPU backend running a single-image avatar model and the
   rest of the app, including the disclosure UI, already works.
2. **A licensed base head** — swap the sample GLB for a rigged head with a commercial
   licence and per-user skin tone blending at the jaw seam.
3. **On-device IRIS/eye refinement** — separate iris textures generated from the photo's
   eye region, so gaze reads correctly at close camera distances.
