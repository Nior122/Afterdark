import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import BrandLogo from './BrandLogo'
import ThemeToggle from './ThemeToggle'
import { useAgeVerification } from '../lib/age'

/**
 * Interstitial that covers the whole site until the visitor confirms they are
 * 18+. The gated tree is not rendered at all until then, so nothing from the
 * catalogue (titles, thumbnails, the header) is mounted behind the gate.
 */
export default function AgeGate({ children }: { children: ReactNode }) {
  const { accepted, accept } = useAgeVerification()
  const [declined, setDeclined] = useState(false)
  const enterRef = useRef<HTMLButtonElement>(null)

  // Keep the page behind the gate from scrolling.
  useEffect(() => {
    if (accepted) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [accepted])

  useEffect(() => {
    if (!accepted) enterRef.current?.focus()
  }, [accepted, declined])

  if (accepted) return <>{children}</>

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="age-title"
        aria-describedby="age-desc"
        className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] dark:bg-panel"
      >
        <div className="flex flex-col items-center border-b border-line bg-panel px-6 pb-5 pt-6 text-center">
          <div className="mb-2 grid w-full place-items-end">
            <ThemeToggle compact />
          </div>
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-100 text-brand-600">
            <ShieldCheck size={24} strokeWidth={1.9} />
          </span>
          <div className="mt-4">
            <BrandLogo />
          </div>
        </div>

        <div className="px-6 py-6 text-center">
          <h1 id="age-title" className="text-[19px] font-bold tracking-[-0.01em] text-ink">
            {declined ? 'You must be 18 or older' : 'Adult content — 18+ only'}
          </h1>
          <p id="age-desc" className="mt-2 text-[13.5px] leading-relaxed text-muted">
            {declined ? (
              'This site links to explicit material and cannot be shown to anyone under 18. Go back and try again when that does not apply.'
            ) : (
              <>
                This catalogue contains explicit adult material and links to third-party sites. Confirm you are
                at least 18 years old, and old enough where you live, to enter.
              </>
            )}
          </p>

          {declined ? (
            <div className="mt-6 flex flex-col gap-2">
              <a
                href="https://www.google.com"
                className="flex h-11 items-center justify-center rounded-full bg-action text-[14px] font-semibold text-on-action transition hover:opacity-90"
              >
                Leave this site
              </a>
              <button
                type="button"
                onClick={() => setDeclined(false)}
                className="h-11 rounded-full text-[13px] font-semibold text-muted transition hover:bg-raise hover:text-ink"
              >
                Go back
              </button>
            </div>
          ) : (
            <div className="mt-6 flex flex-col gap-2">
              <button
                ref={enterRef}
                type="button"
                onClick={() => {
                  setDeclined(false)
                  accept()
                }}
                className="h-11 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-5 text-[14px] font-semibold text-white shadow-[0_8px_22px_-10px_rgba(225,29,72,0.9)] transition hover:brightness-105 active:scale-[0.99]"
              >
                I am 18 or older — Enter
              </button>
              <button
                type="button"
                onClick={() => setDeclined(true)}
                className="h-10 rounded-full text-[13px] font-semibold text-muted transition hover:bg-raise hover:text-ink"
              >
                I am under 18
              </button>
            </div>
          )}

          <p className="mt-5 text-[11.5px] leading-relaxed text-faint">
            Your answer is stored in this browser only — no account, no sign-up, nothing sent to a server.
            Clearing site data asks again.
          </p>
        </div>
      </div>
    </div>
  )
}
