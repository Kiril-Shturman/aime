// Подключение Gmail без своего бэка: клиент-сайд OAuth через Google
// Identity Services (GIS). Читаем скоуп readonly, токен кладём в
// localStorage под ключ проекта. Когда появится бэк — переедем на
// server-side flow с refresh-токеном.

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

// Минимально нужный кусочек GIS API. Более полные типы лежат в
// `@types/google.accounts`, но ставить пакет ради двух вызовов лишнее.
interface TokenClient {
  requestAccessToken: () => void
}
interface TokenResponse {
  access_token?: string
  error?: string
  error_description?: string
  expires_in?: number
}
type GisGlobal = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string
        scope: string
        callback: (resp: TokenResponse) => void
      }) => TokenClient
    }
  }
}
declare global {
  interface Window {
    google?: GisGlobal
  }
}

export interface GmailAccount {
  accessToken: string
  email: string
  expiresAt: number
}

const key = (projectId: string) => `gmail:${projectId}`

export function isGmailConfigured() {
  return !!CLIENT_ID
}

export function getGmail(projectId: string): GmailAccount | null {
  const raw = localStorage.getItem(key(projectId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as GmailAccount
    if (!parsed.accessToken || parsed.expiresAt < Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

export function saveGmail(projectId: string, acc: GmailAccount) {
  localStorage.setItem(key(projectId), JSON.stringify(acc))
}

export function clearGmail(projectId: string) {
  localStorage.removeItem(key(projectId))
}

let gisLoader: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisLoader) return gisLoader
  gisLoader = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => {
      gisLoader = null
      reject(new Error('Не удалось загрузить Google Identity Services'))
    }
    document.head.appendChild(s)
  })
  return gisLoader
}

// Открывает попап Google, возвращает access_token и время его жизни.
export async function requestGmailToken(): Promise<{
  accessToken: string
  expiresIn: number
}> {
  if (!CLIENT_ID) {
    throw new Error(
      'VITE_GOOGLE_CLIENT_ID не задан. Заведи OAuth-клиент в Google Cloud Console и пропиши его в .env.',
    )
  }
  await loadGis()
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || 'Google отклонил запрос'))
          return
        }
        resolve({
          accessToken: resp.access_token,
          expiresIn: resp.expires_in ?? 3600,
        })
      },
    })
    client.requestAccessToken()
  })
}

export async function fetchGmailProfile(
  token: string,
): Promise<{ emailAddress: string; messagesTotal: number }> {
  const res = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    throw new Error(`Не удалось получить профиль Gmail (${res.status})`)
  }
  return (await res.json()) as {
    emailAddress: string
    messagesTotal: number
  }
}
