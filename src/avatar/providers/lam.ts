/**
 * Option C: GPU backend running a single-image avatar model (LAM / Human3DAvatar
 * class). NOT IMPLEMENTED — this is the clean hook, as the brief asked.
 *
 * Why it is worth leaving a real seam rather than a TODO comment:
 *
 * The on-device provider textures and proportionally fits the user's photo, but it
 * cannot invent geometry that is not visible in a single front-facing photograph —
 * the sides of the jaw, the profile of the nose, the shape of the skull. A
 * single-image reconstruction model does exactly that in a few seconds on a GPU.
 * Everything downstream of `AvatarProvider.generate()` (loader, rig, materials, the
 * whole tracking and recording stack) already accepts any rigged GLB, so wiring LAM
 * in is a matter of filling in this one method and pointing a config flag at a
 * server. No changes are needed anywhere else in the app.
 *
 * The backend contract this expects:
 *
 *   POST /generate        multipart/form-data with `photo`
 *     202 { jobId }       accepted, work queued
 *   GET  /generate/:jobId
 *     200 { status: 'pending' | 'running', progress: 0..1 }
 *     200 { status: 'done', glbUrl, faceTextureUrl? }
 *     200 { status: 'error', message }
 *
 * Returning a URL rather than bytes keeps the model output (typically 5-15 MB) out of
 * a JSON body and lets it be served from object storage with range requests. The app
 * fetches it afterwards, exactly as it does for Avaturn.
 */
import { AppError } from '../../lib/util'
import type { AvatarProvider, AvatarAsset, ProgressReport, ProviderAvailability } from '../types'

/** Point this at a self-hosted LAM-compatible service to enable the provider. */
export const LAM_ENDPOINT: string = (import.meta.env.VITE_LAM_ENDPOINT as string | undefined)?.trim() ?? ''

export const LAM_DISCLOSURE =
  'Your photo is uploaded to the avatar server, reconstructed with a single-image ' +
  'avatar model, and the resulting 3D head is downloaded to this device. The photo is ' +
  'deleted from the server as soon as the job finishes.'

interface LamStatus {
  status: 'pending' | 'running' | 'done' | 'error'
  progress?: number
  glbUrl?: string
  faceTextureUrl?: string
  message?: string
}

const POLL_INTERVAL_MS = 900
const MAX_WAIT_MS = 120_000

export function createLamProvider(): AvatarProvider {
  return {
    id: 'lam',
    label: 'Reconstructed (server GPU)',
    summary: 'Single-image reconstruction for true 3D likeness. Requires a GPU backend.',
    privacy: 'uploads-photo',
    cost: 'self-hosted',
    disclosure: LAM_DISCLOSURE,

    availability: async (): Promise<ProviderAvailability> => {
      if (!LAM_ENDPOINT) {
        return {
          ready: false,
          reason:
            'No reconstruction backend configured. This provider needs a GPU server running a single-image avatar model; set VITE_LAM_ENDPOINT once one exists.',
          recoverable: false,
        }
      }
      try {
        const res = await fetch(`${LAM_ENDPOINT}/health`, { method: 'GET' })
        return res.ok
          ? { ready: true }
          : { ready: false, reason: `Backend responded ${res.status}.`, recoverable: true }
      } catch {
        return { ready: false, reason: 'Reconstruction backend is unreachable.', recoverable: true }
      }
    },

    async generate({ photo, file, signal, onProgress }): Promise<AvatarAsset> {
      if (!LAM_ENDPOINT) {
        throw new AppError(
          'lam-not-configured',
          'No reconstruction backend is configured.',
          'Set VITE_LAM_ENDPOINT to a running service. See docs/UPGRADES.md.',
        )
      }

      const report = (r: ProgressReport) => onProgress?.(r)
      report({ stage: 'validating', progress: 0.05, message: 'Uploading your photo…' })

      // Prefer the original file bytes when available (no re-encode loss); otherwise
      // re-encode the decoded bitmap.
      const blob = file ?? (await new Promise<Blob>((resolve, reject) => {
        const canvas = document.createElement('canvas')
        canvas.width = photo.width
        canvas.height = photo.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new AppError('no-2d-context', 'This browser cannot encode images.'))
        ctx.drawImage(photo, 0, 0)
        canvas.toBlob((b) => (b ? resolve(b) : reject(new AppError('encode-failed', 'Could not encode the photo.'))), 'image/jpeg', 0.94)
      }))

      const form = new FormData()
      form.append('photo', blob, 'selfie.jpg')

      const submit = await fetch(`${LAM_ENDPOINT}/generate`, { method: 'POST', body: form, signal })
      if (!submit.ok) {
        throw new AppError('lam-submit-failed', `The avatar server rejected the request (HTTP ${submit.status}).`)
      }
      const { jobId } = (await submit.json()) as { jobId: string }
      if (!jobId) throw new AppError('lam-bad-response', 'The avatar server did not return a job id.')

      const deadline = performance.now() + MAX_WAIT_MS
      let status: LamStatus = { status: 'pending' }
      while (performance.now() < deadline) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

        const poll = await fetch(`${LAM_ENDPOINT}/generate/${jobId}`, { signal })
        if (!poll.ok) continue
        status = (await poll.json()) as LamStatus

        if (status.status === 'error') {
          throw new AppError('lam-failed', status.message ?? 'The avatar server reported an error.')
        }
        if (status.status === 'done' && status.glbUrl) break

        report({
          stage: status.status === 'running' ? 'fitting' : 'downloading',
          progress: 0.05 + 0.6 * (status.progress ?? 0),
          message: 'Reconstructing your head…',
        })
      }

      if (status.status !== 'done' || !status.glbUrl) {
        throw new AppError('lam-timeout', 'Reconstruction took too long and was stopped.')
      }

      report({ stage: 'downloading', progress: 0.7, message: 'Downloading your head…' })
      const glbRes = await fetch(status.glbUrl, { signal })
      if (!glbRes.ok) throw new AppError('lam-download-failed', `Could not download the avatar (HTTP ${glbRes.status}).`)
      const glb = await glbRes.arrayBuffer()

      let faceTextureBlob: Blob | undefined
      if (status.faceTextureUrl) {
        const texRes = await fetch(status.faceTextureUrl, { signal })
        if (texRes.ok) faceTextureBlob = await texRes.blob()
      }

      report({ stage: 'done', progress: 1, message: 'Ready' })

      return {
        source: 'lam',
        glb,
        faceTextureBlob,
        metadata: {
          provider: `single-image reconstruction @ ${LAM_ENDPOINT}`,
          generatedAt: new Date().toISOString(),
          bytes: glb.byteLength + (faceTextureBlob?.size ?? 0),
          notes: ['reconstructed server-side; photo deleted after the job completed'],
        },
      }
    },
  }
}
