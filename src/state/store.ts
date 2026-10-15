/**
 * Global app state.
 *
 * Zustand, with the deliberate exception that *per-frame* data never lives here.
 * Head pose and the 52 expression channels are written into a mutable `FaceState`
 * object held in a ref and consumed directly by the render loop (see AvatarStage).
 * Routing those through React at 60 Hz would be the single biggest performance
 * mistake available in this app.
 *
 * What does live here is everything that changes at human speed: mode, quality,
 * provider choice, recording state, progress, and persisted preferences.
 */
import { create } from 'zustand'
import { createIdleState, type IdleState } from '../avatar/idle'
import { createFaceState, type FaceState, type RigDiagnostics } from '../avatar/rig'
import type { AvatarAsset, AvatarSourceId, ProviderInfo, ProgressReport } from '../avatar/types'
import type { QualityTier } from '../render/quality'
import type { CalibrationData } from '../tracking/calibration'
import { detectInitialTier, getTierSettings } from '../render/quality'

export type AppMode = 'manual' | 'live'

export type BootStage = 'loading' | 'ready' | 'error'

export interface RecordingState {
  active: boolean
  durationMs: number
  /** True while the browser is finalising the file (MediaRecorder.stop is async). */
  finalising: boolean
  result: { url: string; blob: Blob; mimeType: string; extension: string } | null
  error: string | null
}

export interface AvatarStatus {
  source: AvatarSourceId
  /** 0..1 */
  progress: number
  report: ProgressReport | null
  generating: boolean
  error: { message: string; hint?: string } | null
  /** Diagnostics from the loader, shown in the About panel. */
  diagnostics: RigDiagnostics | null
  /** Model provenance, shown in the About panel. */
  provider: string | null
  bytes: number | null
  /** Wall-clock time the last generation took, ms. */
  generationMs: number | null
}

export interface AppState {
  // --- shell ---------------------------------------------------------------
  booted: BootStage
  bootError: string | null
  mode: AppMode
  settingsOpen: boolean
  aboutOpen: boolean

  // --- avatar --------------------------------------------------------------
  avatar: AvatarStatus
  /**
   * The most recently generated avatar asset, or null to use the bundled sample.
   * Held here rather than as per-frame state because a GLB is megabytes and changes
   * only when the user generates a new avatar.
   */
  avatarAsset: AvatarAsset | null
  /** Increments whenever the scene should load \`avatarAsset\` (or the sample). */
  avatarRevision: number

  // --- quality -------------------------------------------------------------
  qualityTier: QualityTier
  /** True when the user has pinned the tier; disables adaptive changes. */
  qualityPinned: boolean
  /** What the watchdog last measured, for the About panel. */
  measuredFps: number

  // --- live mode -----------------------------------------------------------
  mirror: boolean
  splitEyes: boolean
  facing: 'user' | 'environment'
  calibration: CalibrationData | null
  calibrating: boolean
  watermark: boolean

  // --- recording -----------------------------------------------------------
  recording: RecordingState
  /** Whether the mic is included in recordings. */
  recordAudio: boolean

  // --- mutable, render-loop-owned state (never triggers a React render) ----
  faceState: FaceState
  idleState: IdleState

  // --- actions -------------------------------------------------------------
  setBooted: (stage: BootStage, error?: string | null) => void
  setMode: (mode: AppMode) => void
  setAvatarAsset: (asset: AvatarAsset | null) => void
  /** Force the scene to reload the current asset (used by Recalibrate/Reset). */
  bumpAvatarRevision: () => void
  setSettingsOpen: (open: boolean) => void
  setAboutOpen: (open: boolean) => void
  setQualityTier: (tier: QualityTier, pinned?: boolean) => void
  setMeasuredFps: (fps: number) => void
  setMirror: (mirror: boolean) => void
  setSplitEyes: (split: boolean) => void
  flipCamera: () => void
  setWatermark: (on: boolean) => void
  setRecordAudio: (on: boolean) => void
  setCalibration: (data: CalibrationData | null) => void
  setCalibrating: (on: boolean) => void
  beginGeneration: (source: AvatarSourceId) => void
  reportProgress: (report: ProgressReport) => void
  finishGeneration: (info: {
    provider: string
    diagnostics: RigDiagnostics
    bytes: number | null
    generationMs: number
  }) => void
  failGeneration: (message: string, hint?: string) => void
  setRecording: (patch: Partial<RecordingState>) => void
}

