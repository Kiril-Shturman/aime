import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Copy as CopyIcon, KeyRound, Trash2 } from 'lucide-react'
import { Navbar, NavbarBackLink, Page } from 'konsta/react'
import { haptic } from '../lib/telegram'

// Модель ключа — как в ai-webapi mcp-keys.component.ts (id/label/created).
interface McpKey {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
}

// URL мини-аппы для MCP-подключения; при выкате в прод — заменить на боевой.
const MCP_URL = 'https://aime.example/mcp'

export default function McpKeysPage() {
  const nav = useNavigate()
  const [keys, setKeys] = useState<McpKey[]>([])
  const [copiedUrl, setCopiedUrl] = useState(false)

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(MCP_URL)
      setCopiedUrl(true)
      window.setTimeout(() => setCopiedUrl(false), 1400)
      haptic('light')
    } catch {
      /* clipboard недоступен */
    }
  }

  const createKey = () => {
    haptic('light')
    const now = new Date().toISOString()
    setKeys((prev) => [
      {
        id: crypto.randomUUID(),
        label: `Ключ ${prev.length + 1}`,
        createdAt: now,
        lastUsedAt: null,
      },
      ...prev,
    ])
  }

  const revoke = (id: string) => {
    haptic('warning')
    setKeys((prev) => prev.filter((k) => k.id !== id))
  }

  return (
    <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="MCP-ключи"
        left={<NavbarBackLink text="Назад" onClick={() => nav(-1)} />}
      />

      <div className="mx-auto w-full max-w-[560px] px-safe-4 mt-4">
        {/* Интро */}
        <div className="rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 p-5">
          <div className="text-[17px] font-semibold text-black dark:text-white mb-1">
            Подключение по MCP
          </div>
          <div className="text-[13px] text-black/55 dark:text-white/50 leading-relaxed">
            Подключайте aiMe как MCP-сервер к OpenClaw, Claude Desktop,
            Cursor и другим клиентам. Для доступа нужен URL и ключ.
          </div>

          {/* URL: код + копия */}
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-black/[.05] dark:bg-white/[.06] px-3 py-2">
            <code className="flex-1 min-w-0 text-[13px] font-mono text-black dark:text-white truncate">
              {MCP_URL}
            </code>
            <button
              type="button"
              onClick={copyUrl}
              className="shrink-0 h-8 px-2.5 rounded-lg text-[13px] font-medium text-[#2a8bff] active:opacity-60 inline-flex items-center gap-1"
            >
              {copiedUrl ? (
                <>
                  <Check size={14} /> Скопировано
                </>
              ) : (
                <>
                  <CopyIcon size={14} /> Копировать
                </>
              )}
            </button>
          </div>

          <ol className="mt-4 pl-4 list-decimal text-[13px] text-black/60 dark:text-white/50 space-y-1">
            <li>Создайте ключ ниже</li>
            <li>Скопируйте URL и вставьте в MCP-клиент</li>
            <li>В качестве Bearer-токена используйте ключ</li>
          </ol>
        </div>

        {/* Кнопка создать */}
        <button
          type="button"
          onClick={createKey}
          className="mt-4 w-full h-11 rounded-full bg-[#2a8bff] text-white text-[15px] font-semibold active:opacity-80"
        >
          Создать ключ
        </button>

        {/* Список ключей / пустой стейт */}
        <div className="mt-4 rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 overflow-hidden">
          {keys.length === 0 ? (
            <div className="p-6 text-center">
              <span className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-black/[.05] dark:bg-white/[.06] text-black/45 dark:text-white/40 mb-2">
                <KeyRound size={22} />
              </span>
              <div className="text-[15px] font-semibold text-black dark:text-white">
                Ключей пока нет
              </div>
              <div className="text-[13px] text-black/50 dark:text-white/45 mt-1">
                Создайте первый ключ — он появится здесь
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-black/[.06] dark:divide-white/[.06]">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-9 h-9 rounded-full flex items-center justify-center bg-[#2a8bff]/12 text-[#2a8bff]">
                    <KeyRound size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-semibold text-black dark:text-white truncate">
                      {k.label}
                    </div>
                    <div className="text-[12px] text-black/45 dark:text-white/40 truncate">
                      Создан{' '}
                      {new Date(k.createdAt).toLocaleDateString('ru-RU')}
                      {k.lastUsedAt
                        ? ` · использован ${new Date(k.lastUsedAt).toLocaleDateString('ru-RU')}`
                        : ' · ещё не использован'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => revoke(k.id)}
                    aria-label="Удалить ключ"
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
