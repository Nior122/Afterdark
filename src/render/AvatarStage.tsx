/**
 * The 3D stage.
 *
 * This is the only place the render loop and the rig meet. Everything that must be
 * smooth lives inside `useFrame`; everything that must be reactive lives outside it.
 * Breaking that rule is how a 3D app ends up stuttering on a mid-range phone.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment } from '@react-three/drei'
import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  SRGBColorSpace,
  type Group,
  type PerspectiveCamera,
} from 'three'
import { IdleAnimator } from '../avatar/idle'
import { HEAD_HEIGHT_METRES, loadAvatar, loadSampleAsset, type LoadedAvatar } from '../avatar/loader'
import type { AvatarAsset } from '../avatar/types'
import { CHANNEL } from '../avatar/rig'
import { applyManualExpression, manualInput, JOYSTICK_PITCH_LIMIT, JOYSTICK_YAW_LIMIT, DEG } from '../state/manualInput'
import { useApp } from '../state/store'
import { AdaptiveQuality, getTierSettings, type QualityTier } from './quality'
import { EXPOSURE, ENV_INTENSITY, INTENSITY, STUDIO_COLORS, studioLightPositions } from './lighting'
import { devLog, devWarn } from '../lib/util'

/** Camera framing constants, expressed in head-heights so any avatar frames the same. */
const CAMERA = {
  fov: 30,
  /** Distance from the head centre, in head-heights. */
  distance: 1.62,
  /** Look-at point, in head-heights below the head centre. */
  targetY: -0.34,
  near: 0.02,
  far: 20,
} as const

export interface AvatarStageProps {
  /** Called once the model is in the scene, for the boot sequence and the recorder. */
  onReady?: (canvas: HTMLCanvasElement) => void
}

export function AvatarStage({ onReady }: AvatarStageProps) {
  const qualityTier = useApp((s) => s.qualityTier)
  const quality = useMemo(() => getTierSettings(qualityTier), [qualityTier])

  // devicePixelRatio is capped at 2 (and lower by the quality tier). An uncapped DPR
  // on a 3x phone quadruples the fragment work for no visible gain.
  const dpr = useMemo<[number, number]>(() => [1, Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio)], [quality.maxPixelRatio])

  return (
    <Canvas
      className="absolute inset-0"
      dpr={dpr}
      shadows={quality.shadowMapSize > 0 ? 'soft' : false}
      gl={{
        antialias: quality.antialias,
        alpha: false,
        powerPreference: 'high-performance',
        // Required so we can call captureStream() on the canvas for recording.
        preserveDrawingBuffer: false,
      }}
      camera={{ fov: CAMERA.fov, near: CAMERA.near, far: CAMERA.far, position: [0, 0, CAMERA.distance] }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping
        gl.toneMappingExposure = EXPOSURE
        gl.outputColorSpace = SRGBColorSpace
        gl.shadowMap.type = PCFSoftShadowMap
        // Hand the canvas up so the recorder can captureStream() from it.
        onReady?.(gl.domElement)
      }}
    >
      <Studio quality={quality} />
      <Suspense fallback={null}>
        <AvatarModel quality={quality} />
      </Suspense>
      <QualityWatchdog tier={qualityTier} />
    </Canvas>
  )
}

/* -------------------------------------------------------------------------- */
/* Studio                                                                      */
/* -------------------------------------------------------------------------- */

