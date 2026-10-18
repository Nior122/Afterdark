import { useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import CreateModal from './components/CreateModal'
import HomePage from './pages/HomePage'
import BrowsePage from './pages/BrowsePage'
import ExplorePage from './pages/ExplorePage'
import TrendingPage from './pages/TrendingPage'
import SubscriptionsPage from './pages/SubscriptionsPage'
import LibraryPage from './pages/LibraryPage'
import HistoryPage from './pages/HistoryPage'
import WatchLaterPage from './pages/WatchLaterPage'
import LikedPage from './pages/LikedPage'
import ResultsPage from './pages/ResultsPage'
import ChannelPage from './pages/ChannelPage'
import WatchPage from './pages/WatchPage'
import NotFoundPage from './pages/NotFoundPage'

function ScrollToTop() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname, search])
  return null
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-white">
      <ScrollToTop />
      <Header onCreate={() => setCreateOpen(true)} onToggleSidebar={() => setSidebarOpen((open) => !open)} />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="pt-16 lg:pl-[192px]">
        <main className="px-4 pb-20 sm:px-5 xl:px-6">
          <Routes>
            <Route path="/" element={<HomePage onCreate={() => setCreateOpen(true)} />} />
            <Route path="/browse/:category" element={<BrowsePage />} />
            <Route path="/explore" element={<ExplorePage />} />
            <Route path="/trending" element={<TrendingPage />} />
            <Route path="/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/library" element={<LibraryPage onCreate={() => setCreateOpen(true)} />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/watch-later" element={<WatchLaterPage />} />
            <Route path="/liked" element={<LikedPage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/channel/:channelId" element={<ChannelPage onCreate={() => setCreateOpen(true)} />} />
            <Route path="/watch/:id" element={<WatchPage onCreate={() => setCreateOpen(true)} />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </div>

      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
