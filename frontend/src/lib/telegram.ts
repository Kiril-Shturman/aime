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
  ready?: () => void
  expand?: () => void
  setHeaderColor?: (c: string) => void
  setBackgroundColor?: (c: string) => void
  setBottomBarColor?: (c: string) => void
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
  if (!t) return
  const bg = theme === 'dark' ? '#000000' : '#ffffff'
  try {
    t.setHeaderColor?.(bg)
    t.setBackgroundColor?.(bg)
    t.setBottomBarColor?.(bg)
  } catch {
    /* старая версия клиента */
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
