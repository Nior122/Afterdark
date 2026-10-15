/**
 * Eye panel: a hold-to-blink button, a gaze pad, and a Split toggle.
 *
 * When Split is on the gaze pad grows a second, dimmer handle for the right eye, and
 * dragging in the pad's corners moves both. Keeping one pad (rather than two) is a
 * deliberate mobile choice: the tray is already cramped, and two pads inside a
 * 110-pixel box would be untouchable.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { manualInput } from '../state/manualInput'
import { haptic } from '../lib/util'
import { IconEye, IconBlink } from './icons'

export interface EyePanelProps {
  split: boolean
  onSplitChange: (split: boolean) => void
  disabled?: boolean
}

export function EyePanel({ split, onSplitChange, disabled = false }: EyePanelProps) {
  const padRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(false)
  const [blinking, setBlinking] = useState(false)

  // Blink is an instantaneous contact action, not a value: hold to close, release to
  // open. It is driven through the same non-reactive singleton as the other controls.
  useEffect(() => {
    return () => {
      manualInput.blink = 0
    }
  }, [])

  const commitGaze = useCallback(
    (x: number, y: number) => {
      const pad = padRef.current
      if (!pad) return
      const rect = pad.getBoundingClientRect()
      const travel = rect.width / 2 - 12
      const left = leftRef.current
      const right = rightRef.current
      const px = x * travel
      const py = -y * travel

      pad.setAttribute('aria-valuenow', String(Math.round(x * 100)))

      if (split) {
        // Split mode: the primary handle drives the left eye, and the secondary one
        // mirrors it at 70% so the pair still reads as a pair.
        manualInput.gazeXLeft = x
        manualInput.gazeYLeft = y
        manualInput.gazeXRight = x * 0.7
        manualInput.gazeYRight = y * 0.7
        if (left) left.style.transform = `translate3d(${px}px, ${py}px, 0)`
        if (right) right.style.transform = `translate3d(${px * 0.7}px, ${py * 0.7}px, 0)`
      } else {
        manualInput.gazeX = x
        manualInput.gazeY = y
        manualInput.gazeXLeft = x
        manualInput.gazeYLeft = y
        manualInput.gazeXRight = x
        manualInput.gazeYRight = y
        if (left) left.style.transform = `translate3d(${px}px, ${py}px, 0)`
        if (right) right.style.display = 'none'
      }
    },
    [split],
  )

  const onPointer = useCallback(
    (event: React.PointerEvent) => {
      const pad = padRef.current
      if (!pad) return
      const rect = pad.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const travel = rect.width / 2 - 12
      let x = (event.clientX - cx) / travel
      let y = -(event.clientY - cy) / travel
      const len = Math.hypot(x, y)
      if (len > 1) {
        x /= len
        y /= len
      }
      commitGaze(x, y)
    },
    [commitGaze],
  )

  const onDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return
      event.currentTarget.setPointerCapture(event.pointerId)
      activeRef.current = true
      haptic(5)
      onPointer(event)
    },
    [disabled, onPointer],
  )

  const onMove = useCallback(
    (event: React.PointerEvent) => {
      if (!activeRef.current) return
      onPointer(event)
    },
    [onPointer],
  )

  const onUp = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false
    // Gaze springs back to the front on release: a held gaze is a deliberate act.
    commitGaze(0, 0)
    manualInput.gazeX = 0
    manualInput.gazeY = 0
    manualInput.gazeXLeft = 0
    manualInput.gazeYLeft = 0
    manualInput.gazeXRight = 0
    manualInput.gazeYRight = 0
  }, [commitGaze])

  const blinkDown = useCallback(() => {
    if (disabled) return
    manualInput.blink = 1
    setBlinking(true)
    haptic(8)
  }, [disabled])

  const blinkUp = useCallback(() => {
    manualInput.blink = 0
    setBlinking(false)
  }, [])

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-2">
        {/* Blink: an eye glyph. Hold to close. */}
        <button
          type="button"
          aria-label="Hold to blink"
          aria-pressed={blinking}
          disabled={disabled}
          onPointerDown={blinkDown}
          onPointerUp={blinkUp}
          onPointerLeave={blinkUp}
          onPointerCancel={blinkUp}
          onContextMenu={(e) => e.preventDefault()}
          className={[
            'flex h-11 w-11 touch-none select-none items-center justify-center rounded-full',
            'transition-all duration-100 active:scale-95',
            blinking
              ? 'bg-slate-900 text-white shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]'
              : 'bg-white text-slate-600 shadow-[0_1px_3px_rgba(15,23,42,0.16),0_0_0_1px_rgba(15,23,42,0.06)]',
            disabled ? 'opacity-40' : '',
          ].join(' ')}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <IconBlink className="h-5 w-5" />
        </button>

        {/* Gaze pad. */}
        <div
          ref={padRef}
          role="slider"
          aria-label="Eye gaze"
          aria-valuemin={-100}
          aria-valuemax={100}
          // Seeded from the singleton; commitGaze() updates it without a render.
        aria-valuenow={0}
          tabIndex={disabled ? -1 : 0}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className={[
            'relative touch-none select-none rounded-2xl',
            'h-[58px] w-[76px]',
            'bg-gradient-to-b from-slate-100 to-slate-200/90',
            'shadow-[inset_0_2px_5px_rgba(15,23,42,0.15),inset_0_-1px_2px_rgba(255,255,255,0.9)]',
            'ring-1 ring-slate-900/10 overflow-hidden',
            disabled ? 'opacity-40' : '',
          ].join(' ')}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 bg-slate-900/8" />
          <span aria-hidden className="pointer-events-none absolute top-1/2 left-2 right-2 h-px -translate-y-1/2 bg-slate-900/8" />
          <div
            ref={leftRef}
            className="pointer-events-none absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-slate-500 shadow-[0_1px_4px_rgba(15,23,42,0.22),0_0_0_1px_rgba(15,23,42,0.06)]"
            style={{ transform: 'translate3d(0,0,0)' }}
          >
            <IconEye className="h-4 w-4" />
          </div>
          <div
            ref={rightRef}
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/70 text-slate-400 shadow-[0_1px_3px_rgba(15,23,42,0.16)]"
            style={{ display: split ? 'flex' : 'none', transform: 'translate3d(0,0,0)' }}
          >
            <IconEye className="h-3.5 w-3.5" />
          </div>
        </div>

        {/* Split toggle. */}
        <button
          type="button"
          role="switch"
          aria-checked={split}
          aria-label="Control eyes separately"
          onClick={() => {
            onSplitChange(!split)
            haptic(6)
          }}
          disabled={disabled}
          className={[
            'flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-full',
            'text-[9px] font-semibold uppercase tracking-wide',
            'transition-all duration-150 active:scale-95',
            split
              ? 'bg-slate-900 text-white shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]'
              : 'bg-white text-slate-500 shadow-[0_1px_3px_rgba(15,23,42,0.16),0_0_0_1px_rgba(15,23,42,0.06)]',
            disabled ? 'opacity-40' : '',
          ].join(' ')}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
            <path d="M12 5v14" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.4 2.4" fill="none" />
            <circle cx="7.5" cy="12" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="16.5" cy="12" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          Split
        </button>
      </div>
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Eyes</span>
    </div>
  )
}
