/**
 * Settings.
 *
 * Grouped by the question the user is actually asking, not by where the code lives:
 * "it looks bad / it is slow", "the camera behaves oddly", "what do you have of mine".
 *
 * The quality control is a three-way choice plus an honest readout of the measured
 * frame rate, because a user on a low-end phone can see for themselves whether Lite
 * helped. Pinning a tier disables the adaptive watchdog — that is stated, since an
 * automatic system that silently overrides a manual choice is a bug in the user's eyes.
 */
import { useState } from 'react'
import { Sheet } from './Sheet'
import { IconInfo, IconTrash, IconWave, IconCheck } from './icons'
import { formatBytes } from '../lib/util'
import type { Prefs } from '../state/persistence'
import type { QualityTier } from '../render/quality'

export interface SettingsSheetProps {
  open: boolean
  onClose: () => void
  prefs: Prefs
  onChange: (patch: Partial<Prefs>) => void
  onOpenAbout: () => void
  onOpenLegal: (doc: 'terms' | 'privacy') => void
  onDeleteAvatar: () => void
  onRecalibrate: () => void
  hasCalibration: boolean
  measuredFps: number
  storage: { usage: number; quota: number } | null
  canRecord: boolean
  /** True when the browser has offered an install prompt (Chromium only). */
  canInstall: boolean
  onInstall: () => void
}

const TIERS: { id: QualityTier; label: string; note: string }[] = [
  { id: 'lite', label: 'Lite', note: 'No shadows, 1× pixels, CPU tracker' },
  { id: 'balanced', label: 'Balanced', note: 'Default: shadows, 1.5× pixels' },
  { id: 'high', label: 'High', note: 'Full detail, 2× pixels, antialiased' },
]

