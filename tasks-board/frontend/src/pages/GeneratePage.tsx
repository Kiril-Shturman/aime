import { useNavigate } from 'react-router-dom'
import { useRef, useState } from 'react'
import {
  Bookmark,
  Download,
  History,
  MoreHorizontal,
  Moon,
  Search,
  Settings,
  Sun,
} from 'lucide-react'
import { Link as KLink, Navbar, Page } from 'konsta/react'
import Menu, { type MenuItem } from '../components/Menu'
import { getUser, haptic } from '../lib/telegram'
import { useTheme } from '../store/ThemeStore'

// Каталог AI-сервисов по типам генерации. Дизайн взят из ai-webapi
// (страница «Поиск»): четыре категории горизонтальными лентами,
// в каждой — плитки с аватаркой и подписью. Картинки — public/providers/
// (перенесены из ai-webapi).
interface Provider {
  id: string
  name: string
  avatar: string
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
const CHAT_HISTORY: ChatHistoryItem[] = [
  {
    id: '1',
    provider: 'ChatGPT',
    title: 'ChatGPT',
    preview: 'Помоги написать письмо клиенту про перенос сроков…',
    time: '2 ч',
    avatar: '/providers/gpt.png',
  },
  {
    id: '2',
    provider: 'Claude',
    title: 'Claude',
    preview: 'Разбор ТЗ на посадочную страницу',
    time: 'вчера',
    avatar: '/providers/claude.png',
  },
  {
    id: '3',
    provider: 'Midjourney',
    title: 'Midjourney',
    preview: 'Постер к концерту — тёмный акварельный стиль',
    time: '3 д',
    avatar: '/providers/midjourney.png',
  },
]

const CATEGORIES: Category[] = [
  {
    id: 'text',
    title: 'Текст',
    items: [
      { id: 'chatgpt', name: 'ChatGPT', avatar: `${P}/gpt.png` },
      { id: 'claude', name: 'Claude', avatar: `${P}/claude.png` },
      { id: 'gemini', name: 'Gemini', avatar: `${P}/gemini.png` },
      { id: 'grok', name: 'Grok', avatar: `${P}/grok.png` },
      { id: 'deepseek', name: 'Deepseek', avatar: `${P}/deepseek.png` },
      { id: 'perplexity', name: 'Perplexity', avatar: `${P}/perplexity.png` },
      { id: 'qwen', name: 'Qwen', avatar: `${P}/qwen.png` },
      { id: 'nvidia', name: 'NVIDIA', avatar: `${P}/nvidea.png` },
      { id: 'meta', name: 'Meta AI', avatar: `${P}/metaai.png` },
      { id: 'nous', name: 'Nous', avatar: `${P}/nous.png` },
      { id: 'baidu', name: 'Baidu', avatar: `${P}/baidu.png` },
    ],
  },
  {
    id: 'image',
    title: 'Изображения',
    items: [
      { id: 'dalle', name: 'DALL·E', avatar: `${P}/dalle.png` },
      { id: 'nanobanana', name: 'Gemini Image', avatar: `${P}/NanoBanana.png` },
      { id: 'midjourney', name: 'Midjourney', avatar: `${P}/midjourney.png` },
      { id: 'sourceful', name: 'Sourceful', avatar: `${P}/Sourceful.png` },
      { id: 'flux', name: 'FLUX.2', avatar: `${P}/blclabs.png` },
    ],
  },
  {
    id: 'video',
    title: 'Видео',
    items: [
      { id: 'sora2', name: 'Sora', avatar: `${P}/sora-optimized.png` },
      { id: 'veo3', name: 'Veo 3', avatar: `${P}/veo3.png` },
      { id: 'kling', name: 'Kling AI', avatar: `${P}/klingai.png` },
    ],
  },
  {
    id: 'audio',
    title: 'Аудио',
    items: [
      { id: 'elevenlabs', name: 'ElevenLabs', avatar: `${P}/elevenlabs.png` },
      { id: 'openai-audio', name: 'OpenAI Audio', avatar: `${P}/gpt.png` },
    ],
  },
]

function ProviderTile({ item, onClick }: { item: Provider; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 w-[80px] shrink-0 active:opacity-70"
    >
      <img
        src={item.avatar}
        alt=""
        className="w-16 h-16 rounded-[20px] object-cover bg-black/5 dark:bg-white/10 shadow-[0_2px_8px_rgba(0,0,0,0.10)] dark:shadow-none"
      />
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

  const menuItems: MenuItem[] = [
    { label: 'Загрузки', icon: Download, onSelect: () => haptic('light') },
    { label: 'Избранное', icon: Bookmark, onSelect: () => haptic('light') },
    { label: 'Настройки', icon: Settings, onSelect: () => nav('/profile') },
  ]

  const fullName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ')
    : 'Гость'
  const letter = fullName.trim().charAt(0).toUpperCase() || '?'

  const pick = (id: string) => {
    haptic('light')
    // TODO: открыть подробную страницу провайдера
    console.log('provider', id)
  }

  return (
    <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="Генерация"
        right={
          <>
            <KLink iconOnly onClick={() => haptic('light')}>
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

      {/* Профиль-пилюля: аватарка, имя, план, тумблер темы */}
      <div className="mx-safe-4 mt-20 mb-3">
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

      {CATEGORIES.map((cat) => (
        <div
          key={cat.id}
          className="ml-safe-4 mr-safe-4 rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1
                     my-3 pt-3 pb-4 pl-4"
        >
          <div className="pr-4 text-[17px] font-semibold text-black dark:text-white mb-3">
            {cat.title}
          </div>
          <div
            className="flex gap-4 overflow-x-auto pr-4
                       [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {cat.items.map((it) => (
              <ProviderTile
                key={it.id}
                item={it}
                onClick={() => pick(it.id)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* История чатов */}
      <div
        className="ml-safe-4 mr-safe-4 rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1
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
