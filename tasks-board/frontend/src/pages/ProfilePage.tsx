import type { ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronLeft, Globe, Moon, Pencil, Sun } from 'lucide-react'
import { Link as KLink, Popover } from 'konsta/react'
import { GbFlag, RuFlag, useLang } from '../components/LangSwitch'
import MoneyRublCircleFill from 'framework7-icons/react/esm/MoneyRublCircleFill.js'
import PlusIcon from 'framework7-icons/react/esm/Plus.js'
import Rosette from 'framework7-icons/react/esm/Rosette.js'
import CreditcardFill from 'framework7-icons/react/esm/CreditcardFill.js'
import SquareStack from 'framework7-icons/react/esm/SquareStack.js'
import BitcoinCircleFill from 'framework7-icons/react/esm/BitcoinCircleFill.js'
import CubeBoxFill from 'framework7-icons/react/esm/CubeBoxFill.js'
import AppFill from 'framework7-icons/react/esm/AppFill.js'
import CheckmarkSquareFill from 'framework7-icons/react/esm/CheckmarkSquareFill.js'
import GearAlt from 'framework7-icons/react/esm/GearAlt.js'
import ChatBubble2Fill from 'framework7-icons/react/esm/ChatBubble2Fill.js'
import QuestionCircleFill from 'framework7-icons/react/esm/QuestionCircleFill.js'
import DocText from 'framework7-icons/react/esm/DocText.js'
import Lock from 'framework7-icons/react/esm/Lock.js'
import {
  Block,
  BlockTitle,
  List,
  ListItem,
  Navbar,
  Page,
  Toggle,
} from 'konsta/react'
import { useTheme } from '../store/ThemeStore'
import { getUser, haptic } from '../lib/telegram'

// Строка меню в стиле iOS Settings: цветная иконка + название + описание.
interface Row {
  icon: ComponentType
  title: string
  desc: string
  color: string
  to: string
}

const ROWS: Row[] = [
  {
    icon: SquareStack,
    title: 'Тарифы',
    desc: '',
    color: '#ec4899',
    to: '/tariffs',
  },
  {
    icon: BitcoinCircleFill,
    title: 'Мои токены',
    desc: '',
    color: '#f59e0b',
    to: '/balance',
  },
  {
    icon: CreditcardFill,
    title: 'Транзакции',
    desc: '',
    color: '#a855f7',
    to: '/transactions',
  },
  {
    icon: Rosette,
    title: 'Расход токенов',
    desc: '',
    color: '#2a8bff',
    to: '/tokens',
  },
  {
    icon: CubeBoxFill,
    title: 'MCP-ключи',
    desc: '',
    color: '#10b981',
    to: '/mcp-keys',
  },
  {
    icon: AppFill,
    title: 'Подключённые приложения',
    desc: '',
    color: '#0ea5e9',
    to: '/connected-apps',
  },
]

const MORE_ROWS: Row[] = [
  {
    icon: CheckmarkSquareFill,
    title: 'Настройки доски',
    desc: '',
    color: '#f97316',
    to: '/board-settings',
  },
  {
    icon: GearAlt,
    title: 'Настройки',
    desc: '',
    color: '#64748b',
    to: '/settings',
  },
  {
    icon: ChatBubble2Fill,
    title: 'Поддержка',
    desc: '',
    color: '#10b981',
    to: '/support',
  },
  {
    icon: QuestionCircleFill,
    title: 'FAQ',
    desc: '',
    color: '#f59e0b',
    to: '/faq',
  },
  {
    icon: DocText,
    title: 'Условия использования',
    desc: '',
    color: '#0ea5e9',
    to: '/terms',
  },
  {
    icon: Lock,
    title: 'Конфиденциальность',
    desc: '',
    color: '#22c55e',
    to: '/privacy',
  },
]

