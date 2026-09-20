import { useEffect, useState } from 'react'
import { Bot, Check, Copy, User as UserIcon } from 'lucide-react'
import { Block, Button, List, ListInput, Segmented, SegmentedButton } from 'konsta/react'
import Popup from '../components/Popup'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'
import type { Member, MemberKind } from '../api/types'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
}

// Что отдаём наружу, чтобы чужой агент подключился к доске сам.
const SPOSOBY = [
  { id: 'promt', label: 'Промпт' },
  { id: 'claude', label: 'Claude' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'codex', label: 'Codex' },
] as const

// Коннектор агент скачивает с самой доски: curl -sO <адрес>/mcp_board.py
function recept(sposob: string, url: string, key: string, jmeno: string, role: string) {
  if (sposob === 'promt') {
    return `Подключись к доске задач aiMe — ты там участник «${jmeno}»${role ? ` (${role})` : ''}.
Инструкция и команды: ${url}/agent?k=${key}
Дальше бери задачи и отчитывайся по ним сам.`
  }
  if (sposob === 'claude') {
    return `curl -sO ${url}/mcp_board.py
claude mcp add board \\
  -e BOARD_URL=${url} \\
  -e BOARD_KEY=${key} \\
  -- python3 ./mcp_board.py`
  }
  if (sposob === 'cursor') {
    return `// ~/.cursor/mcp.json
{
  "mcpServers": {
    "board": {
      "command": "python3",
      "args": ["./mcp_board.py"],
      "env": { "BOARD_URL": "${url}", "BOARD_KEY": "${key}" }
    }
  }
}`
  }
  return `# ~/.codex/config.toml
[mcp_servers.board]
command = "python3"
args = ["./mcp_board.py"]
env = { BOARD_URL = "${url}", BOARD_KEY = "${key}" }`
}

