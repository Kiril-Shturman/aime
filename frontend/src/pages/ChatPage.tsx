import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, Paperclip } from 'lucide-react'
import {
  Link as KLink,
  Messagebar,
  Message,
  Messages,
  MessagesTitle,
  Navbar,
  NavbarBackLink,
  Page,
  ToolbarPane,
} from 'konsta/react'

interface ChatMsg {
  type: 'sent' | 'received'
  name?: string
  text: string
  avatar?: string
}

interface Model {
  id: string
  name: string
  desc: string
  free?: boolean
}

interface Seed {
  title: string
  avatar: string
  models: Model[]
  messages: ChatMsg[]
}

const SEED: Record<string, Seed> = {
  '1': {
    title: 'ChatGPT',
    avatar: '/providers/gpt.png',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', desc: 'Быстрая и универсальная' },
      { id: 'gpt-4', name: 'GPT-4', desc: 'Точная, чуть медленнее' },
      { id: 'gpt-3.5', name: 'GPT-3.5', desc: 'Дешёвая и простая', free: true },
    ],
    messages: [
      { type: 'sent', text: 'Помоги написать письмо клиенту про перенос сроков' },
      {
        type: 'received',
        name: 'ChatGPT',
        avatar: '/providers/gpt.png',
        text: 'Конечно. Уточним контекст: кому именно, что за проект и на какие новые сроки переносим?',
      },
      { type: 'sent', text: 'Иван, релиз API. Было 25.08, теперь 05.09.' },
    ],
  },
  '2': {
    title: 'Claude',
    avatar: '/providers/claude.png',
    models: [
      { id: 'sonnet-3.5', name: 'Claude 3.5 Sonnet', desc: 'Основная модель' },
      { id: 'haiku', name: 'Claude 3.5 Haiku', desc: 'Быстрая', free: true },
      { id: 'opus', name: 'Claude 3 Opus', desc: 'Самая умная' },
    ],
    messages: [
      { type: 'sent', text: 'Разбери, пожалуйста, ТЗ на посадочную' },
      {
        type: 'received',
        name: 'Claude',
        avatar: '/providers/claude.png',
        text: 'Давайте так: пришли ТЗ или ссылку, я вычленю блоки, цели, метрики и подсвечу пробелы.',
      },
    ],
  },
  '3': {
    title: 'Midjourney',
    avatar: '/providers/midjourney.png',
    models: [{ id: 'v6.1', name: 'Midjourney v6.1', desc: 'Реалистичные картинки' }],
    messages: [
      { type: 'sent', text: 'Постер к концерту — тёмный акварельный стиль' },
      {
        type: 'received',
        name: 'Midjourney',
        avatar: '/providers/midjourney.png',
        text: 'Ок. Сформулируй сцену: город, инструмент, толпа? Дай ключевые референсы.',
      },
    ],
  },
}

