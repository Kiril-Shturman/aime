import { useEffect } from 'react'
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { App as KonstaApp } from 'konsta/react'
import HomePage from './pages/HomePage'
import ProjectPage from './pages/ProjectPage'
import FilterPage from './pages/FilterPage'
import ProfilePage from './pages/ProfilePage'
import GeneratePage from './pages/GeneratePage'
import HistoryPage from './pages/HistoryPage'
import TariffsPage from './pages/TariffsPage'
import PaymentPage from './pages/PaymentPage'
import TermsPage from './pages/TermsPage'
import PrivacyPage from './pages/PrivacyPage'
import ChatPage from './pages/ChatPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import TabPill from './components/TabPill'
import DesktopSidebar from './components/DesktopSidebar'
import CopyToast from './components/CopyToast'
import { AppStoreProvider, useApp } from './store/AppStore'
import { ThemeProvider, useTheme } from './store/ThemeStore'
import { applyTgTheme, initTelegram } from './lib/telegram'

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

  // Перекрашиваем шапку/фон ТГ-мини-аппы под нашу тему.
  useEffect(() => {
    applyTgTheme(theme)
  }, [theme])

  return (
    <KonstaApp theme="ios" dark={dark}>
      <AppStoreProvider>
        <BrowserRouter>
          <Gate>
            <AppRoutes />
          </Gate>
        </BrowserRouter>
      </AppStoreProvider>
      <CopyToast />
    </KonstaApp>
  )
}

function AppRoutes() {
  const { pathname } = useLocation()
  const hasTabPill =
    pathname === '/' ||
    pathname === '/generate' ||
    pathname === '/profile' ||
    pathname.startsWith('/project/')
  // На страницах авторизации сайдбар не рисуем — там своя вёрстка на всю ширину.
  const withSidebar = !PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  return (
    <div className="flex h-full w-full">
      {withSidebar && <DesktopSidebar />}
      <div className="flex-1 min-w-0 relative">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/project/:id" element={<ProjectPage />} />
          <Route path="/filter/:kind" element={<FilterPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/generate" element={<GeneratePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/tariffs" element={<TariffsPage />} />
          <Route path="/payment/subscription" element={<PaymentPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/chat/:provider" element={<ChatPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Routes>
        {hasTabPill && <TabPill className="md:hidden" />}
      </div>
    </div>
  )
}

// Публичные страницы: авторизация и правовые — их гейт не закрывает.
const PUBLIC_PATHS = ['/login', '/register', '/terms', '/privacy']

// Доска закрыта ключом. Из Телеграма подпись приходит сама, в браузере
// ключ передаётся один раз: адрес?key=…
function Gate({ children }: { children: React.ReactNode }) {
  const { denied } = useApp()
  const { pathname } = useLocation()
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  if (!denied || isPublic) return <>{children}</>
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
