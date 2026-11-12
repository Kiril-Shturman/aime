export interface TgUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  language_code?: string
  is_premium?: boolean
}

interface TG {
  isVersionAtLeast?: (version: string) => boolean
  ready?: () => void
  expand?: () => void
  setHeaderColor?: (c: string) => void
  setBackgroundColor?: (c: string) => void
  setBottomBarColor?: (c: string) => void
  openTelegramLink?: (url: string) => void
  openLink?: (url: string) => void
  showScanQrPopup?: (params: { text?: string }, callback?: (data: string) => boolean | void) => void
  closeScanQrPopup?: () => void
  disableVerticalSwipes?: () => void
  initData?: string
  initDataUnsafe?: { user?: TgUser }
  HapticFeedback?: {
    impactOccurred: (kind: 'light' | 'medium' | 'heavy') => void
    notificationOccurred: (kind: 'success' | 'error' | 'warning') => void
  }
  BackButton?: { show: () => void; hide: () => void; onClick: (h: () => void) => void }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TG }
  }
}

export const tg = (): TG | undefined => window.Telegram?.WebApp

export function getUser(): TgUser | null {
  return tg()?.initDataUnsafe?.user ?? null
}

export function haptic(
  kind: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' = 'light',
) {
  try {
    const t = tg()
    if (!t?.HapticFeedback) return
    if (kind === 'success' || kind === 'error' || kind === 'warning')
      t.HapticFeedback.notificationOccurred(kind)
    else t.HapticFeedback.impactOccurred(kind)
  } catch {
    /* вне Телеграма */
  }
}

export function initTelegram() {
  const t = tg()
  try {
    t?.ready?.()
    t?.expand?.()
    t?.disableVerticalSwipes?.()
  } catch {
    /* обычный браузер */
  }
}

// Красим шапку/фон/нижнюю панель ТГ-мини-аппы под текущую тему.
// Вызываем каждый раз, когда пользователь переключает светлую/тёмную.
export function applyTgTheme(theme: 'dark' | 'light') {
  const t = tg()
  // В светлой теме экран кошелька использует системный iOS grouped background.
  // Тем же цветом красим нативную шапку Telegram, чтобы над WebView не было
  // отдельной белой полосы.
  const views = document.querySelectorAll<HTMLElement>('[data-wallet-surface][aria-hidden="false"]')
  const assetSurface = views[views.length - 1]?.dataset.walletSurface === 'asset'
  const bg = assetSurface
    ? (theme === 'dark' ? '#1c1c1e' : '#ffffff')
    : (theme === 'dark' ? '#000000' : '#efeff4')

  // Держим цвет самого WebView и системной шапки Telegram одинаковым.
  // meta theme-color нужен как запасной вариант для клиентов, которые
  // применяют цвет WebView раньше, чем становится доступен WebApp API.
  document.documentElement.style.backgroundColor = bg
  document.body.style.backgroundColor = bg
  let themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!themeMeta) {
    themeMeta = document.createElement('meta')
    themeMeta.name = 'theme-color'
    document.head.appendChild(themeMeta)
  }
  themeMeta.content = bg

  if (!t) return
  // Older Telegram clients may support only some of these methods.
  const bottom = theme === 'dark' ? '#000000' : '#efeff4'
  for (const [update, color] of [[t.setHeaderColor, bg], [t.setBackgroundColor, bg], [t.setBottomBarColor, bottom]] as const) {
    try { update?.call(t, color) } catch { /* unsupported client method */ }
  }
}

// Доска пускает менять данные только своих. Из Телеграма подпись мини-аппы
// приходит сама, а в обычном браузере ключ передаётся один раз через
// ?key=… и остаётся в памяти браузера.
const KEY_STORE = 'board-key'

export function boardKey(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get('key')
    if (fromUrl) localStorage.setItem(KEY_STORE, fromUrl)
    return localStorage.getItem(KEY_STORE) ?? ''
  } catch {
    return ''
  }
}

export function initData(): string {
  return tg()?.initData ?? ''
}

export function forgetBoardKey() {
  try {
    localStorage.removeItem(KEY_STORE)
  } catch {
    /* памяти нет — и ладно */
  }
}
