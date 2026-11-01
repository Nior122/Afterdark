/**
 * WhatsApp call-to-action, deliberately the twin of TelegramCta: page-level,
 * rendered immediately below the Telegram button on every *opened* video —
 * watch page in public mode, standalone /v/ page in direct mode — so it
 * covers existing and future videos with no per-video data.
 *
 * The link is one constant and the play gate (see PlayGate) opens the exact
 * same URL, so "change the funnel" is a one-line edit and rebuild.
 * `data-cta="whatsapp"` marks it as an intentional outbound link for the
 * anchor invariants (only site-navigation anchors are forbidden on the
 * standalone pages). Rendered after TelegramCta, so first-match CTA probes
 * keep pointing at the Telegram button.
 */
export const WHATSAPP_CTA_URL =
  'https://downconvenientmagnetic.com/gnzgnq4tuu?key=65f2307646f602430f34834500ac67c9'

export default function WhatsAppCta({ className = '' }: { className?: string }) {
  return (
    <a
      href={WHATSAPP_CTA_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-cta="whatsapp"
      aria-label="Text on WhatsApp"
      className={`flex w-full items-center justify-center gap-2 rounded-xl bg-[#25d366] px-4 py-2.5 text-[13.5px] font-extrabold tracking-wide text-white ring-1 ring-inset ring-white/15 transition hover:bg-[#2ad871] active:scale-[0.99] ${className}`}
    >
      {/* Filled chat bubble — lucide dropped brand glyphs; the bubble on
          WhatsApp green reads as the mark at this size. */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 1.67c2.2 0 4.27.86 5.83 2.42a8.2 8.2 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.25 8.24a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24Zm-4.5 4.5c-.21 0-.55.08-.84.39-.29.32-1.1 1.08-1.1 2.63s1.13 3.06 1.29 3.27c.16.21 2.22 3.52 5.49 4.8.77.3 1.37.48 1.84.62.77.24 1.48.21 2.03.13.62-.09 1.9-.78 2.17-1.53.27-.75.27-1.39.19-1.53-.08-.13-.29-.21-.61-.37-.32-.16-1.9-.94-2.19-1.04-.29-.11-.51-.16-.72.16-.21.32-.83 1.04-1.01 1.25-.19.21-.37.24-.69.08-.32-.16-1.36-.5-2.58-1.59-.95-.85-1.6-1.9-1.78-2.22-.19-.32-.02-.49.14-.65.14-.14.32-.37.48-.56.16-.19.21-.32.32-.53.1-.21.05-.4-.03-.56-.08-.16-.72-1.74-.99-2.38-.26-.62-.52-.54-.72-.55l-.61-.01Z" />
      </svg>
      <span>Text WhatsApp</span>
    </a>
  )
}
