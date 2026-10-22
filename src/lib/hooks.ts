import { useEffect, useRef, type RefObject } from 'react'

export function useClickOutside<T extends HTMLElement>(
  onOutside: () => void,
  enabled = true,
): RefObject<T | null> {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    if (!enabled) return
    function handler(event: MouseEvent | TouchEvent) {
      const el = ref.current
      if (el && !el.contains(event.target as Node)) onOutside()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [onOutside, enabled])
  return ref
}

export function usePageTitle(title: string) {
  useEffect(() => {
    const previous = document.title
    document.title = title ? `${title} · AfterDark` : 'AfterDark — Adult Videos (18+)'
    return () => {
      document.title = previous
    }
  }, [title])
}

export function useEscape(onEscape: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    function handler(event: KeyboardEvent) {
      if (event.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onEscape, enabled])
}
