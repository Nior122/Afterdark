import { Route, Routes } from 'react-router-dom'
import VideoPage from './pages/VideoPage'
import NotFoundPage from './pages/NotFoundPage'

/**
 * Two routes only:
 *
 *   /v/:id  a single video page (player, title, optional description)
 *   *       neutral 404 — including "/", which lists nothing
 *
 * There is no home feed, category, search, channel or related-video route.
 */
export default function App() {
  return (
    <div className="min-h-screen bg-surface">
      <Routes>
        <Route path="/v/:id" element={<VideoPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  )
}