export default function ProfilePage() {
  const navigate = useNavigate()
  const user = getUser()

  const fullName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ')
    : 'Гость'
  const letter = fullName.trim().charAt(0).toUpperCase() || '?'

  // Стеклянная пилюля-шапка «назад + язык»: KLink-ки внутри одного div,
  // как левая пилюля в шапке чата. Поповер выбора языка портируем в body,
  // чтобы backdrop не резался transform-обёрткой Konsta Navbar. KLink
  // не пробрасывает ref, поэтому «якорь» поповера — обёртка span.
  const langBtnRef = useRef<HTMLSpanElement | null>(null)
  const [langOpen, setLangOpen] = useState(false)
  const { lang, setLang } = useLang()

  const HeaderPill = ({
    langBtnRef,
    onLang,
  }: {
    langBtnRef: React.RefObject<HTMLSpanElement | null>
    onLang: () => void
  }) => (
    <>
      <KLink
        iconOnly
        onClick={() => navigate('/')}
        aria-label="Назад"
        className="aspect-square h-full max-h-11 !text-black dark:!text-white"
      >
        <ChevronLeft size={20} strokeWidth={2.5} />
      </KLink>
      <span
        ref={langBtnRef}
        className="inline-flex aspect-square h-full max-h-11"
      >
        <KLink
          iconOnly
          onClick={onLang}
          aria-label="Язык"
          className="!w-full !h-full !text-black dark:!text-white"
        >
          <Globe size={20} strokeWidth={2.5} />
        </KLink>
      </span>
    </>
  )

  const OPTIONS = [
    { id: 'ru' as const, label: 'Русский', flag: <RuFlag /> },
    { id: 'en' as const, label: 'English', flag: <GbFlag /> },
  ]

  const langPortal = createPortal(
    <Popover
      opened={langOpen}
      target={langBtnRef.current}
      onBackdropClick={() => setLangOpen(false)}
      className="!w-56 !mt-3"
    >
      <div className="py-1">
        {OPTIONS.map((o, i) => {
          const active = lang === o.id
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                setLangOpen(false)
                setLang(o.id)
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left active:bg-black/5 dark:active:bg-white/[.06] ${
                i > 0
                  ? 'border-t border-black/[.06] dark:border-white/[.06]'
                  : ''
              }`}
            >
              <span className="w-6 h-6 rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-white">
                {o.flag}
              </span>
              <span className="flex-1 text-[15px]">{o.label}</span>
              {active && (
                <Check size={16} className="text-[#2a8bff] shrink-0" />
              )}
            </button>
          )
        })}
      </div>
    </Popover>,
    document.body,
  )

  return (
    <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="Профиль"
        // Konsta и так оборачивает left в Glass — оставляем его капсулой
        // с двумя KLink-ами внутри, ровно как левая пилюля в шапке чата.
        left={<HeaderPill langBtnRef={langBtnRef} onLang={() => setLangOpen(true)} />}
        right={<TokenBadge onOpen={() => navigate('/tokens')} onTopUp={() => navigate('/tariffs')} />}
      />
      {langPortal}

      <div className="mx-auto w-full max-w-[560px]">
        {/* Шапка: аватар + имя + username */}
        <Block className="!mt-4 !mb-4">
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              {user?.photo_url ? (
                <img
                  src={user.photo_url}
                  alt=""
                  className="w-24 h-24 rounded-full object-cover"
                />
              ) : (
                <div className="w-24 h-24 rounded-full flex items-center justify-center bg-[#2a8bff] text-white text-[40px] font-semibold">
                  {letter}
                </div>
              )}
              {/* Круглая стеклянная кнопка правки прямо на углу аватара */}
              <button
                type="button"
                onClick={() => {
                  haptic('light')
                  navigate('/profile/edit')
                }}
                aria-label="Редактировать профиль"
                className="absolute bottom-0 right-0 w-9 h-9 rounded-full
                           bg-ios-light-glass dark:bg-ios-dark-glass
                           shadow-ios-light-glass dark:shadow-ios-dark-glass backdrop-blur-lg
                           flex items-center justify-center text-black dark:text-white
                           ring-2 ring-white dark:ring-black
                           active:opacity-70"
              >
                <Pencil size={14} />
              </button>
            </div>
            <div className="text-center">
              <div className="text-black dark:text-white text-[24px] font-semibold">
                {fullName}
              </div>
              {user?.username && (
                <div className="text-black/60 dark:text-white/60 text-[15px] mt-0.5">
                  @{user.username}
                </div>
              )}
              {user?.is_premium && (
                <div className="inline-block mt-2 text-[12px] px-2 py-0.5 rounded-full bg-[#ffd60a]/20 text-[#ffd60a]">
                  Telegram Premium
                </div>
              )}
            </div>
          </div>
        </Block>

        {/* Одна форма-список, разделы идут по строкам (iOS Settings). */}
        <BlockTitle>Нейросети</BlockTitle>
        <List
          strong
          inset
          className="[&>ul]:!rounded-[28px]"
        >
          {ROWS.map((r) => (
            <ListItem
              key={r.to}
              link
              onClick={() => {
                haptic('light')
                navigate(r.to)
              }}
              title={r.title}
              mediaClassName="!me-5"
              media={
                <span
                  className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white shrink-0 text-[18px]"
                  style={{ background: r.color }}
                >
                  <r.icon />
                </span>
              }
            />
          ))}
        </List>

        <BlockTitle>Помощь и настройки</BlockTitle>
        <List strong inset className="[&>ul]:!rounded-[28px]">
          {MORE_ROWS.map((r) => (
            <ListItem
              key={r.to}
              link
              onClick={() => {
                haptic('light')
                navigate(r.to)
              }}
              title={r.title}
              mediaClassName="!me-5"
              media={
                <span
                  className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white shrink-0 text-[18px]"
                  style={{ background: r.color }}
                >
                  <r.icon />
                </span>
              }
            />
          ))}
        </List>

        {/* Тумблер темы — тем же паттерном, что и в предыдущей версии */}
        <BlockTitle>Оформление</BlockTitle>
        <List strong inset>
          <ThemeRow />
        </List>
      </div>
    </Page>
  )
}

// Пилюля-балансер токенов в правой части Navbar: наш стеклянный
// шаблон + маленькая иконка монеты, число токенов и «+»-кнопка
// пополнения. По клику на число — уходим в /tokens, по «+» — в /tariffs.
function TokenBadge({
  onOpen,
  onTopUp,
}: {
  onOpen: () => void
  onTopUp: () => void
}) {
  // TODO: подтянуть из SubscriptionService (user/tokens). Пока моковое.
  const balance = 12_450
  // Форматирование как у ai-webapi: целая часть жирная, дробная — тоньше.
  const [whole, frac] = balance.toFixed(2).split('.')
  return (
    <span className="inline-flex items-center gap-2 pl-safe-2 pr-safe-2">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Баланс"
        className="w-8 h-8 aspect-square rounded-full bg-[#2a8bff] text-white inline-flex items-center justify-center shrink-0 basis-8 text-[24px] active:opacity-70"
      >
        <MoneyRublCircleFill />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="text-[14px] font-semibold leading-none text-black dark:text-white tabular-nums px-1 active:opacity-70"
      >
        {whole}
        <span className="text-[0.75em] opacity-70 font-medium">.{frac}</span>
      </button>
      <button
        type="button"
        onClick={onTopUp}
        aria-label="Пополнить"
        className="w-8 h-8 aspect-square rounded-full bg-white text-[#1c1c1e] inline-flex items-center justify-center shrink-0 basis-8 text-[18px] shadow-sm active:opacity-80"
      >
        <PlusIcon />
      </button>
    </span>
  )
}

function ThemeRow() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <ListItem
      title="Тёмная тема"
      media={
        <span className="w-8 h-8 rounded-full flex items-center justify-center bg-black/[.06] dark:bg-white/[.10] text-black dark:text-white">
          {dark ? <Moon size={16} /> : <Sun size={16} />}
        </span>
      }
      after={<Toggle checked={dark} onChange={toggle} />}
    />
  )
}
