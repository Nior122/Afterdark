/**
 * Option B: on-device photo fit.
 *
 * The default provider, and the only one that is both free and fully private.
 *
 * What it does:
 *   1. runs Face Landmarker on the photo (IMAGE mode) to get 478 landmarks
 *   2. projects the user's own pixels into the rig's face UV space
 *   3. derives a proportional fit from the landmarks
 *   4. returns the bundled rig unchanged, plus the projected texture
 *
 * What it deliberately does not do: reconstruct identity geometry. The projected
 * photo is what carries likeness, and it carries most of it. See docs/UPGRADES.md for
 * the path to true identity fitting.
 *
 * Cost: zero. Network: zero. The photo never leaves the device.
 */

import { AppError } from '../../lib/util'
import { loadSampleAsset } from '../loader'
import type { AvatarProvider, AvatarRequest, AvatarAsset, ProviderAvailability } from '../types'
import { fitFaceProportions, projectFaceTexture } from '../../features/photo/projectFaceTexture'
import { validatePhoto } from '../../features/photo/validatePhoto'

export interface LocalFitProviderOptions {
  /** Texture resolution. Lite quality uses 512. */
  textureSize?: number
}

export function createLocalFitProvider(options: LocalFitProviderOptions = {}): AvatarProvider {
  const textureSize = options.textureSize ?? 1024

  return {
    id: 'local-fit',
    label: 'On-device fit',
    summary: 'Uses your photo on this device to texture and shape the head. Nothing is uploaded.',
    privacy: 'on-device',
    cost: 'free',
    availability: async (): Promise<ProviderAvailability> => ({
      ready: true,
    }),

    async generate({ photo, signal, onProgress }: AvatarRequest): Promise<AvatarAsset> {
      const started = performance.now()
      const report = (stage: Parameters<NonNullable<AvatarRequest['onProgress']>>[0]['stage'], progress: number, message: string) =>
        onProgress?.({ stage, progress, message })

      report('detecting', 0.05, 'Finding your face…')

      // IMAGE mode with 2 faces so the validator can reject group photos.
      // Imported here rather than at module scope so that opening the photo sheet does
      // not download the MediaPipe bundle before the user has even picked a photo.
      const { createLandmarker } = await import('../../tracking/landmarker')
      const handle = await createLandmarker({ mode: 'IMAGE', numFaces: 2, signal })
      try {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

        const raw = handle.landmarker.detect(photo)
        const landmarks = raw.faceLandmarks?.[0]
        if (!landmarks) {
          throw new AppError(
            'no-face',
            "We couldn't find a face in that photo.",
            'Face the camera straight on, in good light, without sunglasses.',
          )
        }

        // Re-validate here as well as in the UI: the provider must never build an
        // avatar from a photo the checks would reject, whatever the caller did.
        const reportValidation = validatePhoto(photo, raw)
        if (!reportValidation.ok) {
          throw new AppError(
            reportValidation.failure?.code ?? 'invalid-photo',
            reportValidation.failure?.message ?? 'That photo could not be used.',
          )
        }

        report('fitting', 0.25, 'Measuring your face…')
        const fit = fitFaceProportions(landmarks)

        report('texturing', 0.45, 'Painting your photo onto the head…')
        // Yield so the progress bar can paint before we block on rasterisation.
        await new Promise((r) => setTimeout(r, 0))

        const projection = projectFaceTexture(landmarks, photo, {
          size: textureSize,
          feather: Math.round(textureSize / 56),
        })

        report('packing', 0.8, 'Packaging your avatar…')
        const faceTextureBlob = await imageDataToPngBlob(projection.image)

        // Reuse the bundled rig: it is the only one we ship with all 52 ARKit
        // blendshapes, and re-downloading it per generation would waste data.
        const sample = await loadSampleAsset(signal)

        if (projection.coverage < 0.35) {
          // Not fatal, but worth surfacing: it usually means the photo was cropped
          // oddly rather than that anything is broken.
          projection.notes.push('low face texture coverage')
        }

        const elapsed = performance.now() - started
        report('done', 1, `Ready in ${(elapsed / 1000).toFixed(1)} s`)

        return {
          source: 'local-fit',
          glb: sample.glb,
          faceTextureBlob,
          rigHints: sample.rigHints,
          metadata: {
            provider: `on-device fit (${handle.delegate} delegate, ${textureSize}px)`,
            generatedAt: new Date().toISOString(),
            bytes: faceTextureBlob.size,
            notes: [
              ...projection.notes,
              `proportions scale x=${fit.scale.x.toFixed(3)}`,
              `generation took ${Math.round(elapsed)} ms`,
              'photo processed entirely on-device and discarded',
              `face width/height ratio ${fit.faceWidthRatio.toFixed(3)}`,
            ],
          },
        }
      } finally {
        handle.dispose()
      }
    },
  }
}

/** Encode ImageData to a PNG blob without pulling in a compression library. */
export async function imageDataToPngBlob(image: ImageData): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new AppError('no-2d-context', 'This browser cannot encode images.')
  ctx.putImageData(image, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new AppError('encode-failed', 'Could not encode the face texture.')
  return blob
}
