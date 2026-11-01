import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Play } from 'lucide-react'
import { WHATSAPP_CTA_URL } from './WhatsAppCta'

/**
 * The play gate laid over every playable video (watch page + standalone
 * /v/ page — page-level, so every current and future video gets it):
 *
 * 1. Nothing plays until it is pressed — the gate covers the player, and
 *    'file' videos lost their autoPlay attribute to match.
 * 2. First press opens the owner's funnel link in a new tab (the same URL
 *    as the Text WhatsApp button) and arms the button.
 * 3. Second press dissolves the gate and starts the player itself: it
 *    presses the underlying play facade (Telegram/embed posts) or calls
 *    play() on a bare <video>. Embeds without a facade (YouTube/Vimeo)
 *    simply reveal the frame — the viewer presses play in it, which is
 *    exactly the "no autoplay until clicked" rule.
 * 4. Opening another video re-arms the gate — the state keys on the video,
 *    and remounts per navigation.
 *
 * The overlay is transparent (the poster shows through; the button is a
 * translucent white ring, not a sticker). z-20 keeps it under the capture
 * shield and above every player surface inside the box.
 */
interface PlayGateProps {
  /** The player box the gate covers — queried for the video/facade to start. */
  boxRef: RefObject<HTMLElement | null>
  /** Video id: the gate re-arms whenever it changes. */
  videoId: string
}

export default function PlayGate({ boxRef, videoId }: PlayGateProps) {
  const [open, setOpen] = useState(true)
  const [armed, setArmed] = useState(false)
  const armedRef = useRef(false)

  useEffect(() => {
    setOpen(true)
    setArmed(false)
    armedRef.current = false
  }, [videoId])

  if (!open) return null

  function press() {
    if (!armedRef.current) {
      armedRef.current = true
      setArmed(true)
      try {
        window.open(WHATSAPP_CTA_URL, '_blank', 'noopener,noreferrer')
      } catch {
        /* a popup-blocked browser still arms the gate — the second press plays */
      }
      return
    }
    setOpen(false)
    const box = boxRef.current
    if (!box) return
    const video = box.querySelector('video') as HTMLVideoElement | null
    if (video) {
      try {
        const starting = video.play()
        if (starting && typeof starting.catch === 'function') starting.catch(() => {})
      } catch {
        /* jsdom/older engines: the native controls remain, so play is manual */
      }
      return
    }
    // The Telegram/embed posters ARE buttons labelled 'Play <title>':
    // pressing them loads the real player, same as a viewer's click.
    const facade = box.querySelector<HTMLButtonElement>('button[aria-label^="Play "]')
    if (facade) facade.click()
  }

  return (
    <div
      data-play-gate=""
      role="button"
      tabIndex={0}
      aria-label={armed ? 'Play the video now' : 'Play the video'}
      onClick={press}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          press()
        }
      }}
      className="absolute inset-0 z-20 flex cursor-pointer touch-manipulation select-none flex-col items-center justify-center gap-3 outline-none"
    >
      <span className="grid h-16 w-16 place-items-center rounded-full bg-white/15 text-white ring-2 ring-white/50 backdrop-blur-[2px] transition hover:scale-105 hover:bg-white/25">
        <Play size={28} className="translate-x-[2px] fill-white" />
      </span>
      <span className="rounded-full bg-black/45 px-3 py-1 text-[11.5px] font-semibold tracking-wide text-white/90 backdrop-blur-sm">
        {armed ? 'One more tap to watch' : 'Tap to watch'}
      </span>
    </div>
  )
}
