import AppPreloader from "./components/AppPreloader";
import { useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { App as KonstaApp } from "konsta/react";
const HomePage = lazy(() => import("./pages/HomePage"));
const ProjectPage = lazy(() => import("./pages/ProjectPage"));
const ProjectSettingsPage = lazy(() => import("./pages/ProjectSettingsPage"));
const DesignKitPage = lazy(() => import("./pages/DesignKitPage"));
const FilterPage = lazy(() => import("./pages/FilterPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const BoardSettingsPage = lazy(() => import("./pages/BoardSettingsPage"));
const ProfileEditPage = lazy(() => import("./pages/ProfileEditPage"));
const GeneratePage = lazy(() => import("./pages/GeneratePage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const TariffsPage = lazy(() => import("./pages/TariffsPage"));
const PaymentPage = lazy(() => import("./pages/PaymentPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const TransactionsPage = lazy(() => import("./pages/TransactionsPage"));
const TokenUsagePage = lazy(() => import("./pages/TokenUsagePage"));
const BalancePage = lazy(() => import("./pages/BalancePage"));
const McpKeysPage = lazy(() => import("./pages/McpKeysPage"));
const AgentDocsPage = lazy(() => import("./pages/AgentDocsPage"));
const ConnectedAppsPage = lazy(() => import("./pages/ConnectedAppsPage"));
const FaqPage = lazy(() => import("./pages/FaqPage"));
const ChatPage = lazy(() => import("./pages/ChatPage"));
const AgentChatPage = lazy(() => import("./pages/AgentChatPage"));
const GmailConnectPage = lazy(() => import("./pages/GmailConnectPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const WalletPage = lazy(() => import("./pages/WalletPage"));
const WalletAdminPage = lazy(() => import("./pages/WalletAdminPage"));
import TabPill from "./components/TabPill";
import DesktopSidebar from "./components/DesktopSidebar";
import CopyToast from "./components/CopyToast";
import { AppStoreProvider, useApp } from "./store/AppStore";
import { ThemeProvider, useTheme } from "./store/ThemeStore";
import { applyTgTheme, initTelegram } from "./lib/telegram";

export default function App() {
  useEffect(() => {
    initTelegram();
  }, []);

  return (
    <ThemeProvider>
      <Themed />
    </ThemeProvider>
  );
}

function Themed() {
  const { theme } = useTheme();
  const dark = theme === "dark";

  // Перекрашиваем шапку/фон ТГ-мини-аппы под нашу тему.
  useEffect(() => {
    const sync = () => {
      initTelegram();
      applyTgTheme(theme);
    };
    sync();
    window.addEventListener("telegram-ready", sync);
    window.addEventListener("load", sync);
    return () => {
      window.removeEventListener("telegram-ready", sync);
      window.removeEventListener("load", sync);
    };
  }, [theme]);

  return (
    <KonstaApp theme="ios" dark={dark}>
      <AppStoreProvider>
        <BrowserRouter>
          <Gate>
            <Suspense
              fallback={
                <div
                  role="status"
                  aria-label="Загрузка приложения"
                  aria-busy="true"
                  className="flex min-h-[100dvh] w-full items-center justify-center bg-[#efeff4] dark:bg-black"
                >
                  <AppPreloader />
                </div>
              }
            >
              <AppRoutes />
            </Suspense>
          </Gate>
        </BrowserRouter>
      </AppStoreProvider>
      <CopyToast />
    </KonstaApp>
  );
}

function AppRoutes() {
  const { pathname } = useLocation();
  if (isWalletHost()) {
    return pathname === "/admin" ? <WalletAdminPage /> : <WalletPage />;
  }
  const hasTabPill =
    pathname === "/" || pathname === "/generate" || pathname === "/profile";
  // На страницах авторизации сайдбар не рисуем — там своя вёрстка на всю ширину.
  const withSidebar = !PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  return (
    <div className="flex h-full w-full">
      {withSidebar && <DesktopSidebar />}
      <div className="flex-1 min-w-0 relative">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/project/:id" element={<ProjectPage />} />
          <Route
            path="/project/:id/settings"
            element={<ProjectSettingsPage />}
          />
          <Route path="/design" element={<DesignKitPage />} />
          <Route path="/filter/:kind" element={<FilterPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/board-settings" element={<BoardSettingsPage />} />
          <Route path="/profile/edit" element={<ProfileEditPage />} />
          <Route path="/generate" element={<GeneratePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/tariffs" element={<TariffsPage />} />
          <Route path="/payment/subscription" element={<PaymentPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/tokens" element={<TokenUsagePage />} />
          <Route path="/balance" element={<BalancePage />} />
          <Route path="/mcp-keys" element={<McpKeysPage />} />
          <Route path="/agent" element={<AgentDocsPage />} />
          <Route path="/connected-apps" element={<ConnectedAppsPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/chat/:provider" element={<ChatPage />} />
          <Route path="/chat-agent/:id" element={<AgentChatPage />} />
          <Route path="/connect/gmail" element={<GmailConnectPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/wallet" element={<WalletPage />} />
        </Routes>
        {hasTabPill && <TabPill className="md:hidden" />}
      </div>
    </div>
  );
}

// Публичные страницы: авторизация и правовые — их гейт не закрывает.
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/terms",
  "/privacy",
  "/agent",
  "/wallet",
];

// Доска закрыта ключом. Из Телеграма подпись приходит сама, в браузере
// ключ передаётся один раз: адрес?key=…
function Gate({ children }: { children: React.ReactNode }) {
  const { denied } = useApp();
  const { pathname } = useLocation();
  const isPublic =
    isWalletHost() || PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (!denied || isPublic) return <>{children}</>;
  return (
    <div className="h-full flex items-center justify-center px-8 text-center">
      <div>
        <div className="text-[19px] font-semibold">Доска закрыта</div>
        <p className="opacity-60 text-[15px] mt-2 leading-snug">
          Открой её из бота в Телеграме. Если нужен обычный браузер, добавь к
          адресу ?key= и свой ключ.
        </p>
      </div>
    </div>
  );
}

function isWalletHost() {
  return (
    window.location.hostname.startsWith("wallet.") ||
    window.location.hostname ===
      "wpay-react-wallet.gildedmandrill1.chatgpt.site" ||
    import.meta.env.VITE_APP_MODE === "wallet"
  );
}
