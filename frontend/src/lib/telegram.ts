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

export function haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'error' = 'light') {
  try {
    const t = tg()
    if (!t?.HapticFeedback) return
    if (kind === 'success' || kind === 'error') t.HapticFeedback.notificationOccurred(kind)
    else t.HapticFeedback.impactOccurred(kind)
  } catch {
    /* вне Телеграма */
  }
}

export function initTelegram() {
  const t = tg()
  const BG = '#000000'
  try {
    t?.ready?.()
    t?.expand?.()
    t?.setHeaderColor?.(BG)
    t?.setBackgroundColor?.(BG)
    t?.setBottomBarColor?.(BG)
    t?.disableVerticalSwipes?.()
  } catch {
    /* обычный браузер */
  }
}
