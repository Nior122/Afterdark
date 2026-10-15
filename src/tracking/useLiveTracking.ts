/**
 * Live camera tracking.
 *
 * Pipeline per camera frame:
 *   requestVideoFrameCallback -> FaceLandmarker.detectForVideo (monotonic timestamp)
 *     -> blendshape categories into a channel array
 *     -> calibration (baseline, gain, dead zone)
 *     -> One Euro filters (pose and expression, separately tuned)
 *     -> FaceState consumed by the render loop
 *
 * Design notes that matter for feel:
 *  - **Tracking runs on its own schedule, not the render loop's.** Camera frames
 *    arrive at 30 Hz while the renderer may run at 60; the render loop simply reads
 *    the latest state, which keeps motion smooth without extra latency.
 *  - **Lost tracking eases to neutral, never freezes.** After 300 ms without a face
 *    the avatar drifts back to rest, and a hint appears; the moment a face returns it
 *    snaps to the filtered value again.
 *  - **Visibility changes are respected.** A backgrounded tab stops the camera so we
 *    are not burning a user's battery or data.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { createIdleState, type IdleState } from '../avatar/idle'
import { CHANNEL_COUNT, resetFaceState, type FaceState } from '../avatar/rig'
import { CalibratedBlender, CalibrationCapture, type CalibrationData } from './calibration'
import { POSE_FILTER, BLENDSHAPE_FILTER, OneEuroBank, OneEuroFilter, QuaternionSmoother } from './oneEuroFilter'
import { blendshapesToChannels, clampPose, decomposePose, extractGaze, type PoseResult } from './pose'
// The MediaPipe bundle is imported dynamically at the moment Live mode starts, never at
// module scope: it is 46 KB of JavaScript (plus a 13 MB WASM runtime fetched later), and
// a user who only ever uses Manual mode should not pay for any of it.
import type { Delegate, LandmarkerHandle } from './landmarker'
import { AppError, devLog, devWarn, isEmbedded } from '../lib/util'

export type LiveStatus =
  | 'idle'
  | 'requesting-permission'
  | 'loading-model'
  | 'warming-up'
  | 'tracking'
  | 'no-face'
  | 'calibrating'
  | 'error'

export interface LiveTrackingState {
  status: LiveStatus
  /** Frames per second actually delivered by the tracker. */
  trackingFps: number
  /** Milliseconds spent in detectForVideo on the last frame. */
  inferenceMs: number
  delegate: Delegate | null
  error: { message: string; hint?: string; code: string } | null
  calibrationProgress: number
  hasFace: boolean
}

export interface LiveTrackingOptions {
  enabled: boolean
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** Written by the tracker, read by the render loop. Never causes a React render. */
  faceStateRef: React.RefObject<FaceState>
  /** Idle contributions, so live mode can still add blink/saccade between frames. */
  idleRef: React.RefObject<IdleState>
  mirror: boolean
  splitEyes: boolean
  facing: 'user' | 'environment'
  calibration: CalibrationData | null
  onCalibration: (data: CalibrationData) => void
  /** Lite mode forces the CPU delegate to leave GPU headroom for rendering. */
  preferCpu?: boolean
}

const NO_FACE_GRACE_MS = 300
/** Camera request: small enough to save battery, large enough to track well. */
const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 30, max: 30 },
  facingMode: 'user',
}