export const useApp = create<AppState>((set, get) => ({
  booted: 'loading',
  bootError: null,
  mode: 'manual',
  settingsOpen: false,
  aboutOpen: false,

  avatar: {
    source: 'sample',
    progress: 0,
    report: null,
    generating: false,
    error: null,
    diagnostics: null,
    provider: null,
    bytes: null,
    generationMs: null,
  },
  avatarAsset: null,
  avatarRevision: 0,

  qualityTier: detectInitialTier(),
  qualityPinned: false,
  measuredFps: 0,

  mirror: true,
  splitEyes: false,
  facing: 'user',
  calibration: null,
  calibrating: false,
  watermark: true,

  recording: { active: false, durationMs: 0, finalising: false, result: null, error: null },
  recordAudio: false,

  faceState: createFaceState(),
  idleState: createIdleState(),

  setBooted: (booted, bootError = null) => set({ booted, bootError }),
  setMode: (mode) => set({ mode }),
  setAvatarAsset: (avatarAsset) => set({ avatarAsset, avatarRevision: get().avatarRevision + 1 }),
  bumpAvatarRevision: () => set((s) => ({ avatarRevision: s.avatarRevision + 1 })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),

  setQualityTier: (qualityTier, pinned) =>
    set((s) => ({ qualityTier, qualityPinned: pinned ?? s.qualityPinned })),

  setMeasuredFps: (measuredFps) =>
    set((s) => (Math.abs(s.measuredFps - measuredFps) < 1 ? s : { measuredFps })),

  setMirror: (mirror) => set({ mirror }),
  setSplitEyes: (splitEyes) => set({ splitEyes }),
  flipCamera: () => set((s) => ({ facing: s.facing === 'user' ? 'environment' : 'user' })),
  setWatermark: (watermark) => set({ watermark }),
  setRecordAudio: (recordAudio) => set({ recordAudio }),

  setCalibration: (calibration) => set({ calibration }),
  setCalibrating: (calibrating) => set({ calibrating }),

  beginGeneration: (source) =>
    set((s) => ({
      avatar: { ...s.avatar, source, generating: true, progress: 0, error: null, report: null },
    })),

  reportProgress: (report) =>
    set((s) => ({
      // Progress must be monotonic: a provider that reports out of order should not
      // make the bar jump backwards.
      avatar: { ...s.avatar, report, progress: Math.max(s.avatar.progress, report.progress) },
    })),

  finishGeneration: ({ provider, diagnostics, bytes, generationMs }) =>
    set((s) => ({
      avatar: {
        ...s.avatar,
        generating: false,
        progress: 1,
        error: null,
        diagnostics,
        provider,
        bytes,
        generationMs,
      },
    })),

  failGeneration: (message, hint) =>
    set((s) => ({ avatar: { ...s.avatar, generating: false, error: { message, hint }, progress: 0 } })),

  setRecording: (patch) => set((s) => ({ recording: { ...s.recording, ...patch } })),
}))

/** Convenience selector: the effective quality settings for the current tier. */
export const selectQuality = (s: AppState) => getTierSettings(s.qualityTier)

/** Providers shown in the picker, filtered to those that can actually run. */
export const selectMode = (s: AppState) => s.mode
export const selectProviderMeta = (s: AppState): ProviderInfo[] => {
  void s
  return []
}
