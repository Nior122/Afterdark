/**
 * Terms and Privacy, as real pages.
 *
 * They are routes (`#/terms`, `#/privacy`) rather than sheets so they can be linked to,
 * opened in a new tab, printed, or read by a store reviewer — a modal that vanishes when
 * you scroll the wrong way is not a legal page.
 *
 * Written in plain English and kept deliberately specific to what this build does. A
 * developer shipping this for real should have them reviewed; the file says so, because
 * silently implying legal review would be worse than saying nothing.
 */
import { useEffect } from 'react'

export type LegalDoc = 'terms' | 'privacy'

export function isLegalRoute(hash: string): LegalDoc | null {
  const clean = hash.replace(/^#\/?/, '').toLowerCase()
  if (clean === 'terms') return 'terms'
  if (clean === 'privacy') return 'privacy'
  return null
}

export interface LegalPageProps {
  doc: LegalDoc
  onBack: () => void
}

export function LegalPage({ doc, onBack }: LegalPageProps) {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [doc])

  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-white text-slate-800">
      <div className="mx-auto max-w-[680px] px-5 pb-24 pt-safe">
        <div className="flex items-center justify-between gap-3 py-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 items-center gap-1.5 rounded-full bg-slate-100 px-3.5 text-[13px] font-semibold text-slate-700 active:scale-95"
          >
            ← Back to Faceverify
          </button>
          <div className="flex gap-1.5">
            <NavLink href="#/terms" active={doc === 'terms'}>
              Terms
            </NavLink>
            <NavLink href="#/privacy" active={doc === 'privacy'}>
              Privacy
            </NavLink>
          </div>
        </div>

        {doc === 'terms' ? <Terms /> : <Privacy />}

        <p className="mt-10 rounded-2xl bg-slate-50 px-4 py-3 text-[12px] leading-relaxed text-slate-500 ring-1 ring-slate-900/6">
          This document is written to match exactly what this build of Faceverify does. It is not legal advice.
          If you deploy this app commercially, have these terms reviewed for your jurisdiction and add your
          entity name, address and contact details.
        </p>
      </div>
    </div>
  )
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={[
        'flex h-10 items-center rounded-full px-3.5 text-[13px] font-semibold',
        active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600',
      ].join(' ')}
    >
      {children}
    </a>
  )
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 text-[16px] font-semibold text-slate-900">{children}</h2>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-2.5 text-[13.5px] leading-relaxed text-slate-600">{children}</p>
}

function UL({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mt-2.5 space-y-1.5 pl-4">
      {items.map((item, index) => (
        <li key={index} className="list-disc text-[13.5px] leading-relaxed text-slate-600">
          {item}
        </li>
      ))}
    </ul>
  )
}

function Terms() {
  return (
    <article>
      <h1 className="mt-4 text-[24px] font-bold tracking-tight text-slate-900">Terms of Use</h1>
      <P>Last updated: 15 October 2026.</P>

      <H>1. What Faceverify is</H>
      <P>
        Faceverify turns a photograph of your face into an animated 3D head, and can drive that head with your
        camera. It runs in your browser. It is provided as-is, without warranty, and it is not a verification,
        identity, security or authentication product — the name is a name, not a claim.
      </P>

      <H>2. Your photo, your responsibility</H>
      <P>
        You may only upload a photo of yourself, or a photo you have permission to use. Uploading someone
        else&apos;s face to build a convincing animated likeness of them can cause real harm, and it may be
        unlawful where you live. You agree not to use this app to create a likeness of any person who has not
        consented, and not to use it to deceive, harass or impersonate anyone.
      </P>

      <H>3. Content you create</H>
      <P>
        You keep the rights you hold in your photo and in the clips you record. We claim nothing over them.
        Because processing happens on your device, we never receive them.
      </P>

      <H>4. Age</H>
      <P>
        Faceverify is not intended for children. If you are under 18, do not use it without a parent or
        guardian, and never upload a photo of someone else&apos;s child.
      </P>

      <H>5. Acceptable use</H>
      <P>You agree not to use Faceverify to:</P>
      <UL
        items={[
          'create sexual, abusive or degrading imagery of any real person;',
          'impersonate anyone, or create material that a reasonable person would mistake for a real recording of them;',
          'break the law in your jurisdiction, including laws on defamation, privacy and data protection;',
          'attack the service, or use it in a way that would harm other users.',
        ]}
      />

      <H>6. Third-party services</H>
      <P>
        Photo generation can run through a provider of your choosing. The default provider runs entirely on
        your device and sends nothing anywhere. Any provider that requires uploading your photo is labelled as
        such, with its cost, before it is used — and it is only used if you select it.
      </P>

      <H>7. Availability and changes</H>
      <P>
        Features may change or stop working; some depend on your browser&apos;s WebGL support, on camera
        permissions, and on model assets that may be removed. Nothing here creates a service level commitment.
      </P>

      <H>8. Limitation of liability</H>
      <P>
        To the extent permitted by law, we are not liable for indirect or consequential losses arising from
        your use of the app. Nothing in these terms limits rights you have under Nigerian law, including the
        Nigeria Data Protection Act 2023, that cannot be limited by agreement.
      </P>

      <H>9. Changes to these terms</H>
      <P>
        Continued use after a change to these terms means you accept the change. The date at the top of this
        page always reflects the current version.
      </P>
    </article>
  )
}

