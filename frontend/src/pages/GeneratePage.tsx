import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bookmark,
  Download,
  Grid3x3,
  Headphones,
  History,
  Image,
  MessageSquare,
  MoreHorizontal,
  Moon,
  Search,
  Settings,
  Sun,
  Video,
  X,
} from 'lucide-react'
import { Link as KLink, Navbar, Page, Searchbar } from 'konsta/react'
import Menu, { type MenuItem } from '../components/Menu'
import { getUser, haptic } from '../lib/telegram'
import { useTheme } from '../store/ThemeStore'
import { CHAT_PROVIDERS } from '../lib/providers'

// Каталог AI-сервисов по типам генерации. Дизайн взят из ai-webapi
// (страница «Поиск»): четыре категории горизонтальными лентами,
// в каждой — плитки с аватаркой и подписью. Картинки — public/providers/
// (перенесены из ai-webapi).
interface Provider {
  id: string
  name: string
  avatar: string
  desc?: string
  model?: string
}

interface Category {
  id: string
  title: string
  items: Provider[]
}

const P = '/providers'

interface ChatHistoryItem {
  id: string
  provider: string
  title: string
  preview: string
  time: string
  avatar: string
}

// Заглушки истории чатов — позже сюда прилетят реальные данные из API.
// id = provider slug из lib/providers.ts (для навигации в /chat/:provider).
const CHAT_HISTORY: ChatHistoryItem[] = [
  {
    id: 'chatgpt',
    provider: 'ChatGPT',
    title: 'ChatGPT',
    preview: 'Помоги написать письмо клиенту про перенос сроков…',
    time: '2 ч',
    avatar: '/providers/gpt.png',
  },
  {
    id: 'claude',
    provider: 'Claude',
    title: 'Claude',
    preview: 'Разбор ТЗ на посадочную страницу',
    time: 'вчера',
    avatar: '/providers/claude.png',
  },
  {
    id: 'gemini',
    provider: 'Gemini',
    title: 'Gemini',
    preview: 'Собери мне таблицу по спринтам за неделю',
    time: '3 д',
    avatar: '/providers/gemini.png',
  },
]

const CATEGORIES: Category[] = [
  {
    id: 'text',
    title: 'Текст',
    // Реестр в src/lib/providers.ts — единый источник правды.
    // avatar null → плитка с буквой (рисует ProviderTile).
    items: CHAT_PROVIDERS.map((p) => ({
      id: p.slug,
      name: p.name,
      avatar: p.avatar ?? '',
      desc: p.models[0]?.desc,
      model: p.models[0]?.name,
    })),
  },
  {
    id: 'image',
    title: 'Изображения',
    items: [
      { id: 'dalle', name: 'DALL·E', avatar: `${P}/dalle.png`, desc: 'Фотореалистичные картинки от OpenAI', model: 'DALL·E 3' },
      { id: 'nanobanana', name: 'Gemini Image', avatar: `${P}/NanoBanana.png`, desc: 'Google-модель для быстрой графики', model: 'Nano-Banana' },
      { id: 'midjourney', name: 'Midjourney', avatar: `${P}/midjourney.png`, desc: 'Художественная генерация, лучший арт', model: 'Midjourney v6' },
      { id: 'sourceful', name: 'Sourceful', avatar: `${P}/Sourceful.png`, desc: 'Открытые SDXL-модели с тонкой настройкой', model: 'SDXL Turbo' },
      { id: 'flux', name: 'FLUX', avatar: `${P}/blclabs.png`, desc: 'Свежая архитектура BlackForest Labs', model: 'FLUX 1.1 Pro' },
    ],
  },
  {
    id: 'video',
    title: 'Видео',
    items: [
      { id: 'sora2', name: 'Sora', avatar: `${P}/sora-optimized.png`, desc: 'Реалистичное видео от OpenAI', model: 'Sora 2' },
      { id: 'veo3', name: 'Veo 3', avatar: `${P}/veo3.png`, desc: 'Google Veo — киношное качество', model: 'Veo 3' },
      { id: 'kling', name: 'Kling AI', avatar: `${P}/klingai.png`, desc: 'Быстрый и точный видеогенератор', model: 'Kling 2.0' },
    ],
  },
  {
    id: 'audio',
    title: 'Аудио',
    items: [
      { id: 'elevenlabs', name: 'ElevenLabs', avatar: `${P}/elevenlabs.png`, desc: 'Речь и голосовое клонирование', model: 'Turbo v2.5' },
      { id: 'openai-audio', name: 'OpenAI Audio', avatar: `${P}/gpt.png`, desc: 'TTS и распознавание речи', model: 'GPT-4o Audio' },
    ],
  },
]

