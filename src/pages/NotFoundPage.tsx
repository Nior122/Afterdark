import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { usePageTitle } from '../lib/hooks'

export default function NotFoundPage() {
  usePageTitle('Page not found')

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-[72px] font-extrabold leading-none tracking-[-0.06em] text-brand-600">404</p>
      <h1 className="mt-3 text-[22px] font-bold tracking-[-0.02em]">This page isn’t available</h1>
      <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-muted">
        The video or page you were looking for may have been removed, or the link is wrong.
      </p>
      <Link
        to="/"
        className="mt-6 flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-4 text-[13.5px] font-semibold text-white"
      >
        <Compass size={17} /> Back to home
      </Link>
    </div>
  )
}
