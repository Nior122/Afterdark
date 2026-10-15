/**
 * Face Landmarker lifecycle.
 *
 * Everything is self-hosted: the WASM runtime and the model both come from our own
 * origin, never a CDN. That is a hard requirement here — a Nigerian user on a
 * metered connection should download the tracking runtime exactly once, have the
 * service worker keep it, and never depend on a third party staying up.
 *
 * GPU delegate first, CPU as fallback: the GPU path is several times faster on
 * mid-range Android, but it fails on some drivers and is unavailable in some
 * privacy modes, and silently falling back is much better than a dead camera.
 */
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerOptions } from '@mediapipe/tasks-vision'
import { AppError, devLog, devWarn } from '../lib/util'

/** Self-hosted paths, populated by scripts/fetch-assets.mjs. */
export const WASM_PATH = '/mediapipe/wasm'
export const MODEL_PATH = '/mediapipe/face_landmarker.task'

/** Exactly the 52 ARKit channels, which is also what MediaPipe emits. */
export const OUTPUT_BLENDSHAPES = true

export type Delegate = 'GPU' | 'CPU'

export interface LandmarkerHandle {
  landmarker: FaceLandmarker
  delegate: Delegate
  dispose: () => void
}

const baseOptions = (delegate: Delegate): FaceLandmarkerOptions['baseOptions'] => ({
  modelAssetPath: MODEL_PATH,
  delegate,
})

let sharedFileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null

async function resolveFileset() {
  if (!sharedFileset) {
    sharedFileset = await FilesetResolver.forVisionTasks(WASM_PATH)
  }
  return sharedFileset
}

export interface CreateOptions {
  mode: 'IMAGE' | 'VIDEO'
  /** Faces to track. VIDEO only needs 1; IMAGE wants 2 to detect "someone else". */
  numFaces?: number
  /** Prefer CPU. Used by the Lite quality switch and as an explicit fallback. */
  forceCpu?: boolean
  signal?: AbortSignal
}

/**
 * Create a landmarker, trying GPU and falling back to CPU.
 *
 * The fallback is not cosmetic: `delegate: 'GPU'` throws on some Android WebViews and
 * on iOS when Low Power Mode restricts WebGL contexts, so catching it is the
 * difference between a working Live mode and a permanent spinner.
 */
export async function createLandmarker(options: CreateOptions): Promise<LandmarkerHandle> {
  const fileset = await resolveFileset()
  const numFaces = options.numFaces ?? (options.mode === 'VIDEO' ? 1 : 2)

  const common: Omit<FaceLandmarkerOptions, 'baseOptions'> = {
    runningMode: options.mode,
    numFaces,
    outputFaceBlendshapes: OUTPUT_BLENDSHAPES,
    outputFacialTransformationMatrixes: true,
    // Defaults are tuned for accuracy; these are tuned for a 24+ FPS budget on a
    // mid-range phone without a visible accuracy loss for a single face.
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  }

  const attempt = async (delegate: Delegate): Promise<LandmarkerHandle> => {
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      ...common,
      baseOptions: baseOptions(delegate),
    })
    devLog(`face landmarker ready (${delegate})`)
    return { landmarker, delegate, dispose: () => landmarker.close() }
  }

  if (options.forceCpu) return attempt('CPU')

  try {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    return await attempt('GPU')
  } catch (err) {
    devWarn('GPU delegate unavailable, falling back to CPU', err)
    try {
      return await attempt('CPU')
    } catch (cpuErr) {
      devWarn('CPU delegate also failed', cpuErr)
      throw new AppError(
        'tracker-unavailable',
        'The face tracker could not start on this device.',
        'Try reloading the page, or switch on Lite quality in Settings.',
      )
    }
  }
}

/**
 * Detect whether WebGL2 is available at all, so we can choose Lite defaults up front
 * instead of discovering the problem after a slow first frame.
 */
export function probeWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) return false
    const lose = gl.getExtension('WEBGL_lose_context')
    lose?.loseContext()
    return true
  } catch {
    return false
  }
}

/** Rough capability tier, used to pick sensible defaults on first run. */
export function detectDeviceTier(): 'low' | 'mid' | 'high' {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const cores = navigator.hardwareConcurrency ?? 4
  const webgl2 = probeWebGL2()
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 380

  if (!webgl2 || cores <= 4 || (memory !== undefined && memory <= 3)) return smallScreen ? 'low' : 'mid'
  if (cores >= 8 && (memory === undefined || memory >= 6)) return 'high'
  return 'mid'
}
