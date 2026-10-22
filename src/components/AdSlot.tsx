import { useEffect, useRef } from 'react'
import { useSiteSettings, type AdSlotName } from '../lib/settings'

/** Reserved height per slot, so an ad never shifts the layout when it arrives. */
const RESERVED_HEIGHT: Record<Exclude<AdSlotName, 'popunder'>, string> = {
  header: 'min-h-[90px]',
  native: 'min-h-[120px]',
  sidebar: 'min-h-[250px]',
  footer: 'min-h-[90px]',
  video: 'min-h-[90px]',
}

interface Props {
  slot: Exclude<AdSlotName, 'popunder'>
  className?: string
}

/**
 * One ad unit. The owner pastes raw ad code (a network's <script> or an
 * <iframe>) into the dashboard; it is injected here.
 *
 * `innerHTML` deliberately does not execute <script> tags, so each one is
 * replaced by a fresh <script> element — that is the standard way to run
 * third-party ad tags. The slot reserves its height up front (no layout shift)
 * and renders nothing at all when ads are off or the slot is empty, so the
 * site stays clean until the owner adds code.
 */
export default function AdSlot({ slot, className = '' }: Props) {
  const { ads } = useSiteSettings()
  const code = ads.enabled ? String(ads[slot] || '').trim() : ''
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    element.innerHTML = ''
    if (!code) return

    const template = document.createElement('template')
    template.innerHTML = code
    // Capture the inert scripts before they are moved into the page.
    const inert = Array.from(template.content.querySelectorAll('script'))
    element.appendChild(template.content)

    for (const old of inert) {
      const script = document.createElement('script')
      for (const attribute of Array.from(old.attributes)) {
        script.setAttribute(attribute.name, attribute.value)
      }
      script.text = old.textContent || ''
      old.replaceWith(script)
    }
  }, [code])

  if (!code) return null

  return (
    <div
      className={`flex w-full max-w-full items-center justify-center overflow-hidden ${RESERVED_HEIGHT[slot]} ${className}`}
      data-ad-slot={slot}
      aria-label="Advertisement"
      role="complementary"
    >
      <div ref={host} className="w-full max-w-full overflow-hidden text-center" />
    </div>
  )
}

/**
 * Global ad script (popunder / interstitial networks). Mounted once per page
 * view; the module flag stops React StrictMode's double render from injecting
 * the same network script twice, which many networks treat as fraud.
 */
let injected = false

export function GlobalAdScript() {
  const { ads } = useSiteSettings()
  const code = ads.enabled ? String(ads.popunder || '').trim() : ''

  useEffect(() => {
    if (!code || injected) return
    injected = true
    const template = document.createElement('template')
    template.innerHTML = code
    const inert = Array.from(template.content.querySelectorAll('script'))
    document.body.appendChild(template.content)
    for (const old of inert) {
      const script = document.createElement('script')
      for (const attribute of Array.from(old.attributes)) {
        script.setAttribute(attribute.name, attribute.value)
      }
      script.text = old.textContent || ''
      old.replaceWith(script)
    }
  }, [code])

  return null
}
