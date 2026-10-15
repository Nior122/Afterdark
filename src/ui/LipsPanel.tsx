/**
 * Lips panel: a vertical mouth-open slider plus smile and pucker rows.
 *
 * The three controls are intentionally different shapes because they are different
 * kinds of thing: opening the mouth is a magnitude (a slider), while smile and pucker
 * are *emotional* directions with a neutral at zero (centred sliders). Making all three
 * identical sliders from 0 to 1 would imply a stillness the face does not have.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { manualInput } from '../state/manualInput'
import { haptic } from '../lib/util'

export interface LipsPanelProps {
  disabled?: boolean
}

interface SliderProps {
  label: string
  /** 'unipolar' fills from the left; 'bipolar' fills from the centre. */
  kind: 'unipolar' | 'bipolar'
  value: number
  onChange: (value: number) => void
  disabled?: boolean
  compact?: boolean
}

/**
 * A slider that updates its own fill with a direct style write and reports values
 * through the callback, so dragging never re-renders the tray.
 */
function Slider({ label, kind, value, onChange, disabled, compact }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const paint = useCallback(
    (v: number) => {
      const fill = fillRef.current
      if (!fill) return
      if (kind === 'unipolar') {
        fill.style.left = '0%'
        fill.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`
      } else {
        const pct = Math.max(-1, Math.min(1, v))
        const left = pct >= 0 ? 50 : 50 + pct * 50
        const width = Math.abs(pct) * 50
        fill.style.left = `${left}%`
        fill.style.width = `${width}%`
      }
    },
    [kind],
  )

  useEffect(() => {
    paint(value)
  }, [paint, value])

  const fromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const v = kind === 'unipolar' ? t : t * 2 - 1
      paint(v)
      onChange(v)
    },
    [kind, onChange, paint],
  )

  const onDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return
      event.currentTarget.setPointerCapture(event.pointerId)
      activeRef.current = true
      setDragging(true)
      haptic(4)
      fromPointer(event.clientX)
    },
    [disabled, fromPointer],
  )

  const onMove = useCallback(
    (event: React.PointerEvent) => {
      if (!activeRef.current) return
      fromPointer(event.clientX)
    },
    [fromPointer],
  )

  const onUp = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false
    setDragging(false)
  }, [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (disabled) return
      const step = event.shiftKey ? 0.02 : 0.08
      let v = value
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') v -= step
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') v += step
      else if (event.key === 'Home') v = kind === 'unipolar' ? 0 : -1
      else if (event.key === 'End') v = 1
      else return
      v = Math.max(kind === 'unipolar' ? 0 : -1, Math.min(1, v))
      paint(v)
      onChange(v)
      event.preventDefault()
    },
    [disabled, kind, onChange, paint, value],
  )

  return (
    <div className={compact ? 'w-full' : 'w-full'}>
      <div className="mb-0.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <div
        ref={trackRef}
        role="slider"
        aria-label={label}
        aria-valuemin={kind === 'unipolar' ? 0 : -100}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKeyDown}
        className={[
          // 34px tall visually, but the touch target is padded to 44px by the wrapper.
          'relative touch-none select-none overflow-hidden rounded-full',
          'h-[18px] w-full bg-slate-200/80',
          'shadow-[inset_0_1px_3px_rgba(15,23,42,0.18)]',
          dragging ? 'ring-2 ring-slate-900/15' : '',
          disabled ? 'opacity-40' : '',
        ].join(' ')}
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        {kind === 'bipolar' ? (
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-900/15" />
        ) : null}
        <div
          ref={fillRef}
          className={[
            'pointer-events-none absolute top-0 h-full',
            kind === 'unipolar'
              ? 'bg-gradient-to-r from-slate-500 to-slate-700 rounded-full'
              : 'bg-gradient-to-r from-sky-400/70 to-sky-600/80 rounded-full',
          ].join(' ')}
          style={{ left: 0, width: '0%' }}
        />
      </div>
    </div>
  )
}

export function LipsPanel({ disabled = false }: LipsPanelProps) {
  // Panel-local mirrors of the singleton, only so the labels and the sliders can show
  // an initial value. Updates during a drag go straight to the singleton.
  const [mouthOpen, setMouthOpen] = useState(manualInput.mouthOpen)
  const [smile, setSmile] = useState(manualInput.smile)
  const [pucker, setPucker] = useState(manualInput.pucker)

  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      <div className="flex w-full items-end gap-2.5">
        {/* Vertical mouth-open slider. */}
        <MouthOpenSlider
          value={mouthOpen}
          onChange={(v) => {
            setMouthOpen(v)
            manualInput.mouthOpen = v
          }}
          disabled={disabled}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Slider
            label="Smile"
            kind="bipolar"
            value={smile}
            disabled={disabled}
            onChange={(v) => {
              setSmile(v)
              // One bipolar control, two ARKit directions: right of centre is a smile,
              // left of centre is a frown. Clamping at zero would make half the travel
              // dead, which feels broken under a thumb.
              manualInput.smile = Math.max(0, v)
              manualInput.frown = Math.max(0, -v)
            }}
          />
          <Slider
            label="Pucker"
            kind="unipolar"
            value={pucker}
            disabled={disabled}
            onChange={(v) => {
              setPucker(v)
              manualInput.pucker = v
            }}
          />
        </div>
      </div>
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Mouth</span>
    </div>
  )
}

/** Tall vertical slider for how far the jaw is open. */
function MouthOpenSlider({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(false)

  const paint = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    const fill = fillRef.current
    const thumb = thumbRef.current
    if (fill) fill.style.height = `${clamped * 100}%`
    if (thumb) thumb.style.bottom = `calc(${clamped * 100}% - 9px)`
  }, [])

  useEffect(() => {
    paint(value)
  }, [paint, value])

  const fromPointer = useCallback(
    (clientY: number) => {
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      const t = 1 - (clientY - rect.top) / rect.height
      const v = Math.max(0, Math.min(1, t))
      paint(v)
      onChange(v)
    },
    [onChange, paint],
  )

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        ref={trackRef}
        role="slider"
        aria-label="Mouth open"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={(e) => {
          if (disabled) return
          e.currentTarget.setPointerCapture(e.pointerId)
          activeRef.current = true
          haptic(4)
          fromPointer(e.clientY)
        }}
        onPointerMove={(e) => {
          if (activeRef.current) fromPointer(e.clientY)
        }}
        onPointerUp={() => {
          activeRef.current = false
        }}
        onPointerCancel={() => {
          activeRef.current = false
        }}
        onKeyDown={(e) => {
          if (disabled) return
          const step = e.shiftKey ? 0.02 : 0.08
          let v = value
          if (e.key === 'ArrowUp') v += step
          else if (e.key === 'ArrowDown') v -= step
          else if (e.key === 'Home') v = 0
          else if (e.key === 'End') v = 1
          else return
          v = Math.max(0, Math.min(1, v))
          paint(v)
          onChange(v)
          e.preventDefault()
        }}
        className={[
          'relative touch-none select-none overflow-hidden rounded-full',
          'h-[92px] w-[26px] bg-slate-200/80',
          'shadow-[inset_0_1px_4px_rgba(15,23,42,0.2)]',
          disabled ? 'opacity-40' : '',
        ].join(' ')}
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        <div
          ref={fillRef}
          className="pointer-events-none absolute bottom-0 left-0 w-full rounded-full bg-gradient-to-t from-rose-400/70 to-rose-500/80"
          style={{ height: '0%' }}
        />
        <div
          ref={thumbRef}
          className="pointer-events-none absolute left-1/2 h-[18px] w-[18px] -translate-x-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.3),0_0_0_1px_rgba(15,23,42,0.06)]"
          style={{ bottom: '-9px' }}
        />
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Open</span>
    </div>
  )
}
