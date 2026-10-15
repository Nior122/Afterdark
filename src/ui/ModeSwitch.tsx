/**
 * The round button that switches between Manual and Live mode.
 *
 * It appears in both modes, always in the same place — the bottom-left of the control
 * cluster — so switching back is never a hunt. The label states where you are going,
 * not where you are, because that is the information a user needs before tapping.
 */
import { IconCamera, IconPencil } from './icons'
import { haptic } from '../lib/util'
import type { AppMode } from '../state/store'

export interface ModeSwitchProps {
  mode: AppMode
  onToggle: () => void
  disabled?: boolean
}

export function ModeSwitch({ mode, onToggle, disabled = false }: ModeSwitchProps) {
  const goingLive = mode === 'manual'

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={goingLive ? 'Switch to live camera mode' : 'Switch to manual controls'}
      onClick={() => {
        haptic(10)
        onToggle()
      }}
      className={[
        'flex h-[54px] w-[54px] flex-none flex-col items-center justify-center gap-0.5 rounded-full',
        'transition-transform duration-150 active:scale-95 disabled:opacity-40',
        goingLive
          ? 'bg-studio-900 text-white shadow-[0_6px_20px_rgba(2,6,23,0.35)]'
          : 'bg-white/95 text-slate-700 shadow-[0_4px_16px_rgba(2,6,23,0.3),0_0_0_1px_rgba(15,23,42,0.08)] backdrop-blur',
      ].join(' ')}
    >
      {goingLive ? <IconCamera className="h-5 w-5" /> : <IconPencil className="h-5 w-5" />}
      <span className="text-[8.5px] font-bold uppercase tracking-wider">{goingLive ? 'Live' : 'Hand'}</span>
    </button>
  )
}
