/**
 * Live mode chrome.
 *
 * Live mode shows the avatar and four things: the switch back to manual, the record
 * button, the mirror toggle and the camera flip. Everything else — status, calibration,
 * "center your face" — is either transient or absent, so the frame stays clean.
 *
 * Status is expressed as one pill with one sentence. A user who has just been asked for
 * camera permission does not want a dashboard; they want to know whether it worked.
 */
import { IconFlip, IconMirror, IconRecord, IconStop } from './icons'
import { ModeSwitch } from './ModeSwitch'
import type { AppMode } from '../state/store'
import type { LiveTrackingState } from '../tracking/useLiveTracking'

export interface LiveOverlayProps {
  mode: AppMode
  onToggleMode: () => void
  tracking: LiveTrackingState
  onRecalibrate: () => void
  calibrating: boolean
  mirror: boolean
  onToggleMirror: () => void
  onFlipCamera: () => void
  recorder: {
    supported: boolean
    isRecording: boolean
    finalising: boolean
    durationMs: number
    start: () => void
    stop: () => void
  }
  onOpenSettings: () => void
}

/**
 * Secondary actions in Live mode: legible over both the dark studio and a bright face,
 * with a 44px-tall touch target even though the type is small.
 */
const CHIP_CLASS =
  'h-9 rounded-full bg-studio-900/70 px-3.5 text-[12.5px] font-semibold text-white ring-1 ring-white/10 backdrop-blur transition-transform active:scale-[0.97] disabled:opacity-50'

