/**
 * The AvatarProvider seam.
 *
 * Photo-to-avatar is the one part of this product that depends on a third party,
 * so it is behind a narrow interface with three implementations:
 *
 *   'local-fit'  Option B — MediaPipe landmarks + on-device texture/shape fit. Free,
 *                fully private, ships today. Default.
 *   'avaturn'    Option A — Avaturn's hosted selfie-to-rigged-GLB flow, embedded as
 *                an iframe. Free tier only, and it uploads the selfie (disclosed in
 *                the UI). See docs/PROVIDERS.md.
 *   'lam'        Option C — reserved hook for a GPU backend running a single-image
 *                avatar model (LAM). Not implemented; the type exists so the
 *                upgrade is a drop-in.
 *
 * Providers return bytes, never a live scene graph — so a provider can run in a
 * worker, on a server, or in an iframe without the render layer caring.
 */
import type { BlendshapeMapping } from './blendshapeMap'

export type AvatarSourceId = 'sample' | 'local-fit' | 'avaturn' | 'lam'

/** Where the user's photo ends up. Surfaced in the UI before anything is uploaded. */
export type PrivacyClass = 'on-device' | 'uploads-photo'

/** How the provider charges for a generation. Surfaced in the UI and the README. */
export type CostClass = 'free' | 'free-tier' | 'paid' | 'self-hosted'

export interface ProviderInfo {
  id: AvatarSourceId
  label: string
  /** One line, shown in the provider picker. */
  summary: string
  privacy: PrivacyClass
  cost: CostClass
  /** Longer disclosure shown when this provider is selected and it uploads data. */
  disclosure?: string
  /** Why this provider might be unavailable right now (config missing, offline...). */
  availability?: () => Promise<ProviderAvailability>
}

export type ProviderAvailability =
  | { ready: true }
  | { ready: false; reason: string; recoverable: boolean }

export interface ProgressReport {
  /** Coarse stage label for the UI. */
  stage: 'validating' | 'detecting' | 'fitting' | 'texturing' | 'packing' | 'downloading' | 'done'
  /** 0..1, monotonic within a generation. */
  progress: number
  message: string
}

export interface AvatarRequest {
  /** The user's selfie, already validated by `photo/validatePhoto.ts`. */
  photo: ImageBitmap
  /** Optional raw file, for providers that need to re-upload the original bytes. */
  file?: File
  signal?: AbortSignal
  onProgress?: (report: ProgressReport) => void
}

/** Rig facts the loader needs in order to drive a model generically. */
export interface RigHints {
  /** Object name of the bone/node that carries head rotation. */
  headNode?: string
  /** Object name of the neck node, if the model has a separate one. */
  neckNode?: string
  /** Names of the separate eye pivot nodes, from the subject's point of view. */
  eyeLeftNode?: string
  eyeRightNode?: string
  /** Name of the mesh that carries the 52 ARKit morph targets. */
  faceMesh?: string
  /** Explicit ARKit-name -> morph-target-name mapping, when it is not auto-detectable. */
  blendshapeMapping?: BlendshapeMapping
  /** Local-space offset that centres the head for the studio camera. */
  focusOffset?: [number, number, number]
  /** Approximate head height in metres, used to frame the shot. */
  headSize?: number
}

/** A generated or bundled avatar, ready to hand to the loader. */
export interface AvatarAsset {
  source: AvatarSourceId
  /** GLB bytes. Providers that generate on-device return a fresh ArrayBuffer. */
  glb: ArrayBuffer
  /** Optional override for the face albedo, as a PNG/JPEG blob. */
  faceTextureBlob?: Blob
  /** Optional explicit mapping for rigs whose morph target names are unusual. */
  rigHints?: RigHints
  /** Free-form audit data: provider version, fit metrics, licences. */
  metadata: {
    provider: string
    /** ISO timestamp of generation. */
    generatedAt: string
    /** Measured or estimated bytes on the wire. */
    bytes?: number
    /** Anything a reviewer would want to know about provenance or quality. */
    notes?: string[]
  }
}

export interface AvatarProvider extends ProviderInfo {
  /** Generate an avatar. Must respect `signal` and report progress monotonically. */
  generate(request: AvatarRequest): Promise<AvatarAsset>
}

/** Guards a provider registry from ever being handed a half-built provider. */
export function isUsableProvider(p: AvatarProvider): boolean {
  return typeof p.generate === 'function' && !!p.id && !!p.label
}
