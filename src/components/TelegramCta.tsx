/**
 * Telegram "Watch Full Video" call-to-action.
 *
 * Rendered on every *opened* video page — the watch page in public mode and
 * the standalone /v/ page in direct mode — between the action row and the
 * description box, never inside the box, and never on grid cards. Because it
 * is page-level, every existing and future video gets it without any per-video
 * data or Worker involvement.
 *
 * The link is the owner's fixed bot URL below; the animations (label sheen,
 * plane nudge, button breathe) live in index.css under `.tg-cta*` and stop
 * under prefers-reduced-motion. `data-cta` marks this anchor so the
 * "standalone page has no anchors" invariants can allow the owner's CTA while
 * still rejecting site navigation links.
 */
import { Send } from 'lucide-react'

export const TELEGRAM_CTA_URL = 'https://t.me/KasiQueenbot'

export default function TelegramCta({ className = '' }: { className?: string }) {
  return (
    <a
      href={TELEGRAM_CTA_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-cta="telegram"
      aria-label="Watch the full video on Telegram"
      className={`tg-cta flex w-full items-center justify-center gap-2 rounded-xl bg-[#229ed9] px-4 py-2.5 text-[13.5px] font-extrabold tracking-wide text-white ring-1 ring-inset ring-white/15 transition hover:bg-[#28a9e6] active:scale-[0.99] ${className}`}
    >
      {/* Paper plane — lucide's generic Send icon stands in for the Telegram
          mark (lucide dropped brand glyphs); filled so it reads as a logo. */}
      <Send size={16} fill="currentColor" className="tg-cta-plane -rotate-6" aria-hidden="true" />
      <span className="tg-cta-label">Watch Full Video</span>
    </a>
  )
}