function Studio({ quality }: { quality: ReturnType<typeof getTierSettings> }) {
  const positions = studioLightPositions(HEAD_HEIGHT_METRES, [0, 0, 0])
  const shadows = quality.shadowMapSize > 0

  return (
    <>
      {/* Ambient base so shadows never crush to black. Cheap, no shadow cost. */}
      <ambientLight intensity={INTENSITY.ambient} color={STUDIO_COLORS.ambient} />

      {/* Key: the only shadow caster. Large, close, soft. */}
      <directionalLight
        position={positions.key}
        intensity={INTENSITY.key}
        color={STUDIO_COLORS.key}
        castShadow={shadows}
        shadow-mapSize-width={quality.shadowMapSize || 512}
        shadow-mapSize-height={quality.shadowMapSize || 512}
        shadow-bias={-0.0006}
        shadow-normalBias={0.012}
        shadow-camera-near={0.2}
        shadow-camera-far={4}
        // A tight shadow frustum around the head is the difference between a crisp
        // 1024 map and a blurry 2048 one.
        shadow-camera-left={-0.45}
        shadow-camera-right={0.45}
        shadow-camera-top={0.5}
        shadow-camera-bottom={-0.5}
        shadow-radius={2}
      />

      {/* Fill: broad, low intensity, no shadow. */}
      <directionalLight position={positions.fill} intensity={INTENSITY.fill} color={STUDIO_COLORS.fill} />

      {/* Rim: behind and slightly to one side, for edge separation on dark hair. */}
      <directionalLight position={positions.rim} intensity={INTENSITY.rim} color={STUDIO_COLORS.rim} />

      {/* Warm low bounce, standing in for the light a body reflects back up. */}
      <pointLight position={positions.bounce} intensity={INTENSITY.bounce} color={STUDIO_COLORS.bounce} distance={0.6} decay={2} />

      {quality.environment ? (
        <Environment files="/hdr/studio.hdr" background={false} environmentIntensity={ENV_INTENSITY} />
      ) : null}

      {/* Soft contact shadow on an invisible floor: grounds the bust so it does not
          look like it is floating in a void. Cheaper than a real AO pass. */}
      {quality.contactShadowSize > 0 ? (
        <ContactShadows
          position={[0, -0.52, 0]}
          opacity={0.42}
          scale={1.1}
          blur={2.6}
          far={0.6}
          resolution={quality.contactShadowSize}
          color="#05070c"
          frames={Infinity}
        />
      ) : null}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* The avatar                                                                  */
/* -------------------------------------------------------------------------- */

function AvatarModel({ quality }: { quality: ReturnType<typeof getTierSettings> }) {
  const generated = useApp((s) => s.avatarAsset)
  const avatarRevision = useApp((s) => s.avatarRevision)
  const [sample, setSample] = useState<AvatarAsset | null>(null)
  const setBooted = useApp((s) => s.setBooted)
  const failGeneration = useApp((s) => s.failGeneration)

  // The bundled sample loads once and stays: it is what the user sees while a photo is
  // being processed, and it is the fallback if generation fails.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // Statically imported: the loader is already in this chunk (the stage cannot
        // render without it), so a dynamic import here would only add a round trip.
        const asset = await loadSampleAsset()
        if (!cancelled) setSample(asset)
      } catch (err) {
        if (!cancelled) setBooted('error', String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setBooted])

  const asset = generated ?? sample
  if (!asset) return null
  return (
    <AvatarInstance
      // Remount on a new asset so the loader and rig are rebuilt cleanly.
      key={`${asset.source}-${avatarRevision}`}
      asset={asset}
      quality={quality}
      onLoadError={(m) => failGeneration(m)}
    />
  )
}

interface AvatarInstanceProps {
  asset: AvatarAsset
  quality: ReturnType<typeof getTierSettings>
  onLoadError: (message: string) => void
}

function AvatarInstance({ asset, quality, onLoadError }: AvatarInstanceProps) {
  const gl = useThree((s) => s.gl)
  const groupRef = useRef<Group>(null)
  const loadedRef = useRef<LoadedAvatar | null>(null)
  const idleRef = useRef(new IdleAnimator())
  const [ready, setReady] = useState(false)

  // Held in refs, not read straight from the store: these two objects are written on
  // every frame by the render loop, which is precisely the kind of mutation React's
  // rules forbid on values that came out of a hook during render. The ref is the
  // sanctioned escape hatch, and it also documents the intent — this is a buffer, not
  // reactive state.
  const faceStateRef = useRef(useApp((s) => s.faceState))
  const idleStateRef = useRef(useApp((s) => s.idleState))
  const mode = useApp((s) => s.mode)
  const finishGeneration = useApp((s) => s.finishGeneration)
  const setBooted = useApp((s) => s.setBooted)
  const setMeasuredFps = useApp((s) => s.setMeasuredFps)

  // Load, then report the rig diagnostics so the UI can be honest about coverage.
  useEffect(() => {
    let cancelled = false
    const started = performance.now()
    void (async () => {
      try {
        const loaded = await loadAvatar(asset, {
          renderer: gl,
          buildBust: true,
          buildHairShell: true,
          textureSize: quality.textureSize,
          lite: quality.tier === 'lite',
        })
        if (cancelled) {
          loaded.dispose()
          return
        }
        loadedRef.current = loaded
        groupRef.current?.add(loaded.root)

        if (!loaded.rig.isDriveable) {
          devWarn('avatar rig is not driveable', loaded.diagnostics)
        }

        finishGeneration({
          provider: asset.metadata.provider,
          diagnostics: loaded.diagnostics,
          bytes: asset.metadata.bytes ?? asset.glb.byteLength,
          generationMs: Math.round(performance.now() - started),
        })
        setBooted('ready')
        setReady(true)
      } catch (err) {
        if (cancelled) return
        devWarn('avatar load failed', err)
        onLoadError(err instanceof Error ? err.message : 'The avatar could not be loaded.')
        // Fall back so the app is never a blank screen.
        setBooted('error', err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      const loaded = loadedRef.current
      if (loaded) {
        loaded.root.removeFromParent()
        loaded.dispose()
        loadedRef.current = null
      }
    }
  }, [asset, gl, quality.textureSize, quality.tier, finishGeneration, onLoadError, setBooted])


  // --- per-frame drive ------------------------------------------------------
  const frameTimes = useRef<number[]>([])
  const fpsAccum = useRef({ frames: 0, elapsed: 0 })

  useFrame((_state, delta) => {
    const loaded = loadedRef.current
    if (!loaded) return

    const dt = Math.min(0.05, delta)
    const idle = idleRef.current.update(dt)

    // Publish idle life so live mode can reuse it when the camera loses the face.
    Object.assign(idleStateRef.current, idle)

    // --- compose the pose ---------------------------------------------------
    const faceState = faceStateRef.current

    if (mode === 'manual') {
      // Joystick -> head rotation, in radians.
      faceState.headYaw = manualInput.headX * JOYSTICK_YAW_LIMIT * DEG + idle.yaw
      faceState.headPitch = manualInput.headY * JOYSTICK_PITCH_LIMIT * DEG + idle.pitch
      faceState.headRoll = idle.roll

      // Manual expression, then let idle blinking add to it rather than replace it,
      // so the avatar blinks while the user is holding a smile.
      applyManualExpression(faceState.expression, (name) => CHANNEL[name as keyof typeof CHANNEL])
      faceState.expression[CHANNEL.eyeBlinkLeft] = Math.max(
        faceState.expression[CHANNEL.eyeBlinkLeft],
        idle.blinkLeft,
      )
      faceState.expression[CHANNEL.eyeBlinkRight] = Math.max(
        faceState.expression[CHANNEL.eyeBlinkRight],
        idle.blinkRight,
      )

      // Gaze: the panel drives it, but idle saccades still ride on top when the pad
      // is centred, which keeps the eyes from looking pinned.
      const gx = manualInput.splitEyes ? manualInput.gazeXLeft : manualInput.gazeX
      const gy = manualInput.splitEyes ? manualInput.gazeYLeft : manualInput.gazeY
      const rx = manualInput.splitEyes ? manualInput.gazeXRight : manualInput.gazeX
      const ry = manualInput.splitEyes ? manualInput.gazeYRight : manualInput.gazeY
      const idleWeight = 1 - Math.min(1, Math.hypot(gx, gy) * 2.2)
      faceState.gazeXLeft = clamp(gx + idle.gazeX * idleWeight)
      faceState.gazeYLeft = clamp(gy + idle.gazeY * idleWeight)
      faceState.gazeXRight = clamp(rx + idle.gazeX * idleWeight)
      faceState.gazeYRight = clamp(ry + idle.gazeY * idleWeight)
    } else {
      // Live mode: the tracker owns the pose and expression. Idle supplies breathing
      // sway and (when tracking is lost) blinking so the avatar is never frozen.
      faceState.headYaw += idle.yaw * 0.6
      faceState.headPitch += idle.pitch * 0.6
      faceState.headRoll += idle.roll * 0.6

      const blinking = Math.max(
        faceState.expression[CHANNEL.eyeBlinkLeft],
        faceState.expression[CHANNEL.eyeBlinkRight],
      )
      if (blinking < 0.02) {
        // The detector is not reporting a blink, so let idle supply one.
        faceState.expression[CHANNEL.eyeBlinkLeft] = Math.max(
          faceState.expression[CHANNEL.eyeBlinkLeft],
          idle.blinkLeft * 0.9,
        )
        faceState.expression[CHANNEL.eyeBlinkRight] = Math.max(
          faceState.expression[CHANNEL.eyeBlinkRight],
          idle.blinkRight * 0.9,
        )
      }
    }

    // --- apply to the rig ---------------------------------------------------
    loaded.rig.apply(faceState)

    // The bust follows the head. The neck takes the full head rotation, tapered per
    // vertex, so a 40-degree turn bends the neck instead of hinging at the jaw.
    loaded.neckSkin?.update(loaded.rig.headDelta)

    // Breathing: a small vertical lift, plus a touch of forward travel.
    if (groupRef.current) {
      const breath = idle.breath
      groupRef.current.position.y = (breath - 0.5) * 0.006
      groupRef.current.rotation.z = Math.sin(breath * Math.PI * 2) * 0.002
    }

    // --- frame budget telemetry -------------------------------------------
    const frameMs = delta * 1000
    frameTimes.current.push(frameMs)
    if (frameTimes.current.length > 60) frameTimes.current.shift()

    fpsAccum.current.frames++
    fpsAccum.current.elapsed += frameMs
    if (fpsAccum.current.elapsed > 1000) {
      const fps = Math.round((fpsAccum.current.frames * 1000) / fpsAccum.current.elapsed)
      setMeasuredFps(fps)
      fpsAccum.current.frames = 0
      fpsAccum.current.elapsed = 0
    }
  })

  void ready
  return <group ref={groupRef} />
}

const clamp = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v)

/* -------------------------------------------------------------------------- */
/* Adaptive quality                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Feeds frame times to the watchdog and pushes tier changes into the store.
 *
 * Mounted inside the Canvas so it samples the real render loop, and it never blocks a
 * frame: the watchdog only decides, the store applies.
 */
function QualityWatchdog({ tier }: { tier: QualityTier }) {
  const pinned = useApp((s) => s.qualityPinned)
  const setQualityTier = useApp((s) => s.setQualityTier)
  const mode = useApp((s) => s.mode)
  const camera = useThree((s) => s.camera) as PerspectiveCamera

  const watchdog = useMemo(
    () =>
      new AdaptiveQuality({
        initial: tier,
        pinned,
        // Live mode reserves headroom for MediaPipe, so it accepts a lower frame rate
        // rather than fighting the tracker for the GPU.
        targetFrameMs: mode === 'live' ? 1000 / 26 : 1000 / 40,
        onChange: (settings, reason) => {
          devLog(`quality -> ${settings.tier} (${reason})`)
          setQualityTier(settings.tier)
        },
      }),
    // Intentionally constructed once per tier/mode change; the watchdog keeps its own
    // rolling window so re-creating it on every render would defeat the purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tier, mode],
  )

  useEffect(() => {
    watchdog.setPinned(pinned)
  }, [watchdog, pinned])

  useEffect(() => {
    // Re-apply the camera's aspect on quality changes, since a DPR change alters it.
    camera.updateProjectionMatrix()
  }, [camera, tier])

  useFrame((_state, delta) => {
    watchdog.sample(delta * 1000)
  })

  return null
}
