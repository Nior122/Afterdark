/**
 * Inline SVG icons.
 *
 * Hand-rolled rather than pulled from an icon library: it keeps the bundle small (a
 * mid-range phone on metered data should not download 40 KB of paths for the eight
 * glyphs this app uses), and it means stroke weight and corner radius match the rest
 * of the interface.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base = (props: IconProps): IconProps => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  ...props,
})

export const IconCamera = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2a1.5 1.5 0 0 0 1.3-.75l.5-.9A1.5 1.5 0 0 1 9.8 3.6h4.4a1.5 1.5 0 0 1 1.3.75l.5.9A1.5 1.5 0 0 0 17.3 6h1.2A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z" />
    <circle cx="12" cy="12.4" r="3.4" />
  </svg>
)

export const IconRecord = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.2" />
    <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
  </svg>
)

export const IconStop = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.2" />
    <rect x="8.6" y="8.6" width="6.8" height="6.8" rx="1.4" fill="currentColor" stroke="none" />
  </svg>
)

export const IconMirror = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v18" strokeDasharray="3 2.6" />
    <path d="M9 6.5 4.5 12 9 17.5Z" />
    <path d="M15 6.5 19.5 12 15 17.5Z" fill="currentColor" fillOpacity="0.16" />
  </svg>
)

export const IconFlip = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9a8 8 0 0 1 13.3-3.3" />
    <path d="M20 15a8 8 0 0 1-13.3 3.3" />
    <path d="M17.5 2.6v3.2h-3.2M6.5 21.4v-3.2h3.2" />
  </svg>
)

export const IconPencil = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 20h4l10-10-4-4L4 16Z" />
    <path d="M14 6l4 4" />
  </svg>
)

export const IconShare = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v11" />
    <path d="M8.5 6.5 12 3l3.5 3.5" />
    <path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />
  </svg>
)

export const IconDownload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4v11" />
    <path d="M8.5 11.5 12 15l3.5-3.5" />
    <path d="M5 18.5h14" />
  </svg>
)

export const IconClose = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const IconSettings = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M4.5 7.5l2 1.2M17.5 15.3l2 1.2M4.5 16.5l2-1.2M17.5 8.7l2-1.2" />
  </svg>
)

export const IconInfo = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 11v5.4" />
    <circle cx="12" cy="7.9" r="0.9" fill="currentColor" stroke="none" />
  </svg>
)

export const IconEye = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.6 12S6 6.4 12 6.4 21.4 12 21.4 12 18 17.6 12 17.6 2.6 12 2.6 12Z" />
    <circle cx="12" cy="12" r="2.7" />
  </svg>
)

export const IconBlink = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.6 12S6 6.4 12 6.4 21.4 12 21.4 12 18 17.6 12 17.6 2.6 12 2.6 12Z" />
    <path d="M8.6 12.4c.6 1 1.9 1.7 3.4 1.7s2.8-.7 3.4-1.7" />
    <path d="M8.2 10.2 7 9.2M15.8 10.2 17 9.2" />
  </svg>
)

export const IconTrash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 7h14" />
    <path d="M9.5 7V5.3A1.3 1.3 0 0 1 10.8 4h2.4a1.3 1.3 0 0 1 1.3 1.3V7" />
    <path d="M6.6 7l.8 11.2A1.8 1.8 0 0 0 9.2 20h5.6a1.8 1.8 0 0 0 1.8-1.8L17.4 7" />
    <path d="M10.4 10.6v5.6M13.6 10.6v5.6" />
  </svg>
)

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4.8 12.6 9.6 17.4 19.2 7" />
  </svg>
)

export const IconWarning = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4.2 2.8 20h18.4Z" />
    <path d="M12 10.2v4.4" />
    <circle cx="12" cy="17.4" r="0.85" fill="currentColor" stroke="none" />
  </svg>
)

export const IconUpload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 20V9" />
    <path d="M8.5 12.5 12 9l3.5 3.5" />
    <path d="M4.5 7.5A3 3 0 0 1 7.5 4.5h1.2" />
    <path d="M19.5 7.5v9A3 3 0 0 1 16.5 19.5h-9a3 3 0 0 1-3-3" />
  </svg>
)

export const IconWave = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 12c0-1.5 1-2.6 2.2-2.6 1.1 0 2 .9 2.3 2.2M8.5 11.6c.3-1.6 1.3-2.7 2.6-2.7 1.4 0 2.4 1.2 2.6 2.9M13.7 11.8c.2-1.5 1-2.4 2.2-2.4 1.3 0 2.2 1.1 2.2 2.6" />
    <path d="M5 16.6c2 1.5 4.4 2.2 7 2.2s5-.7 7-2.2" />
  </svg>
)
