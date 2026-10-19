import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../lib/theme'

/**
 * Light/dark switch. Renders the icon for the theme it will *move to*, which
 * reads better than mirroring the current state, and reports the current theme
 * to assistive tech via `title` + `aria-label`.
 */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { isDark, toggleTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
      className={[
        'grid shrink-0 place-items-center rounded-full text-ink transition hover:bg-raise',
        compact ? 'h-9 w-9' : 'h-10 w-10',
      ].join(' ')}
    >
      {isDark ? <Sun size={21} strokeWidth={1.8} /> : <Moon size={21} strokeWidth={1.8} />}
    </button>
  )
}
