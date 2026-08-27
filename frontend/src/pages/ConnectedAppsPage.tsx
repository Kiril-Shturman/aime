import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppWindow, Trash2 } from 'lucide-react'
import { Navbar, NavbarBackLink, Page } from 'konsta/react'
import { haptic } from '../lib/telegram'

// Модель авторизации приложения — как в ai-webapi
// connected-apps.component.ts. Пока заглушки.
interface AppConnection {
  authorizationId: string
  clientId: string
  clientName: string
  createdAt: string
  scopes: string[]
}

const INITIAL_APPS: AppConnection[] = [
  {
    authorizationId: 'a1',
    clientId: 'openclaw',
    clientName: 'OpenClaw',
    createdAt: '2026-08-20',
    scopes: ['chat.read', 'chat.write', 'mcp.tools'],
  },
  {
    authorizationId: 'a2',
    clientId: 'raycast',
    clientName: 'Raycast',
    createdAt: '2026-08-15',
    scopes: ['chat.write'],
  },
]

const initial = (a: AppConnection) =>
  (a.clientName || a.clientId).trim().charAt(0).toUpperCase() || '?'

export default function ConnectedAppsPage() {
  const nav = useNavigate()
  const [apps, setApps] = useState<AppConnection[]>(INITIAL_APPS)

  const revoke = (id: string) => {
    haptic('warning')
    setApps((prev) => prev.filter((a) => a.authorizationId !== id))
  }

  return (
    <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="Подключённые приложения"
        left={<NavbarBackLink text="Назад" onClick={() => nav(-1)} />}
      />

      <div className="mx-auto w-full max-w-[560px] px-safe-4 mt-4">
        {/* Интро */}
        <div className="rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 p-5">
          <div className="text-[17px] font-semibold text-black dark:text-white mb-1">
            Доступ через OAuth
          </div>
          <div className="text-[13px] text-black/55 dark:text-white/50 leading-relaxed">
            Приложения, которым вы разрешили доступ к своему аккаунту.
            Отозвать доступ можно в любой момент.
          </div>
        </div>

        {/* Список / пустой стейт */}
        <div className="mt-4 rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 overflow-hidden">
          {apps.length === 0 ? (
            <div className="p-6 text-center">
              <span className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-black/[.05] dark:bg-white/[.06] text-black/45 dark:text-white/40 mb-2">
                <AppWindow size={22} />
              </span>
              <div className="text-[15px] font-semibold text-black dark:text-white">
                Пока нет подключений
              </div>
              <div className="text-[13px] text-black/50 dark:text-white/45 mt-1">
                Здесь появятся приложения, которым вы разрешили доступ
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-black/[.06] dark:divide-white/[.06]">
              {apps.map((a) => (
                <li key={a.authorizationId} className="flex items-start gap-3 px-4 py-3">
                  <span className="w-10 h-10 rounded-[12px] bg-[#2a8bff] text-white flex items-center justify-center font-semibold text-[16px] shrink-0">
                    {initial(a)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-semibold text-black dark:text-white truncate">
                      {a.clientName || a.clientId}
                    </div>
                    <div className="text-[12px] text-black/45 dark:text-white/40 truncate">
                      Подключено{' '}
                      {new Date(a.createdAt).toLocaleDateString('ru-RU')}
                    </div>
                    {a.scopes.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {a.scopes.map((s) => (
                          <span
                            key={s}
                            className="text-[11px] px-2 py-0.5 rounded-full bg-black/[.05] dark:bg-white/[.06] text-black/60 dark:text-white/55"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => revoke(a.authorizationId)}
                    aria-label="Отозвать доступ"
                    className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-[#ff453a] active:bg-black/[.05] dark:active:bg-white/[.06]"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Page>
  )
}