// Верхний блок выбора модели: строка «Модель · описание · шеврон»,
// по тапу раскрывается список. Пришло из ai-webapi (simple-header).
function ModelSelector({
  models,
  selected,
  onSelect,
}: {
  models: Model[]
  selected: Model
  onSelect: (m: Model) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mx-safe-4 my-3 rounded-2xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 overflow-hidden">
      <button
        type="button"
        onClick={() => models.length > 1 && setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[15px] font-semibold text-black dark:text-white truncate">
              {selected.name}
            </span>
            {selected.free && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[#30d158]/20 text-[#30d158]">
                FREE
              </span>
            )}
          </div>
          <div className="text-[12px] text-black/50 dark:text-white/45 truncate mt-0.5">
            {selected.desc}
          </div>
        </div>
        {models.length > 1 && (
          <ChevronDown
            size={20}
            className={`text-black/45 dark:text-white/45 shrink-0 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        )}
      </button>

      {open && (
        <div className="border-t border-black/[.06] dark:border-white/[.06]">
          {models.map((m) => {
            const active = m.id === selected.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSelect(m)
                  setOpen(false)
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-black/[.03] dark:active:bg-white/[.04]"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-black dark:text-white truncate">
                      {m.name}
                    </span>
                    {m.free && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[#30d158]/20 text-[#30d158]">
                        FREE
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-black/50 dark:text-white/45 truncate mt-0.5">
                    {m.desc}
                  </div>
                </div>
                {active && (
                  <span className="text-[#2a8bff] text-[17px] leading-none">✓</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function ChatPage() {
  const { id = '1' } = useParams()
  const navigate = useNavigate()
  const seed = SEED[id] ?? SEED['1']

  const [messages, setMessages] = useState<ChatMsg[]>(seed.messages)
  const [text, setText] = useState('')
  const [model, setModel] = useState<Model>(seed.models[0])

  const pageRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = pageRef.current as unknown as HTMLElement | null
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    setMessages((m) => [...m, { type: 'sent', text: trimmed }])
    setText('')
  }

  const canSend = text.trim().length > 0

  const nowLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date()),
    [],
  )

  return (
    <Page
      ref={pageRef as unknown as React.RefObject<HTMLDivElement>}
      className="ios:bg-white ios:dark:bg-black"
    >
      <Navbar
        title={seed.title}
        left={<NavbarBackLink text="Назад" onClick={() => navigate(-1)} />}
      />

      <ModelSelector
        models={seed.models}
        selected={model}
        onSelect={setModel}
      />

      <Messages>
        <MessagesTitle>{nowLabel}</MessagesTitle>
        {messages.map((m, i) => (
          <Message
            key={i}
            type={m.type}
            name={m.name}
            text={m.text}
            avatar={
              m.type === 'received' && m.avatar ? (
                <img
                  alt=""
                  src={m.avatar}
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : undefined
            }
          />
        ))}
      </Messages>

      <Messagebar
        className="z-20 [&_textarea]:!min-h-[44px] [&_textarea]:!py-3 [&_textarea]:!text-[16px]"
        placeholder="Сообщение"
        value={text}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        left={
          <ToolbarPane className="ios:h-10">
            <KLink onClick={() => {}} iconOnly>
              <Paperclip size={22} />
            </KLink>
          </ToolbarPane>
        }
        right={
          <ToolbarPane className="ios:h-10">
            <KLink
              onClick={canSend ? send : undefined}
              iconOnly
              style={{
                opacity: canSend ? 1 : 0.3,
                cursor: canSend ? 'pointer' : 'default',
              }}
            >
              <svg
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
                width="1em"
                height="1em"
                viewBox="0 0 56 56"
                className={`w-7 h-7${canSend ? ' text-[#2a8bff]' : ''}`}
                aria-hidden="true"
              >
                <path d="M 27.9999 51.9063 C 41.0546 51.9063 51.9063 41.0781 51.9063 28 C 51.9063 14.9453 41.0312 4.0937 27.9765 4.0937 C 14.8983 4.0937 4.0937 14.9453 4.0937 28 C 4.0937 41.0781 14.9218 51.9063 27.9999 51.9063 Z M 27.9999 14.8516 C 28.5624 14.8516 29.0077 15.0859 29.5234 15.5781 L 38.1483 24.2266 C 38.4530 24.5547 38.6874 25 38.6874 25.5390 C 38.6874 26.5937 37.8671 27.4141 36.8124 27.4141 C 36.2499 27.4141 35.7812 27.2031 35.4530 26.8516 L 32.3124 23.6641 L 29.7109 20.5703 L 29.9218 25.9844 L 29.9218 39.2734 C 29.9218 40.3984 29.1249 41.1719 27.9999 41.1719 C 26.8749 41.1719 26.0780 40.3984 26.0780 39.2734 L 26.0780 25.9844 L 26.2655 20.5937 L 23.7109 23.6641 L 20.5468 26.8516 C 20.2187 27.1797 19.7265 27.4141 19.1874 27.4141 C 18.1093 27.4141 17.3358 26.5937 17.3358 25.5390 C 17.3358 25 17.5234 24.5547 17.8514 24.2266 L 26.4999 15.5781 C 27.0155 15.0625 27.4374 14.8516 27.9999 14.8516 Z" />
              </svg>
            </KLink>
          </ToolbarPane>
        }
      />
    </Page>
  )
}
