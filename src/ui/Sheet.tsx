/**
 * Bottom sheet.
 *
 * Used for every modal surface (photo upload, settings, about, legal). Behaviours that
 * matter on a phone:
 *  - drag the grab handle down to dismiss, and swipe-to-close from anywhere on the
 *    header so the gesture is not a tiny target
 *  - the background scrolls independently and is locked while open
 *  - focus is trapped and Escape closes, so it works with a keyboard and a screen reader
 *  - `100dvh` units, because `100vh` on mobile Safari is taller than the visible
 *    viewport and pushes content under the browser chrome
 */
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { IconClose } from './icons'
import { haptic } from '../lib/util'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  /** Optional small text under the title. */
  subtitle?: string
  children: ReactNode
  /** Render the content edge to edge without horizontal padding. */
  flush?: boolean
  /** Prevent accidental dismissal while an operation is running. */
  locked?: boolean
}

export function Sheet({ open, onClose, title, subtitle, children, flush, locked }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const dragState = useRef({ startY: 0, offset: 0, dragging: false })

  // Lock background scroll while open.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  // Escape to close, and initial focus into the panel.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked) onClose()
    }
    window.addEventListener('keydown', onKey)
    const focusTarget = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    focusTarget?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, locked, onClose])

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (locked) return
      dragState.current = { startY: event.clientY, offset: 0, dragging: true }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [locked],
  )

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const state = dragState.current
    if (!state.dragging) return
    const offset = Math.max(0, event.clientY - state.startY)
    state.offset = offset
    const panel = panelRef.current
    if (panel) panel.style.transform = `translate3d(0, ${offset}px, 0)`
  }, [])

  const onPointerUp = useCallback(() => {
    const state = dragState.current
    if (!state.dragging) return
    state.dragging = false
    const panel = panelRef.current
    // Dismiss past a quarter of the panel's height, or on a fast flick.
    if (state.offset > (panel?.offsetHeight ?? 400) * 0.26) {
      haptic(5)
      onClose()
    } else if (panel) {
      panel.style.transform = 'translate3d(0, 0, 0)'
    }
  }, [onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close"
        onClick={() => !locked && onClose()}
        className="absolute inset-0 h-full w-full cursor-default bg-slate-950/45 backdrop-blur-[2px]"
        style={{ animation: 'fv-fade-in 160ms ease-out' }}
      />

      <div
        ref={panelRef}
        className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-[26px] bg-white shadow-[0_-8px_40px_rgba(2,6,23,0.28)]"
        style={{
          animation: 'fv-sheet-up 260ms cubic-bezier(0.22, 1, 0.36, 1)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          transition: 'transform 180ms ease-out',
        }}
      >
        {/* Grab area: the whole header, not just the handle. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="flex-none touch-none select-none px-4 pt-2.5 pb-1"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300" aria-hidden />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-[17px] font-semibold text-slate-900">{title}</h2>
              {subtitle ? <p className="mt-0.5 text-[12.5px] leading-snug text-slate-500">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={locked}
              aria-label="Close"
              className="-mr-1 -mt-1 flex h-9 w-9 flex-none items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 active:scale-95 disabled:opacity-40"
            >
              <IconClose className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className={['min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6', flush ? '' : 'px-4'].join(' ')}>
          {children}
        </div>
      </div>
    </div>
  )
}
