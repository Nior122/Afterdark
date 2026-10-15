/**
 * The app shell.
 *
 * Responsibilities, in order of importance:
 *   1. own the objects that must live for the whole session (the camera element, the
 *      renderer canvas, the non-reactive face/idle state the render loop reads)
 *   2. decide which chrome is on screen for the current mode
 *   3. load and save preferences and the saved avatar
 *
 * Everything per-frame is deliberately *not* here: the tracking hook writes into the
 * mutable `FaceState` object and `AvatarStage` reads it inside `useFrame`. React only
 * re-renders for things a human can perceive — mode changes, sheet opens, recording
 * state, tracking status.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AvatarStage } from './render/AvatarStage'
import { TopBar } from './ui/TopBar'
import { ControlTray } from './ui/ControlTray'
import { LiveOverlay } from './ui/LiveOverlay'
import { PhotoSheet } from './ui/PhotoSheet'
import { SettingsSheet } from './ui/SettingsSheet'
import { AboutSheet } from './ui/AboutSheet'
import { RecordingSheet } from './ui/RecordingSheet'
import { PwaStatus, useInstallPrompt } from './ui/PwaStatus'
import { showToast } from './ui/Toast'
import { useRecorder } from './features/recording/useRecorder'
import { useLiveTracking } from './tracking/useLiveTracking'
import { useApp } from './state/store'
import {
  DEFAULT_PREFS,
  deleteAvatarAsset,
  loadAvatarAsset,
  loadPrefs,
  savePrefs,
  type Prefs,
} from './state/persistence'
import { deleteAllUserData, estimateUsage } from './lib/idb'
import { hideSplash } from './lib/splash'
import { manualInput, resetManualInput } from './state/manualInput'
import { getTierSettings } from './render/quality'
import { LegalPage, isLegalRoute, type LegalDoc } from './legal/LegalPage'
import { devWarn } from './lib/util'

const VERSION = '1.0.0'

export function App() {
  /* --- shell state ------------------------------------------------------- */
  const mode = useApp((s) => s.mode)
  const setMode = useApp((s) => s.setMode)
  const booted = useApp((s) => s.booted)
  const qualityTier = useApp((s) => s.qualityTier)
  const qualityPinned = useApp((s) => s.qualityPinned)
  const setQualityTier = useApp((s) => s.setQualityTier)
  const measuredFps = useApp((s) => s.measuredFps)

  const mirror = useApp((s) => s.mirror)
  const setMirror = useApp((s) => s.setMirror)
  const splitEyes = useApp((s) => s.splitEyes)
  const setSplitEyes = useApp((s) => s.setSplitEyes)
  const facing = useApp((s) => s.facing)
  const flipCamera = useApp((s) => s.flipCamera)
  const calibration = useApp((s) => s.calibration)
  const setCalibration = useApp((s) => s.setCalibration)
  const recordAudio = useApp((s) => s.setRecordAudio)
  const recordAudioOn = useApp((s) => s.recordAudio)
  const watermark = useApp((s) => s.watermark)

  const avatarStatus = useApp((s) => s.avatar)
  const avatarAsset = useApp((s) => s.avatarAsset)
  const setAvatarAsset = useApp((s) => s.setAvatarAsset)
  const bumpAvatarRevision = useApp((s) => s.bumpAvatarRevision)

  const idFaceState = useApp((s) => s.faceState)
  const idIdleState = useApp((s) => s.idleState)
  const faceStateRef = useRef(idFaceState)
  const idleRef = useRef(idIdleState)

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(() => isLegalRoute(window.location.hash))
  /** URL of the clip whose preview the user has closed; a new clip reopens the sheet. */
  const [dismissedClipUrl, setDismissedClipUrl] = useState<string | null>(null)
  /** Set when the user asks to calibrate; cleared by the effect once the camera is live. */
  const pendingCalibration = useRef(false)

  const quality = useMemo(() => getTierSettings(qualityTier), [qualityTier])

  /* --- hash routes ------------------------------------------------------- */
  useEffect(() => {
    const onHash = () => setLegalDoc(isLegalRoute(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const openLegal = useCallback((doc: LegalDoc) => {
    window.location.hash = `#/${doc}`
    setLegalDoc(doc)
  }, [])

  const closeLegal = useCallback(() => {
    // `replaceState` rather than assigning '#': a history entry for a page you have just
    // left is a back-button trap.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setLegalDoc(null)
  }, [])

  /* --- boot: preferences and the saved avatar ---------------------------- */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const loaded = await loadPrefs()
      if (cancelled) return
      setPrefs(loaded)
      setPrefsLoaded(true)

      // Apply the stored choices before the first frame the user can see.
      setQualityTier(loaded.lite ? 'lite' : loaded.qualityTier, loaded.lite || loaded.qualityPinned)
      setMirror(loaded.mirror)
      setSplitEyes(loaded.splitEyes)
      manualInput.splitEyes = loaded.splitEyes
      recordAudio(loaded.recordAudio)

      const asset = await loadAvatarAsset()
      if (!cancelled && asset) setAvatarAsset(asset)
    })()
    return () => {
      cancelled = true
    }
  }, [recordAudio, setAvatarAsset, setMirror, setQualityTier, setSplitEyes])

  // Persist preferences on change, but never before the first load has applied — that
  // would overwrite the user's saved choices with the defaults for one tick.
  useEffect(() => {
    if (!prefsLoaded) return
    void savePrefs(prefs)
  }, [prefs, prefsLoaded])

  useEffect(() => {
    if (booted !== 'loading') hideSplash()
  }, [booted])

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((current) => ({ ...current, ...patch }))
  }, [])

  // Preferences that also live in the store (because the renderer reads them directly).
  useEffect(() => {
    setMirror(prefs.mirror)
    setSplitEyes(prefs.splitEyes)
    manualInput.splitEyes = prefs.splitEyes
    recordAudio(prefs.recordAudio)
    setQualityTier(prefs.lite ? 'lite' : prefs.qualityTier, prefs.lite || prefs.qualityPinned)
  }, [prefs, recordAudio, setMirror, setQualityTier, setSplitEyes])

  /* --- camera + tracking -------------------------------------------------- */
  const tracker = useLiveTracking({
    enabled: mode === 'live',
    videoRef,
    faceStateRef,
    idleRef,
    mirror,
    splitEyes,
    facing,
    calibration,
    onCalibration: setCalibration,
    preferCpu: prefs.lite,
  })

  // Surface tracker failures once, loudly, with the fix in the hint.
  const lastErrorCode = useRef<string | null>(null)
  useEffect(() => {
    const error = tracker.state.error
    if (!error) {
      lastErrorCode.current = null
      return
    }
    if (lastErrorCode.current === error.code) return
    lastErrorCode.current = error.code
    showToast(error.message, { hint: error.hint, tone: 'error', ttl: 9000 })
  }, [tracker.state.error])

  // Calibration can only start once the camera is live and a face is in frame, which may
  // be several seconds after the user asked for it (permission prompt, model download).
  // A ref rather than state: this is a one-shot trigger, and re-rendering every tracking
  // status change to poll for it would be wasteful.
  useEffect(() => {
    if (!pendingCalibration.current) return
    if (tracker.state.status !== 'tracking' || !tracker.state.hasFace) return
    pendingCalibration.current = false
    tracker.startCalibration()
    showToast('Hold still — looking straight at the camera', { ttl: 2200 })
  }, [tracker.state.status, tracker.state.hasFace, tracker])

  /* --- recording ---------------------------------------------------------- */
  const recorder = useRecorder({ canvas, audio: recordAudioOn })

  // Derived, not synced: the preview sheet is open whenever there is a clip the user has
  // not closed yet. No effect, and therefore no window in which the sheet is stale.
  const activeClip = recorder.result && recorder.result.url !== dismissedClipUrl ? recorder.result : null

  const handleModeToggle = useCallback(() => {
    setMode(mode === 'manual' ? 'live' : 'manual')
    // Leaving manual mode should not leave a commanded jaw or gaze behind, and entering
    // live mode should not inherit one either.
    resetManualInput(true)
  }, [mode, setMode])

  /* --- delete everything -------------------------------------------------- */
  const handleDeleteAvatar = useCallback(async () => {
    try {
      await deleteAvatarAsset()
      await deleteAllUserData()
      setAvatarAsset(null)
      bumpAvatarRevision()
      setPrefs(DEFAULT_PREFS)
      setCalibration(null)
      showToast('Avatar and local data deleted', {
        tone: 'success',
        hint: 'The bundled sample head is showing again.',
      })
    } catch (err) {
      devWarn('delete failed', err)
      showToast('Some data could not be deleted', {
        hint: 'Try closing other tabs of this app and deleting again.',
        tone: 'error',
      })
    }
  }, [bumpAvatarRevision, setAvatarAsset, setCalibration])

  const openSettings = useCallback(() => {
    setSettingsOpen(true)
    // Storage numbers are only needed when the panel is open, and quota checks are not
    // free on every render.
    void estimateUsage().then(setStorage)
  }, [])

  const install = useInstallPrompt()

  /* --- legal pages replace the app entirely ------------------------------- */
  if (legalDoc) {
    return <LegalPage doc={legalDoc} onBack={closeLegal} />
  }

  const inLiveMode = mode === 'live'
  // The self-view appears exactly when it is useful: while the tracker has no face, or
  // during calibration. Otherwise the frame belongs to the avatar.
  const showSelfView =
    inLiveMode &&
    (tracker.state.status === 'no-face' || tracker.state.status === 'calibrating' || !tracker.state.hasFace)

  return (
    <div data-app-shell className="relative h-full w-full overflow-hidden bg-studio-950">
      {/* The watermark is drawn in-scene while recording, so it lands in the captured
          frames without any readback of the WebGL buffer. */}
      <AvatarStage onReady={setCanvas} showWatermark={recorder.isRecording && watermark} />

      {/*
        One camera element, two jobs: the tracker reads frames from it, and it doubles as
        the self-view. It is never display:none — several mobile browsers stop producing
        frames for a hidden video — only ever transparent.
      */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        aria-hidden="true"
        className={[
          'absolute right-3 z-20 w-[104px] rounded-2xl object-cover ring-1 ring-white/20',
          'aspect-[3/4] bg-black/40 shadow-[0_6px_20px_rgba(2,6,23,0.4)]',
          'transition-opacity duration-300',
        ].join(' ')}
        style={{
          opacity: showSelfView ? 0.94 : 0,
          pointerEvents: 'none',
          transform: mirror && facing === 'user' ? 'scaleX(-1)' : undefined,
          top: 'calc(env(safe-area-inset-top, 0px) + 68px)',
        }}
      />

      {inLiveMode ? (
        <LiveOverlay
          mode={mode}
          onToggleMode={handleModeToggle}
          tracking={tracker.state}
          calibrating={tracker.state.status === 'calibrating'}
          onRecalibrate={() => {
            // Calibration needs a live camera, so this also brings the user into Live
            // mode if they asked for it from Settings.
            if (!inLiveMode) setMode('live')
            pendingCalibration.current = true
            setSettingsOpen(false)
          }}
          mirror={mirror}
          onToggleMirror={() => updatePrefs({ mirror: !mirror })}
          onFlipCamera={() => {
            flipCamera()
            showToast(facing === 'user' ? 'Using the back camera' : 'Using the front camera', { ttl: 1800 })
          }}
          recorder={{
            supported: recorder.supported,
            isRecording: recorder.isRecording,
            finalising: recorder.finalising,
            durationMs: recorder.durationMs,
            start: () => void recorder.start(),
            stop: recorder.stop,
          }}
          onOpenSettings={openSettings}
        />
      ) : (
        <>
          <TopBar
            tier={quality.tier}
            pinned={qualityPinned}
            hasGeneratedAvatar={avatarAsset !== null && avatarAsset.source !== 'sample'}
            onOpenAvatar={() => setPhotoOpen(true)}
            onOpenSettings={openSettings}
          />
          <div className="absolute inset-x-0 bottom-0 z-30">
            <ControlTray
              mode={mode}
              onToggleMode={handleModeToggle}
              split={splitEyes}
              onSplitChange={(split) => updatePrefs({ splitEyes: split })}
              disabled={avatarStatus.generating}
            />
          </div>
        </>
      )}

      <PhotoSheet open={photoOpen} onClose={() => setPhotoOpen(false)} prefs={prefs} />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        prefs={prefs}
        onChange={updatePrefs}
        onOpenAbout={() => {
          setSettingsOpen(false)
          setAboutOpen(true)
        }}
        onOpenLegal={(doc) => {
          setSettingsOpen(false)
          openLegal(doc)
        }}
        onDeleteAvatar={() => void handleDeleteAvatar()}
        onRecalibrate={() => {
          if (!inLiveMode) setMode('live')
          pendingCalibration.current = true
          setSettingsOpen(false)
        }}
        hasCalibration={calibration !== null}
        measuredFps={measuredFps}
        storage={storage}
        canRecord={recorder.supported}
        canInstall={install.canInstall}
        onInstall={install.install}
      />

      <AboutSheet
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        onOpenLegal={(doc) => {
          setAboutOpen(false)
          openLegal(doc)
        }}
        version={VERSION}
        provider={avatarStatus.provider}
        source={avatarAsset?.source ?? 'sample'}
        bytes={avatarStatus.bytes}
        generationMs={avatarStatus.generationMs}
        diagnostics={avatarStatus.diagnostics}
        measuredFps={measuredFps}
        tracker={{
          delegate: tracker.state.delegate,
          trackingFps: tracker.state.trackingFps,
          inferenceMs: tracker.state.inferenceMs,
          status: tracker.state.status,
        }}
      />

      <RecordingSheet
        // Keyed by the clip: a new recording remounts the sheet, so its "Saved" state
        // cannot leak from the previous one.
        key={activeClip?.url ?? 'none'}
        result={activeClip}
        onClose={() => {
          setDismissedClipUrl(activeClip?.url ?? null)
        }}
        onRecordAgain={() => {
          setDismissedClipUrl(activeClip?.url ?? null)
          recorder.clear()
          if (!inLiveMode) setMode('live')
        }}
      />

      <PwaStatus />
    </div>
  )
}
