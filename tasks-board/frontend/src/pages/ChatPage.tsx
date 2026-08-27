import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Clock,
  Copy as CopyIcon,
  Mic,
  MoreHorizontal,
  Pause,
  Paperclip,
  Play,
  Plus,
  Search,
} from 'lucide-react'
import MarkdownMessage from '../components/MarkdownMessage'
import MediaPicker, { type RecentMedia } from '../components/MediaPicker'
import PhotoBrowser, { type PhotoItem } from '../components/PhotoBrowser'
import MessageMenu, { Copy, Trash2 } from '../components/MessageMenu'
import { Pencil } from 'lucide-react'
import { showCopyToast } from '../components/CopyToast'
import { useLongPress } from '../lib/longPress'
import {
  Link as KLink,
  Messagebar,
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

// Вложение в сообщении: url для картинки/видео, name для файлов.
export interface MsgAttachment {
  kind: 'image' | 'video' | 'audio' | 'file'
  name: string
  url?: string // dataURL или blob-URL для картинок/видео/аудио
  mime?: string
}

interface ChatMsg {
  type: 'sent' | 'received'
  name?: string
  text: string
  avatar?: string
  attachments?: MsgAttachment[]
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

// Круглая стеклянная кнопка с синим кругом-фоном под иконкой — тот же
// визуальный шаблон, что у основной кнопки «отправить»: белая иконка
// на синем круге, обёрнутая в стеклянную капсулу.
// пока не вставлена в раскладку; экспорт нужен, чтобы сборка не падала
export function GlassCircleButton({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: () => void
  ariaLabel: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="w-11 h-11 rounded-full flex items-center justify-center
                 bg-ios-light-glass dark:bg-ios-dark-glass
                 shadow-ios-light-glass dark:shadow-ios-dark-glass backdrop-blur-lg
                 active:opacity-70"
    >
      <span className="w-7 h-7 rounded-full bg-[#2a8bff] flex items-center justify-center">
        {children}
      </span>
    </button>
  )
}

// Обёртка над сообщением: ловит долгое нажатие и правый клик для
// контекстного меню. Когда меню открыто именно для этого сообщения —
// приподнимает его над backdrop-ом и слегка увеличивает (iOS Messages).
function MessageWrapper({
  children,
  onLongPress,
  active,
}: {
  children: React.ReactNode
  onLongPress: (x: number, y: number) => void
  active: boolean
}) {
  const handlers = useLongPress(onLongPress)
  return (
    // flex-col — чтобы `self-end` у SentMessage внутри работал и правые
    // пузыри действительно уходили в правую часть, даже если строка длинная.
    <div
      {...handlers}
      className={`flex flex-col transition-transform duration-200 ease-out
                  [&_.k-message]:touch-callout-none [&_.k-message]:select-none ${
                    active
                      ? 'relative z-[95] scale-[1.03]'
                      : ''
                  }`}
    >
      {children}
    </div>
  )
}

// Пользовательское сообщение: сначала сетка вложений, затем текстовый
// пузырь. Картинки/видео кликаются — открывают PhotoBrowser.
function SentMessage({
  text,
  attachments,
  onOpenMedia,
}: {
  text: string
  attachments?: MsgAttachment[]
  onOpenMedia: (items: PhotoItem[], index: number) => void
}) {
  const media = (attachments ?? []).filter(
    (a) => a.kind === 'image' || a.kind === 'video',
  )
  const imgs = attachments?.filter((a) => a.kind === 'image') ?? []
  const vids = attachments?.filter((a) => a.kind === 'video') ?? []
  const auds = attachments?.filter((a) => a.kind === 'audio') ?? []
  const files = attachments?.filter((a) => a.kind === 'file') ?? []
  const photoItems: PhotoItem[] = media.map((a) => ({
    kind: a.kind as 'image' | 'video',
    url: a.url ?? '',
    name: a.name,
  }))
  const openAt = (a: MsgAttachment) =>
    onOpenMedia(
      photoItems,
      media.findIndex((m) => m === a),
    )
  return (
    <div className="k-message my-2 flex flex-col self-end items-end max-w-[70%] gap-1">
      {imgs.length > 0 && (
        <div
          className={`grid gap-1 w-full ${
            imgs.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
          }`}
        >
          {imgs.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => openAt(a)}
              className="block active:opacity-80"
            >
              <img
                src={a.url}
                alt={a.name}
                className="rounded-2xl object-cover w-full aspect-square cursor-zoom-in"
              />
            </button>
          ))}
        </div>
      )}
      {vids.map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={() => openAt(a)}
          className="block w-full"
        >
          <video
            src={a.url}
            className="rounded-2xl w-full max-h-[280px] bg-black cursor-zoom-in pointer-events-none"
          />
        </button>
      ))}
      {auds.map((a, i) => (
        <audio
          key={i}
          src={a.url}
          controls
          className="rounded-2xl w-full min-w-[240px]"
        />
      ))}
      {files.map((a, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-2xl bg-black/[.08] dark:bg-white/[.10] px-3 py-2 text-[13px] text-black dark:text-white max-w-full"
        >
          <Paperclip size={14} className="opacity-60 shrink-0" />
          <span className="truncate">{a.name}</span>
        </div>
      ))}
      {text && (
        <div className="rounded-2xl py-1.5 px-4 bg-primary text-white whitespace-pre-wrap [overflow-wrap:anywhere] max-w-full">
          {text}
        </div>
      )}
    </div>
  )
}