export function useLiveTracking(options: LiveTrackingOptions) {
  const {
    enabled,
    videoRef,
    faceStateRef,
    idleRef,
    mirror,
    splitEyes,
    facing,
    calibration,
    onCalibration,
    preferCpu,
  } = options

  const [state, setState] = useState<LiveTrackingState>({
    status: 'idle',
    trackingFps: 0,
    inferenceMs: 0,
    delegate: null,
    error: null,
    calibrationProgress: 0,
    hasFace: false,
  })

  // Everything the hot loop touches lives in refs so a React render never
  // interrupts tracking.
  const landmarkerRef = useRef<LandmarkerHandle | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const runningRef = useRef(false)
  const lastFaceAtRef = useRef(0)
  const lastVideoTimeRef = useRef(-1)
  const blenderRef = useRef<CalibratedBlender | null>(null)
  const captureRef = useRef<CalibrationCapture | null>(null)

  // Filter banks, sized once.
  const banks = useMemo(
    () => ({
      raw: new Float32Array(CHANNEL_COUNT),
      calibrated: new Float32Array(CHANNEL_COUNT),
      filtered: new Float32Array(CHANNEL_COUNT),
      expressionFilters: new OneEuroBank(CHANNEL_COUNT, BLENDSHAPE_FILTER),
      gazeBanks: new OneEuroBank(4, { minCutoff: 2.4, beta: 1.2, dCutoff: 3 }),
      rotation: new QuaternionSmoother(POSE_FILTER),
      yaw: new OneEuroFilter({ minCutoff: 2.2, beta: 1.4, dCutoff: 4 }),
      pitch: new OneEuroFilter({ minCutoff: 2.2, beta: 1.4, dCutoff: 4 }),
      roll: new OneEuroFilter({ minCutoff: 2.0, beta: 1.2, dCutoff: 4 }),
    }),
    [],
  )

  // Keep the current calibration in a ref so callbacks do not need re-creating.
  const calibrationRef = useRef<CalibrationData | null>(calibration)
  useEffect(() => {
    calibrationRef.current = calibration
    blenderRef.current = calibration ? new CalibratedBlender(calibration) : null
  }, [calibration])

  const stop = useCallback(() => {
    runningRef.current = false
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const stream = streamRef.current
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setState((s) => ({ ...s, status: 'idle', hasFace: false, trackingFps: 0 }))
  }, [videoRef])

  /** Begin the one-second neutral capture. */
  const startCalibration = useCallback(
    (durationMs?: number) => {
      const capture = new CalibrationCapture(durationMs)
      capture.start(performance.now())
      captureRef.current = capture
      setState((s) => ({ ...s, status: 'calibrating', calibrationProgress: 0 }))
    },
    [],
  )

  const cancelCalibration = useCallback(() => {
    captureRef.current = null
    setState((s) => ({ ...s, status: runningRef.current ? 'tracking' : 'idle', calibrationProgress: 0 }))
  }, [])

  useEffect(() => {
    if (!enabled) {
      // Disabling live mode tears the camera down synchronously. The state reset inside
      // stop() happens in the same commit that removed the camera UI, so there is no
      // intermediate frame for anyone to see — and deferring it would keep a live
      // MediaStream (and its recording indicator) alive one frame longer for no reason.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      stop()
      return
    }

    let cancelled = false
    const abort = new AbortController()

    const start = async () => {
      const video = videoRef.current
      if (!video) {
        devWarn('live tracking enabled before the video element existed')
        return
      }

      // --- camera ---------------------------------------------------------
      setState((s) => ({ ...s, status: 'requesting-permission', error: null }))
      let stream: MediaStream
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new AppError(
            'no-media-devices',
            'This browser cannot access the camera.',
            'Open the app in Chrome on Android or Safari on iOS over a secure (https) connection.',
          )
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...CAMERA_CONSTRAINTS, facingMode: facing === 'user' ? 'user' : 'environment' },
          audio: false,
        })
      } catch (err) {
        if (cancelled) return
        const name = (err as DOMException)?.name
        const mapped =
          name === 'NotAllowedError'
            ? new AppError(
                'camera-denied',
                'Camera access was blocked.',
                isEmbedded()
                  ? 'Embedded previews are usually not allowed to use the camera. Open Faceverify in its own tab, then allow the camera when prompted.'
                  : 'Allow the camera for this site in your browser settings, then try again.',
              )
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? new AppError('camera-missing', 'No camera was found on this device.')
              : name === 'NotReadableError' || name === 'AbortError'
                ? new AppError(
                    'camera-busy',
                    'The camera is being used by another app.',
                    'Close other apps or tabs using the camera, then try again.',
                  )
                : new AppError('camera-failed', 'The camera could not be started.', String(err))
        setState((s) => ({ ...s, status: 'error', error: mapped, hasFace: false }))
        return
      }

      if (cancelled) {
        for (const t of stream.getTracks()) t.stop()
        return
      }
      streamRef.current = stream
      video.srcObject = stream
      video.playsInline = true
      video.muted = true
      // iOS Safari needs both the attribute and the property before play() will work
      // without a user gesture.
      video.setAttribute('playsinline', 'true')
      video.setAttribute('webkit-playsinline', 'true')

      try {
        await video.play()
      } catch (err) {
        devWarn('video.play() rejected', err)
      }

      const track = stream.getVideoTracks()[0]
      devLog('camera started', track?.getSettings())

      // --- model ----------------------------------------------------------
      setState((s) => ({ ...s, status: 'loading-model' }))
      let handle: LandmarkerHandle
      try {
        const { createLandmarker } = await import('./landmarker')
        handle = await createLandmarker({ mode: 'VIDEO', numFaces: 1, forceCpu: preferCpu, signal: abort.signal })
      } catch (err) {
        if (cancelled) return
        const appErr =
          err instanceof AppError
            ? err
            : new AppError('tracker-failed', 'The face tracker could not start.', String(err))
        setState((s) => ({ ...s, status: 'error', error: appErr }))
        for (const t of stream.getTracks()) t.stop()
        return
      }

      if (cancelled) {
        handle.dispose()
        return
      }
      landmarkerRef.current = handle
      setState((s) => ({ ...s, status: 'warming-up', delegate: handle.delegate }))

      // --- frame loop -----------------------------------------------------
      runningRef.current = true
      let frameCount = 0
      let fpsWindowStart = performance.now()
      let lastInference = 0
      let lastPublish = 0
      resetFaceState(faceStateRef.current)

      const onFrame = () => {
        if (!runningRef.current) return
        const landmarker = landmarkerRef.current
        const currentVideo = videoRef.current
        if (!landmarker || !currentVideo) {
          rafRef.current = requestAnimationFrame(onFrame)
          return
        }

        // Only run inference on genuinely new frames. Duplicate detects cost CPU and
        // produce an identical result, which the filters would then double-apply.
        if (currentVideo.readyState >= 2 && currentVideo.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = currentVideo.currentTime
          const t0 = performance.now()
          let result: FaceLandmarkerResult | null = null
          try {
            // A monotonic timestamp is required: performance.now() never goes
            // backwards, video.currentTime can reset when the stream restarts.
            result = landmarker.landmarker.detectForVideo(currentVideo, performance.now())
          } catch (err) {
            devWarn('detectForVideo failed', err)
          }
          lastInference = performance.now() - t0

          if (result) applyResult(result, performance.now())
          frameCount++
        }

        // Publish diagnostics at 2 Hz — often enough to be useful, rarely enough that
        // React renders never matter.
        const now = performance.now()
        if (now - lastPublish > 500) {
          lastPublish = now
          const elapsed = now - fpsWindowStart
          const fps = elapsed > 0 ? (frameCount * 1000) / elapsed : 0
          frameCount = 0
          fpsWindowStart = now
          setState((s) =>
            s.trackingFps === Math.round(fps) && s.inferenceMs === Math.round(lastInference)
              ? s
              : { ...s, trackingFps: Math.round(fps), inferenceMs: Math.round(lastInference) },
          )
        }

        rafRef.current = requestAnimationFrame(onFrame)
      }

      /** Main per-frame state update. Kept as a closure over the loop's locals. */
      const applyResult = (result: FaceLandmarkerResult, now: number) => {
        const face = faceStateRef.current
        const idle = idleRef.current

        const categories = result.faceBlendshapes?.[0]?.categories
        const matrix = result.facialTransformationMatrixes?.[0]?.data
        const hasFace = !!categories && categories.length > 0

        // --- calibration capture -------------------------------------------
        const capture = captureRef.current
        if (capture) {
          if (categories) {
            blendshapesToChannels(categories as { categoryName: string; score: number }[], banks.raw)
            capture.add(banks.raw)
          }
          const progress = capture.progress(now)
          if (progress >= 1) {
            captureRef.current = null
            const data = capture.finish()
            blenderRef.current = new CalibratedBlender(data)
            onCalibration(data)
            setState((s) => ({ ...s, status: 'tracking', calibrationProgress: 0 }))
          } else {
            // Throttle progress updates to ~10 Hz.
            const p = Math.round(progress * 20) / 20
            setState((s) => (s.calibrationProgress === p ? s : { ...s, calibrationProgress: p }))
          }
        }

        if (hasFace) {
          lastFaceAtRef.current = now

          // --- expression --------------------------------------------------
          blendshapesToChannels(categories as { categoryName: string; score: number }[], banks.raw)

          const blender = blenderRef.current
          if (blender) {
            blender.apply(banks.raw, banks.calibrated, { applyGain: true })
          } else {
            banks.calibrated.set(banks.raw)
          }

          // One Euro over all 52 channels on a shared timebase.
          const t = now / 1000
          banks.expressionFilters.filterInto(banks.calibrated, banks.filtered, t)
          for (let i = 0; i < CHANNEL_COUNT; i++) {
            // Negative results are meaningful for a few channels (a mouth corner can
            // pull below neutral) but the rig only takes 0..1, so clamp here.
            const v = banks.filtered[i]
            face.expression[i] = v < 0 ? 0 : v > 1 ? 1 : v
          }

          // --- gaze ---------------------------------------------------------
          const gaze = extractGaze(banks.filtered)
          const gazeRaw = [gaze.leftX, gaze.leftY, gaze.rightX, gaze.rightY]
          const gazeFiltered = [0, 0, 0, 0]
          banks.gazeBanks.filterInto(Float32Array.from(gazeRaw), Float32Array.from(gazeFiltered), t)
          // filterInto writes into the second array, so read it back.
          const filteredGaze = new Float32Array(4)
          banks.gazeBanks.filterInto(Float32Array.from(gazeRaw), filteredGaze, t)

          if (splitEyes) {
            face.gazeXLeft = clampUnit(filteredGaze[0])
            face.gazeYLeft = clampUnit(filteredGaze[1])
            face.gazeXRight = clampUnit(filteredGaze[2])
            face.gazeYRight = clampUnit(filteredGaze[3])
          } else {
            const gx = clampUnit((filteredGaze[0] + filteredGaze[2]) / 2)
            const gy = clampUnit((filteredGaze[1] + filteredGaze[3]) / 2)
            face.gazeXLeft = gx
            face.gazeXRight = gx
            face.gazeYLeft = gy
            face.gazeYRight = gy
          }

          // --- pose ---------------------------------------------------------
          const pose = matrix ? clampPose(decomposePose(matrix as number[], mirror)) : null
          if (pose?.valid) {
            const smoothed = banks.rotation.filterQuaternion(
              quaternionFromEuler(pose.pitch, pose.yaw, pose.roll),
              t,
            )
            const e = eulerFromQuaternion(smoothed)
            face.headPitch = e.pitch
            face.headYaw = e.yaw
            face.headRoll = e.roll
          } else {
            // Below the dead zone of the smoother, which is mathematically exact
            // about the previous sample, so nothing to do but leave it.
          }

          // Live mode still gets idle life where the tracker gives us nothing: a
          // slight breath, and blinking if the detector is not reporting blinks.
          if (idle) {
            const blinkL = face.expression[EYE_BLINK_L]
            const blinkR = face.expression[EYE_BLINK_R]
            idle.blinkLeft = blinkL
            idle.blinkRight = blinkR
            idle.gazeX = face.gazeXLeft
            idle.gazeY = face.gazeYLeft
          }
        } else {
          // --- lost tracking ------------------------------------------------
          const since = now - lastFaceAtRef.current
          const lost = since > NO_FACE_GRACE_MS
          if (lost) {
            // Ease to neutral at ~6/s so the avatar relaxes rather than snapping.
            const dt = 1 / 30
            faceStateRef.current.headYaw += (0 - faceStateRef.current.headYaw) * Math.min(1, dt * 6)
            faceStateRef.current.headPitch += (0 - faceStateRef.current.headPitch) * Math.min(1, dt * 6)
            faceStateRef.current.headRoll += (0 - faceStateRef.current.headRoll) * Math.min(1, dt * 6)
            for (let i = 0; i < CHANNEL_COUNT; i++) {
              faceStateRef.current.expression[i] *= 1 - Math.min(1, dt * 5)
            }
          }
          setState((s) => (s.hasFace === false && s.status === (lost ? 'no-face' : s.status) ? s : { ...s, hasFace: false, status: lost ? 'no-face' : s.status }))
        }

        if (hasFace) {
          setState((s) => (s.hasFace ? s : { ...s, hasFace: true, status: 'tracking' }))
        }
      }

      // requestVideoFrameCallback is the right primitive: it fires per decoded
      // camera frame rather than per display refresh. Safari lacks it, so fall back
      // to requestAnimationFrame, which is throttled by the lastVideoTime check.
      rafRef.current = requestAnimationFrame(onFrame)
    }

    start().catch((err) => {
      devWarn('live tracking failed to start', err)
      setState((s) => ({
        ...s,
        status: 'error',
        error: new AppError('live-failed', 'Live mode could not start.', String(err)),
      }))
    })

    return () => {
      cancelled = true
      abort.abort()
      stop()
      landmarkerRef.current?.dispose()
      landmarkerRef.current = null
    }
  }, [enabled, facing, mirror, splitEyes, preferCpu, videoRef, faceStateRef, idleRef, banks, onCalibration, stop])

  /** Zoom control, exposed for the flattering "move closer" affordance. */
  const applyZoom = useCallback(
    async (factor: number) => {
      const track = streamRef.current?.getVideoTracks()[0]
      if (!track) return
      try {
        const caps = track.getCapabilities() as MediaTrackCapabilities & { zoom?: { min: number; max: number } }
        if (!caps.zoom) return
        const next = Math.min(caps.zoom.max, Math.max(caps.zoom.min, factor))
        await track.applyConstraints({ advanced: [{ zoom: next } as MediaTrackConstraintSet] })
      } catch {
        /* zoom is optional; ignore */
      }
    },
    [],
  )

  return { state, startCalibration, cancelCalibration, stop, applyZoom }
}

