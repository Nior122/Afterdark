/**
 * Photo validation.
 *
 * Runs before any avatar generation, and it runs entirely on the device. The goal is
 * not to gatekeep but to tell the user *specifically* what to fix, because "invalid
 * photo" is the fastest way to lose someone on a slow connection.
 */
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { AppError } from '../../lib/util'

export type RejectionCode =
  | 'no-face'
  | 'many-faces'
  | 'too-small'
  | 'not-frontal'
  | 'too-dark'
  | 'too-bright'
  | 'blurry'
  | 'sunglasses'
  | 'not-a-face'

export interface PhotoCheck {
  ok: boolean
  code?: RejectionCode
  /** Friendly, specific instruction for the user. */
  message: string
  /** Short label for the requirement chip. */
  label: string
}

export interface ValidationReport {
  ok: boolean
  checks: PhotoCheck[]
  /** The first failing check — what we actually show. */
  failure: PhotoCheck | null
  metrics: {
    faceCount: number
    faceCoverage: number
    yawDeg: number
    pitchDeg: number
    rollDeg: number
    luma: number
    sharpness: number
    eyeContrast: number
  }
}

/** Tunables, exposed so the thresholds are auditable in one place. */
export const THRESHOLDS = {
  /** Face bounding box must cover at least this fraction of the shorter image side. */
  minFaceCoverage: 0.34,
  /** Maximum absolute yaw/pitch, in degrees. */
  maxYaw: 26,
  maxPitch: 22,
  /** Mean luma (0..255) window. */
  minLuma: 38,
  maxLuma: 232,
  /** Variance-of-Laplacian threshold. Below this the photo is mush. */
  minSharpness: 42,
  /** Eye region must be at least this fraction of the face's mean luma. */
  minEyeContrast: 0.46,
} as const

/** Luma from 8-bit RGB, Rec. 709 coefficients. */
const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

/**
 * Sample an ImageBitmap into a small ImageData for analysis.
 *
 * Downscaling first is both faster and more robust: it removes sensor noise that
 * would otherwise inflate the sharpness score.
 */
