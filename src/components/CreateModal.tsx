import { asset } from '../lib/asset'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Film, Image as ImageIcon, Link2, Loader2, Plus, X } from 'lucide-react'
import { AVATARS, CATEGORIES } from '../data/seed'
import { useEscape } from '../lib/hooks'
import { useStore } from '../lib/store'
import { guessThumbnail, parseDuration, resolveSource } from '../lib/video'

interface CreateModalProps {
  open: boolean
  onClose: () => void
}

const CATEGORY_OPTIONS = CATEGORIES.filter((category) => category !== 'All')

export default function CreateModal({ open, onClose }: CreateModalProps) {
  const { addVideo } = useStore()
  const navigate = useNavigate()

  const [videoUrl, setVideoUrl] = useState('')
  const [title, setTitle] = useState('')
  const [thumbnail, setThumbnail] = useState('')
  const [duration, setDuration] = useState('')
  const [category, setCategory] = useState<string>('Tech')
  const [error, setError] = useState('')
  const [fetching, setFetching] = useState(false)

  const source = useMemo(() => resolveSource(videoUrl), [videoUrl])
  const previewThumb = thumbnail.trim() || source.poster || guessThumbnail(videoUrl) || asset('/thumbnails/placeholder.svg')

  useEscape(onClose, open)

  useEffect(() => {
    if (!open) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setVideoUrl('')
      setTitle('')
      setThumbnail('')
      setDuration('')
      setCategory('Tech')
      setError('')
    }
  }, [open])

  /** Best-effort title autofill for YouTube links (no key, no storage). */
  async function lookupMetadata() {
    const raw = videoUrl.trim()
    if (!raw || title) return
    if (source.kind !== 'youtube') return
    setFetching(true)
    try {
      const response = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(raw)}`)
      const data = (await response.json()) as { title?: string }
      if (data.title) setTitle(data.title)
    } catch {
      /* offline or blocked — the user can type the title */
    } finally {
      setFetching(false)
    }
  }

  if (!open) return null

  function submit(event: FormEvent) {
    event.preventDefault()
    const rawUrl = videoUrl.trim()

    if (!rawUrl) {
      setError('Paste a video link to continue.')
      return
    }
    let valid = false
    try {
      const parsed = new URL(rawUrl)
      valid = parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      valid = false
    }
    if (!valid) {
      setError('That does not look like a valid URL. It should start with http:// or https://')
      return
    }
    if (!title.trim()) {
      setError('Give your video a title.')
      return
    }

    const created = addVideo({
      title,
      videoUrl: rawUrl,
      channelId: 'you',
      category,
      duration: parseDuration(duration) ?? duration.trim() ?? '',
      thumbnail: previewThumb,
    })

    onClose()
    navigate(`/watch/${created.id}`)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-6">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close dialog" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-title"
        className="relative z-10 max-h-[92vh] w-full max-w-[600px] overflow-y-auto rounded-t-2xl bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-brand-700">
              <Plus size={19} strokeWidth={2.4} />
            </span>
            <div>
              <h2 id="create-title" className="text-[17px] font-bold tracking-[-0.01em]">
                Add a video
              </h2>
              <p className="text-[12.5px] text-muted">Paste a link — no upload or storage needed.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-[#f2f2f4] hover:text-ink"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="px-5 pb-6 pt-5 sm:px-6">
          <div className="flex gap-3 rounded-xl border border-line bg-[#fafafb] p-3">
            <div className="relative aspect-video w-[132px] shrink-0 overflow-hidden rounded-lg bg-[#ededf0]">
              <img src={previewThumb} alt="" className="h-full w-full object-cover" />
              {duration && (
                <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-[2px] text-[10px] font-semibold text-white">
                  {parseDuration(duration) ?? duration}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1 py-0.5">
              <p className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-ink">
                {title.trim() || 'Your video title appears here'}
              </p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <img src={AVATARS.user} alt="" className="h-5 w-5 rounded-full object-cover" />
                <span className="text-[12px] text-muted">You</span>
              </div>
              <p className="mt-1.5 text-[11.5px] font-medium text-brand-600">
                {source.kind === 'youtube'
                  ? 'YouTube link detected'
                  : source.kind === 'vimeo'
                    ? 'Vimeo link detected'
                    : source.kind === 'file'
                      ? 'Direct video file detected'
                      : source.kind === 'embed'
                        ? 'Embeddable player detected'
                        : source.kind === 'page'
                          ? 'External page link'
                          : 'Waiting for a link…'}
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="video-url" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                <Link2 size={15} className="text-brand-600" />
                Video URL
                <span className="text-brand-600">*</span>
              </label>
              <input
                id="video-url"
                value={videoUrl}
                onChange={(event) => {
                  setVideoUrl(event.target.value)
                  setError('')
                }}
                onBlur={() => void lookupMetadata()}
                placeholder="https://www.youtube.com/watch?v=… or https://example.com/clip.mp4"
                autoFocus
                spellCheck={false}
                className="h-11 w-full rounded-lg border border-[#dedee3] bg-white px-3 text-[14px] text-ink placeholder:text-[#9b9ba3] transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              />
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
                YouTube, Vimeo, direct MP4/WebM files and embed links (<code className="rounded bg-[#f2f2f4] px-1">/embed/…</code>)
                play inline in a sandboxed player. Other pages only show a preview.
              </p>
            </div>

            <div>
              <label htmlFor="video-title" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                <Film size={15} className="text-brand-600" />
                Title
                <span className="text-brand-600">*</span>
                {fetching && <Loader2 size={13} className="animate-spin text-muted" />}
              </label>
              <input
                id="video-title"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                  setError('')
                }}
                placeholder="e.g. Building a silent 4K editing rig"
                className="h-11 w-full rounded-lg border border-[#dedee3] bg-white px-3 text-[14px] text-ink placeholder:text-[#9b9ba3] transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              />
            </div>

            <div>
              <label htmlFor="video-thumb" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                <ImageIcon size={15} className="text-brand-600" />
                Thumbnail URL <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="video-thumb"
                value={thumbnail}
                onChange={(event) => setThumbnail(event.target.value)}
                placeholder="Leave empty to auto-detect"
                spellCheck={false}
                className="h-11 w-full rounded-lg border border-[#dedee3] bg-white px-3 text-[14px] text-ink placeholder:text-[#9b9ba3] transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="video-category" className="mb-1.5 block text-[13px] font-semibold text-ink">
                  Category
                </label>
                <select
                  id="video-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="h-11 w-full rounded-lg border border-[#dedee3] bg-white px-3 text-[14px] text-ink transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="video-duration" className="mb-1.5 block text-[13px] font-semibold text-ink">
                  Duration <span className="font-normal text-muted">(optional)</span>
                </label>
                <input
                  id="video-duration"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                  placeholder="8:31"
                  className="h-11 w-full rounded-lg border border-[#dedee3] bg-white px-3 text-[14px] text-ink placeholder:text-[#9b9ba3] transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                />
              </div>
            </div>
          </div>

          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] font-medium text-red-600">{error}</p>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
            <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
              <Check size={14} className="text-emerald-600" />
              Saved in this browser only
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-10 rounded-full px-4 text-[13.5px] font-semibold text-ink transition hover:bg-[#f2f2f4]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-5 text-[13.5px] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(109,40,217,0.9)] transition hover:brightness-105 active:scale-[0.98]"
              >
                <Plus size={17} strokeWidth={2.6} />
                Add video
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
