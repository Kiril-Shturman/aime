import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Folder,
  Headphones,
  Image as ImageIcon,
  MessageSquare,
  Search,
  Video,
  type LucideIcon,
} from 'lucide-react'
import {
  Link as KLink,
  Navbar,
  NavbarBackLink,
  Page,
  Searchbar,
} from 'konsta/react'
import {
  CHAT_HISTORY,
  HISTORY_TABS,
  type ChatHistoryItem,
  type HistoryTab,
} from '../lib/history'
import { haptic } from '../lib/telegram'

// Иконки для табов; «Все» без иконки — визуально как ярлык «показать всё».
const TAB_ICONS: Record<string, LucideIcon | undefined> = {
  all: undefined,
  project: Folder,
  text: MessageSquare,
  image: ImageIcon,
  video: Video,
  audio: Headphones,
}

export default function HistoryPage() {
  const nav = useNavigate()

  const [tab, setTab] = useState<HistoryTab['key']>('all')
  const [q, setQ] = useState('')
  const [searchOn, setSearchOn] = useState(false)
  const searchInputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!searchOn) return
    const timer = window.setTimeout(() => {
      searchInputRef.current?.querySelector('input')?.focus()
    }, 320)
    return () => window.clearTimeout(timer)
  }, [searchOn])

  const query = q.trim().toLowerCase()
  const items = useMemo(() => {
    let list: ChatHistoryItem[] = CHAT_HISTORY
    if (tab !== 'all') list = list.filter((c) => c.kind === tab)
    if (query)
      list = list.filter((c) =>
        (c.title + ' ' + c.provider + ' ' + c.preview)
          .toLowerCase()
          .includes(query),
      )
    return list
  }, [tab, query])

  const openItem = (c: ChatHistoryItem) => {
    haptic('light')
    // Пока пробрасываем только text-чаты в /chat/:provider — остальные
    // ждут своих страниц (для image/video/audio/project их пока нет).
    if (c.kind === 'text') nav(`/chat/${c.target}`)
  }

  return (
    <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="История"
        left={
          // На десктопе есть сайдбар с навигацией — «Назад» из navbar лишний.
          <span className="md:hidden">
            <NavbarBackLink text="Назад" onClick={() => nav(-1)} />
          </span>
        }
        right={
          <KLink iconOnly onClick={() => setSearchOn(true)}>
            <Search size={22} />
          </KLink>
        }
      />

      {/* F7 Searchbar Expandable: выезжает справа налево через navbar.
          На мобилке — во всю ширину. На md+ прижимается к правому краю
          и ограничен по ширине (420px), чтобы не растекаться под весь
          navbar-контейнер. */}
      <div
        ref={searchInputRef}
        className={`fixed inset-x-0 top-0 z-[100] bg-white pt-[max(16px,env(safe-area-inset-top))] px-4 pb-2 dark:bg-black
                    md:inset-x-auto md:right-4 md:left-auto md:w-[420px] md:max-w-[calc(100vw-19rem)]
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
          placeholder="Поиск по истории"
        />
      </div>

      {/* Общий wrapper для десктопной ширины — как на GeneratePage.
          Центрируем контент и ограничиваем max-w-[1100px] на md+. */}
      <div className="md:mx-auto md:w-full md:max-w-[1100px] md:px-6">

      {/* Табы разделов: активный — обычный текст (не синий) + синяя черта
          снизу, у неактивных приглушённая заливка. Все табы кроме «Все» —
          с иконкой слева. На md+ распределяются равномерно по всей ширине
          контейнера; на мобилке — горизонтальный скролл. */}
      <div className="mt-2 border-b border-black/[.08] dark:border-white/[.08]">
        <div
          className="flex gap-6 overflow-x-auto px-safe-4 md:px-0
                     [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {HISTORY_TABS.map((t) => {
            const active = tab === t.key
            const Icon = TAB_ICONS[t.key]
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`shrink-0 relative inline-flex items-center gap-2 pt-2.5 pb-3 text-[17px] transition-colors ${
                  active
                    ? 'font-semibold text-black dark:text-white'
                    : 'font-medium text-black/55 dark:text-white/55 active:text-black/80 dark:active:text-white/80'
                }`}
              >
                {Icon && <Icon size={17} strokeWidth={active ? 2.2 : 2} />}
                {t.label}
                {/* Индикатор — синяя черта под активной вкладкой, вылезает
                    за нижний край на пиксель, чтобы перекрыть hairline. */}
                <span
                  className={`absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-[#2a8bff] transition-opacity ${
                    active ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </button>
            )
          })}
        </div>
      </div>

      <div className="ml-safe-4 mr-safe-4 md:mx-0 mt-3 mb-3 rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 overflow-hidden">
        {items.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-black/50 dark:text-white/50">
            {query ? 'Ничего не нашлось' : 'В этом разделе пока пусто'}
          </div>
        ) : (
          <ul className="divide-y divide-black/[.06] dark:divide-white/[.06]">
            {items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => openItem(c)}
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

      </div>
    </Page>
  )
}
