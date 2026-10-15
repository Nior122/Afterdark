# Avatar providers: what was evaluated, and what shipped

Photo-to-avatar is the only part of this app that can require a third party. This document
records what was researched, what it costs, what it does with a user's face, and why the
default is the boring option.

**The user's rule, applied throughout:** every paid dependency is disclosed before it is
used, and the app must work on free tiers. Anything that uploads a photo is opt-in, labelled
in the UI as `uploads-photo`, and shown with its disclosure *before* it opens.

---

## Option A — Avaturn (evaluated, not enabled by default)

Avaturn generates a rigged GLB from a selfie and is the best-known hosted option with
ARKit-compatible output. Findings as of October 2026:

| | |
| --- | --- |
| **Free tier** | Their embeddable **iframe widget** only. You get an avatar the user creates inside Avaturn's UI, on Avaturn's servers. |
| **API / JS SDK** | **Paid plan required.** The free widget cannot be driven programmatically — you cannot ask it for an avatar without a human clicking through it. |
| **Pricing** | **PRO: $800/month for up to 1,000 avatars**, then $0.15 per avatar. There is no mid-tier between free and PRO. |
| **Privacy** | The free widget **uploads the selfie to Avaturn's servers.** Avaturn's own terms then govern that image. This is exactly the thing the brief says must be disclosed before use. |
| **Integration** | We listen for the `avatar.exported` event and read the returned GLB URL. The iframe is sandboxed without `allow-same-origin`, so the host page cannot reach into it. |

### Why it is not the default

1. **It cannot be used autonomously.** The free tier is a widget a person must click
   through; there is no programmatic path without a paid plan.
2. **$800/month is not "free tier".** The brief requires everything to run on free tiers,
   and disclosing a four-figure monthly commitment as the *default* path would be wrong
   even with disclosure.
3. **It uploads the face.** The brief's strong preference is on-device processing. The
   widget's upload is acceptable *as an option* with clear disclosure, not as the default.

### How it is wired anyway

`src/avatar/providers/avaturn.ts` implements the provider. It is present in the registry
but reports `ready: false` unless `VITE_AVATURN_SUBDOMAIN` is configured, in which case the
picker shows it with its free-tier label, its `uploads-photo` privacy class and this
disclosure text:

> Avaturn builds the avatar on their servers. Choosing this uploads your photo to Avaturn,
> who handle it under their privacy policy — not this app's. On the free plan you choose
> the avatar inside Avaturn's own window.

That is the honest version: it says what happens, who is responsible, and what the user
gets. Nothing opens until the user selects it.

---

## Option B — On-device fit (`local-fit`) — the default

What it does, in `src/avatar/providers/localFit.ts`:

1. `createLandmarker({ mode: 'IMAGE', numFaces: 2 })` — two faces so the validator can
   reject group photos.
2. `validatePhoto()` — exactly one face, large enough, frontal enough, not blurred, not
   dark, no sunglasses. Failures carry a `code`, a user-facing message and a hint.
3. `fitFaceProportions()` — proportional fit from landmarks (interocular distance, face
   width/height ratio) recorded as metadata for review.
4. `projectFaceTexture()` — rasterises the photo into the rig's UV space through the
   canonical 468-landmark triangulation (898 triangles), feathers the mask boundary so
   there is no cut-out line across the jaw, dehazes so baked lighting is not doubled.
5. Encodes the result as a PNG blob and returns the bundled rig plus that texture.

Cost: **zero.** Network: **zero.** Caches: the rig is reused, so a second generation costs
no download at all.

Its honest limitation, stated in the UI as well as here: this transfers *appearance*, not
*identity geometry*. The base head's silhouette, hair and profile are what you get; the
photo supplies the face. Fixing that properly is upgrade #1 below.

---

## Option C — GPU backend (LAM-class) — hook only, deliberately not built

`src/avatar/providers/lam.ts` exists as the seam and nothing more. It reports
`ready: false` unless `VITE_LAM_ENDPOINT` is set, and its `generate()` throws
`AppError('lam-not-configured')` with the message that implementing it is a backend task.
The brief is explicit that this must not be built now, and the value of the hook is that
adding it later changes one file plus one environment variable: the picker, the disclosure
UI, the progress reporting and the persistence layer all work unchanged.

---

## Rejected: Ready Player Me

RPM's service has been shut down; it must not be used. Noted here so nobody re-adds it
after seeing it in an older tutorial.

---

## Asset licences

| Asset | Origin | Licence |
| --- | --- | --- |
| `facecap.glb` (the bundled base head) | Distributed with three.js as a sample model; originally by Face Cap (Bannaflak) | **No explicit commercial grant found.** The three.js distribution and the author's documentation page describe the *data format*, not licensing terms. |
| `face_landmarker.task` | Google MediaPipe model distribution | Apache-2.0 (per the MediaPipe project) |
| MediaPipe WASM runtime | `@mediapipe/tasks-vision` npm package | Apache-2.0 |
| Draco decoder, basis transcoder | `three/examples/jsm/libs` | Apache-2.0 |
| `studio.hdr` | Generated by `scripts/gen-studio-env.mjs` | none required |
| three.js, React, r3f, drei, zustand, Tailwind, Vite | npm | MIT |

**Consequence, stated plainly:** the sample head is fine for evaluation and for this
prototype, and it is disclosed in the app's About sheet as well as here. Before any
commercial deployment it must be replaced with a head whose licence you hold. Because the
loader resolves nodes and morph targets by well-known names, that replacement is a file
swap plus, at most, a `rigHints` entry.