// Три «фичи»-карточки сверху — как в App Store Today.
// Каждая ведёт на конкретный AI. Клик разворачивает карточку эффектом
// scale + shadow (простая имитация Expandable Card).
const FEATURED = [
  {
    id: 'chatgpt',
    tag: 'РЕДАКЦИЯ РЕКОМЕНДУЕТ',
    title: 'GPT-4o',
    subtitle: 'Быстрый универсал OpenAI',
    gradient: 'linear-gradient(135deg,#0f172a,#1e40af,#0891b2)',
    avatar: '/providers/gpt.png',
  },
  {
    id: 'midjourney',
    tag: 'ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЙ',
    title: 'Midjourney v6',
    subtitle: 'Художественный арт мирового уровня',
    gradient: 'linear-gradient(135deg,#4c1d95,#7c3aed,#ec4899)',
    avatar: '/providers/midjourney.png',
  },
  {
    id: 'sora2',
    tag: 'ВИДЕО НА ПРОРЫВЕ',
    title: 'Sora 2',
    subtitle: 'Реалистичные ролики до 60 сек',
    gradient: 'linear-gradient(135deg,#111827,#374151,#f97316)',
    avatar: '/providers/sora-optimized.png',
  },
  {
    id: 'claude',
    tag: 'ЛУЧШИЙ ДЛЯ КОДА',
    title: 'Claude 3.5 Sonnet',
    subtitle: 'Осмысленный анализ и рефакторинг',
    gradient: 'linear-gradient(135deg,#7c2d12,#c2410c,#f97316)',
    avatar: '/providers/claude.png',
  },
  {
    id: 'gemini',
    tag: 'МУЛЬТИМОДАЛЬНАЯ',
    title: 'Gemini 2.0 Flash',
    subtitle: 'Текст, картинки и видео в одном запросе',
    gradient: 'linear-gradient(135deg,#0c4a6e,#0284c7,#22d3ee)',
    avatar: '/providers/gemini.png',
  },
  {
    id: 'veo3',
    tag: 'КИНОШНОЕ КАЧЕСТВО',
    title: 'Veo 3',
    subtitle: 'Google Veo с реалистичным движением',
    gradient: 'linear-gradient(135deg,#14532d,#16a34a,#84cc16)',
    avatar: '/providers/veo3.png',
  },
  {
    id: 'grok',
    tag: 'НОВОЕ ОТ XAI',
    title: 'Grok',
    subtitle: 'Быстрый, дерзкий, с чувством юмора',
    gradient: 'linear-gradient(135deg,#0a0a0a,#404040,#737373)',
    avatar: '/providers/grok.png',
  },
  {
    id: 'flux',
    tag: 'НОВАЯ АРХИТЕКТУРА',
    title: 'FLUX 1.1 Pro',
    subtitle: 'Свежая графика от BlackForest Labs',
    gradient: 'linear-gradient(135deg,#450a0a,#dc2626,#f59e0b)',
    avatar: '/providers/blclabs.png',
  },
]

function FeaturedCards({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div
      className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-6 px-6
                 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {FEATURED.map((f) => (
        <div
          key={f.id}
          className="snap-start shrink-0 w-[calc((100%-2rem)/3)]"
        >
          <ExpandableCard data={f} onOpen={() => onPick(f.id)} />
        </div>
      ))}
    </div>
  )
}