const STATUS_TEXT: Record<LiveTrackingState['status'], string> = {
  idle: 'Starting camera…',
  'requesting-permission': 'Waiting for camera permission…',
  'loading-model': 'Loading the face tracker…',
  'warming-up': 'Warming up…',
  tracking: 'Tracking',
  'no-face': 'Center your face in the frame',
  calibrating: 'Hold still, looking straight at the camera',
  error: 'Camera unavailable',
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function LiveOverlay({
  mode,
  onToggleMode,
  tracking,
  onRecalibrate,
  calibrating,
  mirror,
  onToggleMirror,
  onFlipCamera,
  recorder,
  onOpenSettings,
}: LiveOverlayProps) {
  const { status, hasFace, trackingFps, inferenceMs, delegate, error, calibrationProgress } = tracking
  // Aliased predicates, one per question. TypeScript narrows through these, which is
  // what keeps the JSX below free of repeated string comparisons.
  const errored = status === 'error'
  const calibratingNow = status === 'calibrating'
  /** The tracker is running and a face is in frame — the only state with no pill. */
  const healthy = status === 'tracking' && hasFace && !calibrating
  const showPill = errored || !healthy

  const pillTone = calibrating
    ? 'bg-sky-500/95 text-white'
    : errored
      ? 'bg-accent-500/95 text-white'
      : hasFace
        ? 'bg-studio-900/80 text-slate-100'
        : 'bg-amber-400/95 text-amber-950'

  return (
    <>
      {/* Status pill: one line, fades out of the way once tracking is healthy. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-4 pt-safe">
        {showPill || calibrating ? (
          <div
            className={[
              'mt-[calc(env(safe-area-inset-top,0px)+10px)] max-w-[86%] rounded-full px-3.5 py-2 text-center',
              'text-[12.5px] font-medium shadow-[0_4px_18px_rgba(2,6,23,0.35)] backdrop-blur ring-1 ring-white/10',
              pillTone,
            ].join(' ')}
            style={{ animation: 'fv-fade-in 200ms ease-out' }}
            role="status"
            aria-live="polite"
          >
            {calibratingNow ? (
              <span className="flex items-center gap-2">
                <span className="flex h-1.5 w-24 overflow-hidden rounded-full bg-white/25">
                  <span
                    className="h-full rounded-full bg-white transition-[width] duration-100"
                    style={{ width: `${Math.round(calibrationProgress * 100)}%` }}
                  />
                </span>
                {STATUS_TEXT.calibrating}
              </span>
            ) : error ? (
              <span>
                {error.message}
                {error.hint ? <span className="block text-[11.5px] opacity-80">{error.hint}</span> : null}
              </span>
            ) : (
              STATUS_TEXT[status]
            )}
          </div>
        ) : null}
      </div>

      {/* Diagnostics, only in development: real numbers, not guesses. */}
      {__DEV_MODE__ ? (
        <div className="pointer-events-none absolute right-3 top-[calc(env(safe-area-inset-top,0px)+64px)] z-30 rounded-lg bg-black/55 px-2 py-1 font-mono text-[10px] leading-tight text-emerald-300">
          <div>fps {trackingFps.toFixed(0)}</div>
          <div>infer {inferenceMs.toFixed(1)}ms</div>
          <div>{delegate ?? '—'}</div>
        </div>
      ) : null}

      {/* Bottom cluster. */}
      <div className="absolute inset-x-0 bottom-0 z-30 px-4 pb-safe">
        <div className="mb-3 flex items-end justify-between gap-4 pb-2">
          <ModeSwitch mode={mode} onToggle={onToggleMode} />

          {/* Record: the only primary action in the frame. */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              aria-label={recorder.isRecording ? 'Stop recording' : 'Record a clip'}
              disabled={!recorder.supported || recorder.finalising}
              onClick={() => (recorder.isRecording ? recorder.stop() : recorder.start())}
              className={[
                'relative flex h-[68px] w-[68px] items-center justify-center rounded-full',
                'transition-transform duration-150 active:scale-95 disabled:opacity-40',
                recorder.isRecording
                  ? 'bg-white text-accent-500 shadow-[0_6px_24px_rgba(226,84,74,0.45)] ring-4 ring-accent-500/40'
                  : 'bg-accent-500 text-white shadow-[0_6px_24px_rgba(226,84,74,0.45)]',
              ].join(' ')}
            >
              {recorder.finalising ? (
                <span
                  aria-hidden
                  className="h-6 w-6 rounded-full border-2 border-current border-t-transparent"
                  style={{ animation: 'fv-spin 700ms linear infinite' }}
                />
              ) : recorder.isRecording ? (
                <IconStop className="h-7 w-7" />
              ) : (
                <IconRecord className="h-7 w-7" />
              )}
            </button>
            <span className="rounded-full bg-studio-900/70 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur">
              {recorder.finalising ? 'Saving…' : recorder.isRecording ? formatDuration(recorder.durationMs) : recorder.supported ? 'Record' : 'Unsupported'}
            </span>
          </div>

          {/* Mirror + flip. */}
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              aria-label={mirror ? 'Turn mirroring off' : 'Turn mirroring on'}
              aria-pressed={mirror}
              onClick={onToggleMirror}
              className={[
                'flex h-11 w-11 items-center justify-center rounded-full backdrop-blur transition-all active:scale-95',
                mirror
                  ? 'bg-white text-studio-900 shadow-[0_4px_16px_rgba(2,6,23,0.35)]'
                  : 'bg-white/12 text-white ring-1 ring-white/15',
              ].join(' ')}
            >
              <IconMirror className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Switch camera"
              onClick={onFlipCamera}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/12 text-white ring-1 ring-white/15 backdrop-blur transition-transform active:scale-95"
            >
              <IconFlip className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Secondary links: recalibrate once tracking is up, and settings for the
            cases the overlay cannot fix (a denied permission, a camera in use). */}
        <div className="mb-2 flex items-center justify-center gap-2 pb-1">
          {status === 'tracking' ? (
            <button
              type="button"
              onClick={onRecalibrate}
              disabled={calibrating}
              className={CHIP_CLASS}
            >
              {calibrating ? 'Calibrating…' : 'Recalibrate'}
            </button>
          ) : null}
          {errored ? (
            <button type="button" onClick={onOpenSettings} className={CHIP_CLASS}>
              Camera help
            </button>
          ) : null}
        </div>
      </div>
    </>
  )
}