function Privacy() {
  return (
    <article>
      <h1 className="mt-4 text-[24px] font-bold tracking-tight text-slate-900">Privacy Policy</h1>
      <P>Last updated: 15 October 2026. Written to match what the code actually does.</P>

      <H>The short version</H>
      <UL
        items={[
          'Your photo and camera frames are processed inside your browser. They are not uploaded.',
          'There is no account, no sign-in, no analytics, and no advertising.',
          'Your avatar is stored in this browser only, and you can delete it at any time.',
          'If you choose a provider that uploads your photo, you are told before it happens, and the choice is yours.',
        ]}
      />

      <H>What is processed, and where</H>
      <UL
        items={[
          'Face detection and tracking: MediaPipe Face Landmarker, running as WebAssembly on your device, using files served from this same website (no CDN, no third-party request).',
          '3D rendering: your device\u2019s GPU, through WebGL.',
          'Photo-to-avatar fitting: your device, by default. This is labelled “On-device fit”.',
        ]}
      />

      <H>What is stored on your device</H>
      <UL
        items={[
          'Your settings, in IndexedDB.',
          'Your generated avatar — the 3D file and the face texture derived from your photo — in IndexedDB, so it survives a reload without being regenerated.',
          'Model and app files, in your browser\u2019s cache, so the app starts without re-downloading. Offline, these are the only things available.',
        ]}
      />

      <H>What is never collected</H>
      <P>
        No name, email, phone number, location, device identifier or usage history is collected by this app.
        Camera frames are used for tracking and are discarded immediately afterwards; they are never recorded
        unless you press Record, and a recording becomes a file on your device for you to download or share
        yourself.
      </P>

      <H>Deleting your data</H>
      <P>
        Settings → Your data → “Delete my avatar” clears your avatar, its texture, your preferences, and the
        cached model files from this browser. Recording clips live in the page only and disappear when the tab
        closes. Because nothing is stored anywhere else, there is nothing else to delete, and no request to
        make.
      </P>

      <H>If you choose an uploading provider</H>
      <P>
        A provider that uploads your photo is presented with its privacy class, its cost, and a plain-language
        disclosure, and it cannot be used without selecting it. Where such a provider is used, the photo is
        transmitted to that company&apos;s servers and is governed by their privacy policy, not this one. The
        default build of Faceverify enables no such provider.
      </P>

      <H>Your rights</H>
      <P>
        Under the Nigeria Data Protection Act 2023 you have rights of access, correction, erasure and objection
        over personal data about you. Since this app holds no personal data about you on any server, those
        rights are exercised directly: delete the local data with the button above, and nothing remains.
      </P>

      <H>Children</H>
      <P>Faceverify is not directed at children and does not knowingly process their images.</P>
    </article>
  )
}
