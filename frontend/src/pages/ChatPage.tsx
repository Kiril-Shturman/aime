import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, ChevronLeft, Clock, Paperclip, Plus } from 'lucide-react'
import {
  Link as KLink,
  Messagebar,
  Message,
  Messages,
  MessagesTitle,
  Page,
  Popover,
  ToolbarPane,
} from 'konsta/react'
import {
  CHAT_PROVIDERS,
  findProvider,
  type ChatProvider,
  type ProviderModel,
} from '../lib/providers'
import { sendMessage, type OutgoingMessage } from '../lib/chatClient'

interface ChatMsg {
  type: 'sent' | 'received'
  name?: string
  text: string
  avatar?: string
}

// Плашка с аватаркой провайдера. Если картинки нет — цветной кружок с буквой.
function ProviderAvatar({
  provider,
  size,
}: {
  provider: ChatProvider
  size: number
}) {
  if (provider.avatar) {
    return (
      <img
        alt=""
        src={provider.avatar}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  const letter = provider.name.trim().charAt(0).toUpperCase() || '?'
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: provider.color,
        fontSize: Math.round(size * 0.45),
      }}
    >
      {letter}
    </span>
  )
}

// Стекло из дизайн-системы Konsta (те же токены, что у k-Navbar иконок):
// bg-ios-light-glass + shadow-ios-light-glass + backdrop-blur-lg + k-glass.
// Форма — rounded-full, фиксированная высота 44px (iOS-стандарт).
const PILL =
  'inline-flex items-center h-11 rounded-full transform-gpu ' +
  'bg-ios-light-glass shadow-ios-light-glass backdrop-blur-lg k-glass ' +
  'dark:bg-ios-dark-glass dark:shadow-ios-dark-glass touch-none'

