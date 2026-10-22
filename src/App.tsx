import { useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import CreateModal from './components/CreateModal'
import HomePage from './pages/HomePage'
import BrowsePage from './pages/BrowsePage'
import ChannelPage from './pages/ChannelPage'
import ExplorePage from './pages/ExplorePage'
import TrendingPage from './pages/TrendingPage'
import SubscriptionsPage from './pages/SubscriptionsPage'
import LibraryPage from './pages/LibraryPage'
import HistoryPage from './pages/HistoryPage'
import WatchLaterPage from './pages/WatchLaterPage'
import LikedPage from './pages/LikedPage'
import ResultsPage from './pages/ResultsPage'
import WatchPage from './pages/WatchPage'
import NotFoundPage from './pages/NotFoundPage'
import AdSlot, { GlobalAdScript } from './components/AdSlot'

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
    <div className="min-h-screen bg-surface">
      <ScrollToTop />
      <Header onToggleSidebar={() => setSidebarOpen((open) => !open)} />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="pt-16 lg:pl-[192px]">
        <GlobalAdScript />
        {/* Ads live in reserved-height slots: space is allocated before the
            network answers, so nothing jumps and the layout stays stable. */}
        <div className="px-4 pt-3 sm:px-5 xl:px-6">
          <AdSlot slot="header" />
        </div>
        <main className="px-4 pb-20 sm:px-5 xl:px-6">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/browse/:category" element={<BrowsePage />} />
            <Route path="/channel/:channelId" element={<ChannelPage />} />
            <Route path="/explore" element={<ExplorePage />} />
            <Route path="/trending" element={<TrendingPage />} />
            <Route path="/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/watch-later" element={<WatchLaterPage />} />
            <Route path="/liked" element={<LikedPage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/watch/:id" element={<WatchPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          <AdSlot slot="native" className="mt-8" />
        </main>
      </div>

      <footer className="border-t border-line px-4 py-6 sm:px-5 xl:px-6 lg:pl-[192px]">
        <AdSlot slot="footer" />
      </footer>

      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
