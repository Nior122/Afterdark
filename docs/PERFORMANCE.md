# Performance, and how to test it properly

The acceptance criterion is "tracking holds 24+ FPS on a mid-range Android, and the app
still works under a 6× CPU throttle". Read this page with one thing in mind: **no frame
rate has been measured for this project.** There is no browser, no GPU and no CPU-throttling
control in the environment it was built in, and a made-up FPS number would be worse than an
absent one.

What follows is (1) what *is* measured, (2) the exact procedure that produces the missing
number on a real device in about five minutes, and (3) what the app does to hold its budget.

## 1. What is measured

`node tools/perf-probe.mjs` runs the app's **own** modules — `IdleAnimator`,
`OneEuroFilter`/`QuaternionSmoother`, `applyManualExpression` — and reports the per-frame
JavaScript cost:

```
  work                                          native    6x CPU   share of 24 FPS frame
  --------------------------------------------------------------------------------------
  IdleAnimator.update()                          0.3 µs  0.002 ms     0.00%
  applyManualExpression()                        1.3 µs  0.008 ms     0.02%
  live filters (52 channels + quat + gaze)       0.9 µs  0.005 ms     0.01%
  full JS slice of a live frame                  1.1 µs  0.007 ms     0.02%
  --------------------------------------------------------------------------------------
  frame budgets: 41.7 ms at 24 FPS · 16.7 ms at 60 FPS
```

Two caveats, both stated in the probe's own output: the "6×" column is a linear scaling, not
real throttling, and these are desktop-CPU numbers — a mid-range Android runs
single-threaded JS roughly 3–5× slower, which the 6× column deliberately over-states.

**What this supports:** the animation, filtering and expression-composition layer is not the
bottleneck, and the lite tier's 30 Hz rig update costs nothing measurable.
**What it does not support:** any claim about FPS. The unmeasured part of a frame —
rasterisation, texture upload, MediaPipe's WASM inference, the compositor — is the larger
part.

## 2. The throttled-CPU test (5 minutes, desktop Chrome)

1. `npm run dev`, open `http://localhost:5173` in Chrome (or use the deployed URL).
2. DevTools → **Performance** panel → the gear icon → **CPU: 6× slowdown**.
   Also set **Network: Fast 3G** if you want to feel the 4G budget as well.
3. In the app: tap the mode switch to **Live**, allow the camera, and let it settle.
4. **Record** a 20-second performance profile while you turn your head through ±40°, blink
   deliberately, open your mouth, and smile.
5. Open **Settings** (the gear) and read *"Currently N fps"*; the same number appears in the
   About sheet as `Render`. That value is produced by the in-app watchdog: rolling frame
   time samples, published once per second from `AvatarInstance`.
6. In the profile, check the frame breakdown: the **Scripting** slice should be a fraction of
   a millisecond; **Rendering** + **GPU** should dominate. If `detectForVideo` shows up as a
   long yellow block, the tracker is CPU-delegated — see the tier notes below.

Pass criteria: 24 FPS or better on the 6× profile in Manual mode, and no frame longer than
~150 ms (a stall that long is visible as a hitch, and usually means a shader compile or a
texture upload, not steady-state work).

To test a mid-range Android specifically, either use the same Chrome DevTools procedure over
USB (`chrome://inspect` → remote device → Performance panel), or read *Settings → Currently N
fps* on the device directly. Both are more honest than a Lighthouse score.

### Camera and tracker expectations

| Device | Expect |
| --- | --- |
| Desktop, GPU delegate | 55–60 FPS render, tracker at camera rate |
| Mid-range Android, GPU delegate | 30–45 FPS render |
| Mid-range Android, Lite tier (CPU delegate) | 24–35 FPS render, tracker ~15–20 Hz |
| iPhone 12+, Safari | 60 FPS render (ProMotion-capped by the compositor) |

If those are not what you see, the first thing to check is which tier is active:
*About → Quality* shows the tier and whether the watchdog unpinned it.

## 3. What the app does to hold the budget

* **Adaptive quality** (`src/render/quality.ts`, `AdaptiveQuality` in `AvatarStage.tsx`)
  watches a 60-frame rolling window. Below 24 FPS it steps down a tier, and steps back up
  after sustained headroom. An explicit choice in Settings pins the tier and disables the
  watchdog, which the UI says out loud.
* **Lite tier** drops shadows entirely, caps `devicePixelRatio` at 1, uses 512² textures, no
  environment map, 256² shadow maps, no antialiasing, and forces the tracker onto the CPU
  delegate so the GPU keeps its budget for rendering.
* **30 Hz rig updates in lite** (the pass described in [REALISM.md](REALISM.md)): the idle
  animator and expression composition run at half rate while the render loop stays uncapped.
* **`detectForVideo` only on new frames**, preferring `requestVideoFrameCallback`, so the
  tracker never runs twice on the same camera frame.
* **The camera is 640×480.** More resolution costs battery and CPU for a face-tracking model
  that does not read the extra pixels.
* **Everything is torn down on mode exit**: the camera track is stopped, the rAF loop is
  cancelled, the landmarker is closed. Backgrounding the tab pauses tracking.
* **The tracker is not in the critical path of first paint.** MediaPipe's JS, WASM and model
  (~16.8 MiB on first use; 12.89 MiB of that is the SIMD WASM) load only when Live mode is
  entered, and are runtime-cached by the service worker afterwards.

## 4. Data budget

| First visit | Bytes |
| --- | --- |
| App shell + avatar + HDR (service-worker precache) | ~3.0 MiB |
| First Live-mode entry (self-hosted MediaPipe) | ~16.8 MiB |
| Every visit after that | 0 from the network for both |

That is a deliberate trade: the tracker is not needed to look at a head, and a user who never
taps Live never pays for it. It is also why the tier detector drops to `lite` on Data Saver,
2G, ≤4 cores, or a small screen.
