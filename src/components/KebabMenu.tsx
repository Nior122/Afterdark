import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check,
  Clock3,
  ExternalLink,
  Flag,
  MoreVertical,
  Share2,
  ThumbsUp,
  Trash2,
} from 'lucide-react'
import { useClickOutside, useEscape } from '../lib/hooks'
import { useStore } from '../lib/store'

interface KebabMenuProps {
  videoId: string
  advertiser?: string
  onDelete?: () => void
  menuAlign?: 'left' | 'right'
}

export default function KebabMenu({ videoId, advertiser, onDelete, menuAlign = 'right' }: KebabMenuProps) {
  const { watchLater, liked, toggleWatchLater, toggleLike } = useStore()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const navigate = useNavigate()

  const saved = watchLater.includes(videoId)
  const isLiked = liked.includes(videoId)

  const close = useCallback(() => setOpen(false), [])
  const ref = useClickOutside<HTMLDivElement>(close, open)
  useEscape(close, open)

  async function share() {
    const url = `${window.location.origin}/watch/${videoId}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      window.prompt('Copy this link', url)
    }
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        aria-label="More actions"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-raise hover:text-ink"
      >
        <MoreVertical size={18} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="menu"
          className={[
            'absolute top-8 z-40 w-[230px] overflow-hidden rounded-xl border border-line bg-surface py-1.5 shadow-[0_18px_45px_-12px_rgba(0,0,0,0.3)] dark:bg-panel dark:shadow-[0_18px_45px_-12px_rgba(0,0,0,0.85)]',
            menuAlign === 'right' ? 'right-0' : 'left-0',
          ].join(' ')}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              toggleWatchLater(videoId)
              close()
            }}
            className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13.5px] text-ink hover:bg-panel"
          >
            {saved ? <Check size={17} className="text-brand-600" /> : <Clock3 size={17} className="text-muted" />}
            {saved ? 'Remove from Watch later' : 'Save to Watch later'}
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              toggleLike(videoId)
              close()
            }}
            className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13.5px] text-ink hover:bg-panel"
          >
            <ThumbsUp size={17} className={isLiked ? 'text-brand-600' : 'text-muted'} fill={isLiked ? 'currentColor' : 'none'} />
            {isLiked ? 'Remove like' : 'Like this video'}
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void share()
              close()
            }}
            className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13.5px] text-ink hover:bg-panel"
          >
            {copied ? <Check size={17} className="text-emerald-600" /> : <Share2 size={17} className="text-muted" />}
            {copied ? 'Link copied!' : 'Share'}
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              navigate(`/watch/${videoId}`)
              close()
            }}
            className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13.5px] text-ink hover:bg-panel"
          >
            <ExternalLink size={17} className="text-muted" />
            Open video
          </button>

          {advertiser && (
            <div className="mt-1 border-t border-line px-3.5 pb-1 pt-2.5 text-[12px] text-muted">
              <Flag size={14} className="mr-2 inline align-[-2px] text-muted" />
              Ad by {advertiser}
            </div>
          )}

          {onDelete && (
            <>
              <div className="my-1 border-t border-line" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onDelete()
                  close()
                }}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13.5px] text-red-600 hover:bg-red-50"
              >
                <Trash2 size={17} />
                Delete video
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