export default function MemberSheet({ open, onClose, projectId }: Props) {
  const { refresh } = useApp()
  const [kind, setKind] = useState<MemberKind | null>(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [handle, setHandle] = useState('')
  const [hotovy, setHotovy] = useState<Member | null>(null)
  const [sposob, setSposob] = useState<string>('promt')
  const [zkopirovano, setZkopirovano] = useState(false)
  const [chyba, setChyba] = useState<string | null>(null)

  useEffect(() => {
    if (open) return
    // сбрасываем только после закрытия, чтобы не мигало на анимации
    const t = window.setTimeout(() => {
      setKind(null)
      setName('')
      setRole('')
      setHandle('')
      setHotovy(null)
      setSposob('promt')
      setChyba(null)
    }, 300)
    return () => window.clearTimeout(t)
  }, [open])

  const ulozit = async () => {
    if (!name.trim() || !kind) return
    try {
      const member = await api.addMember(projectId, {
        kind,
        name: name.trim(),
        role: role.trim() || undefined,
        handle: handle.trim() || undefined,
      })
      haptic('success')
      await refresh()
      // человеку показывать нечего — закрываемся; агенту даём подключение
      if (kind === 'agent') setHotovy(member)
      else onClose()
    } catch (e) {
      setChyba(String(e).replace(/^Error:\s*\d+\s*[^:]*:\s*/, ''))
    }
  }

  const text = hotovy
    ? recept(sposob, location.origin, hotovy.key ?? '', hotovy.name, hotovy.role ?? '')
    : ''

  const kopirovat = async () => {
    haptic('success')
    try {
      await navigator.clipboard.writeText(text)
      setZkopirovano(true)
      window.setTimeout(() => setZkopirovano(false), 1500)
    } catch {
      /* без буфера — выделит руками */
    }
  }

  const titulek = hotovy
    ? 'Подключение агента'
    : kind === 'agent'
      ? 'ИИ-агент'
      : kind === 'human'
        ? 'Человек'
        : 'Кого добавляем'

  return (
    <Popup open={open} onClose={onClose} title={titulek}>
      {/* шаг 1 — кто это */}
      {!kind && (
        <Block className="!mt-4 grid gap-3">
          <button
            type="button"
            onClick={() => setKind('agent')}
            className="flex items-center gap-4 rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 p-5 text-left active:opacity-75"
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
              <Bot size={26} />
            </span>
            <span>
              <span className="block text-[17px] font-semibold text-black dark:text-white">ИИ-агент</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-black/55 dark:text-white/45">
                Получит ключ и промпт: подключится к доске сам, будет брать задачи и отчитываться
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setKind('human')}
            className="flex items-center gap-4 rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 p-5 text-left active:opacity-75"
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-black/[.06] text-black/70 dark:bg-white/10 dark:text-white/70">
              <UserIcon size={26} />
            </span>
            <span>
              <span className="block text-[17px] font-semibold text-black dark:text-white">Человек</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-black/55 dark:text-white/45">
                Имя, роль и ник в Телеграме — чтобы назначать задачи
              </span>
            </span>
          </button>
        </Block>
      )}

      {/* шаг 2 — как зовут */}
      {kind && !hotovy && (
        <>
          <List strong inset>
            <ListInput
              label="Имя"
              type="text"
              placeholder={kind === 'agent' ? 'Например, Аналитик' : 'Например, Иван'}
              value={name}
              onChange={(e) => setName((e.target as HTMLInputElement).value)}
            />
            <ListInput
              label="Роль"
              type="text"
              placeholder={kind === 'agent' ? 'Что делает: смотрит метрики, пишет код' : 'Например, дизайнер'}
              value={role}
              onChange={(e) => setRole((e.target as HTMLInputElement).value)}
            />
            {kind === 'human' && (
              <ListInput
                label="Ник в Телеграме"
                type="text"
                placeholder="@username"
                value={handle}
                onChange={(e) => setHandle((e.target as HTMLInputElement).value)}
              />
            )}
          </List>

          {chyba && (
            <Block className="!mt-0">
              <p className="text-[14px] leading-snug text-[#ff9f0a]">{chyba}</p>
            </Block>
          )}

          <Block className="grid gap-2">
            <Button large rounded onClick={ulozit}>
              {kind === 'agent' ? 'Создать и подключить' : 'Добавить'}
            </Button>
            <Button large rounded clear onClick={() => setKind(null)}>
              Назад
            </Button>
          </Block>
        </>
      )}

      {/* шаг 3 — что отдать агенту */}
      {hotovy && (
        <>
          <Block className="!mb-0">
            <p className="text-[15px] leading-snug text-black/70 dark:text-white/60">
              «{hotovy.name}» заведён. Отдайте агенту одно из этого — он подключится к доске
              сам и дальше будет виден здесь: что взял, что сделал, во что обошлось.
            </p>
          </Block>

          <Block className="!mt-5">
            <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
              Чем подключаем
            </p>
            <Segmented strong rounded>
              {SPOSOBY.map((s) => (
                <SegmentedButton
                  key={s.id}
                  active={sposob === s.id}
                  onClick={() => setSposob(s.id)}
                  className="!text-[14px] whitespace-nowrap"
                >
                  {s.label}
                </SegmentedButton>
              ))}
            </Segmented>

            <div className="relative mt-3">
              <pre className="max-h-[46dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-2xl bg-black/[.05] p-3 pr-11 text-[12px] leading-snug text-black/80 dark:bg-white/[.06] dark:text-white/80">
                {text}
              </pre>
              <button
                onClick={kopirovat}
                className="absolute right-2 top-2 rounded-full bg-black/10 p-2 text-black/70 dark:bg-white/10 dark:text-white/70"
                aria-label="Скопировать"
              >
                {zkopirovano ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>

            <p className="mt-2 text-[13px] leading-snug text-black/55 dark:text-white/40">
              Ключ личный: по нему доска понимает, кто взял задачу, и не пускает посторонних.
            </p>
          </Block>

          <Block>
            <Button large rounded onClick={onClose}>
              Готово
            </Button>
          </Block>
        </>
      )}
    </Popup>
  )
}