export function SettingsSheet({
  open,
  onClose,
  prefs,
  onChange,
  onOpenAbout,
  onOpenLegal,
  onDeleteAvatar,
  onRecalibrate,
  hasCalibration,
  measuredFps,
  storage,
  canRecord,
  canInstall,
  onInstall,
}: SettingsSheetProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const activeTier: QualityTier = prefs.lite ? 'lite' : prefs.qualityTier

  return (
    <Sheet open={open} onClose={onClose} title="Settings" subtitle="Everything runs on this device.">
      {/* --- quality ------------------------------------------------------- */}
      <Section title="Quality">
        <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-slate-100 p-1.5">
          {TIERS.map((tier) => {
            const active = tier.id === activeTier
            return (
              <button
                key={tier.id}
                type="button"
                onClick={() =>
                  onChange({ lite: tier.id === 'lite', qualityTier: tier.id, qualityPinned: true })
                }
                className={[
                  'flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 transition-all',
                  active ? 'bg-white shadow-[0_1px_4px_rgba(15,23,42,0.16)]' : 'opacity-70',
                ].join(' ')}
              >
                <span className={['text-[13px] font-semibold', active ? 'text-slate-900' : 'text-slate-600'].join(' ')}>
                  {tier.label}
                </span>
                <span className="text-center text-[9.5px] leading-tight text-slate-400">{tier.note}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 px-1">
          <p className="text-[11.5px] text-slate-400">
            {prefs.qualityPinned ? 'Pinned — the app will not change it.' : 'Adaptive — adjusts if frames drop.'}
            {measuredFps > 0 ? ` Currently ${measuredFps} fps.` : ''}
          </p>
          {prefs.qualityPinned ? (
            <button
              type="button"
              onClick={() => onChange({ qualityPinned: false, lite: false })}
              className="flex-none rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-slate-500 ring-1 ring-slate-900/8"
            >
              Auto
            </button>
          ) : null}
        </div>
        {prefs.lite ? (
          <p className="mt-1.5 px-1 text-[11.5px] leading-relaxed text-amber-600">
            Lite is on: the face tracker uses the CPU so the GPU is free for rendering, and textures are
            generated at 512px. Best for older or cheaper phones.
          </p>
        ) : null}
      </Section>

      {/* --- camera & tracking --------------------------------------------- */}
      <Section title="Camera & tracking">
        <Toggle
          label="Mirror my movements"
          hint="The avatar moves like a mirror, rather than like a person facing you."
          checked={prefs.mirror}
          onChange={(mirror) => onChange({ mirror })}
        />
        <Toggle
          label="Control eyes separately"
          hint="Adds a second gaze handle to the eye pad in Manual mode."
          checked={prefs.splitEyes}
          onChange={(splitEyes) => onChange({ splitEyes })}
        />
        <button
          type="button"
          onClick={onRecalibrate}
          className="mt-1 flex w-full items-center justify-between rounded-2xl bg-slate-50 px-3 py-3 text-left ring-1 ring-slate-900/8 active:scale-[0.99]"
        >
          <span className="flex items-center gap-2.5">
            <IconWave className="h-5 w-5 text-slate-400" />
            <span>
              <span className="block text-[13.5px] font-medium text-slate-800">Recalibrate neutral</span>
              <span className="block text-[11.5px] text-slate-500">
                {hasCalibration ? 'Saved. Recalibrate after moving your camera or chair.' : 'Look straight at the camera for one second.'}
              </span>
            </span>
          </span>
          <span className="text-[12px] font-semibold text-slate-400">Calibrate</span>
        </button>
      </Section>

      {/* --- recording ------------------------------------------------------ */}
      <Section title="Recording">
        <Toggle
          label="Include my microphone"
          hint={canRecord ? 'Off by default: silent clips export more reliably.' : 'Recording is unavailable in this browser.'}
          checked={prefs.recordAudio}
          disabled={!canRecord}
          onChange={(recordAudio) => onChange({ recordAudio })}
        />
        <Toggle
          label="Watermark clips"
          hint="Bakes a small “Faceverify” mark into recorded video. Turn it off for clean output."
          checked={prefs.watermark}
          onChange={(watermark) => onChange({ watermark })}
        />
      </Section>

      {/* --- data ------------------------------------------------------------ */}
      <Section title="Your data">
        <div className="rounded-2xl bg-slate-50 px-3 py-3 ring-1 ring-slate-900/8">
          <p className="text-[13px] font-medium text-slate-800">Stored on this device</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
            Your avatar and its face texture live in this browser&apos;s IndexedDB.
            {storage ? ` About ${formatBytes(storage.usage)} of a ${formatBytes(storage.quota)} allowance.` : ''}{' '}
            Nothing is uploaded, and there is no account.
          </p>

          {confirmingDelete ? (
            <div className="mt-2.5 rounded-xl bg-rose-50 px-3 py-2.5 ring-1 ring-rose-200">
              <p className="text-[12.5px] font-medium text-rose-900">
                Delete your avatar and all local data? This cannot be undone.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onDeleteAvatar()
                    setConfirmingDelete(false)
                  }}
                  className="h-9 flex-1 rounded-xl bg-rose-600 text-[13px] font-semibold text-white active:scale-[0.98]"
                >
                  Delete everything
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="h-9 flex-1 rounded-xl bg-white text-[13px] font-semibold text-slate-600 ring-1 ring-slate-900/8 active:scale-[0.98]"
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="mt-2.5 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-white text-[13px] font-semibold text-rose-600 ring-1 ring-rose-200 active:scale-[0.98]"
            >
              <IconTrash className="h-[18px] w-[18px]" />
              Delete my avatar
            </button>
          )}
        </div>
      </Section>

      {/* --- about & legal ---------------------------------------------------- */}
      <Section title="About">
        <button
          type="button"
          onClick={onOpenAbout}
          className="flex w-full items-center justify-between rounded-2xl bg-slate-50 px-3 py-3 text-left ring-1 ring-slate-900/8 active:scale-[0.99]"
        >
          <span className="flex items-center gap-2.5">
            <IconInfo className="h-5 w-5 text-slate-400" />
            <span className="text-[13.5px] font-medium text-slate-800">What is running, and licences</span>
          </span>
          <span className="text-slate-300">›</span>
        </button>
        {canInstall ? (
          <button
            type="button"
            onClick={onInstall}
            className="flex w-full items-center justify-between rounded-2xl bg-slate-900 px-3 py-3 text-left active:scale-[0.99]"
          >
            <span className="text-[13.5px] font-semibold text-white">Install Faceverify</span>
            <span className="text-[11.5px] text-white/60">Home screen, full screen, offline</span>
          </button>
        ) : null}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onOpenLegal('terms')}
            className="h-11 rounded-2xl bg-slate-50 text-[13px] font-semibold text-slate-700 ring-1 ring-slate-900/8 active:scale-[0.98]"
          >
            Terms of use
          </button>
          <button
            type="button"
            onClick={() => onOpenLegal('privacy')}
            className="h-11 rounded-2xl bg-slate-50 text-[13px] font-semibold text-slate-700 ring-1 ring-slate-900/8 active:scale-[0.98]"
          >
            Privacy
          </button>
        </div>
      </Section>
    </Sheet>
  )
}

/* -------------------------------------------------------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-1">
      <h3 className="mb-2 text-[11.5px] font-bold uppercase tracking-wider text-slate-400">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

interface ToggleProps {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

function Toggle({ label, hint, checked, disabled, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-3 text-left ring-1 ring-slate-900/8 transition-colors active:scale-[0.99] disabled:opacity-50"
    >
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-slate-800">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500">{hint}</span> : null}
      </span>
      <span
        className={[
          'flex h-6 w-10 flex-none items-center rounded-full px-0.5 transition-colors',
          checked ? 'bg-emerald-500' : 'bg-slate-300',
        ].join(' ')}
      >
        <span
          className={[
            'flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-4' : 'translate-x-0',
          ].join(' ')}
        >
          {checked ? <IconCheck className="h-3 w-3 text-emerald-600" /> : null}
        </span>
      </span>
    </button>
  )
}
