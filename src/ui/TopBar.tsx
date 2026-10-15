/**
 * Top bar.
 *
 * Kept deliberately shallow: the app name, a quality chip for the performance-minded,
 * and two icon buttons. In Live mode the bar is hidden entirely — the spec asks for the
 * avatar and the recording controls and nothing else, and a header competing with a
 * live camera preview is just noise.
 */
import { IconPencil, IconSettings } from './icons'
import type { QualityTier } from '../render/quality'

export interface TopBarProps {
  tier: QualityTier
  /** True when the user pinned the tier by hand. */
  pinned: boolean
  hasGeneratedAvatar: boolean
  onOpenAvatar: () => void
  onOpenSettings: () => void
  disabled?: boolean
}

const TIER_LABEL: Record<QualityTier, string> = {
  lite: 'Lite',
  balanced: 'Balanced',
  high: 'High',
}

export function TopBar({
  tier,
  pinned,
  hasGeneratedAvatar,
  onOpenAvatar,
  onOpenSettings,
  disabled = false,
}: TopBarProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 px-3 pt-safe">
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="pointer-events-auto flex items-center gap-2">
          <span
            aria-hidden
            className="h-7 w-7 rounded-[10px] bg-gradient-to-br from-accent-400 to-violet-600 shadow-[0_3px_12px_rgba(124,58,237,0.35)]"
          />
          <div className="leading-none">
            <p className="text-[14.5px] font-semibold tracking-tight text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.55)]">
              Faceverify
            </p>
            {/* The tier is shown as a chip rather than hidden in settings, because
                "why does this look soft?" is answered by this word. */}
            <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-white/55">
              {TIER_LABEL[tier]}
              {pinned ? ' · pinned' : ''}
            </p>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={onOpenAvatar}
            aria-label={hasGeneratedAvatar ? 'Change your avatar' : 'Create your avatar from a photo'}
            className="flex h-10 items-center gap-1.5 rounded-full bg-white/12 px-3 text-[12.5px] font-semibold text-white shadow-[0_2px_10px_rgba(2,6,23,0.3)] ring-1 ring-white/15 backdrop-blur transition-transform active:scale-95 disabled:opacity-50"
          >
            <IconPencil className="h-4 w-4" />
            {hasGeneratedAvatar ? 'Change' : 'Your face'}
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/12 text-white shadow-[0_2px_10px_rgba(2,6,23,0.3)] ring-1 ring-white/15 backdrop-blur transition-transform active:scale-95"
          >
            <IconSettings className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  )
}