// Cards Expandable по мотивам Framework7: обычная карточка → на клике
// плавно улетает во весь экран через position:fixed и FLIP-анимацию.
function ExpandableCard({
  data,
  onOpen,
}: {
  data: (typeof FEATURED)[number]
  onOpen: () => void
}) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [full, setFull] = useState(false)
  const holderRef = useRef<HTMLDivElement>(null)

  // Заблокировать прокрутку body в раскрытом состоянии.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const expand = () => {
    if (open || !holderRef.current) return
    haptic('light')
    setRect(holderRef.current.getBoundingClientRect())
    setOpen(true)
    // На следующий кадр — переключаем в fullscreen, чтобы сработал transition
    requestAnimationFrame(() => requestAnimationFrame(() => setFull(true)))
  }

  const collapse = () => {
    haptic('light')
    setFull(false)
    // После анимации — снимаем fixed-клон
    window.setTimeout(() => {
      setOpen(false)
      setRect(null)
    }, 320)
  }

  const style: React.CSSProperties = full
    ? { left: 0, top: 0, right: 0, bottom: 0, borderRadius: 0 }
    : rect
      ? {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          borderRadius: 24,
        }
      : {}

  return (
    <>
      {/* placeholder-плейсхолдер держит место в сетке пока карточка «улетела» */}
      <div
        ref={holderRef}
        onClick={expand}
        className="relative overflow-hidden rounded-[15px] aspect-[16/10]
                   text-left text-white cursor-pointer transition-all duration-200 ease-out
                   hover:-translate-y-0.5 hover:shadow-[0_10px_25px_-12px_rgba(0,0,0,0.35)]
                   shadow-[0_4px_14px_-8px_rgba(0,0,0,0.25)]"
        style={{
          background: data.gradient,
          visibility: open ? 'hidden' : 'visible',
        }}
      >
        <CollapsedContent data={data} />
      </div>

      {open && (
        <>
          {/* тёмная подложка */}
          <div
            onClick={collapse}
            className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
              full ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <div
            className="fixed z-50 overflow-hidden text-white
                       transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ ...style, background: data.gradient }}
          >
            <div className="h-full w-full overflow-y-auto p-6 md:p-10 flex flex-col">
              {full && (
                <button
                  type="button"
                  onClick={collapse}
                  aria-label="Закрыть"
                  className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center
                             bg-white/25 backdrop-blur text-white active:opacity-70 z-10"
                >
                  <X size={18} strokeWidth={2.5} />
                </button>
              )}

              <div className="text-[11px] font-bold tracking-wider opacity-90">
                {data.tag}
              </div>
              <h3 className="mt-2 text-[26px] md:text-[42px] font-extrabold leading-tight tracking-tight">
                {data.title}
              </h3>
              <p className="mt-1 md:mt-2 text-[13px] md:text-[17px] opacity-85 leading-snug">
                {data.subtitle}
              </p>

              {full && (
                <div className="mt-8 flex-1 flex flex-col gap-4 text-[15px] leading-relaxed opacity-90">
                  <p>
                    Модель уже доступна во всех платных тарифах. Открой чат
                    и попробуй прямо сейчас — токены на месяц включены в пакет.
                  </p>
                  <ul className="flex flex-col gap-2 text-[14px] mt-2">
                    <li>· Долгий контекст без потери деталей</li>
                    <li>· Быстрый стриминг ответов</li>
                    <li>· Работа с картинками и файлами</li>
                    <li>· История чатов навсегда</li>
                  </ul>
                </div>
              )}

              <div className="flex items-center gap-3 mt-6">
                <img
                  src={data.avatar}
                  alt=""
                  className="w-11 h-11 md:w-14 md:h-14 rounded-xl object-cover bg-white/20"
                />
                <button
                  type="button"
                  onClick={onOpen}
                  className="ml-auto inline-flex items-center justify-center px-5 h-10
                             rounded-full bg-white text-black text-[14px] font-bold
                             active:opacity-80"
                >
                  Открыть чат
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function CollapsedContent({ data }: { data: (typeof FEATURED)[number] }) {
  return (
    <div className="absolute inset-0 flex flex-col justify-between p-5">
      <div>
        <div className="text-[11px] font-bold tracking-wider opacity-90">
          {data.tag}
        </div>
        <h3 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight">
          {data.title}
        </h3>
        <p className="mt-1 text-[13px] opacity-85 leading-snug">
          {data.subtitle}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <img
          src={data.avatar}
          alt=""
          className="w-11 h-11 rounded-xl object-cover bg-white/20"
        />
        <span className="ml-auto inline-flex items-center justify-center px-4 h-8 rounded-full bg-white/95 text-black text-[13px] font-bold">
          Открыть
        </span>
      </div>
    </div>
  )
}

// App Store Top-Charts-строка: крупная цифра-ранк слева, иконка,
// категория/имя/сабтайтл, синяя пилюля справа.
function RankedRow({
  item,
  onClick,
}: {
  item: Provider
  onClick: () => void
}) {
  const letter = item.name.trim().charAt(0).toUpperCase() || '?'
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 py-2.5 text-left
                 border-b border-black/[.06] dark:border-white/[.06]"
    >
      {item.avatar ? (
        <img
          src={item.avatar}
          alt=""
          className="w-12 h-12 rounded-xl object-cover shrink-0 bg-white"
        />
      ) : (
        <span className="w-12 h-12 rounded-xl bg-[#2a8bff] text-white text-[19px] font-semibold flex items-center justify-center shrink-0">
          {letter}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-black dark:text-white truncate">
          {item.name}
        </div>
        <div className="text-[12px] text-black/55 dark:text-white/50 truncate">
          {item.desc}
        </div>
      </div>
      <span
        className="ml-2 inline-flex items-center justify-center px-4 h-7 rounded-full
                   bg-black/[.06] dark:bg-white/[.10] text-[#2a8bff] text-[12px] font-bold shrink-0"
      >
        Открыть
      </span>
    </button>
  )
}

function AICard({ item, onClick }: { item: Provider; onClick: () => void }) {
  const letter = item.name.trim().charAt(0).toUpperCase() || '?'
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 p-3 rounded-2xl text-left
                 bg-black/[.04] dark:bg-white/[.06]
                 hover:bg-black/[.07] dark:hover:bg-white/[.10]
                 transition-colors"
    >
      {item.avatar ? (
        <img
          src={item.avatar}
          alt=""
          className="w-12 h-12 rounded-xl object-cover shrink-0 bg-white"
        />
      ) : (
        <span className="w-12 h-12 rounded-xl bg-[#2a8bff] text-white text-[19px] font-semibold flex items-center justify-center shrink-0">
          {letter}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-black dark:text-white truncate">
          {item.name}
        </div>
        {item.desc && (
          <div className="text-[12px] text-black/55 dark:text-white/50 truncate">
            {item.desc}
          </div>
        )}
        {item.model && (
          <div className="text-[11px] text-black/40 dark:text-white/35 mt-0.5 truncate">
            {item.model}
          </div>
        )}
      </div>
      <span className="text-[12px] font-semibold text-[#2a8bff] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        Открыть
      </span>
    </button>
  )
}

function ProviderTile({ item, onClick }: { item: Provider; onClick: () => void }) {
  const letter = item.name.trim().charAt(0).toUpperCase() || '?'
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 w-[80px] shrink-0 active:opacity-70"
    >
      {item.avatar ? (
        <img
          src={item.avatar}
          alt=""
          className="w-16 h-16 rounded-[20px] object-cover bg-black/5 dark:bg-white/10 shadow-[0_3px_12px_rgba(0,0,0,0.14)] dark:shadow-none"
        />
      ) : (
        <span className="w-16 h-16 rounded-[20px] bg-[#2a8bff]/85 text-white text-[24px] font-semibold flex items-center justify-center shadow-[0_3px_12px_rgba(0,0,0,0.14)] dark:shadow-none">
          {letter}
        </span>
      )}
      <span className="text-[13px] font-semibold text-black dark:text-white text-center leading-tight truncate w-full">
        {item.name}
      </span>
    </button>
  )
}

export default function GeneratePage() {
  const nav = useNavigate()
  const user = getUser()
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  const [menuOpen, setMenuOpen] = useState(false)
  const menuBtnRef = useRef<HTMLAnchorElement>(null)

  const [q, setQ] = useState('')
  const [searchOn, setSearchOn] = useState(false)
  const searchInputRef = useRef<HTMLDivElement>(null)

  // Категорийный фильтр десктопной раскладки.
  const [cat, setCat] = useState<'all' | 'text' | 'image' | 'video' | 'audio'>(
    'all',
  )


  useEffect(() => {
    if (!searchOn) return
    const timer = window.setTimeout(() => {
      searchInputRef.current?.querySelector('input')?.focus()
    }, 320)
    return () => window.clearTimeout(timer)
  }, [searchOn])

  const query = q.trim().toLowerCase()
  const searchHits = useMemo(() => {
    if (!query) return []
    const hits: { cat: string; item: Provider }[] = []
    for (const cat of CATEGORIES)
      for (const item of cat.items)
        if (item.name.toLowerCase().includes(query))
          hits.push({ cat: cat.title, item })
    return hits
  }, [query])

  const menuItems: MenuItem[] = [
    { label: 'Загрузки', icon: Download, onSelect: () => haptic('light') },
    { label: 'Избранное', icon: Bookmark, onSelect: () => haptic('light') },
    { label: 'Настройки', icon: Settings, onSelect: () => nav('/profile') },
  ]

  const fullName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ')
    : 'Гость'
  const letter = fullName.trim().charAt(0).toUpperCase() || '?'

  const CHAT_SLUGS = new Set(CHAT_PROVIDERS.map((p) => p.slug))

  const pick = (id: string) => {
    haptic('light')
    // Тайлы из категории «Текст» — это чат-провайдеры (id = slug),
    // ведут прямо в /chat/:provider. Image/video/audio пока без страницы.
    if (CHAT_SLUGS.has(id)) {
      nav(`/chat/${id}`)
      return
    }
    console.log('provider', id)
  }

  return (
    <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="Генерация"
        right={
          <>
            <KLink iconOnly onClick={() => setSearchOn(true)}>
              <Search size={22} />
            </KLink>
            <KLink iconOnly onClick={() => haptic('light')}>
              <History size={22} />
            </KLink>
            <KLink
              iconOnly
              ref={menuBtnRef}
              onClick={() => setMenuOpen(true)}
            >
              <MoreHorizontal size={22} />
            </KLink>
          </>
        }
      />

      {/* F7 Searchbar Expandable: выезжает справа налево через весь navbar */}
      <div
        ref={searchInputRef}
        className={`fixed inset-x-0 top-0 z-[100] bg-white pt-[max(16px,env(safe-area-inset-top))] px-4 pb-2 dark:bg-black
                    transition-[clip-path] duration-[350ms] ease-[cubic-bezier(0.22,1,0.36,1)]
                    ${
                      searchOn
                        ? '[clip-path:inset(0_0_0_0)] pointer-events-auto'
                        : '[clip-path:inset(0_0_0_100%)] pointer-events-none'
                    }`}
      >
        <Searchbar
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onClear={() => setQ('')}
          disableButton
          onDisable={() => {
            setSearchOn(false)
            setQ('')
          }}
          placeholder="Поиск по AI-сервисам"
        />
      </div>

      {/* Профиль-пилюля — только на мобилке. На десктопе всё то же
          показывает левый сайдбар. */}
      <div className="mx-safe-4 mt-20 mb-3 md:hidden">
        <div
          className="flex items-center gap-3 pl-2 pr-4 py-2 min-h-[80px]
                     rounded-full bg-ios-light-surface-1 dark:bg-ios-dark-surface-1
                     active:opacity-80 cursor-pointer transition-opacity"
          onClick={() => nav('/profile')}
        >
          {user?.photo_url ? (
            <img
              src={user.photo_url}
              alt=""
              className="w-16 h-16 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-[#2a8bff] text-white text-[26px] font-semibold flex items-center justify-center shrink-0">
              {letter}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-semibold text-black dark:text-white leading-tight truncate">
              {fullName}
            </div>
            <div className="text-[14px] text-[#2a8bff] font-medium mt-1">
              Свободный план
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              haptic('light')
              toggle()
            }}
            aria-label="Сменить тему"
            className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center
                       bg-black/5 dark:bg-white/10 text-black dark:text-white
                       active:opacity-70"
          >
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </div>

      {/* Мобильный layout: горизонтальные ленты категорий или результаты поиска */}
      <div className="md:hidden">
        {query ? (
          <div
            className="ml-safe-4 mr-safe-4 rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1
                       my-3 pt-3 pb-3 px-4"
          >
            <div className="text-[17px] font-semibold text-black dark:text-white mb-2">
              {searchHits.length ? `Найдено: ${searchHits.length}` : 'Ничего не нашлось'}
            </div>
            <div className="grid grid-cols-4 gap-3">
              {searchHits.map(({ cat, item }) => (
                <div key={`${cat}-${item.id}`} className="flex flex-col items-center gap-1">
                  <ProviderTile item={item} onClick={() => pick(item.id)} />
                  <span className="text-[10px] text-black/45 dark:text-white/45 truncate w-full text-center">
                    {cat}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          CATEGORIES.map((c) => (
            <div
              key={c.id}
              className="ml-safe-4 mr-safe-4 rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1
                         my-3 pt-3 pb-4 pl-4"
            >
              <div className="pr-4 text-[17px] font-semibold text-black dark:text-white mb-3">
                {c.title}
              </div>
              <div
                className="flex gap-4 overflow-x-auto pr-4
                           [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {c.items.map((it) => (
                  <ProviderTile
                    key={it.id}
                    item={it}
                    onClick={() => pick(it.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Десктоп: App Store Arcade-стиль. Expandable-карточка сверху,
          горизонтальные пилюли категорий, ниже — секции с ранжированной
          сеткой 2 колонки, номер + иконка + текст + кнопка. */}
      <div className="hidden md:block px-6 pt-4 mx-auto w-full max-w-[1100px]">
        <FeaturedCards onPick={pick} />

        {/* Пилюли-категории со значками — как в App Store */}
        <div className="flex gap-2 flex-wrap mt-6 mb-4">
          {(
            [
              ['all', 'Все', Grid3x3],
              ['text', 'Текст', MessageSquare],
              ['image', 'Изображения', Image],
              ['video', 'Видео', Video],
              ['audio', 'Аудио', Headphones],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setCat(id)}
              className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-semibold transition ${
                cat === id
                  ? 'bg-[#2a8bff] text-white'
                  : 'bg-black/[.05] dark:bg-white/[.08] text-black dark:text-white hover:bg-black/[.08] dark:hover:bg-white/[.12]'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {(cat === 'all'
          ? CATEGORIES
          : CATEGORIES.filter((c) => c.id === cat)
        ).map((c) => (
          <section key={c.id} className="mb-8">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-[22px] font-extrabold text-black dark:text-white tracking-tight">
                Топ-модели · {c.title}
              </h2>
              <button
                type="button"
                className="text-[13px] font-semibold text-[#2a8bff]"
              >
                См. все
              </button>
            </div>
            {/* Скролл-strip: 3 колонки на экран. Для текста/картинок —
                2 строки, для видео и аудио — одна (у них меньше моделей). */}
            <div
              className={`grid grid-flow-col
                          auto-cols-[calc((100%-2rem)/3)] gap-x-4 gap-y-1
                          overflow-x-auto snap-x snap-mandatory pb-1
                          [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
                            c.id === 'video' || c.id === 'audio'
                              ? 'grid-rows-1'
                              : 'grid-rows-2'
                          }`}
            >
              {c.items.map((it) => (
                <div key={it.id} className="snap-start">
                  <RankedRow item={it} onClick={() => pick(it.id)} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* История чатов — только на мобилке. На десктопе у нас отдельный
          раздел «История» в сайдбаре и вся страница /history. */}
      <div
        className="md:hidden ml-safe-4 mr-safe-4 rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1
                   my-3 pt-3 pb-2 px-4"
      >
        <div className="text-[17px] font-semibold text-black dark:text-white mb-2">
          История чатов
        </div>
        {CHAT_HISTORY.length === 0 ? (
          <div className="text-black/50 dark:text-white/50 text-[13px] py-4 text-center">
            Здесь появятся ваши прошлые чаты
          </div>
        ) : (
          <ul className="-mx-4 divide-y divide-black/[.06] dark:divide-white/[.06]">
            {CHAT_HISTORY.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    haptic('light')
                    nav(`/chat/${c.id}`)
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left
                             active:bg-black/[.04] dark:active:bg-white/[.04]"
                >
                  <img
                    src={c.avatar}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover bg-black/5 dark:bg-white/10 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <div className="text-[15px] font-semibold text-black dark:text-white truncate">
                        {c.title}
                      </div>
                      <div className="ms-auto text-[12px] text-black/45 dark:text-white/45 shrink-0">
                        {c.time}
                      </div>
                    </div>
                    <div className="text-[13px] text-black/55 dark:text-white/55 truncate">
                      {c.preview}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        target={menuBtnRef}
      />
    </Page>
  )
}