// Ответ ИИ: аватарка + имя сверху, ниже — markdown-рендер (заголовки,
// списки, таблицы, ссылки, блоки кода с подсветкой и кнопкой копирования).
function AiReply({
  name,
  text,
  provider,
}: {
  name: string
  text: string
  provider: ChatProvider
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      showCopyToast()
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard недоступен */
    }
  }
  return (
    <div className="k-message my-3 flex gap-3 items-start px-safe-2 group">
      <ProviderAvatar provider={provider} size={32} />
      <div className="flex-1 min-w-0 text-black dark:text-white text-[15px]">
        <div className="text-[12px] text-black/45 dark:text-white/45 mb-1">
          {name}
        </div>
        <MarkdownMessage text={text} />
        {/* Мини-бар действий под ответом: копия, регенерация и т.д.
            На десктопе появляется на hover, на мобилке всегда. */}
        <div className="mt-2 flex gap-1 opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 max-md:!opacity-100 transition-opacity">
          <button
            type="button"
            onClick={copy}
            aria-label="Скопировать ответ"
            className="w-8 h-8 rounded-full flex items-center justify-center text-black/60 dark:text-white/55 hover:bg-black/[.06] dark:hover:bg-white/[.08] transition"
          >
            {copied ? (
              <Check size={14} className="text-[#10B981]" />
            ) : (
              <CopyIcon size={14} />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// Чип-превью вложения над полем ввода. Для картинок показывает thumbnail,
// для остального — иконку скрепки.
function AttachmentChip({
  name,
  thumb,
  onRemove,
}: {
  name: string
  thumb?: string
  onRemove: () => void
}) {
  return (
    <span
      className="inline-flex items-center gap-2 pl-1.5 pr-1 h-9 rounded-full
                 bg-ios-light-glass dark:bg-ios-dark-glass
                 shadow-ios-light-glass dark:shadow-ios-dark-glass backdrop-blur-lg
                 text-[13px] text-black dark:text-white max-w-[240px]"
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          className="w-7 h-7 rounded-full object-cover shrink-0"
        />
      ) : (
        <Paperclip size={13} className="ml-1.5 opacity-60 shrink-0" />
      )}
      <span className="truncate">{name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="w-6 h-6 rounded-full flex items-center justify-center opacity-70 hover:opacity-100 shrink-0"
        aria-label="Убрать"
      >
        ×
      </button>
    </span>
  )
}

// Заглушка истории чатов: пока нет бэка, показываем несколько демо-строк.
// Позже подтянем реальные диалоги из ChatService.
interface HistoryChat {
  id: string
  title: string
  avatar: string
  time: string
  messageCount: number
}
const HISTORY_MOCK: HistoryChat[] = [
  { id: 'h1', title: 'Помоги написать письмо клиенту', avatar: '/providers/gpt.png', time: '2 ч', messageCount: 12 },
  { id: 'h2', title: 'Разбор ТЗ на посадочную', avatar: '/providers/claude.png', time: 'вчера', messageCount: 34 },
  { id: 'h3', title: 'Таблица по спринтам', avatar: '/providers/gemini.png', time: '3 д', messageCount: 8 },
  { id: 'h4', title: 'Идеи для лендинга', avatar: '/providers/gpt.png', time: '5 д', messageCount: 21 },
  { id: 'h5', title: 'Код на TypeScript, объясни', avatar: '/providers/claude.png', time: 'нед', messageCount: 47 },
]

// Поповер истории чатов: сверху — поиск, ниже — лента диалогов
// (аватарка модели, заголовок, время + число сообщений). Активный
// подсвечен синей заливкой.
function HistoryPopover({
  opened,
  target,
  onClose,
}: {
  opened: boolean
  target: HTMLElement | null
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const filtered = q
    ? HISTORY_MOCK.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()))
    : HISTORY_MOCK

  return (
    <Popover
      opened={opened}
      target={target}
      onBackdropClick={onClose}
      className="!w-72 !mt-5 md:!-ml-16"
    >
      <div className="rounded-4xl overflow-hidden">
        {/* Поиск */}
        <div className="p-2 border-b border-black/[.06] dark:border-white/[.08]">
          <label className="flex items-center gap-2 h-9 px-3 rounded-lg">
            <Search size={14} className="text-black/45 dark:text-white/45" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по чатам"
              className="flex-1 bg-transparent outline-none text-[13px] text-black dark:text-white placeholder-black/40 dark:placeholder-white/40"
            />
          </label>
        </div>
        {/* Лента */}
        <div className="max-h-[320px] overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-black/50 dark:text-white/40">
              {q ? 'Ничего не нашлось' : 'История пуста'}
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={onClose}
                className="w-full flex items-start gap-3 px-3 py-2 text-left active:bg-black/[.04] dark:active:bg-white/[.04]"
              >
                <img
                  src={c.avatar}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover shrink-0 bg-white"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-black dark:text-white truncate">
                    {c.title}
                  </div>
                  <div className="text-[11px] text-black/50 dark:text-white/40 mt-0.5">
                    {c.time} · {c.messageCount} сообщ.
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </Popover>
  )
}

// Поповер выбора провайдера: слева — круг-индикатор (пустой/синий с
// галкой), рядом аватарка и имя. При открытии автопрокрутка к активному.
function ProviderPickerPopover({
  opened,
  target,
  onClose,
  activeSlug,
  onPick,
}: {
  opened: boolean
  target: HTMLElement | null
  onClose: () => void
  activeSlug: string
  onPick: (p: ChatProvider) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!opened) return
    // Ждём одну анимационную рамку — контейнер уже смонтирован.
    const t = window.setTimeout(() => {
      activeRef.current?.scrollIntoView({ block: 'nearest' })
    }, 60)
    return () => window.clearTimeout(t)
  }, [opened])

  return (
    <Popover
      opened={opened}
      target={target}
      onBackdropClick={onClose}
      className="!w-60 !mt-5 md:!-ml-12"
    >
      <div
        ref={scrollRef}
        className="max-h-[288px] overflow-y-auto py-1 rounded-4xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {CHAT_PROVIDERS.map((p, i) => {
          const active = p.slug === activeSlug
          return (
            <button
              key={p.slug}
              ref={active ? activeRef : undefined}
              type="button"
              onClick={() => {
                onClose()
                if (!active) onPick(p)
              }}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[.04] dark:active:bg-white/[.04] ${
                i > 0
                  ? 'border-t border-black/[.06] dark:border-white/[.06]'
                  : ''
              }`}
            >
              {active ? (
                <span className="w-5 h-5 rounded-full bg-[#2a8bff] flex items-center justify-center shrink-0">
                  <Check size={12} className="text-white" strokeWidth={3.5} />
                </span>
              ) : (
                <span className="w-5 h-5 rounded-full border-2 border-black/25 dark:border-white/30 shrink-0" />
              )}
              <ProviderAvatar provider={p} size={28} />
              <span className="flex-1 min-w-0 truncate text-[15px] font-semibold text-black dark:text-white">
                {p.name}
              </span>
            </button>
          )
        })}
      </div>
    </Popover>
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
  lockModel = false,
  projectContext,
}: {
  provider: ChatProvider
  model: ProviderModel
  models: ProviderModel[]
  onSelectModel: (m: ProviderModel) => void
  onSelectProvider: (p: ChatProvider) => void
  onBack: () => void
  // В режиме собеседования модель зафиксирована: центральная пилюля
  // — не кнопка, шеврон и Popover со списком моделей не показываем.
  lockModel?: boolean
  // Проектный контекст: имя показываем в центральной пилюле, а под
  // тройкой пилюль рисуем полоску «понимания» 0–100%.
  projectContext?: {
    name: string
    pct: number
    onOpenReasoning?: () => void
    // «Три точки» вместо часов «Истории». Родитель ловит клик и
    // якорится к переданному элементу (тому, что тапнули), чтобы
    // самому нарисовать Menu — здесь мы про пункты не знаем.
    onMoreClick?: (anchor: HTMLAnchorElement) => void
  }
}) {
  const [modelsOpen, setModelsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const modelBtnRef = useRef<HTMLButtonElement | null>(null)
  const avatarBtnRef = useRef<HTMLButtonElement | null>(null)
  const historyBtnRef = useRef<HTMLAnchorElement | null>(null)

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30 pt-[max(16px,calc(env(safe-area-inset-top)+12px))] md:left-[var(--sidebar-width,18rem)]">
        <div className="pointer-events-auto flex items-center gap-2 pl-safe-4 pr-safe-4">
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

          {/* центральная пилюля — provider + model, клик открывает Popover.
              В режиме собеседования (lockModel) шеврон и клик убираем —
              модель выбираем мы, юзеру её менять нельзя. Внутри проекта
              вместо модели показываем имя проекта. */}
          <button
            ref={modelBtnRef}
            type="button"
            onClick={() => !lockModel && models.length > 1 && setModelsOpen(true)}
            className={`inline-flex flex-1 min-w-0 items-center justify-center gap-1.5 h-11 px-5 text-black dark:text-white ${
              lockModel ? 'cursor-default' : 'active:opacity-70'
            }`}
          >
            <span className="truncate text-[16px] font-semibold leading-tight">
              {projectContext ? projectContext.name : model.name}
            </span>
            {!projectContext && model.free && (
              <span className="rounded-md bg-[#30d158]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#30d158]">
                FREE
              </span>
            )}
            {!lockModel && models.length > 1 && (
              <ChevronDown
                size={14}
                className={`shrink-0 opacity-70 transition-transform ${modelsOpen ? 'rotate-180' : ''}`}
              />
            )}
          </button>

          {/* правая пилюля: история/меню + аватарка провайдера. В
              проектном режиме часы уступают место «трём точкам» — из
              них родитель раскрывает своё меню действий над проектом. */}
          <div className={`${PILL} shrink-0 justify-center pr-1.5 text-black dark:text-white`}>
            {projectContext ? (
              <KLink
                ref={historyBtnRef}
                iconOnly
                onClick={(e: React.MouseEvent<HTMLAnchorElement>) =>
                  projectContext.onMoreClick?.(e.currentTarget)
                }
                aria-label="Меню"
                className="aspect-square h-full max-h-11 !text-black dark:!text-white"
              >
                <MoreHorizontal size={22} strokeWidth={2} />
              </KLink>
            ) : (
              <KLink
                ref={historyBtnRef}
                iconOnly
                onClick={() => setHistoryOpen(true)}
                aria-label="История"
                className="aspect-square h-full max-h-11 !text-black dark:!text-white"
              >
                <Clock size={20} strokeWidth={2} />
              </KLink>
            )}
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

        {/* Полоска «понимания» проекта — рисуется в шапке под тройкой
            пилюль, только когда чат работает в контексте проекта.
            Клик — колбэк наверх, чтобы родитель показал детали. */}
        {projectContext && (
          <div className="pointer-events-auto mt-2 mx-safe-4">
            <button
              type="button"
              onClick={projectContext.onOpenReasoning}
              className="w-full flex items-center gap-3 px-4 h-9 rounded-full
                         bg-ios-light-glass dark:bg-ios-dark-glass shadow-ios-light-glass
                         dark:shadow-ios-dark-glass backdrop-blur-lg k-glass
                         text-left active:opacity-70"
            >
              <span className="text-[12px] font-semibold text-black/60 dark:text-white/60 shrink-0">
                Понимание
              </span>
              <span className="flex-1 h-1.5 rounded-full bg-black/[.08] dark:bg-white/[.12] overflow-hidden">
                <span
                  className="block h-full bg-[#2a8bff] rounded-full transition-[width] duration-500"
                  style={{ width: `${projectContext.pct}%` }}
                />
              </span>
              <span className="text-[12px] tabular-nums text-black/55 dark:text-white/50 shrink-0">
                {projectContext.pct}%
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Popover со списком моделей — привязан к центральной пилюле */}
      <Popover
        opened={modelsOpen}
        target={modelBtnRef.current}
        onBackdropClick={() => setModelsOpen(false)}
        className="!w-72 !mt-5"
      >
        <div className="py-1 rounded-4xl overflow-hidden">
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
                  <Check size={16} className="text-[#2a8bff] shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      </Popover>

      {/* Popover-переключатель провайдера — Checkbox Group: круг-индикатор
          слева, заливается синим когда выбран. При открытии список сам
          прокручивается к активной модели. */}
      <ProviderPickerPopover
        opened={aboutOpen}
        target={avatarBtnRef.current}
        onClose={() => setAboutOpen(false)}
        activeSlug={provider.slug}
        onPick={onSelectProvider}
      />

      {/* Поповер истории чатов с поиском вверху и лентой — как в
          113-profile2-konsta-styles ai-webapi. */}
      <HistoryPopover
        opened={historyOpen}
        target={historyBtnRef.current}
        onClose={() => setHistoryOpen(false)}
      />
    </>
  )
}

// Опциональные пропсы позволяют использовать эту же страницу как «чат
// внутри проекта»: жёстко задать провайдера, спрятать пикер модели и
// подсунуть данные проекта (имя + понимание в %) в шапку. Роут
// /chat/:provider работает по-прежнему — все пропсы необязательные.
export interface ChatPageProps {
  providerSlug?: string
  projectContext?: {
    name: string
    pct: number
    onOpenReasoning?: () => void
    // «Три точки» вместо часов «Истории». Родитель ловит клик и
    // якорится к переданному элементу (тому, что тапнули), чтобы
    // самому нарисовать Menu — здесь мы про пункты не знаем.
    onMoreClick?: (anchor: HTMLAnchorElement) => void
  }
}

export default function ChatPage({
  providerSlug,
  projectContext,
}: ChatPageProps = {}) {
  const { provider: routeSlug } = useParams<{ provider: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const slug = providerSlug ?? routeSlug
  const provider = findProvider(slug)

  // Режим «собеседование по проекту»: приходит из ProjectKickoff через
  // navigate state ИЛИ включается сразу, если страницу отрисовали из
  // ProjectPage с projectContext. Тут фиксируем модель, прячем её пикер
  // и в самом начале сами задаём первый вопрос ИИ (плюс, если
  // пользователь начал печатать на карточке, добавляем его текст первым
  // sent-сообщением).
  const nav = location.state as
    | { interview?: boolean; projectId?: string; seedPrompt?: string | null }
    | null
  const interviewMode = !!nav?.interview || !!projectContext

  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [text, setText] = useState('')
  // Файлы, свежевыбранные из системного диалога/камеры.
  const [attachments, setAttachments] = useState<File[]>([])
  // Файлы, взятые из «недавних» — File-объекта нет, но есть name + thumb.
  const [reused, setReused] = useState<RecentMedia[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  // Фотобраузер для тапа по картинке/видео в чате.
  const [browser, setBrowser] = useState<{
    items: PhotoItem[]
    index: number | null
  }>({ items: [], index: null })
  // Контекстное меню сообщения (долгий тап или правый клик).
  const [msgMenu, setMsgMenu] = useState<{
    x: number
    y: number
    idx: number
  } | null>(null)
  // Запись голосового: MediaRecorder API, тот же паттерн из ai-webapi
  // (input-bar.component.ts → startRecording/stopRecording).
  const [isRec, setIsRec] = useState(false)
  const [recTime, setRecTime] = useState(0)
  const recRef = useRef<{
    mr: MediaRecorder
    chunks: Blob[]
    mime: string
    stream: MediaStream
    timer: number
    cancelled: boolean
  } | null>(null)

  const [isPaused, setIsPaused] = useState(false)

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : 'audio/ogg;codecs=opus'
      const mr = new MediaRecorder(stream, { mimeType: mime })
      const chunks: Blob[] = []
      mr.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
      mr.start()
      const timer = window.setInterval(() => {
        // Таймер не тикает пока на паузе.
        setRecTime((t) => (recRef.current?.mr.state === 'paused' ? t : t + 1))
      }, 1000)
      recRef.current = { mr, chunks, mime, stream, timer, cancelled: false }
      setIsRec(true)
      setIsPaused(false)
      setRecTime(0)
    } catch (e) {
      console.error('mic access denied', e)
    }
  }

  const togglePause = () => {
    const state = recRef.current
    if (!state) return
    if (state.mr.state === 'recording') {
      state.mr.pause()
      setIsPaused(true)
    } else if (state.mr.state === 'paused') {
      state.mr.resume()
      setIsPaused(false)
    }
  }

  // Останавливаем запись и возвращаем File с голосовкой (или null,
  // если пользователь отменил / чанков нет). Используем Promise, чтобы
  // не полагаться на асинхронные setState.
  const stopRec = (cancel: boolean): Promise<File | null> =>
    new Promise((resolve) => {
      const state = recRef.current
      if (!state) return resolve(null)
      state.cancelled = cancel
      window.clearInterval(state.timer)
      state.mr.onstop = () => {
        state.stream.getTracks().forEach((t) => t.stop())
        if (state.cancelled || state.chunks.length === 0) return resolve(null)
        const blob = new Blob(state.chunks, { type: state.mime })
        const ext = state.mime.includes('mp4')
          ? 'mp4'
          : state.mime.includes('ogg')
            ? 'ogg'
            : 'webm'
        resolve(
          new File([blob], `voice_${Date.now()}.${ext}`, { type: state.mime }),
        )
      }
      if (state.mr.state !== 'inactive') state.mr.stop()
      recRef.current = null
      setIsRec(false)
      setRecTime(0)
    })

  const fmtTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  // Динамическая высота мессаджбара — поднимаем над ней и полосу чипов,
  // и поповер пикера, чтобы всё синхронно ехало вверх при росте инпута.
  const [mbHeight, setMbHeight] = useState(120)
  useEffect(() => {
    const el = document.querySelector('.k-messagebar') as HTMLElement | null
    if (!el || !('ResizeObserver' in window)) return
    const ro = new ResizeObserver(() => setMbHeight(el.offsetHeight))
    ro.observe(el)
    setMbHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [])
  // Высота полосы чипов — чтобы поставить пикер ровно над ней без нахлёста.
  const chipsRef = useRef<HTMLDivElement | null>(null)
  const [chipsHeight, setChipsHeight] = useState(0)
  useEffect(() => {
    const el = chipsRef.current
    if (!el) return setChipsHeight(0)
    const ro = new ResizeObserver(() => setChipsHeight(el.offsetHeight))
    ro.observe(el)
    setChipsHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [attachments.length, reused.length])
  // Экспозим высоту мессаджбара + чипов в CSS-переменную — глобальный
  // CopyToast читает её и всплывает над полем ввода, не у верха экрана.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--chat-input-height',
      `${mbHeight + chipsHeight}px`,
    )
    return () => {
      document.documentElement.style.removeProperty('--chat-input-height')
    }
  }, [mbHeight, chipsHeight])
  const [model, setModel] = useState<ProviderModel | null>(
    provider?.models[0] ?? null,
  )
  const [sending, setSending] = useState(false)

  // При смене провайдера через URL — сброс модели на дефолт и очистка истории
  useEffect(() => {
    setMessages([])
    setModel(provider?.models[0] ?? null)
  }, [slug, provider])

  // Заготовка стартовой ленты для собеседования: если пользователь начал
  // печатать на карточке — его текст летит первым sent-сообщением, а ИИ
  // сразу задаёт первый вопрос собеса. Настоящую подгрузку следующих
  // ответов будет делать sendMessage при вводе следующих реплик.
  useEffect(() => {
    if (!interviewMode) return
    const seed = nav?.seedPrompt?.trim() || ''
    const opener: ChatMsg = {
      type: 'received',
      name: provider?.name,
      avatar: provider?.avatar,
      text:
        'Привет! Помогу распаковать проект и составлю первый план. ' +
        'Начнём с короткого собеседования — задам несколько вопросов.\n\n' +
        '**Вопрос 1.** Что должно получиться в итоге? Опиши финальный результат одним абзацем.',
    }
    setMessages(
      seed
        ? [{ type: 'sent', text: seed }, opener]
        : [opener],
    )
    // Убираем seed из истории роутера, чтобы обновление страницы не
    // перезаряжало собес заново.
    window.history.replaceState({}, '')
    // Зависимости специально узкие: заряжаем один раз на вход в чат.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewMode])

  const pageRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = pageRef.current as unknown as HTMLElement | null
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = async (extraFiles: File[] = []) => {
    if (!provider || !model) return
    const trimmed = text.trim()
    if (
      (!trimmed && attachments.length === 0 && extraFiles.length === 0 && reused.length === 0) ||
      sending
    )
      return
    // Пока прикреплённые файлы просто перечисляем в самом сообщении.
    // Реальная загрузка через /api/media/upload из ai-webapi — на следующем шаге.
    // Собираем вложения в структурированный вид: для картинок/видео —
    // локальный blob-URL, для файлов — просто имя. Реальную загрузку
    // (media-service) подключим позже.
    const allFiles = [...attachments, ...extraFiles]
    const msgAttachments: MsgAttachment[] = [
      ...allFiles.map<MsgAttachment>((f) => {
        const kind: MsgAttachment['kind'] = f.type.startsWith('image/')
          ? 'image'
          : f.type.startsWith('video/')
            ? 'video'
            : f.type.startsWith('audio/')
              ? 'audio'
              : 'file'
        return {
          kind,
          name: f.name,
          url:
            kind === 'file' ? undefined : URL.createObjectURL(f),
          mime: f.type,
        }
      }),
      ...reused.map<MsgAttachment>((r) => ({
        kind: (r.mime?.startsWith('image/')
          ? 'image'
          : r.mime?.startsWith('video/')
            ? 'video'
            : 'file') as MsgAttachment['kind'],
        name: r.name,
        url: r.thumb,
        mime: r.mime,
      })),
    ]
    const nextMessages: ChatMsg[] = [
      ...messages,
      {
        type: 'sent',
        text: trimmed,
        attachments: msgAttachments.length ? msgAttachments : undefined,
      },
    ]
    setMessages(nextMessages)
    setText('')
    setAttachments([])
    setReused([])
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

  const canSend =
    !!provider &&
    !!model &&
    (text.trim().length > 0 || attachments.length > 0 || reused.length > 0) &&
    !sending

  // Enter → отправить, Shift+Enter → перевод строки. Konsta не пробрасывает
  // onKeyDown на textarea, поэтому вешаем listener напрямую по id.
  useEffect(() => {
    const el = document.getElementById(
      'chat-textarea',
    ) as HTMLTextAreaElement | null
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        if (canSend) {
          send()
          // Сбросить высоту после отправки: пусто → 1 строка.
          el.style.height = 'auto'
        }
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [canSend, send])

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
          lockModel={interviewMode}
          projectContext={projectContext}
        />
      )}

      {/* Отступ под фиксированной трёхпилюльной шапкой; в проектном
          режиме под ней ещё живёт полоска понимания — плюс её высота. */}
      <div
        className={`${
          projectContext
            ? 'h-[calc(env(safe-area-inset-top)+108px)]'
            : 'h-[calc(env(safe-area-inset-top)+64px)]'
        }`}
      />


      {/* Konsta Messages не пробрасывает className — оборачиваем в div,
          чтобы центрировать ленту тем же max-width, что у пилюли и ввода.
          Padding-bottom = высота мессаджбара + чипов + запас — иначе
          последнее сообщение перекрывается фикс-инпутом. */}
      <div
        className="md:max-w-[1000px] md:mx-auto"
        style={{ paddingBottom: mbHeight + chipsHeight + 32 }}
      >
      <Messages>
        <MessagesTitle>{nowLabel}</MessagesTitle>
        {messages.map((m, i) => (
          <MessageWrapper
            key={i}
            active={msgMenu?.idx === i}
            onLongPress={(x, y) => setMsgMenu({ x, y, idx: i })}
          >
            {m.type === 'sent' ? (
              <SentMessage
                text={m.text}
                attachments={m.attachments}
                onOpenMedia={(items, index) => setBrowser({ items, index })}
              />
            ) : (
              <AiReply name={m.name ?? provider.name} text={m.text} provider={provider} />
            )}
          </MessageWrapper>
        ))}
        {sending && (
          <AiReply name={provider.name} text="…" provider={provider} />
        )}
      </Messages>
      </div>

      <MediaPicker
        open={pickerOpen}
        anchorBottom={mbHeight + chipsHeight + 8}
        selectedIds={reused.map((r) => r.id)}
        onClose={() => setPickerOpen(false)}
        onPick={(files) => setAttachments((prev) => [...prev, ...files])}
        // Защита от дублей — не добавляем уже выбранное.
        onPickRecent={(items) =>
          setReused((prev) => {
            const have = new Set(prev.map((p) => p.id))
            return [...prev, ...items.filter((i) => !have.has(i.id))]
          })
        }
      />

      <PhotoBrowser
        items={browser.items}
        index={browser.index}
        onClose={() => setBrowser({ items: [], index: null })}
      />

      {msgMenu && (() => {
        const target = messages[msgMenu.idx]
        const isSent = target?.type === 'sent'
        const actions = [
          {
            label: 'Скопировать',
            icon: Copy,
            onSelect: () => {
              if (!target) return
              navigator.clipboard
                ?.writeText(target.text)
                .then(() => showCopyToast())
                .catch(() => {})
            },
          },
          ...(isSent
            ? [
                {
                  label: 'Редактировать',
                  icon: Pencil,
                  onSelect: () => {
                    if (!target) return
                    // Отправляем текст обратно в инпут, а сообщение
                    // удаляем — можно править и переотправить.
                    setText(target.text)
                    setMessages((prev) =>
                      prev.filter((_, j) => j !== msgMenu.idx),
                    )
                    document.getElementById('chat-textarea')?.focus()
                  },
                },
              ]
            : []),
          {
            label: 'Удалить',
            icon: Trash2,
            destructive: true,
            onSelect: () =>
              setMessages((prev) =>
                prev.filter((_, j) => j !== msgMenu.idx),
              ),
          },
        ]
        return (
          <MessageMenu
            x={msgMenu.x}
            y={msgMenu.y}
            onClose={() => setMsgMenu(null)}
            actions={actions}
          />
        )
      })()}

      {(attachments.length > 0 || reused.length > 0) && (
        <div
          ref={chipsRef}
          style={{ bottom: mbHeight + 4 }}
          className="fixed z-30 left-0 right-0
                     md:left-[calc(var(--sidebar-width,18rem)+max(0px,(100vw-var(--sidebar-width,18rem)-1000px)/2))]
                     md:right-[max(0px,calc((100vw-var(--sidebar-width,18rem)-1000px)/2))]
                     px-4 py-1.5 flex flex-wrap gap-2"
        >
          {attachments.map((f, i) => (
            <AttachmentChip
              key={`f${i}`}
              name={f.name}
              // Для картинок делаем локальный URL — работает без сети.
              thumb={
                f.type.startsWith('image/')
                  ? URL.createObjectURL(f)
                  : undefined
              }
              onRemove={() =>
                setAttachments((prev) => prev.filter((_, j) => j !== i))
              }
            />
          ))}
          {reused.map((r, i) => (
            <AttachmentChip
              key={`r${i}`}
              name={r.name}
              thumb={r.thumb}
              onRemove={() =>
                setReused((prev) => prev.filter((_, j) => j !== i))
              }
            />
          ))}
        </div>
      )}

      <Messagebar
        textareaId="chat-textarea"
        className={`z-20 [&_.k-toolbar]:!pb-[max(5px,env(safe-area-inset-bottom))] md:[&_.k-toolbar]:!pb-safe-4 md:!w-auto md:!left-[calc(var(--sidebar-width,18rem)+max(0px,(100vw-var(--sidebar-width,18rem)-1000px)/2))] md:!right-[max(0px,calc((100vw-var(--sidebar-width,18rem)-1000px)/2))] [&_.k-toolbar>div]:!items-end [&_.k-toolbar>div]:!h-auto [&_.k-toolbar>div]:!py-2 [&_textarea]:!min-h-[86px] [&_textarea]:!py-3 [&_textarea]:!text-[16px] [&_textarea]:!leading-snug [&_textarea]:!overflow-y-auto max-md:[&_.k-toolbar]:!px-safe-3 max-md:[&_.k-toolbar>div>div:first-child]:!hidden max-md:[&_textarea]:!pl-6 ${
          isRec ? '!hidden' : ''
        }`}
        placeholder={`Сообщение · ${provider.name}`}
        value={text}
        onInput={(e) => {
          const el = e.target as HTMLTextAreaElement
          setText(el.value)
          // Автоувеличение: пусто/мало текста → минимум 3 строки (86px),
          // больше — растём по scrollHeight (мессаджбар прибит к bottom,
          // так что растёт только вверх). Потолок 260px — потом скролл.
          el.style.height = 'auto'
          el.style.height =
            Math.min(260, Math.max(86, el.scrollHeight + 22)) + 'px'
        }}
        left={
          <ToolbarPane className="ios:h-10">
            <KLink
              onClick={() => setPickerOpen(true)}
              iconOnly
              aria-label="Прикрепить файл"
            >
              <Paperclip size={22} />
            </KLink>
          </ToolbarPane>
        }
        right={
          <ToolbarPane className="ios:h-10">
            {canSend ? (
              <KLink onClick={() => send()} iconOnly aria-label="Отправить">
                <svg
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                  width="1em"
                  height="1em"
                  viewBox="0 0 56 56"
                  className="w-7 h-7 text-[#2a8bff]"
                  aria-hidden="true"
                >
                  <path d="M 27.9999 51.9063 C 41.0546 51.9063 51.9063 41.0781 51.9063 28 C 51.9063 14.9453 41.0312 4.0937 27.9765 4.0937 C 14.8983 4.0937 4.0937 14.9453 4.0937 28 C 4.0937 41.0781 14.9218 51.9063 27.9999 51.9063 Z M 27.9999 14.8516 C 28.5624 14.8516 29.0077 15.0859 29.5234 15.5781 L 38.1483 24.2266 C 38.4530 24.5547 38.6874 25 38.6874 25.5390 C 38.6874 26.5937 37.8671 27.4141 36.8124 27.4141 C 36.2499 27.4141 35.7812 27.2031 35.4530 26.8516 L 32.3124 23.6641 L 29.7109 20.5703 L 29.9218 25.9844 L 29.9218 39.2734 C 29.9218 40.3984 29.1249 41.1719 27.9999 41.1719 C 26.8749 41.1719 26.0780 40.3984 26.0780 39.2734 L 26.0780 25.9844 L 26.2655 20.5937 L 23.7109 23.6641 L 20.5468 26.8516 C 20.2187 27.1797 19.7265 27.4141 19.1874 27.4141 C 18.1093 27.4141 17.3358 26.5937 17.3358 25.5390 C 17.3358 25 17.5234 24.5547 17.8514 24.2266 L 26.4999 15.5781 C 27.0155 15.0625 27.4374 14.8516 27.9999 14.8516 Z" />
                </svg>
              </KLink>
            ) : (
              <KLink onClick={startRec} iconOnly aria-label="Записать голосовое">
                <Mic size={22} />
              </KLink>
            )}
          </ToolbarPane>
        }
      />

      {/* Плавающая скрепка внутри поля ввода — только мобилка. Левая
          Konsta-пилюля спрятана через max-md:!hidden, textarea добавляет
          !pl-11 чтобы текст не наезжал на иконку. */}
      {!isRec && (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          aria-label="Прикрепить файл"
          className="md:hidden fixed z-30 bottom-[calc(max(5px,env(safe-area-inset-bottom))+14px)] left-6 h-9 w-9 flex items-center justify-center text-black/70 dark:text-white/70 active:opacity-60"
        >
          <Paperclip size={20} />
        </button>
      )}

      {/* Ряд записи: подменяет мессаджбар (Messagebar скрывается !hidden).
          Пилюля высотой в одну строку, справа две кнопки — Готово сверху,
          Пауза снизу, обе в том же glass-стиле, что и обычная отправка. */}
      {isRec && (
        <div
          style={{ bottom: `calc(env(safe-area-inset-bottom) + 24px)` }}
          className="fixed z-40 left-4 right-4
                     md:left-[calc(var(--sidebar-width,18rem)+max(0px,(100vw-var(--sidebar-width,18rem)-1000px)/2))]
                     md:right-[max(0px,calc((100vw-var(--sidebar-width,18rem)-1000px)/2))]
                     flex items-end gap-3 px-4"
        >
          {/* Пилюля записи в одну строку */}
          <div
            className="flex-1 h-11 flex items-center gap-3 px-4 rounded-full
                       bg-ios-light-glass dark:bg-ios-dark-glass
                       shadow-ios-light-glass dark:shadow-ios-dark-glass backdrop-blur-lg"
          >
            <span
              className={`w-2.5 h-2.5 rounded-full bg-[#ff3b30] shrink-0 ${
                isPaused ? 'opacity-40' : 'animate-pulse'
              }`}
            />
            <span className="text-[15px] font-semibold tabular-nums text-black dark:text-white">
              {fmtTime(recTime)}
            </span>
            <span className="text-[13px] text-black/50 dark:text-white/50 truncate flex-1">
              {isPaused ? 'Пауза' : 'Запись голосового…'}
            </span>
            <button
              type="button"
              onClick={() => stopRec(true)}
              aria-label="Удалить запись"
              className="w-7 h-7 rounded-full flex items-center justify-center
                         text-[#ff3b30] active:opacity-70 shrink-0 -mr-1"
            >
              <Trash2 size={16} />
            </button>
          </div>

          {/* Стопка справа: Готово сверху, Пауза снизу. Обе — стеклянный
              круг с синим кружком и иконкой (как основная кнопка отправки). */}
          <div className="flex flex-col gap-2 shrink-0">
            {/* Готово — стеклянный внешний круг, синий внутри, белая иконка */}
            <button
              type="button"
              onClick={async () => {
                const file = await stopRec(false)
                if (file) setAttachments((prev) => [...prev, file])
              }}
              aria-label="Готово"
              className="w-11 h-11 rounded-full flex items-center justify-center
                         bg-ios-light-glass dark:bg-ios-dark-glass
                         shadow-ios-light-glass dark:shadow-ios-dark-glass backdrop-blur-lg
                         active:opacity-70"
            >
              <span className="w-7 h-7 rounded-full bg-[#2a8bff] flex items-center justify-center">
                <svg
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 56 56"
                  className="w-4 h-4 text-white"
                  aria-hidden="true"
                >
                  <path d="M 27.9999 51.9063 C 41.0546 51.9063 51.9063 41.0781 51.9063 28 C 51.9063 14.9453 41.0312 4.0937 27.9765 4.0937 C 14.8983 4.0937 4.0937 14.9453 4.0937 28 C 4.0937 41.0781 14.9218 51.9063 27.9999 51.9063 Z M 27.9999 14.8516 C 28.5624 14.8516 29.0077 15.0859 29.5234 15.5781 L 38.1483 24.2266 C 38.4530 24.5547 38.6874 25 38.6874 25.5390 C 38.6874 26.5937 37.8671 27.4141 36.8124 27.4141 C 36.2499 27.4141 35.7812 27.2031 35.4530 26.8516 L 32.3124 23.6641 L 29.7109 20.5703 L 29.9218 25.9844 L 29.9218 39.2734 C 29.9218 40.3984 29.1249 41.1719 27.9999 41.1719 C 26.8749 41.1719 26.0780 40.3984 26.0780 39.2734 L 26.0780 25.9844 L 26.2655 20.5937 L 23.7109 23.6641 L 20.5468 26.8516 C 20.2187 27.1797 19.7265 27.4141 19.1874 27.4141 C 18.1093 27.4141 17.3358 26.5937 17.3358 25.5390 C 17.3358 25 17.5234 24.5547 17.8514 24.2266 L 26.4999 15.5781 C 27.0155 15.0625 27.4374 14.8516 27.9999 14.8516 Z" />
                </svg>
              </span>
            </button>
            {/* Пауза / Продолжить — стеклянный внешний, белый внутри */}
            <button
              type="button"
              onClick={togglePause}
              aria-label={isPaused ? 'Продолжить' : 'Пауза'}
              className="w-11 h-11 rounded-full flex items-center justify-center
                         bg-ios-light-glass dark:bg-ios-dark-glass
                         shadow-ios-light-glass dark:shadow-ios-dark-glass backdrop-blur-lg
                         active:opacity-70"
            >
              <span className="w-7 h-7 rounded-full bg-white flex items-center justify-center">
                {isPaused ? (
                  <Play size={14} strokeWidth={3} className="text-black ml-0.5" />
                ) : (
                  <Pause size={14} strokeWidth={3} className="text-black" />
                )}
              </span>
            </button>
          </div>
        </div>
      )}
    </Page>
  )
}
