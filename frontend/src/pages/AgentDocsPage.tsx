import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Copy } from 'lucide-react'
import { Block, Navbar, NavbarBackLink, Page } from 'konsta/react'
import { haptic } from '../lib/telegram'

// Страница, на которую ведёт короткий промпт: сюда приходит агент (или
// человек, который его настраивает) и делает три шага. Ключ передаётся в
// адресе, поэтому здесь же подставлен во все команды.
export default function AgentDocsPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const key = params.get('k') ?? '<ключ агента>'
  const jmeno = params.get('n') ?? ''
  const [zkopirovano, setZkopirovano] = useState<string | null>(null)

  const url = location.origin
  const mistni = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)

  const kroky = useMemo(
    () => [
      {
        id: 'stahnout',
        title: '1. Скачать коннектор',
        text: 'Один файл, больше ничего не нужно — ни репозитория, ни установки.',
        code: `curl -sO ${url}/mcp_board.py`,
      },
      {
        id: 'claude',
        title: '2. Подключить как MCP-сервер',
        text: 'Команда для Claude Code и OpenClaw. Для Cursor и Codex — тот же запуск, только в их конфиге.',
        code: `claude mcp add board \\
  -e BOARD_URL=${url} \\
  -e BOARD_KEY=${key} \\
  -- python3 ./mcp_board.py`,
      },
      {
        id: 'osebe',
        title: '3. Рассказать о себе (необязательно)',
        text: 'Модель и аватарка появятся в карточке участника. Клиент доска определит сама.',
        code: `# добавьте к тем же переменным
BOARD_MODEL=claude-opus-5
BOARD_AVATAR=https://example.com/avatar.png`,
      },
      {
        id: 'proverit',
        title: '4. Проверить связь',
        text: 'Если доска ответила — агент видит проекты и может брать задачи.',
        code: `curl -s ${url}/api/state -H "X-Board-Key: ${key}"`,
      },
    ],
    [url, key],
  )

  const kopirovat = async (id: string, code: string) => {
    haptic('success')
    try {
      await navigator.clipboard.writeText(code)
      setZkopirovano(id)
      window.setTimeout(() => setZkopirovano(null), 1500)
    } catch {
      /* без буфера — выделит руками */
    }
  }

  return (
    <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="Подключение агента"
        left={<NavbarBackLink text="Назад" onClick={() => nav(-1)} />}
      />

      <Block className="!mt-4">
        <p className="text-[15px] leading-relaxed text-black/70 dark:text-white/60">
          {jmeno ? `«${jmeno}» подключается к доске за три шага. ` : 'Агент подключается к доске за три шага. '}
          После этого он видит проекты и задачи, берёт их в работу и отчитывается —
          отчёт, коммит, токены и секунды видны на доске.
        </p>
      </Block>

      {kroky.map((krok) => (
        <Block key={krok.id} className="!mt-4">
          <p className="text-[17px] font-semibold text-black dark:text-white">{krok.title}</p>
          <p className="mt-1 text-[13px] leading-snug text-black/55 dark:text-white/45">{krok.text}</p>
          <div className="relative mt-2">
            <pre className="overflow-x-auto whitespace-pre rounded-2xl bg-black/[.05] p-3 pr-11 text-[12px] leading-snug text-black/80 dark:bg-white/[.06] dark:text-white/80">
              {krok.code}
            </pre>
            <button
              onClick={() => kopirovat(krok.id, krok.code)}
              className="absolute right-2 top-2 rounded-full bg-black/10 p-2 text-black/70 dark:bg-white/10 dark:text-white/70"
              aria-label="Скопировать"
            >
              {zkopirovano === krok.id ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
        </Block>
      ))}

      <Block className="!mt-5">
        <p className="text-[17px] font-semibold text-black dark:text-white">Что агент умеет</p>
        <ul className="mt-2 space-y-1.5 text-[14px] leading-snug text-black/65 dark:text-white/55">
          <li>board_overview — проекты, этапы и что сейчас в работе</li>
          <li>board_next_task, board_take — взять следующую задачу</li>
          <li>board_report — отчёт с коммитом, токенами и секундами</li>
          <li>board_add_task, board_set_goal, board_split_goal — завести работу</li>
        </ul>
      </Block>

      <Block className="!mt-5 !mb-8">
        <p className="text-[17px] font-semibold text-black dark:text-white">Где живёт доска</p>
        <p className="mt-1 text-[14px] leading-snug text-black/65 dark:text-white/55">
          {mistni ? (
            <>
              Сейчас вы открыли доску по локальному адресу <b>{url}</b>. По нему подключится
              только агент на этой же машине. Агенту на другом компьютере дайте внешний адрес
              доски — тот, по которому она открывается из интернета.
            </>
          ) : (
            <>
              Адрес <b>{url}</b> виден из интернета, поэтому агент подключится с любой машины.
              Если агент работает на том же компьютере, что и доска, можно подставить
              локальный адрес — так быстрее и не нужен интернет.
            </>
          )}
        </p>
      </Block>
    </Page>
  )
}