// Шапка чата: три стеклянные пилюли (левая — back+аватар, центральная —
// провайдер/модель + выпадашка с моделями, правая — история + новый чат).
// Прибита фиксировано к верху окна поверх сообщений; для контента добавляем
// верхний паддинг ~72px.
function ChatHeader({
  provider,
  model,
  models,
  onSelectModel,
  onSelectProvider,
  onBack,
}: {
  provider: ChatProvider
  model: ProviderModel
  models: ProviderModel[]
  onSelectModel: (m: ProviderModel) => void
  onSelectProvider: (p: ChatProvider) => void
  onBack: () => void
}) {
  const [modelsOpen, setModelsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const modelBtnRef = useRef<HTMLButtonElement | null>(null)
  const avatarBtnRef = useRef<HTMLButtonElement | null>(null)

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 pt-[max(8px,env(safe-area-inset-top))] md:left-[var(--sidebar-width,18rem)]">
        <div className="pointer-events-auto mx-auto flex max-w-[1000px] items-center gap-2 px-3">
          {/* левая пилюля: назад + новый чат */}
          <div className={`${PILL} shrink-0 justify-center text-black dark:text-white`}>
            <KLink
              iconOnly
              onClick={onBack}
              aria-label="Назад"
              className="aspect-square h-full max-h-11 !text-black dark:!text-white"
            >
              <ChevronLeft size={20} strokeWidth={2.5} />
            </KLink>
            <KLink
              iconOnly
              onClick={() => {}}
              aria-label="Новый чат"
              className="aspect-square h-full max-h-11 !text-black dark:!text-white"
            >
              <Plus size={20} strokeWidth={2.5} />
            </KLink>
          </div>

          {/* центральная пилюля — provider + model, клик открывает Popover */}
          <button
            ref={modelBtnRef}
            type="button"
            onClick={() => models.length > 1 && setModelsOpen(true)}
            className={`${PILL} flex-1 min-w-0 flex-col items-center justify-center px-5 py-1.5 text-black dark:text-white`}
          >
            <span className="max-w-full truncate text-[13px] font-normal leading-tight opacity-70">
              {provider.name}
            </span>
            <span className="flex max-w-full items-center gap-1.5">
              <span className="truncate text-[16px] font-semibold leading-tight">
                {model.name}
              </span>
              {model.free && (
                <span className="rounded-md bg-[#30d158]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#30d158]">
                  FREE
                </span>
              )}
              {models.length > 1 && (
                <ChevronDown
                  size={14}
                  className={`shrink-0 opacity-70 transition-transform ${modelsOpen ? 'rotate-180' : ''}`}
                />
              )}
            </span>
          </button>

          {/* правая пилюля: история + аватарка провайдера (клик = About-попап) */}
          <div className={`${PILL} shrink-0 justify-center pr-1.5 text-black dark:text-white`}>
            <KLink
              iconOnly
              onClick={() => {}}
              aria-label="История"
              className="aspect-square h-full max-h-11 !text-black dark:!text-white"
            >
              <Clock size={20} strokeWidth={2} />
            </KLink>
            <button
              ref={avatarBtnRef}
              type="button"
              onClick={() => setAboutOpen(true)}
              className="ml-0.5 rounded-full active:opacity-70"
              aria-label={`Сменить провайдера · сейчас ${provider.name}`}
            >
              <ProviderAvatar provider={provider} size={32} />
            </button>
          </div>
        </div>
      </div>

      {/* Popover со списком моделей — привязан к центральной пилюле */}
      <Popover
        opened={modelsOpen}
        target={modelBtnRef.current}
        onBackdropClick={() => setModelsOpen(false)}
        className="!w-72 !mt-2"
      >
        <div className="py-1">
          {models.map((m, i) => {
            const active = m.id === model.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSelectModel(m)
                  setModelsOpen(false)
                }}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/5 dark:active:bg-white/[.06] ${
                  i > 0 ? 'border-t border-black/[.06] dark:border-white/[.06]' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-black dark:text-white">
                      {m.name}
                    </span>
                    {m.free && (
                      <span className="rounded-md bg-[#30d158]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#30d158]">
                        FREE
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-black/50 dark:text-white/45">
                    {m.desc}
                  </div>
                </div>
                {active && (
                  <span className="text-[17px] leading-none text-[#2a8bff]">✓</span>
                )}
              </button>
            )
          })}
        </div>
      </Popover>

      {/* Popover-переключатель провайдера — весь реестр списком, с
          активной галочкой на текущем. Клик = переход на /chat/${slug}. */}
      <Popover
        opened={aboutOpen}
        target={avatarBtnRef.current}
        onBackdropClick={() => setAboutOpen(false)}
        className="!w-72 !mt-2"
      >
        <div className="max-h-[70vh] overflow-y-auto py-1">
          {CHAT_PROVIDERS.map((p, i) => {
            const active = p.slug === provider.slug
            return (
              <button
                key={p.slug}
                type="button"
                onClick={() => {
                  setAboutOpen(false)
                  if (!active) onSelectProvider(p)
                }}
                // Компактнее F7-дефолтов, но с той же композицией:
                // min-h 44px, gap 12px, avatar 32px, title 15px.
                className={`flex w-full min-h-[44px] items-center gap-3 px-4 text-left active:bg-black/[.04] dark:active:bg-white/[.04] ${
                  i > 0 ? 'border-t border-black/[.06] dark:border-white/[.06]' : ''
                }`}
              >
                <ProviderAvatar provider={p} size={32} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-black dark:text-white">
                  {p.name}
                </span>
                {active && (
                  <span className="shrink-0 text-[17px] leading-none text-[#2a8bff]">
                    ✓
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </Popover>
    </>
  )
}

export default function ChatPage() {
  const { provider: slug } = useParams<{ provider: string }>()
  const navigate = useNavigate()
  const provider = findProvider(slug)

  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [text, setText] = useState('')
  const [model, setModel] = useState<ProviderModel | null>(
    provider?.models[0] ?? null,
  )
  const [sending, setSending] = useState(false)

  // При смене провайдера через URL — сброс модели на дефолт и очистка истории
  useEffect(() => {
    setMessages([])
    setModel(provider?.models[0] ?? null)
  }, [slug, provider])

  const pageRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = pageRef.current as unknown as HTMLElement | null
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!provider || !model) return
    const trimmed = text.trim()
    if (!trimmed || sending) return
    const nextMessages: ChatMsg[] = [
      ...messages,
      { type: 'sent', text: trimmed },
    ]
    setMessages(nextMessages)
    setText('')
    setSending(true)
    try {
      const outgoing: OutgoingMessage[] = nextMessages.map((m) => ({
        role: m.type === 'sent' ? 'user' : 'assistant',
        content: m.text,
      }))
      const reply = await sendMessage(provider.slug, model.id, outgoing)
      setMessages((prev) => [
        ...prev,
        {
          type: 'received',
          name: provider.name,
          text: reply,
          avatar: provider.avatar ?? undefined,
        },
      ])
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          type: 'received',
          name: provider.name,
          text: `Не получилось получить ответ: ${String(error)}`,
        },
      ])
    } finally {
      setSending(false)
    }
  }

  const canSend = !!provider && !!model && text.trim().length > 0 && !sending

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

  if (!provider) {
    return (
      <Page>
        <div className="px-4 pt-safe-24 pb-6 text-black/60 dark:text-white/60">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-3 text-[15px] text-[#2a8bff]"
          >
            ← Назад
          </button>
          Неизвестный провайдер «{slug}». Открой чат из каталога на странице
          «Генерация».
        </div>
      </Page>
    )
  }

  return (
    <Page ref={pageRef as unknown as React.RefObject<HTMLDivElement>}>
      {model && (
        <ChatHeader
          provider={provider}
          model={model}
          models={provider.models}
          onSelectModel={setModel}
          onSelectProvider={(p) => navigate(`/chat/${p.slug}`)}
          onBack={() => navigate(-1)}
        />
      )}

      {/* Отступ под фиксированной трёхпилюльной шапкой */}
      <div className="h-[calc(env(safe-area-inset-top)+64px)]" />


      {/* Konsta Messages не пробрасывает className — оборачиваем в div,
          чтобы центрировать ленту тем же max-width, что у пилюли и ввода. */}
      <div className="md:max-w-[1000px] md:mx-auto">
      <Messages>
        <MessagesTitle>{nowLabel}</MessagesTitle>
        {messages.map((m, i) => (
          <Message
            key={i}
            type={m.type}
            name={m.name}
            text={m.text}
            avatar={
              m.type === 'received' ? (
                <ProviderAvatar provider={provider} size={32} />
              ) : undefined
            }
          />
        ))}
        {sending && (
          <Message
            type="received"
            name={provider.name}
            text="…"
            avatar={<ProviderAvatar provider={provider} size={32} />}
          />
        )}
      </Messages>
      </div>

      <Messagebar
        className="z-20 md:!w-auto md:!left-[calc(var(--sidebar-width,18rem)+max(0px,(100vw-var(--sidebar-width,18rem)-1000px)/2))] md:!right-[max(0px,calc((100vw-var(--sidebar-width,18rem)-1000px)/2))] [&_textarea]:!min-h-[44px] [&_textarea]:!py-3 [&_textarea]:!text-[16px]"
        placeholder={`Сообщение · ${provider.name}`}
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
