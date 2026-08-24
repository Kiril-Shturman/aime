import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { App as KonstaApp } from 'konsta/react'
import { AppRoot } from '@telegram-apps/telegram-ui'
import '@telegram-apps/telegram-ui/dist/styles.css'
import HomePage from './pages/HomePage'
import ProjectPage from './pages/ProjectPage'
import FilterPage from './pages/FilterPage'
import ProfilePage from './pages/ProfilePage'
import GeneratePage from './pages/GeneratePage'
import ChatPage from './pages/ChatPage'
import { AppStoreProvider, useApp } from './store/AppStore'
import { ThemeProvider, useTheme } from './store/ThemeStore'
import { initTelegram } from './lib/telegram'

export default function App() {
  useEffect(() => {
    initTelegram()
  }, [])

  return (
    <ThemeProvider>
      <Themed />
    </ThemeProvider>
  )
}

function Themed() {
  const { theme } = useTheme()
  const dark = theme === 'dark'
  return (
    <AppRoot
      appearance={dark ? 'dark' : 'light'}
      platform="ios"
      className={dark ? 'tg-dark' : ''}
    >
      <KonstaApp theme="ios" dark={dark}>
        <AppStoreProvider>
          <Gate>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/project/:id" element={<ProjectPage />} />
                <Route path="/filter/:kind" element={<FilterPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/generate" element={<GeneratePage />} />
                <Route path="/chat/:id" element={<ChatPage />} />
              </Routes>
            </BrowserRouter>
          </Gate>
        </AppStoreProvider>
      </KonstaApp>
    </AppRoot>
  )
}

// Доска закрыта ключом. Из Телеграма подпись приходит сама, в браузере
// ключ передаётся один раз: адрес?key=…
function Gate({ children }: { children: React.ReactNode }) {
  const { denied } = useApp()
  if (!denied) return <>{children}</>
  return (
    <div className="h-full flex items-center justify-center px-8 text-center">
      <div>
        <div className="text-[19px] font-semibold">Доска закрыта</div>
        <p className="opacity-60 text-[15px] mt-2 leading-snug">
          Открой её из бота в Телеграме. Если нужен обычный браузер, добавь
          к адресу ?key= и свой ключ.
        </p>
      </div>
    </div>
  )
}
