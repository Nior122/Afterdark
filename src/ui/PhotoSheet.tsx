/**
 * Photo mode: upload, validate, generate.
 *
 * The flow is deliberately linear and explicit, because the one thing this screen must
 * never do is surprise someone about where their face is going:
 *
 *   1. pick a file (accept="image/*", no camera capture attribute — the file picker on
 *      Android offers the camera anyway, and forcing `capture` blocks the gallery)
 *   2. cheap local checks (type, size, decodability) before anything expensive runs
 *   3. show the provider list with its privacy and cost, and the consent line
 *   4. generate, with real progress
 *
 * Providers are listed rather than chosen for the user: only "On-device fit" ships
 * enabled, and it says so in plain words ("Nothing is uploaded"). Avaturn appears only
 * when it has been configured, and its disclosure is shown before its iframe opens.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sheet } from './Sheet'
import { IconCheck, IconUpload, IconWarning } from './icons'
import { showToast } from './Toast'
import { getProviders, DEFAULT_PROVIDER_ID } from '../avatar/providerRegistry'
import type { AvatarProvider, ProviderAvailability } from '../avatar/types'
import { validatePhotoFile } from '../features/photo/validatePhoto'
import { getTierSettings } from '../render/quality'
import { AppError, devWarn, haptic } from '../lib/util'
import { saveAvatarAsset, type Prefs } from '../state/persistence'
import { useApp } from '../state/store'

export interface PhotoSheetProps {
  open: boolean
  onClose: () => void
  prefs: Prefs
}

interface PickedPhoto {
  file: File
  bitmap: ImageBitmap
  url: string
}

export function PhotoSheet({ open, onClose, prefs }: PhotoSheetProps) {
  const qualityTier = useApp((s) => s.qualityTier)
  const setAvatarAsset = useApp((s) => s.setAvatarAsset)
  const beginGeneration = useApp((s) => s.beginGeneration)
  const reportProgress = useApp((s) => s.reportProgress)
  const failGeneration = useApp((s) => s.failGeneration)
  const avatar = useApp((s) => s.avatar)

  const [photo, setPhoto] = useState<PickedPhoto | null>(null)
  const [providerId, setProviderId] = useState<string>(DEFAULT_PROVIDER_ID)
  const [consented, setConsented] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [availability, setAvailability] = useState<Record<string, ProviderAvailability>>({})
  const abortRef = useRef<AbortController | null>(null)

  const providers = useMemo(
    // Texture size follows quality, so Lite spends less time rasterising the projection.
    () => getProviders(getTierSettings(qualityTier).textureSize).all,
    [qualityTier],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const entries = await Promise.all(
        providers.map(async (p) => [p.id, (await p.availability?.()) ?? { ready: true as const }] as const),
      )
      if (!cancelled) setAvailability(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
    }
  }, [providers])

  // Object URLs and ImageBitmaps are not garbage-collected on unmount by themselves.
  useEffect(() => {
    return () => {
      setPhoto((current) => {
        if (current) {
          URL.revokeObjectURL(current.url)
          current.bitmap.close()
        }
        return null
      })
      abortRef.current?.abort()
    }
  }, [])

  const selected = providers.find((p) => p.id === providerId) ?? providers[0]
  const selectedAvailability = selected ? availability[selected.id] : undefined
  const unavailable = selectedAvailability ? !selectedAvailability.ready : false
  const uploading = selected?.privacy === 'uploads-photo'
  const busy = avatar.generating

  const onPick = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset the input so re-picking the same file still fires a change event.
    event.target.value = ''
    if (!file) return

    setFileError(null)
    const fileCheck = validatePhotoFile(file)
    if (!fileCheck.ok) {
      setFileError(fileCheck.message)
      haptic([10, 50, 10])
      return
    }

    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      setPhoto((current) => {
        if (current) {
          URL.revokeObjectURL(current.url)
          current.bitmap.close()
        }
        return { file, bitmap, url: URL.createObjectURL(file) }
      })
      haptic(8)
    } catch (err) {
      devWarn('image decode failed', err)
      setFileError('That image could not be decoded. Try a JPEG or PNG straight from your camera.')
    }
  }, [])

  const generate = useCallback(async () => {
    if (!photo || !selected) return
    if (selected.id === providerId && selected.privacy === 'on-device') haptic(10)

    const controller = new AbortController()
    abortRef.current = controller
    beginGeneration(selected.id)

    const started = performance.now()
    try {
      const asset = await selected.generate({
        photo: photo.bitmap,
        file: photo.file,
        signal: controller.signal,
        onProgress: reportProgress,
      })
      // Persist before swapping the scene: a reload mid-generation then still has an
      // avatar, and the "delete my avatar" button has something real to delete.
      await saveAvatarAsset(asset)
      setAvatarAsset(asset)
      showToast(`Avatar ready in ${((performance.now() - started) / 1000).toFixed(1)} s`, {
        tone: 'success',
        hint: 'Built on your device. Nothing was uploaded.',
      })
      onClose()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        failGeneration('Generation cancelled.')
        return
      }
      const message = err instanceof AppError ? err.message : 'That photo could not be turned into an avatar.'
      const hint =
        err instanceof AppError
          ? err.hint
          : 'Try a clear, well-lit photo of one face, taken straight on.'
      devWarn('generation failed', err)
      failGeneration(message, hint)
      haptic([12, 60, 12])
    } finally {
      abortRef.current = null
    }
  }, [photo, selected, providerId, beginGeneration, reportProgress, setAvatarAsset, failGeneration, onClose])

  const canGenerate = Boolean(photo) && consented && !unavailable && !busy

  return (
    <Sheet
      open={open}
      onClose={onClose}
      locked={busy}
      title="Make an avatar from a photo"
      subtitle="Your photo is turned into a 3D head entirely in this browser."
    >
      {/* --- the photo ------------------------------------------------------- */}
      {photo ? (
        <div className="relative overflow-hidden rounded-2xl bg-slate-900">
          <img src={photo.url} alt="Your photo" className="max-h-[30dvh] w-full object-contain" />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              URL.revokeObjectURL(photo.url)
              photo.bitmap.close()
              setPhoto(null)
            }}
            className="absolute bottom-2 right-2 rounded-full bg-black/60 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur disabled:opacity-50"
          >
            Choose another
          </button>
        </div>
      ) : (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition-colors hover:bg-slate-100">
          <IconUpload className="h-7 w-7 text-slate-400" />
          <span className="text-[14px] font-semibold text-slate-800">Choose a photo</span>
          <span className="max-w-[280px] text-[12px] leading-relaxed text-slate-500">
            Front-facing, one face, good light, no sunglasses. A phone selfie works best.
          </span>
          <input type="file" accept="image/*" className="hidden" onChange={onPick} disabled={busy} />
        </label>
      )}

      {fileError ? (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900 ring-1 ring-amber-200">
          <IconWarning className="mt-0.5 h-4 w-4 flex-none" />
          <span>{fileError}</span>
        </div>
      ) : null}

      {/* --- consent --------------------------------------------------------- */}
      <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-2xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-900/8">
        <input
          type="checkbox"
          checked={consented}
          disabled={busy}
          onChange={(e) => setConsented(e.target.checked)}
          className="mt-0.5 h-[18px] w-[18px] flex-none accent-slate-900"
        />
        <span className="text-[12.5px] leading-relaxed text-slate-600">
          Only upload your own photo or one you have permission to use.
        </span>
      </label>

      {/* --- provider picker ------------------------------------------------- */}
      <h3 className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-wider text-slate-400">Where it is processed</h3>
      <div className="space-y-2">
        {providers.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            selected={provider.id === providerId}
            availability={availability[provider.id]}
            disabled={busy}
            onSelect={() => setProviderId(provider.id)}
          />
        ))}
      </div>

      {/* Health warning for the one provider that uploads. */}
      {uploading && selected?.disclosure ? (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-rose-50 px-3 py-2.5 text-[12px] leading-relaxed text-rose-900 ring-1 ring-rose-200">
          <IconWarning className="mt-0.5 h-4 w-4 flex-none" />
          <span>{selected.disclosure}</span>
        </div>
      ) : null}

      {/* --- progress -------------------------------------------------------- */}
      {busy ? (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent-400 to-violet-500 transition-[width] duration-300"
              style={{ width: `${Math.round(Math.max(0.04, avatar.progress) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-center text-[12.5px] text-slate-500">
            {avatar.report?.message ?? 'Starting…'}
          </p>
        </div>
      ) : null}

      {avatar.error ? (
        <div className="mt-3 rounded-2xl bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-900 ring-1 ring-rose-200">
          <p className="font-semibold">{avatar.error.message}</p>
          {avatar.error.hint ? <p className="mt-0.5 opacity-80">{avatar.error.hint}</p> : null}
        </div>
      ) : null}

      {/* --- actions --------------------------------------------------------- */}
      <button
        type="button"
        disabled={!canGenerate}
        onClick={() => void generate()}
        className="mt-4 h-[52px] w-full rounded-2xl bg-slate-900 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] disabled:bg-slate-300 disabled:text-slate-500"
      >
        {busy ? 'Building your avatar…' : 'Create my avatar'}
      </button>

      {prefs.lite ? (
        <p className="mt-2 text-center text-[11px] text-slate-400">
          Lite quality is on, so the face texture is generated at a lower resolution.
        </p>
      ) : null}

      <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400">
        Photo mode is a photo on a 3D head: it matches the shape of the bundled base head and paints your
        face onto it. Hair, jawline and profile come from the base model, not from your photo.
      </p>
    </Sheet>
  )
}

/* -------------------------------------------------------------------------- */

interface ProviderRowProps {
  provider: AvatarProvider
  selected: boolean
  availability: ProviderAvailability | undefined
  disabled: boolean
  onSelect: () => void
}

const COST_LABEL: Record<string, string> = {
  free: 'Free',
  'free-tier': 'Free tier',
  paid: 'Paid',
  'self-hosted': 'Self-hosted',
}

function ProviderRow({ provider, selected, availability, disabled, onSelect }: ProviderRowProps) {
  const unavailable = availability ? !availability.ready : false
  return (
    <button
      type="button"
      disabled={disabled || unavailable}
      onClick={onSelect}
      className={[
        'flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors',
        selected ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-900 ring-1 ring-slate-900/8',
        unavailable ? 'opacity-55' : '',
      ].join(' ')}
    >
      <span
        className={[
          'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full',
          selected ? 'bg-white text-slate-900' : 'ring-1 ring-slate-300',
        ].join(' ')}
      >
        {selected ? <IconCheck className="h-3.5 w-3.5" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-semibold">{provider.label}</span>
          <span
            className={[
              'rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
              selected ? 'bg-white/15 text-white/80' : 'bg-slate-200/80 text-slate-600',
            ].join(' ')}
          >
            {COST_LABEL[provider.cost] ?? provider.cost}
          </span>
        </span>
        <span className={['mt-0.5 block text-[12px] leading-relaxed', selected ? 'text-white/70' : 'text-slate-500'].join(' ')}>
          {provider.summary}
        </span>
        {unavailable && availability && !availability.ready ? (
          <span className="mt-1 block text-[11.5px] font-medium text-amber-500">{availability.reason}</span>
        ) : null}
      </span>
    </button>
  )
}
