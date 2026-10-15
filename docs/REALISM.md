# Realism pass — what changed, and the evidence

The goal for this pass was specific: stop the head reading as a mannequin. That is almost
never a polygon problem. It is light *ratios*, a material that responds to light the way
skin does, and a face that is never perfectly still.

Two things follow from having no browser in the build environment:

1. The comparison images on this page are **software-rasteriser renders**, not browser
   screenshots. They are produced by `tools/realism-probe.mjs`, which imports the app's
   own light and material constants, so they move when the app's numbers move.
2. Everything the probe does *not* model is listed at the bottom, because a render that
   flatters the change would be worse than no render.

![Before and after](img/realism-labelled.png)

*Left: `feb7732`, the commit before this pass. Right: this pass. Same geometry, same
camera, same crop, same flat skin albedo — the only differences are the ones in the tables
below.*

## Lighting

`src/render/lighting.ts`. The layout was already a soft three-point studio; the ratios were
the problem. A fill at 40% of the key flattens a face into a mask, which is the single most
common reason a rendered head looks synthetic.

| | before | after | why |
| --- | --- | --- | --- |
| key | `0xfff2e4` @ 2.15 | `0xfff1e0` @ **2.45** | warmer, and the key should carry the form |
| fill | `0xe8eeff` @ 0.85 | `0xdfe9ff` @ **0.62** | a 1:4 ratio is a portrait; 1:2.5 is a passport photo |
| rim | `0xbcd4ff` @ 1.45 | `0xb4d0ff` @ **1.7** | dark hair has to separate from a dark studio |
| bounce | `0xffd9be` @ 0.35, `decay: 2` | @ 0.42, **`decay: 0`** | see the bug below |
| ambient | `0x2a3040` @ 0.32 | `0x232a3a` @ **0.18** | ambient only exists so shadows do not crush |
| hair/back light | — | `0xcfe0ff` @ **0.55** | a separate instrument behind the crown |
| catchlight | — | `0xfff6ea` @ **0.34**, directional | the specular dot in each cornea |
| env (`ENV_INTENSITY`) | 0.55 | **0.7** | the HDR carries the soft ambient shape |
| `EXPOSURE` | 0.94 | **0.92** | skin clips early under ACES |

### The bug the probe found

The bounce was a `pointLight` 0.18 m under the chin with `decay: 2`. Inverse-square falloff
at that distance multiplies a nominal 0.35 by ~30, so the "subtle warm bounce" was arriving
at the chest as **irradiance 10.6 — more than four times the key**. That is the white wash
across the neck in the left-hand image, and it was there before this pass: the old probe
could not show it because it only ever modelled a single Lambert light.

| | before | after |
| --- | --- | --- |
| bounce irradiance at the chest (180 mm) | 10.63 | **0.42** |

Fixed by modelling the bounce the way a bounce card actually behaves — a large, close area
source: `decay: 0` (no distance falloff) with a cutoff in head-heights so it cannot leak up
onto the face. `BOUNCE` in `lighting.ts` documents the reasoning.

The catchlight changed shape for the same class of reason. A point light bright enough to
put a dot in a cornea sits ~0.2 head-heights off the face, and at that range it becomes the
brightest object in the scene and burns the eyelid. A camera-axis directional light is what
a real ring/beauty light is: bounded, even across the face, and it still lands a tight dot
in both corneas.

## Skin and eyes

`src/avatar/local/buildHead.ts`.

| | before | after | why |
| --- | --- | --- | --- |
| skin roughness | 0.62 | **0.55** | where a forehead under a softbox actually puts its lobe |
| skin `ior` | (default 1.5) | **1.4** | the measured IOR of skin; 1.5 is glassier |
| `specularIntensity` | (default 1.0) | **0.6** | dry stratum corneum reflects ~4% |
| sheen | 0.55 | **0.62**, `0xff9d78` | the scattering stand-in, warmed toward flesh |
| clearcoat | 0.16 / 0.35 | **0.2 / 0.3** | a thin, tighter coat |
| subsurface | one wrap term @ 0.20 | two terms, 0.26 + a flat-lit term | keeps unlit skin from going matte grey |
| eye roughness | 0.08 | **0.14** + clearcoat 1/0.02 | sclera is not the wet part; the tear film is |
| eye `ior` | 1.38 | **1.376** | the IOR of the cornea |
| eye `envMapIntensity` | 1.6 | **2.1** | the cornea takes more of the room than anything else |

The eye change is the one worth reading twice: a single low-roughness surface turns an
eyeball into a marble. Two layers — a slightly rough sclera under a near-mirror clearcoat —
is what reads as a wet eye.

## Idle life

`src/avatar/idle.ts`. A face that blinks on a perfectly regular clock is a loop, and loops
are what the eye picks up as fake.

* Blink *rate* drifts on a ~60 s cycle, so the gap between blinks is not uniformly random.
* The brow follows the blink: a decaying impulse lifts `browInnerUp` at each blink and
  settles over ~0.5 s.
* A tremor (two incommensurate sines, 39.6 s⁻¹ and 25.8 s⁻¹) keeps the head out of
  perfect stillness at rest, where a real head is never still either.

Idle output is `max()`-combined with manual and live input, so it can never fight a user's
expression or a tracker reading.

## Cost

Realism is not free, so two things pay for it:

* The lite tier now updates the rig at **30 Hz while still rendering at full rate**. The
  idle animator produces nothing above ~2 Hz and the tracker never delivers faster than
  30 fps, so halving the update rate is invisible; the render loop is untouched.
* The catchlight and hair light are both shadowless and directional — one extra uniform
  light's worth of cost, not another shadow map.

Measured JavaScript cost per frame (see [PERFORMANCE.md](PERFORMANCE.md)):
**1.1 µs** for the full live-mode JS slice, i.e. ~0.007 ms at a 6× throttle.

## Reproducing

```bash
node tools/realism-probe.mjs     # writes tools/out/realism-*.png and prints the tables above
```

The "after" preset is imported live from `src/render/lighting.ts` and from the materials
`buildHead.ts` constructs. The "before" preset is hard-coded at commit `feb7732` and must
never be edited — it is the control.

## What the render does not show

Honest limits of this evidence, in order of how much they matter:

* **It is not a browser screenshot.** No browser exists in this environment. These are
  ~520×640 CPU renders of the same geometry with an approximation of three.js's lit path.
* No normal map, roughness map, or albedo texture — the head is painted a flat medium-skin
  reflectance (`0.46, 0.32, 0.27` linear). The wetness and pore detail the app gets from
  its texture set is simply absent, so the real app should read *better* than the right-hand
  image, not worse.
* No HDR environment (folded into a constant ambient tint), no shadow map, no
  `onBeforeCompile` subsurface term, and affine rather than perspective-correct
  interpolation. The eyes are flat colour, so the corneal catchlight is under-shown.
* Nothing here says anything about frame rate. That is
  [PERFORMANCE.md](PERFORMANCE.md)'s job, and it also cannot be fully answered here.

The first real check available is a browser at the deployed URL; step 4 of
[DEPLOY.md](DEPLOY.md) is the list of things to look at when someone does that.