function sample(bitmap: ImageBitmap, targetLongestEdge = 256): ImageData {
  const scale = Math.min(1, targetLongestEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(8, Math.round(bitmap.width * scale))
  const h = Math.max(8, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new AppError('no-2d-context', 'This browser cannot analyse images.')
  ctx.drawImage(bitmap, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/** Full-resolution readback, used for the sharpness measurement only. */
function readFull(bitmap: ImageBitmap, maxEdge = 512): ImageData {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(8, Math.round(bitmap.width * scale))
  const h = Math.max(8, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new AppError('no-2d-context', 'This browser cannot analyse images.')
  ctx.drawImage(bitmap, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/** Variance of the Laplacian: the standard cheap focus measure. */
function sharpness(img: ImageData): number {
  const { data, width, height } = img
  const gray = new Float32Array(width * height)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = luma(data[p], data[p + 1], data[p + 2])
  }
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      // 4-neighbour Laplacian
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]
      sum += lap
      sumSq += lap * lap
      n++
    }
  }
  if (n === 0) return 0
  const mean = sum / n
  return sumSq / n - mean * mean
}

/** Mean luma inside an inclusive-normalised box. */
function meanLumaIn(img: ImageData, x0: number, y0: number, x1: number, y1: number): number {
  const ax = Math.max(0, Math.min(img.width - 1, Math.round(x0 * img.width)))
  const ay = Math.max(0, Math.min(img.height - 1, Math.round(y0 * img.height)))
  const bx = Math.max(0, Math.min(img.width - 1, Math.round(x1 * img.width)))
  const by = Math.max(0, Math.min(img.height - 1, Math.round(y1 * img.height)))
  let sum = 0
  let n = 0
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      const p = (y * img.width + x) * 4
      sum += luma(img.data[p], img.data[p + 1], img.data[p + 2])
      n++
    }
  }
  return n ? sum / n : 0
}

/** Extract yaw/pitch/roll from MediaPipe's 4x4 facial transformation matrix. */
function decomposePose(matrix: Float32Array | number[]): { yaw: number; pitch: number; roll: number } {
  // Column-major. Rotation part is columns 0..2.
  const m = matrix
  const r00 = m[0]
  const r10 = m[1]
  const r20 = m[2]
  const r21 = m[6]
  const r22 = m[10]

  const pitch = Math.asin(Math.max(-1, Math.min(1, -r20)))
  const yaw = Math.atan2(r10, r00)
  const roll = Math.atan2(r21, r22)
  const deg = 180 / Math.PI
  return { yaw: yaw * deg, pitch: pitch * deg, roll: roll * deg }
}

const OK = (label: string): PhotoCheck => ({ ok: true, label, message: '' })

/**
 * Validate an uploaded selfie against everything the rest of the pipeline needs.
 *
 * @param bitmap   the decoded photo
 * @param result   a FaceLandmarker IMAGE-mode result, run with numFaces 2 so we can
 *                 detect the "someone else is in the frame" case
 * @param faceBounds normalised bounding box of the primary face, if known
 */
export function validatePhoto(
  bitmap: ImageBitmap,
  result: FaceLandmarkerResult,
  faceBounds?: { x0: number; y0: number; x1: number; y1: number },
): ValidationReport {
  const checks: PhotoCheck[] = []
  const faces = result.faceLandmarks ?? []
  const faceCount = faces.length

  // --- exactly one face ----------------------------------------------------
  if (faceCount === 0) {
    checks.push({
      ok: false,
      code: 'no-face',
      label: 'One face',
      message: "We couldn't find a face. Face the camera straight on and make sure your whole head is in the frame.",
    })
  } else if (faceCount > 1) {
    checks.push({
      ok: false,
      code: 'many-faces',
      label: 'Only you',
      message: 'More than one face is in the photo. Use a photo with just you in it.',
    })
  } else {
    checks.push(OK('One face'))
  }

  // If there is no usable face, later checks cannot run.
  if (faceCount !== 1) {
    return {
      ok: false,
      checks,
      failure: checks.find((c) => !c.ok) ?? null,
      metrics: {
        faceCount,
        faceCoverage: 0,
        yawDeg: 0,
        pitchDeg: 0,
        rollDeg: 0,
        luma: 0,
        sharpness: 0,
        eyeContrast: 0,
      },
    }
  }

  // --- bounding box, coverage ---------------------------------------------
  const landmarks = faces[0]
  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const bounds = faceBounds ?? { x0: minX, y0: minY, x1: maxX, y1: maxY }
  // MediaPipe returns normalised coordinates relative to image width/height, but a
  // tight landmark box excludes the chin and hair, so pad it out to approximate a
  // real head box before judging size.
  const boxW = (bounds.x1 - bounds.x0) * 1.22
  const boxH = (bounds.y1 - bounds.y0) * 1.34
  const aspect = bitmap.width / bitmap.height
  // Compare like with like: both measured against the image's shorter side.
  const coverage = aspect >= 1 ? Math.min(boxW, boxH / aspect) : Math.min(boxW / aspect, boxH)

  if (coverage < THRESHOLDS.minFaceCoverage) {
    checks.push({
      ok: false,
      code: 'too-small',
      label: 'Close enough',
      message: 'Your face is too small in this photo. Move closer, or crop so your head fills most of the frame.',
    })
  } else {
    checks.push(OK('Close enough'))
  }

  // --- pose ----------------------------------------------------------------
  const matrix = result.facialTransformationMatrixes?.[0]?.data
  const pose = matrix ? decomposePose(matrix) : { yaw: 0, pitch: 0, roll: 0 }
  const tooTurned = Math.abs(pose.yaw) > THRESHOLDS.maxYaw || Math.abs(pose.pitch) > THRESHOLDS.maxPitch
  if (tooTurned) {
    checks.push({
      ok: false,
      code: 'not-frontal',
      label: 'Looking at camera',
      message: 'Please look straight at the camera — this photo is turned to the side or tilted.',
    })
  } else {
    checks.push(OK('Looking at camera'))
  }

  // --- exposure ------------------------------------------------------------
  const small = sample(bitmap, 256)
  const faceLuma = meanLumaIn(small, bounds.x0, bounds.y0, bounds.x1, bounds.y1)
  if (faceLuma < THRESHOLDS.minLuma) {
    checks.push({
      ok: false,
      code: 'too-dark',
      label: 'Well lit',
      message: 'This photo is too dark. Try again facing a window or in a brighter room.',
    })
  } else if (faceLuma > THRESHOLDS.maxLuma) {
    checks.push({
      ok: false,
      code: 'too-bright',
      label: 'Well lit',
      message: 'This photo is overexposed. Move out of direct sunlight or harsh light.',
    })
  } else {
    checks.push(OK('Well lit'))
  }

  // --- sharpness -----------------------------------------------------------
  const detail = readFull(bitmap, 512)
  const sharp = sharpness(detail)
  if (sharp < THRESHOLDS.minSharpness) {
    checks.push({
      ok: false,
      code: 'blurry',
      label: 'In focus',
      message: 'This photo looks blurry. Hold still and tap to focus before taking it.',
    })
  } else {
    checks.push(OK('In focus'))
  }

  // --- sunglasses ----------------------------------------------------------
  // There is no "glasses" classifier in Face Landmarker, so this is a heuristic:
  // the eye band across a normal face is only slightly darker than the cheeks,
  // while sunglasses make it dramatically darker.
  const eyeY0 = bounds.y0 + (bounds.y1 - bounds.y0) * 0.3
  const eyeY1 = bounds.y0 + (bounds.y1 - bounds.y0) * 0.52
  const eyeBandLuma = meanLumaIn(small, bounds.x0 + (bounds.x1 - bounds.x0) * 0.12, eyeY0, bounds.x0 + (bounds.x1 - bounds.x0) * 0.88, eyeY1)
  const cheekY0 = bounds.y0 + (bounds.y1 - bounds.y0) * 0.62
  const cheekY1 = bounds.y0 + (bounds.y1 - bounds.y0) * 0.82
  const cheekLuma = meanLumaIn(small, bounds.x0 + (bounds.x1 - bounds.x0) * 0.15, cheekY0, bounds.x0 + (bounds.x1 - bounds.x0) * 0.85, cheekY1)
  const eyeContrast = cheekLuma > 1 ? eyeBandLuma / cheekLuma : 1

  if (eyeContrast < THRESHOLDS.minEyeContrast) {
    checks.push({
      ok: false,
      code: 'sunglasses',
      label: 'Eyes visible',
      message: 'We need to see your eyes. Please remove sunglasses, tinted lenses or a heavy fringe over your eyes.',
    })
  } else {
    checks.push(OK('Eyes visible'))
  }

  const failure = checks.find((c) => !c.ok) ?? null
  return {
    ok: failure === null,
    checks,
    failure,
    metrics: {
      faceCount,
      faceCoverage: coverage,
      yawDeg: pose.yaw,
      pitchDeg: pose.pitch,
      rollDeg: pose.roll,
      luma: faceLuma,
      sharpness: sharp,
      eyeContrast,
    },
  }
}

/** File-level guard rails, applied before we spend time decoding. */
export function validatePhotoFile(file: File): { ok: true } | { ok: false; message: string } {
  if (!file.type.startsWith('image/')) {
    return { ok: false, message: 'That file is not an image. Please choose a photo (JPEG, PNG or WebP).' }
  }
  const maxBytes = 20 * 1024 * 1024
  if (file.size > maxBytes) {
    return { ok: false, message: 'That photo is larger than 20 MB. Try a smaller version.' }
  }
  return { ok: true }
}
