/**
 * The rounded control tray: everything the user touches in Manual mode.
 *
 * Layout reasoning — this is the one screen that decides whether the app feels good on
 * a phone, so it is arranged for thumbs rather than for symmetry:
 *
 *   row 1   the joystick (left thumb, the control used most) and the eye panel
 *   row 2   the mouth panel, which is naturally wide (two horizontal sliders)
 *   footer  the mode switch, bottom-left, where the spec puts it
 *
 * Phone widths down to 320px are the constraint. A single row of three panels does not
 * fit there without shrinking the joystick below a comfortable 44px-per-axis travel,
 * which is why the mouth panel gets its own row.
 */
import { Joystick } from './Joystick'
import { EyePanel } from './EyePanel'
import { LipsPanel } from './LipsPanel'
import { ModeSwitch } from './ModeSwitch'
import { resetManualInput } from '../state/manualInput'
import { haptic } from '../lib/util'
import type { AppMode } from '../state/store'

export interface ControlTrayProps {
  mode: AppMode
  onToggleMode: () => void
  split: boolean
  onSplitChange: (split: boolean) => void
  /** True while an avatar is being generated, so controls do not fight the loader. */
  disabled?: boolean
}

export function ControlTray({ mode, onToggleMode, split, onSplitChange, disabled = false }: ControlTrayProps) {
  return (
    <div className="px-3 pb-safe">
      <div
        className={[
          'mx-auto w-full max-w-[520px] rounded-tray',
          // Translucent rather than opaque: the bust continues faintly behind the tray,
          // which keeps the avatar feeling full-screen instead of boxed.
          'bg-white/92 backdrop-blur-xl',
          'shadow-[0_-6px_34px_rgba(2,6,23,0.34),0_0_0_1px_rgba(255,255,255,0.55)]',
          'px-3 pt-3 pb-2.5',
          'transition-transform duration-300 ease-out',
        ].join(' ')}
        style={{ animation: 'fv-sheet-up 320ms cubic-bezier(0.22, 1, 0.36, 1)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <Joystick disabled={disabled} />
          <EyePanel split={split} onSplitChange={onSplitChange} disabled={disabled} />
        </div>

        <div className="mt-2.5 border-t border-slate-900/8 pt-2.5">
          <LipsPanel disabled={disabled} />
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <ModeSwitch mode={mode} onToggle={onToggleMode} disabled={disabled} />
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              // A "reset the face" affordance: the joystick springs back on its own, but
              // a set jaw or a held smile would otherwise stay put with no obvious undo.
              resetManualInput(true)
              haptic(6)
            }}
            className="h-9 rounded-full px-3.5 text-[12px] font-semibold text-slate-500 transition-colors hover:bg-slate-900/5 active:scale-[0.97] disabled:opacity-40"
          >
            Reset pose
          </button>
        </div>
      </div>
    </div>
  )
}
