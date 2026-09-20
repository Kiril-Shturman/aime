import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Copy as CopyIcon, KeyRound } from 'lucide-react'
import { Navbar, NavbarBackLink, Page } from 'konsta/react'
import { haptic } from '../lib/telegram'
import { useApp } from '../store/AppStore'

// Адрес доски берём из самой страницы: на любом домене подсказка верная.
const MCP_URL = typeof location === 'undefined' ? '' : location.origin

export default function McpKeysPage() {
  const nav = useNavigate()
  const { state } = useApp()
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Ключи не придумываем: доска выдаёт личный ключ каждому исполнителю,
  // когда его заводят в проекте. Здесь просто собираем их в одно место.
  const keys = useMemo(
    () =>
      (state?.projects ?? []).flatMap((project) =>
        project.members
          .filter((m) => m.kind === 'agent' || m.kind === 'bot')
          .filter((m) => !!m.key)
          .map((m) => ({
            id: `${project.id}:${m.id}`,
            label: m.name,
            project: project.name,
            projectId: project.id,
            kind: m.kind,
            key: m.key as string,
          })),
      ),
    [state?.projects],
  )

  const copyKey = async (id: string, key: string) => {
    haptic('success')
    try {
      await navigator.clipboard.writeText(key)
      setCopiedKey(id)
      window.setTimeout(() => setCopiedKey(null), 1500)
    } catch {
      /* без буфера — пусть выделяет руками */
    }
  }

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
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 px-3 py-2">
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
            <li>Заведите в проекте участника вида «ИИ-агент» — ключ выдаётся сразу</li>
            <li>Скопируйте адрес выше и вставьте в MCP-клиент</li>
            <li>В качестве Bearer-токена используйте ключ агента</li>
          </ol>
        </div>

        {/* Список ключей / пустой стейт */}
        <div className="mt-4 rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 overflow-hidden">
          {keys.length === 0 ? (
            <div className="p-6 text-center">
              <span className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 text-black/45 dark:text-white/40 mb-2">
                <KeyRound size={22} />
              </span>
              <div className="text-[15px] font-semibold text-black dark:text-white">
                Исполнителей пока нет
              </div>
              <div className="text-[13px] text-black/50 dark:text-white/45 mt-1">
                Заведите в проекте агента или бота — его ключ появится здесь
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-black/[.06] dark:divide-white/[.06]">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-9 h-9 rounded-full flex items-center justify-center bg-[#2a8bff]/12 text-[#2a8bff]">
                    <KeyRound size={16} />
                  </span>
                  <button
                    type="button"
                    onClick={() => nav(`/project/${k.projectId}`)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="text-[15px] font-semibold text-black dark:text-white truncate">
                      {k.label}
                    </div>
                    <div className="text-[12px] text-black/45 dark:text-white/40 truncate">
                      {k.kind === 'agent' ? 'ИИ-агент' : 'Бот'} · {k.project}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => copyKey(k.id, k.key)}
                    aria-label="Скопировать ключ"
                    className="shrink-0 h-9 px-3 rounded-full text-[13px] font-medium text-[#2a8bff] active:bg-ios-light-surface-1 dark:active:bg-white/[.06] inline-flex items-center gap-1"
                  >
                    {copiedKey === k.id ? (
                      <>
                        <Check size={14} /> Готово
                      </>
                    ) : (
                      <>
                        <CopyIcon size={14} /> Ключ
                      </>
                    )}
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
