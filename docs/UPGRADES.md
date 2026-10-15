# Upgrades, in the order they are worth doing

## 1. Real identity geometry — the LAM-class backend

**Problem it fixes.** Today's photo mode projects your *appearance* onto a base head. The
texture carries the likeness; the geometry does not. A user looking at their own profile
sees the base head's profile.

**What to build.** A small GPU service running a single-image avatar model (LAM-style),
returning a neutral-expression GLB with ARKit blendshapes and a 4K albedo. Everything in
front of it already exists.

**Where the seam is.** `src/avatar/providers/lam.ts`:

```ts
export function createLamProvider(): AvatarProvider {
  // ready: false unless VITE_LAM_ENDPOINT is set
  async generate(request) { /* POST request.photo, stream progress, return AvatarAsset */ }
}
```

The contract to honour: report progress monotonically through `AvatarRequest.onProgress`,
respect `request.signal`, and return `AvatarAsset` — `glb` plus optional
`faceTextureBlob`, `rigHints` and `metadata.notes`. The picker, the disclosure UI, the
progress bar, IndexedDB persistence and "delete my avatar" all work with no changes.

**Disclosure requirement.** This provider uploads a photo. It must ship with
`privacy: 'uploads-photo'`, a `cost` class, and a `disclosure` string shown before it can
be selected. The plumbing for that is already used by the Avaturn entry.

**Cost note.** A single A100-class GPU serving one model is roughly $1–2/hour on spot
pricing; a warm instance plus a queue is the honest shape of this, not a free tier.

---

## 2. A licensed base head with per-user skin blending

**Problem it fixes.** The bundled `facecap.glb` has no explicit commercial grant (see
PROVIDERS.md). It is also fixed in skin tone, so a projected face has to blend into a
predetermined bust colour.

**What to build.** Buy or commission a rigged head with all 52 ARKit channels, separate eye
meshes and a permissive licence; add a second skin-tone pass that samples the projected
texture's average colour and tints the bust/neck to match, with a gradient across the
jaw seam.

The second half is mostly written: `averageColorTexture()` in `loader.ts` already derives a
flat tint from the projected face, and `applyBustOcclusion()` already handles the bust
blend. The remaining work is a small gradient rather than a flat tint.

---

## 3. Eye-region refinement

**Problem it fixes.** At close camera distances, iris and eye-white detail is what makes a
face read as real, and the projection pass blurs the eye region the most (it is the area
with the smallest triangles and the most specular highlights).

**What to build.** A second, smaller projection pass dedicated to the eye region at 2×
resolution: iris texture, a cornea normal map, and an eyelid shadow ramp. Then, on the rig
side, make sure the eyelids follow gaze — the `Rig` already writes `eyeLook*` to both morph
targets and eye bones, so the missing piece is the eyelid follow-through.
