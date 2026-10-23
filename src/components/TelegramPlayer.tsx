import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock, LockOpen, Play } from 'lucide-react'

interface TelegramPlayerProps {
  src: string
  title: string
  poster: string
  /** Clip length for the poster overlay ("41:05"); hidden when unknown. */
  duration?: string
  /** Vertical media: letterbox the poster instead of cropping the scene away. */
  isPortrait?: boolean
}

interface TelegramWidgetMessage {
  event?: unknown
  height?: unknown
}

const HEADER_CROP = 52
const FOOTER_CROP = 36
const MIN_CONTENT_HEIGHT = 360
const MAX_CONTENT_HEIGHT = 980

function clampContentHeight(height: number): number {
  return Math.min(MAX_CONTENT_HEIGHT, Math.max(MIN_CONTENT_HEIGHT, Math.round(height)))
}

/**
 * Player for a public Telegram post (`t.me/<channel>/<message>`).
 *
 * Telegram's own post-widget iframe is used rather than a temporary CDN MP4
 * URL. The iframe stays unloaded behind our poster until the viewer presses
 * play. Its sandbox intentionally omits top-navigation and popup permissions,
 * so channel/post links inside Telegram cannot redirect this page or open
 * Telegram in a new tab. Telegram's resize messages are accepted only from
 * this iframe and only from the `https://t.me` origin.
 */
export default function TelegramPlayer({ src, title, poster, duration, isPortrait }: TelegramPlayerProps) {
  const [activated, setActivated] = useState(false)
  const [clicksLocked, setClicksLocked] = useState(false)
  const [contentHeight, setContentHeight] = useState(560)
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  const frameId = useMemo(() => {
    try {
      const path = new URL(src).pathname
        .replace(/^\/+|\/+$/g, '')
        .replace(/[^A-Za-z0-9_]/g, '-')
      return `telegram-post-${path || 'video'}`
    } catch {
      return 'telegram-post-video'
    }
  }, [src])

  const postToFrame = useCallback((event: string, data: Record<string, unknown> = {}) => {
    try {
      frameRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event, ...data }),
        'https://t.me',
      )
    } catch {
      /* The iframe may still be navigating; Telegram will send `ready` later. */
    }
  }, [])

  useEffect(() => {
    if (!activated) return

    function onMessage(event: MessageEvent) {
      const frame = frameRef.current
      if (!frame || event.source !== frame.contentWindow || event.origin !== 'https://t.me') {
        return
      }

      let data: TelegramWidgetMessage | null = null
      try {
        data =
          typeof event.data === 'string'
            ? (JSON.parse(event.data) as TelegramWidgetMessage)
            : (event.data as TelegramWidgetMessage)
      } catch {
        return
      }

      if (data?.event === 'resize') {
        const height = Number(data.height)
        if (Number.isFinite(height) && height > 0) {
          setContentHeight(clampContentHeight(height))
        }
      } else if (data?.event === 'ready') {
        postToFrame('focus', { has_focus: document.hasFocus() })
        postToFrame('visible', { frame: frameId })
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [activated, frameId, postToFrame])

  function handleFrameLoad() {
    postToFrame('visible', { frame: frameId })
    postToFrame('focus', { has_focus: document.hasFocus() })
  }

  const visibleHeight = Math.max(320, contentHeight - HEADER_CROP - FOOTER_CROP)

  if (!activated) {
    return (
      <button
        type="button"
        onClick={() => setActivated(true)}
        aria-label={`Play ${title}`}
        className="group/telegram relative block h-[min(620px,78vh)] min-h-[360px] w-full overflow-hidden bg-black"
      >
        <img
          src={poster}
          alt=""
          referrerPolicy="no-referrer"
          className={`absolute inset-0 h-full w-full ${
            isPortrait ? 'object-contain' : 'object-cover'
          }`}
        />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition group-hover/telegram:scale-105 group-hover/telegram:bg-brand-600">
            <Play size={28} className="translate-x-[2px] fill-white" />
          </span>
        </span>

        {/* Timestamp on the facade, mirroring the card badge, so the clip's
            length reads on the video page before anything is loaded. */}
        {duration && duration !== '0:00' && (
          <span className="absolute bottom-2 right-2 rounded-[5px] bg-black/80 px-1.5 py-[3px] text-[11px] font-semibold leading-none text-white">
            {duration}
          </span>
        )}
      </button>
    )
  }

  return (
    <div
      className="group/telegram relative w-full overflow-hidden bg-black"
      style={{ height: visibleHeight }}
    >
      <iframe
        id={frameId}
        ref={frameRef}
        src={src}
        title={title}
        onLoad={handleFrameLoad}
        className="absolute left-0 w-full border-0"
        style={{ height: contentHeight, top: -HEADER_CROP }}
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        referrerPolicy="no-referrer"
        // Deliberately NO allow-top-navigation* or allow-popups*: Telegram's
        // internal channel/post links must not take viewers off AfterDark.
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allowFullScreen
      />

      {/* Covers any residual Telegram header link at the top of the frame. */}
      <div
        aria-hidden="true"
        data-testid="telegram-title-shield"
        className="absolute inset-x-0 top-0 z-10 h-[52px]"
        onClick={(event) => event.preventDefault()}
        onContextMenu={(event) => event.preventDefault()}
      />

      {clicksLocked && (
        <div
          aria-hidden="true"
          data-testid="telegram-full-shield"
          className="absolute inset-0 z-10"
          onClick={(event) => event.preventDefault()}
          onContextMenu={(event) => event.preventDefault()}
        />
      )}

      <button
        type="button"
        onClick={() => setClicksLocked((locked) => !locked)}
        aria-pressed={clicksLocked}
        aria-label={clicksLocked ? 'Unlock player clicks' : 'Lock player clicks'}
        title={clicksLocked ? 'Unlock player clicks' : 'Lock player clicks'}
        className={[
          'absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/65 focus-visible:opacity-100',
          clicksLocked ? 'opacity-100' : 'opacity-0 group-hover/telegram:opacity-100',
        ].join(' ')}
      >
        {clicksLocked ? <Lock size={14} /> : <LockOpen size={14} />}
      </button>
    </div>
  )
}
