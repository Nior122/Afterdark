/**
 * Circular 2D head-rotation pad.
 *
 * Performance detail: during a drag the thumb is moved with a direct DOM transform
 * and the value is written to the non-reactive `manualInput` singleton. React state is
 * only touched when the gesture ends. Doing it the obvious way — a `useState` per
 * pointermove — reconciles the whole tray on every frame of the drag.
 *
 * Spring-back on release is an exponential decay that the component drives itself,
 * which keeps the release feeling physical without a physics library.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { manualInput } from '../state/manualInput'
import { haptic } from '../lib/util'

export interface JoystickProps {
  /** Radius of travel in CSS pixels. */
  travel?: number
  /** Called with the normalised value when a drag ends (for label readouts). */
  onChangeEnd?: (x: number, y: number) => void
  disabled?: boolean
}

export function Joystick({ travel = 34, onChangeEnd, disabled = false }: JoystickProps) {
  const baseRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const valueRef = useRef({ x: 0, y: 0 })
  const [engaged, setEngaged] = useState(false)

  /** Move the thumb and write the value. No React state involved. */
  const commit = useCallback(
    (x: number, y: number) => {
      valueRef.current.x = x
      valueRef.current.y = y
      manualInput.headX = x
      manualInput.headY = y
      const thumb = thumbRef.current
      if (thumb) {
        thumb.style.transform = `translate3d(${(x * travel).toFixed(2)}px, ${(y * travel).toFixed(2)}px, 0)`
      }
      // The accessible value is written straight to the DOM for the same reason the
      // thumb is: this runs on every pointer move, and 60 renders a second is not
      // something a screen reader needs either.
      baseRef.current?.setAttribute('aria-valuenow', String(Math.round(x * 100)))
    },
    [travel],
  )

  const springBack = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { x, y } = valueRef.current
      // Exponentially approach centre; 0.16 s half-life reads as a physical spring.
      const k = Math.pow(0.5, dt / 0.16)
      const nx = x * k
      const ny = y * k
      if (Math.abs(nx) < 0.002 && Math.abs(ny) < 0.002) {
        commit(0, 0)
        rafRef.current = null
        return
      }
      commit(nx, ny)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }, [commit])

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const base = baseRef.current
      if (!base) return
      const rect = base.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const px = (clientX - cx) / travel
      const py = -(clientY - cy) / travel
      // Clamp to the unit disc so diagonal travel cannot exceed the pad.
      const len = Math.hypot(px, py)
      const scale = len > 1 ? 1 / len : 1
      commit(px * scale, py * scale)
    },
    [commit, travel],
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return
      event.currentTarget.setPointerCapture(event.pointerId)
      activeRef.current = true
      setEngaged(true)
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      haptic(6)
      updateFromPointer(event.clientX, event.clientY)
    },
    [disabled, updateFromPointer],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!activeRef.current) return
      updateFromPointer(event.clientX, event.clientY)
    },
    [updateFromPointer],
  )

  const onPointerUp = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false
    setEngaged(false)
    haptic(4)
    onChangeEnd?.(valueRef.current.x, valueRef.current.y)
    springBack()
  }, [onChangeEnd, springBack])

  // Keyboard accessibility: arrows nudge, Escape centres.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (disabled) return
      const step = event.shiftKey ? 0.05 : 0.15
      const { x, y } = valueRef.current
      let nx = x
      let ny = y
      if (event.key === 'ArrowLeft') nx = Math.max(-1, x - step)
      else if (event.key === 'ArrowRight') nx = Math.min(1, x + step)
      else if (event.key === 'ArrowUp') ny = Math.min(1, y + step)
      else if (event.key === 'ArrowDown') ny = Math.max(-1, y - step)
      else if (event.key === 'Escape' || event.key === '0') {
        commit(0, 0)
        onChangeEnd?.(0, 0)
        event.preventDefault()
        return
      } else return
      const len = Math.hypot(nx, ny)
      const s = len > 1 ? 1 / len : 1
      commit(nx * s, ny * s)
      onChangeEnd?.(nx * s, ny * s)
      event.preventDefault()
    },
    [commit, disabled, onChangeEnd],
  )

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      // Never leave the avatar rotated because the panel unmounted mid-drag.
      manualInput.headX = 0
      manualInput.headY = 0
    }
  }, [])

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        ref={baseRef}
        role="slider"
        aria-label="Head direction"
        aria-valuemin={-100}
        aria-valuemax={100}
        // Seeded at centre; commit() keeps it current without a render.
        aria-valuenow={0}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className={[
          'relative touch-none select-none rounded-full',
          'h-[104px] w-[104px]',
          'bg-gradient-to-b from-slate-100 to-slate-200/90',
          'shadow-[inset_0_2px_6px_rgba(15,23,42,0.16),inset_0_-1px_2px_rgba(255,255,255,0.9)]',
          'ring-1 ring-slate-900/10',
          engaged ? 'cursor-grabbing' : 'cursor-grab',
          disabled ? 'opacity-40' : '',
        ].join(' ')}
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        {/* Cross-hair guides, so the centre is obvious without decoration. */}
        <span aria-hidden className="pointer-events-none absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 bg-slate-900/8" />
        <span aria-hidden className="pointer-events-none absolute top-1/2 left-2 right-2 h-px -translate-y-1/2 bg-slate-900/8" />
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-900/15"
        />

        <div
          ref={thumbRef}
          className={[
            'pointer-events-none absolute left-1/2 top-1/2',
            'h-[46px] w-[46px] -translate-x-1/2 -translate-y-1/2 rounded-full',
            'bg-white shadow-[0_2px_6px_rgba(15,23,42,0.24),0_0_0_1px_rgba(15,23,42,0.07)]',
            'flex items-center justify-center',
            'transition-[box-shadow] duration-150',
            engaged ? 'shadow-[0_3px_10px_rgba(15,23,42,0.3),0_0_0_1px_rgba(15,23,42,0.09)]' : '',
          ].join(' ')}
        >
          {/* A subtle face glyph makes the control self-explanatory. */}
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-400" aria-hidden>
            <path
              d="M12 3.2c-3.6 0-6.2 2.9-6.2 7.1 0 4.4 2.5 8.1 6.2 8.1s6.2-3.7 6.2-8.1c0-4.2-2.6-7.1-6.2-7.1Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <circle cx="9.4" cy="10.4" r="0.95" fill="currentColor" />
            <circle cx="14.6" cy="10.4" r="0.95" fill="currentColor" />
          </svg>
        </div>
      </div>
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Head</span>
    </div>
  )
}
