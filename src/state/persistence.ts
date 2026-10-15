/**
 * Local persistence.
 *
 * Two things are stored, both on-device:
 *   - preferences (small JSON, in IndexedDB's kv store)
 *   - the generated avatar: the GLB bytes and the projected face texture, as blobs
 *
 * Nothing here touches the network. The IndexedDB store is the reason "delete my
 * avatar" is a meaningful button rather than a gesture, and it is also what makes a
 * generated avatar survive a reload instead of costing the user another generation and
 * another few megabytes of data.
 */
import { BLOB_KEYS, KV_KEYS, idbDeleteBlob, idbGet, idbGetBlob, idbSet, idbSetBlob } from '../lib/idb'
import { devWarn } from '../lib/util'
import type { AvatarAsset, AvatarSourceId, RigHints } from '../avatar/types'
import type { QualityTier } from '../render/quality'

export interface Prefs {
  qualityTier: QualityTier
  qualityPinned: boolean
  /** The manual "Lite quality" switch, honoured even when adaptive quality would raise it. */
  lite: boolean
  mirror: boolean
  splitEyes: boolean
  recordAudio: boolean
  watermark: boolean
  /** Providers the user has been warned about, so the disclosure is shown once. */
  acknowledgedProviders: string[]
}

export const DEFAULT_PREFS: Prefs = {
  qualityTier: 'balanced',
  qualityPinned: false,
  lite: false,
  mirror: true,
  splitEyes: false,
  recordAudio: false,
  watermark: true,
  acknowledgedProviders: [],
}

const PREFS_VERSION = 1

export async function loadPrefs(): Promise<Prefs> {
  try {
    const stored = await idbGet<{ version: number; prefs: Partial<Prefs> }>(KV_KEYS.prefs)
    if (!stored || stored.version !== PREFS_VERSION) return { ...DEFAULT_PREFS }
    // Merge rather than replace: a preference added in a later version must not be
    // undefined for someone who has been using the app since the previous one.
    return { ...DEFAULT_PREFS, ...stored.prefs }
  } catch (err) {
    devWarn('could not read preferences', err)
    return { ...DEFAULT_PREFS }
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  try {
    await idbSet(KV_KEYS.prefs, { version: PREFS_VERSION, prefs })
  } catch (err) {
    devWarn('could not save preferences', err)
  }
}

interface StoredAvatarMeta {
  version: number
  source: AvatarSourceId
  provider: string
  generatedAt: string
  bytes?: number
  notes?: string[]
  rigHints?: RigHints
  hasTexture: boolean
  /** Mirrors `AvatarAsset.metadata.faceTextureMime` when one is stored. */
  textureMime?: string
}

const AVATAR_VERSION = 1

export async function saveAvatarAsset(asset: AvatarAsset): Promise<void> {
  try {
    await idbSetBlob(BLOB_KEYS.avatarGlb, new Blob([asset.glb], { type: 'model/gltf-binary' }))
    if (asset.faceTextureBlob) {
      await idbSetBlob(BLOB_KEYS.faceTexture, asset.faceTextureBlob)
    } else {
      await idbDeleteBlob(BLOB_KEYS.faceTexture)
    }
    const meta: StoredAvatarMeta = {
      version: AVATAR_VERSION,
      source: asset.source,
      provider: asset.metadata.provider,
      generatedAt: asset.metadata.generatedAt,
      ...(asset.metadata.bytes !== undefined ? { bytes: asset.metadata.bytes } : {}),
      ...(asset.metadata.notes ? { notes: asset.metadata.notes } : {}),
      ...(asset.rigHints ? { rigHints: asset.rigHints } : {}),
      hasTexture: Boolean(asset.faceTextureBlob),
      ...(asset.faceTextureBlob?.type ? { textureMime: asset.faceTextureBlob.type } : {}),
    }
    await idbSet(KV_KEYS.avatarMeta, meta)
  } catch (err) {
    // Storage is a convenience, never a requirement: a full quota or a browser in
    // private mode must not break avatar generation.
    devWarn('could not persist avatar', err)
  }
}

export async function loadAvatarAsset(): Promise<AvatarAsset | null> {
  try {
    const meta = await idbGet<StoredAvatarMeta>(KV_KEYS.avatarMeta)
    if (!meta || meta.version !== AVATAR_VERSION) return null
    const glb = await idbGetBlob(BLOB_KEYS.avatarGlb)
    if (!glb) return null
    const buffer = await glb.arrayBuffer()
    const faceTextureBlob = meta.hasTexture ? await idbGetBlob(BLOB_KEYS.faceTexture) : undefined
    return {
      source: meta.source,
      glb: buffer,
      ...(faceTextureBlob ? { faceTextureBlob } : {}),
      ...(meta.rigHints ? { rigHints: meta.rigHints } : {}),
      metadata: {
        provider: meta.provider,
        generatedAt: meta.generatedAt,
        ...(meta.bytes !== undefined ? { bytes: meta.bytes } : { bytes: buffer.byteLength }),
        ...(meta.notes ? { notes: [...meta.notes, 'restored from this device'] } : {}),
      },
    }
  } catch (err) {
    devWarn('could not restore saved avatar', err)
    return null
  }
}

export async function deleteAvatarAsset(): Promise<void> {
  await Promise.allSettled([idbDeleteBlob(BLOB_KEYS.avatarGlb), idbDeleteBlob(BLOB_KEYS.faceTexture), idbSet(KV_KEYS.avatarMeta, null)])
}
