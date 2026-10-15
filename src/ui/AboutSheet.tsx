/**
 * About: what this build actually is.
 *
 * Deliberately factual. Three things a user (or a reviewer) has a right to know are all
 * here rather than buried in a README:
 *
 *   - which avatar provider produced the head on screen, and what it did with the photo
 *   - the rig diagnostics: whether the model on screen really exposes the ARKit
 *     blendshapes this app drives, or whether channels are being approximated
 *   - the third-party licences, including the one that is unresolved
 */
import { Sheet } from './Sheet'
import { IconCheck, IconWarning } from './icons'
import { formatBytes } from '../lib/util'
import type { RigDiagnostics } from '../avatar/rig'
import type { AvatarSourceId } from '../avatar/types'

export interface AboutSheetProps {
  open: boolean
  onClose: () => void
  onOpenLegal: (doc: 'terms' | 'privacy') => void
  version: string
  provider: string | null
  source: AvatarSourceId
  bytes: number | null
  generationMs: number | null
  diagnostics: RigDiagnostics | null
  measuredFps: number
  tracker: { delegate: string | null; trackingFps: number; inferenceMs: number; status: string }
}

export function AboutSheet({
  open,
  onClose,
  onOpenLegal,
  version,
  provider,
  source,
  bytes,
  generationMs,
  diagnostics,
  measuredFps,
  tracker,
}: AboutSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="About this build" subtitle={`Faceverify ${version}`}>
      <Section title="The head on screen">
        <Row label="Source" value={SOURCE_LABEL[source]} />
        <Row label="Built by" value={provider ?? '—'} />
        <Row label="Asset size" value={bytes ? formatBytes(bytes) : '—'} />
        <Row label="Build time" value={generationMs ? `${(generationMs / 1000).toFixed(1)} s` : '—'} />
        <Row label="Render" value={measuredFps > 0 ? `${measuredFps} fps` : 'measuring…'} />
      </Section>

      <Section title="Rig coverage">
        {diagnostics ? (
          <>
            <Row label="Morph targets" value={String(diagnostics.morphTargetCount)} />
            <Row
              label="Channels mapped"
              value={`${diagnostics.mappedChannels} / 52 (${Math.round(diagnostics.coverage * 100)}%)`}
            />
            <Row label="Face mesh found" value={diagnostics.faceMeshFound ? 'yes' : 'no'} />
            <Row label="Head node found" value={diagnostics.headNodeFound ? 'yes' : 'no'} />
            <Row label="Separate eye nodes" value={String(diagnostics.eyeNodesFound)} />
          </>
        ) : (
          <p className="px-1 text-[12.5px] text-slate-500">The model is still loading.</p>
        )}
        <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-slate-500">
          ARKit names 52 facial channels. A model that exposes fewer is still animated, but the missing
          movements are folded into the nearest available channel, which is why a low-coverage rig can look
          slightly stiff around the mouth.
        </p>
      </Section>

      <Section title="Face tracking">
        <Row label="Status" value={tracker.status} />
        <Row label="Delegate" value={tracker.delegate ?? 'not started'} />
        <Row label="Tracker frame rate" value={tracker.trackingFps > 0 ? `${tracker.trackingFps.toFixed(0)} fps` : '—'} />
        <Row label="Inference" value={tracker.inferenceMs > 0 ? `${tracker.inferenceMs.toFixed(1)} ms/frame` : '—'} />
        <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-slate-500">
          Tracking runs through MediaPipe Face Landmarker, loaded from this site rather than a CDN, and every
          frame is processed in the browser. No camera frame is recorded or transmitted.
        </p>
      </Section>

      <Section title="Privacy in one line">
        <div className="flex items-start gap-2.5 rounded-2xl bg-emerald-50 px-3 py-2.5 ring-1 ring-emerald-200">
          <IconCheck className="mt-0.5 h-[18px] w-[18px] flex-none text-emerald-600" />
          <p className="text-[12.5px] leading-relaxed text-emerald-900">
            Photos and camera frames are processed with WebGL/WASM on this device. There is no upload, no
            account, and no analytics. Deleting your avatar removes it from this browser&apos;s storage.
          </p>
        </div>
      </Section>

      <Section title="Third-party licences">
        <Licence name="three.js" note="MIT — renderer, GLTF/DRACO/KTX2 loaders" />
        <Licence name="React, react-three-fiber, drei, zustand" note="MIT — UI and scene graph" />
        <Licence name="MediaPipe Tasks Vision" note="Apache-2.0 — face landmark model and WASM runtime" />
        <Licence name="Tailwind CSS, Vite, vite-plugin-pwa" note="MIT — build tooling" />
        <Licence name="Studio HDRI" note="Generated in-repo by scripts/gen-studio-env.mjs — no third-party rights" />
        <div className="flex items-start gap-2.5 rounded-2xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
          <IconWarning className="mt-0.5 h-[18px] w-[18px] flex-none text-amber-600" />
          <p className="text-[12px] leading-relaxed text-amber-900">
            The bundled base head (<span className="font-mono text-[11px]">facecap.glb</span>) is distributed
            with three.js as a sample asset and its author grants no explicit commercial licence. It is fine
            for evaluation; before shipping commercially, replace it with a licensed ARKit head. The loader
            takes any GLB that exposes the standard names, so this is a file swap, not a rewrite.
          </p>
        </div>
      </Section>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onOpenLegal('terms')}
          className="h-11 rounded-2xl bg-slate-50 text-[13px] font-semibold text-slate-700 ring-1 ring-slate-900/8"
        >
          Terms
        </button>
        <button
          type="button"
          onClick={() => onOpenLegal('privacy')}
          className="h-11 rounded-2xl bg-slate-50 text-[13px] font-semibold text-slate-700 ring-1 ring-slate-900/8"
        >
          Privacy
        </button>
      </div>
    </Sheet>
  )
}

const SOURCE_LABEL: Record<AvatarSourceId, string> = {
  sample: 'Bundled sample head',
  'local-fit': 'Your photo, fitted on-device',
  avaturn: 'Avaturn (hosted)',
  lam: 'GPU server (LAM)',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-1">
      <h3 className="mb-2 text-[11.5px] font-bold uppercase tracking-wider text-slate-400">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-900/6">
      <span className="text-[12.5px] text-slate-500">{label}</span>
      <span className="text-right text-[12.5px] font-medium text-slate-800">{value}</span>
    </div>
  )
}

function Licence({ name, note }: { name: string; note: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1 py-1">
      <span className="text-[12.5px] font-medium text-slate-700">{name}</span>
      <span className="text-right text-[11.5px] text-slate-400">{note}</span>
    </div>
  )
}