const EYE_BLINK_L = 8
const EYE_BLINK_R = 9

const clampUnit = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v)

// Quaternion scratch used only inside the tracking loop.
const scratch = { x: 0, y: 0, z: 0, w: 1 }

function quaternionFromEuler(pitch: number, yaw: number, roll: number): typeof scratch {
  const c1 = Math.cos(pitch / 2)
  const c2 = Math.cos(yaw / 2)
  const c3 = Math.cos(roll / 2)
  const s1 = Math.sin(pitch / 2)
  const s2 = Math.sin(yaw / 2)
  const s3 = Math.sin(roll / 2)
  // YXZ order
  scratch.x = s1 * c2 * c3 + c1 * s2 * s3
  scratch.y = c1 * s2 * c3 - s1 * c2 * s3
  scratch.z = c1 * c2 * s3 - s1 * s2 * c3
  scratch.w = c1 * c2 * c3 + s1 * s2 * s3
  return scratch
}

function eulerFromQuaternion(q: { x: number; y: number; z: number; w: number }): {
  pitch: number
  yaw: number
  roll: number
} {
  // YXZ extraction.
  const { x, y, z, w } = q
  const m12 = 2 * (y * z - w * x)
  const clamped = m12 > 1 ? 1 : m12 < -1 ? -1 : m12
  const pitch = Math.asin(-clamped)
  const yaw = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y))
  const roll = Math.atan2(2 * (x * y + w * z), 1 - 2 * (x * x + z * z))
  return { pitch, yaw, roll }
}

export { createIdleState }
export type { PoseResult }
