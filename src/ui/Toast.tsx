/**
 * Transient status messages.
 *
 * A single store-backed queue rather than per-component state, so any layer can report
 * something ("Camera permission denied", "Saved to your downloads") without plumbing a
 * callback down to it. Toasts auto-dismiss, stack at most three deep, and can be
 * dismissed by tapping.
 */
import { useCallback, useEffect, useState } from 'react'
import { haptic } from '../lib/util'

export type ToastTone = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: number
  message: string
  /** Optional second line: what the user can do about it. */
  hint?: string
  tone: ToastTone
  /** Milliseconds before auto-dismiss; 0 pins the toast until tapped. */
  ttl: number
}

type Listener = (toasts: Toast[]) => void

let nextId = 1
let toasts: Toast[] = []
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener(toasts)
}

export function showToast(message: string, options: { hint?: string; tone?: ToastTone; ttl?: number } = {}): number {
  const tone = options.tone ?? 'info'
  const toast: Toast = {
    id: nextId++,
    message,
    ...(options.hint ? { hint: options.hint } : {}),
    tone,
    // Errors stay long enough to read; success messages get out of the way.
    ttl: options.ttl ?? (tone === 'error' ? 8000 : tone === 'success' ? 2600 : 4200),
  }
  // Cap the stack: more than three and the newest is competing with the oldest for the
  // same square inch of screen.
  toasts = [...toasts, toast].slice(-3)
  emit()
  if (tone === 'error') haptic([12, 60, 12])
  return toast.id
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function clearToasts(): void {
  toasts = []
  emit()
}

const TONE_STYLES: Record<ToastTone, string> = {
  info: 'bg-studio-800/95 text-slate-100 ring-white/10',
  success: 'bg-emerald-600/95 text-white ring-emerald-300/30',
  warning: 'bg-amber-500/95 text-amber-950 ring-amber-200/40',
  error: 'bg-accent-500/95 text-white ring-accent-400/40',
}

export function ToastViewport() {
  const [items, setItems] = useState<Toast[]>(toasts)

  useEffect(() => {
    const listener: Listener = (next) => setItems(next)
    listeners.add(listener)
    listener(toasts)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  useEffect(() => {
    if (items.length === 0) return
    const timers = items
      .filter((t) => t.ttl > 0)
      .map((t) => window.setTimeout(() => dismissToast(t.id), t.ttl))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [items])

  const onTap = useCallback((id: number) => dismissToast(id), [])

  return (
    <div
      // `pointer-events-none` on the stack, `auto` on each toast, so the container never
      // intercepts taps meant for the controls underneath.
      className="pointer-events-none fixed inset-x-0 top-0 z-[120] flex flex-col items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top,0px)+10px)]"
      role="status"
      aria-live="polite"
    >
      {items.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => onTap(toast.id)}
          className={[
            'pointer-events-auto w-full max-w-sm rounded-2xl px-3.5 py-2.5 text-left shadow-lg backdrop-blur',
            'ring-1 transition-transform active:scale-[0.99]',
            TONE_STYLES[toast.tone],
          ].join(' ')}
          style={{ animation: 'fv-toast-in 200ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        >
          <p className="text-[13.5px] font-medium leading-snug">{toast.message}</p>
          {toast.hint ? <p className="mt-0.5 text-[12px] leading-snug opacity-80">{toast.hint}</p> : null}
        </button>
      ))}
    </div>
  )
}
