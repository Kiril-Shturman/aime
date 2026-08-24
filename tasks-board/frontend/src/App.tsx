import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { App as KonstaApp } from 'konsta/react'
import HomePage from './pages/HomePage'
import ProjectPage from './pages/ProjectPage'
import FilterPage from './pages/FilterPage'
import { AppStoreProvider } from './store/AppStore'
import { initTelegram } from './lib/telegram'

export default function App() {
  useEffect(() => {
    initTelegram()
  }, [])

  return (
    <KonstaApp theme="ios" dark>
      <AppStoreProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/project/:id" element={<ProjectPage />} />
            <Route path="/filter/:kind" element={<FilterPage />} />
          </Routes>
        </BrowserRouter>
      </AppStoreProvider>
    </KonstaApp>
  )
}
