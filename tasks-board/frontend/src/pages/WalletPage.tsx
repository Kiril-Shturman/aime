import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'react-qr-code'
import { Button, Card, Link as KLink, List, ListItem, Navbar, Page, Popover, Preloader, Searchbar, Segmented, SegmentedButton, Tabbar, TabbarLink, ToolbarPane } from 'konsta/react'
import {
  SiBitcoin,
  SiBnbchain,
  SiEthereum,
  SiSolana,
  SiTether,
  SiTon,
} from '@icons-pack/react-simple-icons'
import ArrowRightArrowLeft from 'framework7-icons/react/esm/ArrowRightArrowLeft.js'
import ArrowDownCircleFill from 'framework7-icons/react/esm/ArrowDownCircleFill.js'
import ArrowUpCircleFill from 'framework7-icons/react/esm/ArrowUpCircleFill.js'
import BellFill from 'framework7-icons/react/esm/BellFill.js'
import BuildingColumnsFill from 'framework7-icons/react/esm/BuildingColumnsFill.js'
import ChevronLeft from 'framework7-icons/react/esm/ChevronLeft.js'
import ChevronRight from 'framework7-icons/react/esm/ChevronRight.js'
import Clock from 'framework7-icons/react/esm/Clock.js'
import ClockFill from 'framework7-icons/react/esm/ClockFill.js'
import CreditcardFill from 'framework7-icons/react/esm/CreditcardFill.js'
import DocOnDoc from 'framework7-icons/react/esm/DocOnDoc.js'
import Ellipsis from 'framework7-icons/react/esm/Ellipsis.js'
import Eye from 'framework7-icons/react/esm/Eye.js'
import EyeSlash from 'framework7-icons/react/esm/EyeSlash.js'
import GearAlt from 'framework7-icons/react/esm/GearAlt.js'
import Globe from 'framework7-icons/react/esm/Globe.js'
import LockShieldFill from 'framework7-icons/react/esm/LockShieldFill.js'
import LogoApple from 'framework7-icons/react/esm/LogoApple.js'
import LogoGoogle from 'framework7-icons/react/esm/LogoGoogle.js'
import MoonStars from 'framework7-icons/react/esm/MoonStars.js'
import PaperplaneFill from 'framework7-icons/react/esm/PaperplaneFill.js'
import PersonCropCircleFill from 'framework7-icons/react/esm/PersonCropCircleFill.js'
import PlusCircleFill from 'framework7-icons/react/esm/PlusCircleFill.js'
import QuestionCircleFill from 'framework7-icons/react/esm/QuestionCircleFill.js'
import SliderHorizontal3 from 'framework7-icons/react/esm/SliderHorizontal3.js'
import Snow from 'framework7-icons/react/esm/Snow.js'
import SunMax from 'framework7-icons/react/esm/SunMax.js'
import WalletFill from 'framework7-icons/react/esm/WalletFill.js'
import { getUser, haptic } from '../lib/telegram'
import { useTheme } from '../store/ThemeStore'

type Action = {
  label: string
  icon: ComponentType<{ className?: string }>
}

type Asset = {
  code: string
  name: string
  rate: string
  color: string
  iconColor: string
  icon: ReactNode
}

type WalletTab = 'wallet' | 'history' | 'cards' | 'profile'
type CryptoFlow = { kind: 'deposit' | 'withdraw' | 'exchange'; assetCode?: string }

type WalletNetwork = {
  name: string
  address: string
}

const tabMeta: Record<WalletTab, { title: string; subtitle: string }> = {
  wallet: { title: 'Кошелёк', subtitle: 'Все активы' },
  history: { title: 'История', subtitle: 'Платежи и переводы' },
  cards: { title: 'Карты', subtitle: 'Виртуальные карты Visa' },
  profile: { title: 'Профиль', subtitle: 'Настройки аккаунта' },
}

const actions: Action[] = [
  { label: 'Перевести', icon: PaperplaneFill },
  { label: 'Пополнить', icon: PlusCircleFill },
  { label: 'Вывести', icon: ArrowUpCircleFill },
  { label: 'Обменять', icon: ArrowRightArrowLeft },
]

const assets: Asset[] = [
  { code: 'USDT', name: 'Tether', rate: '$1,00', color: '#26A17B', iconColor: '#fff', icon: <SiTether size={25} /> },
  { code: 'TON', name: 'Toncoin', rate: '$1,86', color: '#0098EA', iconColor: '#fff', icon: <SiTon size={25} /> },
  { code: 'BTC', name: 'Bitcoin', rate: '$65 840', color: '#F7931A', iconColor: '#fff', icon: <SiBitcoin size={25} /> },
  { code: 'ETH', name: 'Ethereum', rate: '$2 090', color: '#627EEA', iconColor: '#fff', icon: <SiEthereum size={25} /> },
  { code: 'BNB', name: 'BNB', rate: '$612,40', color: '#F3BA2F', iconColor: '#181818', icon: <SiBnbchain size={25} /> },
  { code: 'SOL', name: 'Solana', rate: '$145,20', color: '#111', iconColor: '#14F195', icon: <SiSolana size={25} /> },
]

// Пока провайдер кошелька не подключён, реквизиты намеренно не являются
// реальными адресами. Экран нужен для согласования UX и визуального слоя.
const assetNetworks: Record<string, WalletNetwork[]> = {
  USDT: [
    { name: 'TRC20', address: 'TDEMO7qWalletAddressNotActiveTRC20' },
    { name: 'ERC20', address: '0xDEMO0000000000000000000000000000ERC20' },
    { name: 'TON', address: 'UQ_DEMO_USDT_WALLET_ADDRESS_NOT_ACTIVE' },
  ],
  TON: [{ name: 'TON', address: 'UQ_DEMO_TON_WALLET_ADDRESS_NOT_ACTIVE' }],
  BTC: [{ name: 'Bitcoin', address: 'bc1q-demo-wallet-address-not-active' }],
  ETH: [{ name: 'Ethereum', address: '0xDEMO0000000000000000000000000000000ETH' }],
  BNB: [{ name: 'BSC', address: '0xDEMO0000000000000000000000000000000BNB' }],
  SOL: [{ name: 'Solana', address: 'DEMO_SOLANA_WALLET_ADDRESS_NOT_ACTIVE' }],
}

const PULL_THRESHOLD = 58
const PULL_MAX_DISTANCE = 96

function usePullToRefresh<T extends HTMLElement>(
  scrollRef: RefObject<T | null>,
  {
    onRefreshStart,
    onRefreshed,
    delay = 800,
  }: {
    onRefreshStart?: () => void
    onRefreshed: () => void
    delay?: number
  },
) {
  const startY = useRef<number | null>(null)
  const distanceRef = useRef(0)
  const refreshingRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const callbacksRef = useRef({ onRefreshStart, onRefreshed })
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [dragging, setDragging] = useState(false)

  callbacksRef.current = { onRefreshStart, onRefreshed }

  const updateDistance = useCallback((clientY: number) => {
    if (startY.current === null || refreshingRef.current || (scrollRef.current?.scrollTop ?? 0) > 0) return false
    const delta = clientY - startY.current
    if (delta <= 0) {
      distanceRef.current = 0
      setDistance(0)
      return false
    }

    // Контент заметно следует за пальцем, но после 72 px сопротивление
    // постепенно растёт, чтобы не появлялась бесконечная пустая область.
    const easedDelta = delta <= 72 ? delta * 0.72 : 51.84 + (delta - 72) * 0.24
    const nextDistance = Math.min(PULL_MAX_DISTANCE, easedDelta)
    distanceRef.current = nextDistance
    setDistance(nextDistance)
    return true
  }, [scrollRef])

  const finish = useCallback(() => {
    startY.current = null
    setDragging(false)
    if (distanceRef.current < PULL_THRESHOLD || refreshingRef.current) {
      distanceRef.current = 0
      setDistance(0)
      return
    }

    refreshingRef.current = true
    setRefreshing(true)
    setDistance(PULL_THRESHOLD)
    callbacksRef.current.onRefreshStart?.()
    haptic('medium')

    timerRef.current = window.setTimeout(() => {
      refreshingRef.current = false
      setRefreshing(false)
      distanceRef.current = 0
      setDistance(0)
      haptic('success')
      callbacksRef.current.onRefreshed()
    }, delay)
  }, [delay])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || refreshingRef.current || node.scrollTop > 0) return
      startY.current = event.touches[0].clientY
      setDragging(true)
    }
    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      if (updateDistance(event.touches[0].clientY)) event.preventDefault()
    }
    const handleTouchEnd = () => finish()

    node.addEventListener('touchstart', handleTouchStart, { passive: true })
    node.addEventListener('touchmove', handleTouchMove, { passive: false })
    node.addEventListener('touchend', handleTouchEnd, { passive: true })
    node.addEventListener('touchcancel', handleTouchEnd, { passive: true })
    return () => {
      node.removeEventListener('touchstart', handleTouchStart)
      node.removeEventListener('touchmove', handleTouchMove)
      node.removeEventListener('touchend', handleTouchEnd)
      node.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [finish, scrollRef, updateDistance])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const pointerDown = (event: ReactPointerEvent<T>) => {
    if (event.pointerType !== 'mouse' || refreshingRef.current || (scrollRef.current?.scrollTop ?? 0) > 0) return
    startY.current = event.clientY
    setDragging(true)
  }
  const pointerMove = (event: ReactPointerEvent<T>) => {
    if (event.pointerType === 'mouse') updateDistance(event.clientY)
  }

  return { distance, refreshing, dragging, pointerDown, pointerMove, finish }
}

function PullRefreshIndicator({ distance, refreshing, dragging }: { distance: number; refreshing: boolean; dragging: boolean }) {
  const ready = distance >= PULL_THRESHOLD
  return (
    <div
      aria-live="polite"
      className={`relative z-20 flex shrink-0 items-center justify-center overflow-hidden text-[13px] font-medium text-black/60 dark:text-white/60 ${dragging ? '' : 'transition-[height] duration-300 ease-out'}`}
      style={{ height: refreshing ? PULL_THRESHOLD : distance }}
    >
      <span className="flex items-center gap-2 whitespace-nowrap rounded-full bg-black/[.055] px-3 py-1.5 backdrop-blur-md dark:bg-white/[.10]">
        {refreshing ? (
          <>
            <Preloader className="h-5 w-5" />
            <span>Обновляем…</span>
          </>
        ) : (
          <>
            <ArrowDownCircleFill className={`text-[18px] text-primary transition-transform ${ready ? 'rotate-180' : ''}`} />
            <span>{ready ? 'Отпустите, чтобы обновить' : 'Потяните вниз для обновления'}</span>
          </>
        )}
      </span>
    </div>
  )
}

export default function WalletPage() {
  const user = getUser()
  const { theme, toggle: toggleTheme } = useTheme()
  const menuButton = useRef<HTMLElement | null>(null)
  const pageRef = useRef<HTMLElement | null>(null)
  const [activeTab, setActiveTab] = useState<WalletTab>('wallet')
  const [selectedAssetCode, setSelectedAssetCode] = useState<string | null>(null)
  const [cryptoFlow, setCryptoFlow] = useState<CryptoFlow | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [balanceHidden, setBalanceHidden] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Кошелёк'
    const timer = window.setTimeout(() => setLoading(false), 850)
    return () => {
      document.title = previousTitle
      window.clearTimeout(timer)
    }
  }, [])

  const initials = (user?.first_name || 'К').slice(0, 1).toUpperCase()
  const menuItems = useMemo(
    () => [
      {
        title: theme === 'dark' ? 'Светлая тема' : 'Тёмная тема',
        subtitle: 'Сменить оформление',
        icon: theme === 'dark' ? <SunMax /> : <MoonStars />,
        action: () => toggleTheme(),
      },
      {
        title: balanceHidden ? 'Показать баланс' : 'Скрыть баланс',
        subtitle: 'На этом устройстве',
        icon: balanceHidden ? <Eye /> : <EyeSlash />,
        action: () => setBalanceHidden((value) => !value),
      },
      {
        title: 'История операций',
        subtitle: 'Переводы и обмены',
        icon: <Clock />,
        action: () => selectTab('history'),
      },
      {
        title: 'Настройки кошелька',
        subtitle: 'Валюта и безопасность',
        icon: <GearAlt />,
        action: () => selectTab('profile'),
      },
    ],
    [balanceHidden, theme, toggleTheme],
  )

  function showNotice(text: string) {
    haptic('light')
    setNotice(text)
    window.setTimeout(() => setNotice(''), 1800)
  }

  function runMenuAction(action: () => void) {
    haptic('light')
    setMenuOpen(false)
    action()
  }

  function selectTab(tab: WalletTab) {
    haptic('light')
    setSelectedAssetCode(null)
    setActiveTab(tab)
    pageRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const pull = usePullToRefresh(pageRef, {
    delay: 900,
    onRefreshStart: () => setLoading(true),
    onRefreshed: () => {
      setLoading(false)
      showNotice(`${tabMeta[activeTab].title} обновлен${activeTab === 'history' ? 'а' : activeTab === 'cards' ? 'ы' : ''}`)
    },
  })

  const menu = createPortal(
    <Popover
      opened={menuOpen}
      target={menuButton.current}
      onBackdropClick={() => setMenuOpen(false)}
      className="!mt-3 !w-72"
    >
      <List nested className="!my-0">
        {menuItems.map((item) => (
          <ListItem
            key={item.title}
            link
            onClick={() => runMenuAction(item.action)}
            media={<span className="text-[21px] text-primary">{item.icon}</span>}
            title={item.title}
            subtitle={item.subtitle}
          />
        ))}
      </List>
    </Popover>,
    document.body,
  )

  return (
    <Page
      ref={pageRef}
      className="overscroll-y-none pb-[calc(96px+env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      onPointerDown={pull.pointerDown}
      onPointerMove={pull.pointerMove}
      onPointerUp={pull.finish}
      onPointerCancel={pull.finish}
    >
      <Navbar
        title={tabMeta[activeTab].title}
        subtitle={tabMeta[activeTab].subtitle}
        left={
          <button
            type="button"
            onClick={() => selectTab('profile')}
            aria-label="Профиль"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/45 p-[5px] text-[15px] font-semibold leading-none text-white shadow-sm backdrop-blur-xl active:opacity-60 dark:border-white/[.16] dark:bg-white/10"
          >
            {user?.photo_url ? (
              <img src={user.photo_url} alt="" className="block h-full w-full rounded-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center rounded-full bg-primary">{initials}</span>
            )}
          </button>
        }
        right={
          <span ref={menuButton} className="inline-flex h-11 w-11">
            <KLink
              iconOnly
              onClick={() => {
                haptic('light')
                setMenuOpen(true)
              }}
              aria-label="Ещё"
              className="!h-full !w-full !text-black dark:!text-white"
            >
              <Ellipsis className="text-[25px]" />
            </KLink>
          </span>
        }
      />
      {menu}

      <PullRefreshIndicator distance={pull.distance} refreshing={pull.refreshing} dragging={pull.dragging} />

      {activeTab === 'wallet' && <main className={`mx-auto w-full max-w-[560px] transition-[transform,opacity] duration-300 ease-out ${selectedAssetCode ? '-translate-x-[22%] opacity-60' : 'translate-x-0 opacity-100'}`}>
        <section className="px-safe-4 pb-7 pt-9 text-center" aria-label="Общий баланс">
          <div className="text-[15px] font-medium text-black/50 dark:text-white/50">Общий баланс</div>
          {loading ? (
            <div className="mx-auto mt-3 h-[52px] w-44 animate-pulse rounded-2xl bg-black/10 dark:bg-white/10" />
          ) : (
            <>
              <div className="mt-2 text-[52px] font-semibold leading-none tracking-[-0.045em] tabular-nums text-black dark:text-white">
                {balanceHidden ? '••••••' : <><span>$0</span><span className="text-black/35 dark:text-white/35">.00</span></>}
              </div>
              <div className="mt-3 text-[14px] text-black/40 dark:text-white/40">
                {balanceHidden ? '≈ ••••••' : '≈ 0,00 ₽'}
              </div>
            </>
          )}
        </section>

        <section className="grid grid-cols-4 gap-2 px-safe-4" aria-label="Действия с кошельком">
          {actions.map(({ label, icon: Icon }) => (
            <Button
              key={label}
              rounded
              clear
              onClick={() => {
                if (label === 'Пополнить') setCryptoFlow({ kind: 'deposit' })
                else if (label === 'Вывести') setCryptoFlow({ kind: 'withdraw' })
                else if (label === 'Обменять') setCryptoFlow({ kind: 'exchange' })
                else showNotice(`${label}: скоро будет доступно`)
              }}
              className="!m-0 !h-[62px] !min-w-0 !rounded-[22px] !bg-black/[.055] !px-1 !text-primary active:!bg-black/10 dark:!bg-white/[.10] dark:active:!bg-white/[.16]"
            >
              <span className="flex min-w-0 flex-col items-center justify-center gap-1">
                <Icon className="text-[22px]" />
                <span className="w-full truncate text-[10px] font-medium leading-none normal-case">{label}</span>
              </span>
            </Button>
          ))}
        </section>

        <section className="mt-8">
          <div className="mb-2 flex items-end justify-between px-safe-4">
            <h2 className="m-0 text-[21px] font-semibold tracking-tight text-black dark:text-white">Криптовалюты</h2>
            <span className="text-[13px] text-black/40 dark:text-white/40">Всего: $0,00</span>
          </div>

          {loading ? <WalletSkeleton /> : (
            <List strong inset dividers className="!mt-0">
              {assets.map((asset) => (
                <ListItem
                  key={asset.code}
                  link
                  chevron={false}
                  onClick={() => {
                    haptic('light')
                    setSelectedAssetCode(asset.code)
                  }}
                  innerClassName="!min-w-0 !py-3"
                  media={
                    <span
                      className="relative block h-11 w-11 shrink-0 rounded-full leading-none [&>svg]:!absolute [&>svg]:!left-1/2 [&>svg]:!top-1/2 [&>svg]:!m-0 [&>svg]:!block [&>svg]:!h-[24px] [&>svg]:!w-[24px] [&>svg]:!-translate-x-1/2 [&>svg]:!-translate-y-1/2"
                      style={{ backgroundColor: asset.color, color: asset.iconColor }}
                    >
                      {asset.icon}
                    </span>
                  }
                  innerChildren={
                    <span className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_72px] items-center gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[17px] font-semibold leading-6 text-black dark:text-white">{asset.name}</span>
                        <span className="mt-0.5 block truncate text-[14px] leading-5 text-black/55 dark:text-white/55">{asset.code} · {asset.rate}</span>
                      </span>
                      <span className="w-[72px] text-right">
                        <span className="block text-[16px] font-medium leading-6 tabular-nums text-black dark:text-white">0,00</span>
                        <span className="block text-[12px] leading-5 tabular-nums text-black/40 dark:text-white/40">$0,00</span>
                      </span>
                    </span>
                  }
                />
              ))}
            </List>
          )}
        </section>

        <p className="mx-auto mb-0 mt-5 max-w-[360px] px-5 text-center text-[12px] leading-relaxed text-black/30 dark:text-white/30">
          Курсы указаны для демонстрации интерфейса. Операции с активами пока не подключены.
        </p>
      </main>}

      {activeTab === 'history' && <HistorySection showNotice={showNotice} />}
      {activeTab === 'cards' && <CardsSection showNotice={showNotice} />}
      {activeTab === 'profile' && (
        <ProfileSection user={user} initials={initials} showNotice={showNotice} />
      )}

      <AssetPushView
        asset={assets.find((item) => item.code === selectedAssetCode) ?? null}
        onClose={() => setSelectedAssetCode(null)}
        showNotice={showNotice}
        openFlow={(kind, assetCode) => setCryptoFlow({ kind, assetCode })}
      />

      <CryptoFlowPushView
        flow={cryptoFlow}
        onClose={() => setCryptoFlow(null)}
        showNotice={showNotice}
      />

      <Tabbar
        labels
        icons
        className="!fixed !bottom-0 !left-0 !right-0 !z-30 !w-full !pb-[calc(env(safe-area-inset-bottom)+12px)]"
      >
        <ToolbarPane>
          <TabbarLink
            active={activeTab === 'wallet'}
            label="Кошелёк"
            icon={<WalletFill className="h-6 w-6" />}
            onClick={() => selectTab('wallet')}
          />
          <TabbarLink
            active={activeTab === 'history'}
            label="История"
            icon={<ClockFill className="h-6 w-6" />}
            onClick={() => selectTab('history')}
          />
          <TabbarLink
            active={activeTab === 'cards'}
            label="Карты"
            icon={<CreditcardFill className="h-6 w-6" />}
            onClick={() => selectTab('cards')}
          />
          <TabbarLink
            active={activeTab === 'profile'}
            label="Профиль"
            icon={<PersonCropCircleFill className="h-6 w-6" />}
            onClick={() => selectTab('profile')}
          />
        </ToolbarPane>
      </Tabbar>

      <div
        role="status"
        className={`pointer-events-none fixed bottom-[calc(88px+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-black px-4 py-2.5 text-[13px] font-medium text-white shadow-xl transition-all dark:bg-white dark:text-black ${notice ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}
      >
        {notice}
      </div>
    </Page>
  )
}

type NoticeHandler = (text: string) => void

function PullToRefreshContent({
  children,
  onRefreshed,
}: {
  children: ReactNode
  onRefreshed: () => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pull = usePullToRefresh(scrollRef, { onRefreshed })

  return (
    <div
      ref={scrollRef}
      className="flex-1 overscroll-y-none overflow-y-auto pb-[calc(32px+env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      onPointerDown={pull.pointerDown}
      onPointerMove={pull.pointerMove}
      onPointerUp={pull.finish}
      onPointerCancel={pull.finish}
    >
      <PullRefreshIndicator distance={pull.distance} refreshing={pull.refreshing} dragging={pull.dragging} />
      {children}
    </div>
  )
}

const demoPayments = [
  { id: 1, title: 'Пополнение карты', subtitle: 'Сегодня, 12:40', amount: '+10 000 ₽', kind: 'income' as const, icon: ArrowDownCircleFill },
  { id: 2, title: 'Оплата картой', subtitle: 'Кофейня · 10:15', amount: '−620 ₽', kind: 'expense' as const, icon: CreditcardFill },
  { id: 3, title: 'Обмен USDT', subtitle: 'Вчера, 18:06', amount: '−9 380 ₽', kind: 'expense' as const, icon: ArrowRightArrowLeft },
]

function AssetPushView({
  asset,
  onClose,
  showNotice,
  openFlow,
}: {
  asset: Asset | null
  onClose: () => void
  showNotice: NoticeHandler
  openFlow: (kind: CryptoFlow['kind'], assetCode: string) => void
}) {
  const [displayAsset, setDisplayAsset] = useState<Asset>(asset ?? assets[0])
  const swipeStart = useRef<number | null>(null)

  useEffect(() => {
    if (asset) setDisplayAsset(asset)
  }, [asset])

  const networks = assetNetworks[displayAsset.code] ?? []
  const [networkByAsset, setNetworkByAsset] = useState<Record<string, string>>({})
  const networkName = networkByAsset[displayAsset.code] ?? networks[0]?.name ?? ''
  const network = networks.find((item) => item.name === networkName) ?? networks[0]

  async function copyAddress() {
    if (!network?.address) return
    try {
      await navigator.clipboard.writeText(network.address)
      haptic('success')
      showNotice('Адрес скопирован')
    } catch {
      showNotice('Не удалось скопировать адрес')
    }
  }

  return createPortal(
    <section
      aria-hidden={asset === null}
      className={`fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#f3f3f8] transition-transform duration-300 ease-out dark:bg-black ${asset ? 'translate-x-0 shadow-[-18px_0_50px_rgba(0,0,0,.18)]' : 'pointer-events-none translate-x-full'}`}
      onPointerDown={(event) => {
        if (event.clientX <= 28) swipeStart.current = event.clientX
      }}
      onPointerUp={(event) => {
        if (swipeStart.current !== null && event.clientX - swipeStart.current > 72) onClose()
        swipeStart.current = null
      }}
      onPointerCancel={() => {
        swipeStart.current = null
      }}
    >
      <Navbar
        title={displayAsset.name}
        subtitle={displayAsset.code}
        left={
          <KLink onClick={onClose} aria-label="Назад" className="!-ml-2 !gap-0 !text-primary">
            <ChevronLeft className="text-[29px]" />
            <span className="-ml-1 text-[17px]">Назад</span>
          </KLink>
        }
      />

      <PullToRefreshContent onRefreshed={() => showNotice(`${displayAsset.name} обновлён`)}>
        {network && <main className="mx-auto w-full max-w-[560px] pb-5">
          <div className="px-safe-4 pb-3 pt-7 text-center">
            <span
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
              style={{ backgroundColor: displayAsset.color, color: displayAsset.iconColor }}
            >
              {displayAsset.icon}
            </span>
            <div className="mt-3 text-[15px] font-medium text-black/50 dark:text-white/50">Баланс {displayAsset.code}</div>
            <div className="mt-1 text-[36px] font-semibold leading-tight tabular-nums text-black dark:text-white">0,00</div>
            <div className="mt-1 text-[13px] text-black/40 dark:text-white/40">$0,00 · курс {displayAsset.rate}</div>
          </div>

          {networks.length > 1 ? (
            <div className="px-safe-4">
              <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-black/40 dark:text-white/40">Сеть получения</div>
              <Segmented strong rounded>
                {networks.map((item) => (
                  <SegmentedButton
                    key={item.name}
                    active={network.name === item.name}
                    onClick={() => {
                      haptic('light')
                      setNetworkByAsset((current) => ({ ...current, [displayAsset.code]: item.name }))
                    }}
                  >
                    {item.name}
                  </SegmentedButton>
                ))}
              </Segmented>
            </div>
          ) : (
            <List strong inset className="!my-1">
              <ListItem title="Сеть получения" after={network.name} />
            </List>
          )}

          <div className="mx-auto mt-5 w-fit rounded-[24px] bg-white p-4 shadow-sm">
            <QRCode value={network.address} size={168} bgColor="#ffffff" fgColor="#000000" />
          </div>
          <div className="mt-2 text-center text-[12px] text-black/40 dark:text-white/40">QR-код адреса {displayAsset.code}</div>

          <Card className="!mx-4 !mt-4" contentWrapPadding="p-3">
            <div className="text-[12px] font-medium text-black/40 dark:text-white/40">Адрес для получения</div>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-[12px] leading-5 text-black dark:text-white">{network.address}</code>
              <Button
                rounded
                small
                clear
                className="!m-0 !h-10 !w-10 !shrink-0 !p-0"
                aria-label="Скопировать адрес"
                onClick={copyAddress}
              >
                <DocOnDoc className="text-[20px]" />
              </Button>
            </div>
          </Card>

          <div className="grid grid-cols-3 gap-2 px-4">
            <Button rounded tonal className="!m-0 !h-[62px] !px-1" onClick={() => showNotice(`Перевод ${displayAsset.code}: скоро будет доступен`)}>
              <span className="flex flex-col items-center gap-1 normal-case"><PaperplaneFill className="text-[21px]" /><span className="text-[11px]">Перевести</span></span>
            </Button>
            <Button rounded tonal className="!m-0 !h-[62px] !px-1" onClick={() => openFlow('withdraw', displayAsset.code)}>
              <span className="flex flex-col items-center gap-1 normal-case"><ArrowUpCircleFill className="text-[21px]" /><span className="text-[11px]">Вывести</span></span>
            </Button>
            <Button rounded tonal className="!m-0 !h-[62px] !px-1" onClick={() => openFlow('exchange', displayAsset.code)}>
              <span className="flex flex-col items-center gap-1 normal-case"><ArrowRightArrowLeft className="text-[21px]" /><span className="text-[11px]">Обменять</span></span>
            </Button>
          </div>

          <p className="mx-auto mt-4 max-w-[340px] px-5 text-center text-[11px] leading-4 text-red-500/75">
            Демонстрационный адрес. Не отправляйте на него реальные средства.
          </p>
        </main>}
      </PullToRefreshContent>
    </section>,
    document.body,
  )
}

function PushViewShell({
  open,
  title,
  subtitle,
  onClose,
  children,
  zClass = 'z-[60]',
  onRefreshed,
}: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  zClass?: string
  onRefreshed?: () => void
}) {
  const swipeStart = useRef<number | null>(null)

  return createPortal(
    <section
      aria-hidden={!open}
      className={`fixed inset-0 ${zClass} flex flex-col overflow-hidden bg-[#f3f3f8] transition-transform duration-300 ease-out dark:bg-black ${open ? 'translate-x-0 shadow-[-18px_0_50px_rgba(0,0,0,.18)]' : 'pointer-events-none translate-x-full'}`}
      onPointerDown={(event) => {
        if (event.clientX <= 28) swipeStart.current = event.clientX
      }}
      onPointerUp={(event) => {
        if (swipeStart.current !== null && event.clientX - swipeStart.current > 72) onClose()
        swipeStart.current = null
      }}
      onPointerCancel={() => {
        swipeStart.current = null
      }}
    >
      <Navbar
        title={title}
        subtitle={subtitle}
        left={
          <KLink onClick={onClose} aria-label="Назад" className="!-ml-2 !gap-0 !text-primary">
            <ChevronLeft className="text-[29px]" />
            <span className="-ml-1 text-[17px]">Назад</span>
          </KLink>
        }
      />
      <PullToRefreshContent onRefreshed={onRefreshed ?? (() => {})}>
        {children}
      </PullToRefreshContent>
    </section>,
    document.body,
  )
}

function CryptoFlowPushView({
  flow,
  onClose,
  showNotice,
}: {
  flow: CryptoFlow | null
  onClose: () => void
  showNotice: NoticeHandler
}) {
  const [displayFlow, setDisplayFlow] = useState<CryptoFlow>({ kind: 'withdraw' })
  const [fromCode, setFromCode] = useState('USDT')
  const [toCode, setToCode] = useState('TON')
  const [amount, setAmount] = useState('')
  const [address, setAddress] = useState('')
  const [assetPicker, setAssetPicker] = useState<'from' | 'to' | null>(null)
  const [depositMode, setDepositMode] = useState<'crypto' | 'sbp'>('crypto')
  const [depositNetworkByAsset, setDepositNetworkByAsset] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!flow) return
    setDisplayFlow(flow)
    if (flow.assetCode) setFromCode(flow.assetCode)
  }, [flow])

  const activeFlow = flow ?? displayFlow
  const isDeposit = activeFlow.kind === 'deposit'
  const isWithdraw = activeFlow.kind === 'withdraw'
  const fromAsset = assets.find((item) => item.code === fromCode) ?? assets[0]
  const toAsset = assets.find((item) => item.code === toCode) ?? assets[1]
  const depositNetworks = assetNetworks[fromAsset.code] ?? []
  const depositNetworkName = depositNetworkByAsset[fromAsset.code] ?? depositNetworks[0]?.name ?? ''
  const depositNetwork = depositNetworks.find((item) => item.name === depositNetworkName) ?? depositNetworks[0]
  const usdRates: Record<string, number> = {
    USDT: 1,
    TON: 1.86,
    BTC: 65840,
    ETH: 2090,
    BNB: 612.4,
    SOL: 145.2,
  }
  const balances: Record<string, number> = {
    USDT: 0,
    TON: 0,
    BTC: 0,
    ETH: 0,
    BNB: 0,
    SOL: 0,
  }
  const parsedAmount = Number(amount.replace(',', '.')) || 0
  const exchangeRate = (usdRates[fromAsset.code] ?? 0) / (usdRates[toAsset.code] ?? 1)
  const receiveAmount = parsedAmount * exchangeRate
  const formatCrypto = (value: number, maximumFractionDigits = 6) =>
    value.toLocaleString('ru-RU', { maximumFractionDigits })

  const selectExchangeAsset = (code: string) => {
    if (assetPicker === 'from') setFromCode(code)
    if (assetPicker === 'to') setToCode(code)
    setAssetPicker(null)
  }

  const swapExchangeAssets = () => {
    setFromCode(toCode)
    setToCode(fromCode)
    setAmount(receiveAmount > 0 ? String(Number(receiveAmount.toFixed(8))) : '')
    haptic('light')
  }

  const copyDepositAddress = async () => {
    if (!depositNetwork?.address) return
    try {
      await navigator.clipboard.writeText(depositNetwork.address)
      haptic('success')
      showNotice('Адрес скопирован')
    } catch {
      showNotice('Не удалось скопировать адрес')
    }
  }

  if (isDeposit) {
    const fiatAmount = Number(amount.replace(',', '.')) || 0
    const estimatedUsdt = fiatAmount > 0 ? fiatAmount / 99.8 : 0

    return (
      <PushViewShell
        open={flow !== null}
        title="Пополнить"
        subtitle={depositMode === 'crypto' ? 'Криптовалютой' : 'Через СБП'}
        onClose={onClose}
        onRefreshed={() => showNotice('Реквизиты обновлены')}
      >
        <main className="mx-auto w-full max-w-[560px] pb-5 pt-4">
          <div className="px-safe-4">
            <Segmented strong rounded>
              <SegmentedButton
                active={depositMode === 'crypto'}
                onClick={() => {
                  haptic('light')
                  setDepositMode('crypto')
                  setAmount('')
                }}
              >
                Криптовалюта
              </SegmentedButton>
              <SegmentedButton
                active={depositMode === 'sbp'}
                onClick={() => {
                  haptic('light')
                  setDepositMode('sbp')
                  setFromCode('USDT')
                  setAmount('')
                }}
              >
                СБП
              </SegmentedButton>
            </Segmented>
          </div>

          {depositMode === 'crypto' ? (
            <>
              <div className="px-safe-4 pt-5">
                <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-black/40 dark:text-white/40">Валюта пополнения</div>
                <Card className="!m-0" contentWrapPadding="p-3">
                  <div className="grid grid-cols-3 gap-2">
                    {assets.map((item) => (
                      <Button
                        key={item.code}
                        rounded
                        tonal={fromCode !== item.code}
                        className="!m-0 !h-14 !min-w-0 !px-2"
                        onClick={() => {
                          haptic('light')
                          setFromCode(item.code)
                        }}
                      >
                        <span className="flex items-center justify-center gap-2 normal-case">
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full [&>svg]:h-4 [&>svg]:w-4"
                            style={{ backgroundColor: item.color, color: item.iconColor }}
                          >
                            {item.icon}
                          </span>
                          <span className="text-[13px] font-semibold">{item.code}</span>
                        </span>
                      </Button>
                    ))}
                  </div>
                </Card>
              </div>

              <div className="px-safe-4 pt-4">
                <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-black/40 dark:text-white/40">Сеть</div>
                {depositNetworks.length > 1 ? (
                  <Segmented strong rounded>
                    {depositNetworks.map((item) => (
                      <SegmentedButton
                        key={item.name}
                        active={depositNetwork?.name === item.name}
                        onClick={() => {
                          haptic('light')
                          setDepositNetworkByAsset((current) => ({ ...current, [fromAsset.code]: item.name }))
                        }}
                      >
                        {item.name}
                      </SegmentedButton>
                    ))}
                  </Segmented>
                ) : (
                  <List strong inset className="!m-0">
                    <ListItem title="Сеть пополнения" after={depositNetwork?.name ?? '—'} />
                  </List>
                )}
              </div>

              {depositNetwork && (
                <>
                  <Card className="!mx-4 !mt-4" contentWrapPadding="p-4">
                    <div className="flex flex-col items-center text-center">
                      <div className="rounded-[22px] bg-white p-3 shadow-sm">
                        <QRCode value={depositNetwork.address} size={164} bgColor="#ffffff" fgColor="#000000" />
                      </div>
                      <div className="mt-3 text-[17px] font-semibold text-black dark:text-white">
                        Адрес {fromAsset.code} · {depositNetwork.name}
                      </div>
                      <div className="mt-1 text-[13px] text-black/45 dark:text-white/45">
                        Отправьте средства на этот адрес
                      </div>
                    </div>
                  </Card>

                  <Card className="!mx-4 !mt-3" contentWrapPadding="p-3">
                    <div className="flex items-center gap-3">
                      <code className="min-w-0 flex-1 break-all text-[12px] leading-5 text-black dark:text-white">{depositNetwork.address}</code>
                      <Button rounded small tonal className="!m-0 !h-11 !w-11 !shrink-0 !p-0" aria-label="Скопировать адрес" onClick={copyDepositAddress}>
                        <DocOnDoc className="text-[20px]" />
                      </Button>
                    </div>
                  </Card>

                  <List strong inset dividers className="!mt-3">
                    <ListItem title="Комиссия сервиса" after="0%" />
                    <ListItem title="Зачисление" after="После подтверждений сети" />
                  </List>
                  <p className="mx-auto mt-3 max-w-[360px] px-5 text-center text-[12px] leading-5 text-red-500/80">
                    Отправляйте только {fromAsset.code} в сети {depositNetwork.name}. Другая валюта или сеть может привести к потере средств.
                  </p>
                </>
              )}
            </>
          ) : (
            <>
              <Card className="!mx-4 !mt-5" contentWrapPadding="p-4">
                <div className="text-[13px] font-medium text-black/45 dark:text-white/45">Сумма пополнения</div>
                <div className="mt-3 flex items-baseline gap-2">
                  <input
                    aria-label="Сумма в рублях"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value.replace(/[^0-9.,]/g, ''))}
                    placeholder="0"
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[46px] font-semibold leading-none tracking-[-0.04em] text-black outline-none placeholder:text-black/20 dark:text-white dark:placeholder:text-white/20"
                  />
                  <span className="text-[25px] font-semibold text-black/45 dark:text-white/45">₽</span>
                </div>
                <div className="mt-4 grid grid-cols-4 gap-2">
                  {[1000, 3000, 5000, 10000].map((value) => (
                    <Button key={value} rounded small tonal className="!m-0 !min-w-0 !px-1" onClick={() => setAmount(String(value))}>
                      <span className="text-[12px] normal-case">{value.toLocaleString('ru-RU')}</span>
                    </Button>
                  ))}
                </div>
              </Card>

              <List strong inset dividers className="!mt-3">
                <ListItem title="Способ оплаты" after="СБП" media={<BuildingColumnsFill className="text-[22px] text-primary" />} />
                <ListItem title="Получите" after={estimatedUsdt > 0 ? `≈ ${formatCrypto(estimatedUsdt, 2)} USDT` : '—'} />
                <ListItem title="Курс с комиссией" after="99,80 ₽ за USDT" />
                <ListItem title="Время на оплату" after="15 минут" />
              </List>

              <div className="px-safe-4 pt-2">
                <Button
                  rounded
                  large
                  disabled={fiatAmount < 1000}
                  className="!m-0 !w-full"
                  onClick={() => showNotice('Пополнение через СБП будет доступно после подключения провайдера')}
                >
                  <span className="normal-case">Продолжить</span>
                </Button>
                <p className="mx-auto mt-3 max-w-[360px] text-center text-[11px] leading-4 text-black/35 dark:text-white/35">
                  Минимальная сумма — 1 000 ₽. Реквизиты появятся на следующем шаге.
                </p>
              </div>
            </>
          )}
        </main>
      </PushViewShell>
    )
  }

  if (!isWithdraw) {
    const pickerAssets = assets.filter((item) => item.code !== (assetPicker === 'from' ? toCode : fromCode))

    return (
      <PushViewShell
        open={flow !== null}
        title="Обмен"
        subtitle={`${fromAsset.code} → ${toAsset.code}`}
        onClose={onClose}
        onRefreshed={() => showNotice('Курсы обновлены')}
      >
        <main className="relative mx-auto flex min-h-full w-full max-w-[560px] flex-col px-safe-4 pb-5 pt-5">
          <Card className="!m-0 !rounded-[28px]" contentWrapPadding="px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[17px] font-medium text-black/65 dark:text-white/70">Вы меняете</span>
              <div className="flex items-center gap-2 text-[15px] text-black/40 dark:text-white/45">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[12px]"
                  style={{ backgroundColor: fromAsset.color, color: fromAsset.iconColor }}
                >
                  {fromAsset.icon}
                </span>
                <span>{formatCrypto(balances[fromAsset.code] ?? 0)} {fromAsset.code}</span>
                <button
                  type="button"
                  onClick={() => setAmount(String(balances[fromAsset.code] ?? 0))}
                  className="border-0 bg-transparent p-0 text-[15px] font-bold text-primary"
                >
                  МАКС
                </button>
              </div>
            </div>

            <div className="mt-7 flex min-h-[76px] items-center gap-3">
              <button
                type="button"
                onClick={() => setAssetPicker('from')}
                className="flex min-w-0 items-center gap-3 border-0 bg-transparent p-0 text-left"
              >
                <span
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: fromAsset.color, color: fromAsset.iconColor }}
                >
                  {fromAsset.icon}
                </span>
                <span className="text-[31px] font-bold tracking-[-0.02em] text-black dark:text-white">{fromAsset.code}</span>
                <ChevronRight className="text-[22px] text-black/35 dark:text-white/40" />
              </button>
              <input
                aria-label={`Сумма в ${fromAsset.code}`}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^0-9.,]/g, ''))}
                placeholder="0"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-right text-[54px] font-semibold leading-none tracking-[-0.04em] text-black outline-none placeholder:text-black/20 dark:text-white dark:placeholder:text-white/20"
              />
            </div>

            <div className="relative my-7 h-px bg-black/[.08] dark:bg-white/[.10]">
              <button
                type="button"
                onClick={swapExchangeAssets}
                aria-label="Поменять валюты местами"
                className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[6px] border-white bg-[#f2f2f7] text-primary active:scale-95 dark:border-[#0b0b0d] dark:bg-[#1c1c1e]"
              >
                <ArrowRightArrowLeft className="rotate-90 text-[26px]" />
              </button>
            </div>

            <div className="text-[17px] font-medium text-black/65 dark:text-white/70">Вы получаете</div>
            <div className="mt-7 flex min-h-[76px] items-center gap-3">
              <button
                type="button"
                onClick={() => setAssetPicker('to')}
                className="flex min-w-0 items-center gap-3 border-0 bg-transparent p-0 text-left"
              >
                <span
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: toAsset.color, color: toAsset.iconColor }}
                >
                  {toAsset.icon}
                </span>
                <span className="text-[31px] font-bold tracking-[-0.02em] text-black dark:text-white">{toAsset.code}</span>
                <ChevronRight className="text-[22px] text-black/35 dark:text-white/40" />
              </button>
              <div className="min-w-0 flex-1 truncate text-right text-[54px] font-semibold leading-none tracking-[-0.04em] text-black/20 dark:text-white/20">
                {receiveAmount > 0 ? formatCrypto(receiveAmount) : '0'}
              </div>
            </div>

            <div className="mt-7 text-center text-[14px] text-black/40 dark:text-white/40">
              1 {fromAsset.code} = {formatCrypto(exchangeRate)} {toAsset.code} · без скрытых комиссий
            </div>
          </Card>

          <div className="mt-auto pt-5">
            <Button
              rounded
              large
              disabled={parsedAmount <= 0}
              className="!m-0 !w-full"
              onClick={() => showNotice('Обмен будет доступен после подключения провайдера')}
            >
              <span className="normal-case">Обменять {fromAsset.code} на {toAsset.code}</span>
            </Button>
            <p className="mx-auto mt-3 max-w-[340px] text-center text-[11px] leading-4 text-black/35 dark:text-white/35">
              Демонстрационный сценарий. Реальная операция не выполняется.
            </p>
          </div>

          {assetPicker && (
            <div className="absolute inset-0 z-20 flex items-end bg-black/25 px-3 pb-3 backdrop-blur-[2px]" onClick={() => setAssetPicker(null)}>
              <section
                role="dialog"
                aria-label="Выбор валюты"
                className="w-full rounded-[26px] bg-white p-3 shadow-2xl dark:bg-[#1c1c1e]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="px-2 pb-2 pt-1 text-center text-[15px] font-semibold text-black/55 dark:text-white/55">
                  {assetPicker === 'from' ? 'Вы меняете' : 'Вы получаете'}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {pickerAssets.map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => selectExchangeAsset(item.code)}
                      className="flex items-center gap-3 rounded-2xl border-0 bg-black/[.035] px-3 py-3 text-left dark:bg-white/[.07]"
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                        style={{ backgroundColor: item.color, color: item.iconColor }}
                      >
                        {item.icon}
                      </span>
                      <span>
                        <span className="block text-[16px] font-semibold text-black dark:text-white">{item.code}</span>
                        <span className="block text-[11px] text-black/40 dark:text-white/40">{item.name}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setAssetPicker(null)}
                  className="mt-2 w-full rounded-2xl border-0 bg-black/[.045] py-3 text-[16px] font-semibold text-primary dark:bg-white/[.08]"
                >
                  Отмена
                </button>
              </section>
            </div>
          )}
        </main>
      </PushViewShell>
    )
  }

  return (
    <PushViewShell
      open={flow !== null}
      title={isWithdraw ? 'Вывод' : 'Обмен'}
      subtitle={isWithdraw ? `Отправить ${fromAsset.code}` : `${fromAsset.code} → ${toAsset.code}`}
      onClose={onClose}
      onRefreshed={() => showNotice('Данные обновлены')}
    >
      <main className="mx-auto w-full max-w-[560px] pb-5">
        <div className="px-safe-4 pt-5">
          <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-black/40 dark:text-white/40">
            {isWithdraw ? 'Актив для вывода' : 'Отдаёте'}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {assets.slice(0, 6).map((item) => (
              <button
                key={item.code}
                type="button"
                onClick={() => setFromCode(item.code)}
                className={`rounded-2xl border-0 px-2 py-3 text-[13px] font-semibold ${fromCode === item.code ? 'bg-primary text-white' : 'bg-white text-black dark:bg-white/10 dark:text-white'}`}
              >
                {item.code}
              </button>
            ))}
          </div>
        </div>

        {!isWithdraw && (
          <div className="px-safe-4 pt-5">
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-black/40 dark:text-white/40">Получаете</div>
            <div className="grid grid-cols-3 gap-2">
              {assets.filter((item) => item.code !== fromCode).slice(0, 6).map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setToCode(item.code)}
                  className={`rounded-2xl border-0 px-2 py-3 text-[13px] font-semibold ${toCode === item.code ? 'bg-primary text-white' : 'bg-white text-black dark:bg-white/10 dark:text-white'}`}
                >
                  {item.code}
                </button>
              ))}
            </div>
          </div>
        )}

        <Card className="!mx-4 !mt-5" contentWrapPadding="p-4">
          <label className="block text-[12px] font-medium uppercase tracking-wide text-black/40 dark:text-white/40">Сумма</label>
          <div className="mt-2 flex items-center gap-2">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0,00"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[32px] font-semibold outline-none placeholder:text-black/20 dark:text-white dark:placeholder:text-white/20"
            />
            <span className="text-[17px] font-semibold text-black/50 dark:text-white/50">{fromAsset.code}</span>
          </div>
          <div className="mt-2 text-[12px] text-black/40 dark:text-white/40">Доступно: 0,00 {fromAsset.code}</div>
        </Card>

        {isWithdraw ? (
          <Card className="!mx-4 !mt-3" contentWrapPadding="p-4">
            <label className="block text-[12px] font-medium uppercase tracking-wide text-black/40 dark:text-white/40">Адрес получателя</label>
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Вставьте адрес кошелька"
              className="mt-3 w-full border-0 bg-transparent p-0 text-[16px] outline-none placeholder:text-black/30 dark:text-white dark:placeholder:text-white/30"
            />
          </Card>
        ) : (
          <Card className="!mx-4 !mt-3" contentWrapPadding="p-4">
            <div className="flex items-center justify-between text-[14px]"><span className="text-black/45 dark:text-white/45">Курс</span><span className="font-medium">1 {fromAsset.code} ≈ 0,00 {toAsset.code}</span></div>
            <div className="mt-3 flex items-center justify-between text-[14px]"><span className="text-black/45 dark:text-white/45">Комиссия</span><span className="font-medium">0,00 {fromAsset.code}</span></div>
          </Card>
        )}

        <div className="mt-5 px-safe-4">
          <Button
            rounded
            large
            className="!m-0 !w-full"
            onClick={() => showNotice(isWithdraw ? 'Вывод будет доступен после подключения провайдера' : 'Обмен будет доступен после подключения провайдера')}
          >
            <span className="normal-case">{isWithdraw ? 'Продолжить вывод' : `Обменять на ${toAsset.code}`}</span>
          </Button>
        </div>

        <p className="mx-auto mt-4 max-w-[340px] px-5 text-center text-[11px] leading-4 text-black/35 dark:text-white/35">
          Демонстрационный сценарий. Реальная операция не выполняется.
        </p>
      </main>
    </PushViewShell>
  )
}

function HistorySection({ showNotice }: { showNotice: NoticeHandler }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all')
  const [selectedPaymentId, setSelectedPaymentId] = useState<number | null>(null)
  const selectedPayment = demoPayments.find((payment) => payment.id === selectedPaymentId) ?? demoPayments[0]
  const visiblePayments = demoPayments.filter((payment) => {
    const matchesFilter = filter === 'all' || payment.kind === filter
    const matchesQuery = `${payment.title} ${payment.subtitle}`.toLowerCase().includes(query.trim().toLowerCase())
    return matchesFilter && matchesQuery
  })

  return (
    <>
    <main className={`mx-auto w-full max-w-[560px] pb-6 transition-[transform,opacity] duration-300 ease-out ${selectedPaymentId ? '-translate-x-[22%] opacity-60' : 'translate-x-0 opacity-100'}`}>
      <div className="px-safe-4 pt-4">
        <Searchbar
          value={query}
          placeholder="Поиск по платежам"
          onInput={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          className="!w-full"
        />
      </div>

      <Segmented strong rounded className="!mx-4 !mt-3 !w-auto">
        <SegmentedButton active={filter === 'all'} onClick={() => setFilter('all')}>Все</SegmentedButton>
        <SegmentedButton active={filter === 'income'} onClick={() => setFilter('income')}>Пополнения</SegmentedButton>
        <SegmentedButton active={filter === 'expense'} onClick={() => setFilter('expense')}>Платежи</SegmentedButton>
      </Segmented>

      <div className="mb-2 mt-7 flex items-end justify-between px-safe-4">
        <h2 className="m-0 text-[21px] font-semibold tracking-tight text-black dark:text-white">Операции</h2>
        <span className="text-[12px] text-black/40 dark:text-white/40">Демо-данные</span>
      </div>

      {visiblePayments.length > 0 ? (
        <List strong inset dividers className="!mt-0">
          {visiblePayments.map((payment) => {
            const Icon = payment.icon
            return (
              <ListItem
                key={payment.id}
                link
                chevron={false}
                onClick={() => setSelectedPaymentId(payment.id)}
                innerClassName="!min-w-0 !py-3"
                media={
                  <span className={`flex h-10 w-10 items-center justify-center rounded-full ${payment.kind === 'income' ? 'bg-green-500/15 text-green-500' : 'bg-primary/15 text-primary'}`}>
                    <Icon className="text-[21px]" />
                  </span>
                }
                innerChildren={
                  <span className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_96px] items-center gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold leading-6 text-black dark:text-white">{payment.title}</span>
                      <span className="mt-0.5 block truncate text-[13px] leading-5 text-black/50 dark:text-white/50">{payment.subtitle}</span>
                    </span>
                    <span className={`whitespace-nowrap text-right text-[16px] font-medium tabular-nums ${payment.kind === 'income' ? 'text-green-500' : 'text-black dark:text-white'}`}>
                      {payment.amount}
                    </span>
                  </span>
                }
              />
            )
          })}
        </List>
      ) : (
        <Card className="!mx-4 !mt-0 text-center">
          <ClockFill className="mx-auto text-[34px] text-black/25 dark:text-white/25" />
          <div className="mt-2 font-semibold">Ничего не найдено</div>
          <div className="mt-1 text-[13px] text-black/45 dark:text-white/45">Измените запрос или фильтр</div>
        </Card>
      )}
    </main>
    <PaymentDetailsPushView
      payment={selectedPayment}
      open={selectedPaymentId !== null}
      onClose={() => setSelectedPaymentId(null)}
      showNotice={showNotice}
    />
    </>
  )
}

function PaymentDetailsPushView({
  payment,
  open,
  onClose,
  showNotice,
}: {
  payment: (typeof demoPayments)[number]
  open: boolean
  onClose: () => void
  showNotice: NoticeHandler
}) {
  const Icon = payment.icon
  const isIncome = payment.kind === 'income'

  return (
    <PushViewShell open={open} title="Операция" subtitle={payment.subtitle} onClose={onClose} onRefreshed={() => showNotice('Операция обновлена')}>
      <main className="mx-auto w-full max-w-[560px] pb-5">
        <section className="px-safe-4 pb-5 pt-8 text-center">
          <span className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${isIncome ? 'bg-green-500/15 text-green-500' : 'bg-primary/15 text-primary'}`}>
            <Icon className="text-[31px]" />
          </span>
          <h2 className="mb-0 mt-4 text-[19px] font-semibold text-black dark:text-white">{payment.title}</h2>
          <div className={`mt-2 text-[36px] font-semibold tabular-nums ${isIncome ? 'text-green-500' : 'text-black dark:text-white'}`}>{payment.amount}</div>
          <div className="mt-2 inline-flex rounded-full bg-green-500/15 px-3 py-1 text-[12px] font-medium text-green-600 dark:text-green-400">Выполнено</div>
        </section>

        <List strong inset dividers className="!mt-2">
          <ListItem title="Дата и время" after={payment.subtitle.replace(' · ', ', ')} />
          <ListItem title="Категория" after={isIncome ? 'Пополнение' : 'Платёж'} />
          <ListItem title="Способ" after={payment.title.includes('карт') ? 'Visa •••• 0000' : 'Кошелёк'} />
          <ListItem title="Комиссия" after="0 ₽" />
          <ListItem title="Идентификатор" after={`DEMO-${String(payment.id).padStart(6, '0')}`} />
        </List>

        <div className="mt-5 space-y-2 px-safe-4">
          <Button rounded large tonal className="!m-0 !w-full" onClick={() => showNotice('Квитанция подготовлена')}>
            <span className="flex items-center justify-center gap-2 normal-case"><DocOnDoc className="text-[20px]" />Квитанция</span>
          </Button>
          {!isIncome && (
            <Button rounded large clear className="!m-0 !w-full" onClick={() => showNotice('Платёж будет повторён после подключения провайдера')}>
              <span className="normal-case">Повторить платёж</span>
            </Button>
          )}
        </div>
      </main>
    </PushViewShell>
  )
}

const bankCards = [
  { id: 'rub', name: 'Основная карта', currency: '₽', balance: '0,00 ₽', last4: '0000', gradient: 'from-[#1d4ed8] via-[#2563eb] to-[#60a5fa]' },
  { id: 'usd', name: 'Долларовая карта', currency: '$', balance: '$0.00', last4: '0001', gradient: 'from-[#312e81] via-[#5b21b6] to-[#a855f7]' },
]

const cardPayments = {
  rub: [
    { id: 1, title: 'Кофейня', subtitle: 'Сегодня, 10:15', amount: '−620 ₽', icon: CreditcardFill },
    { id: 2, title: 'Пополнение', subtitle: 'Сегодня, 09:40', amount: '+10 000 ₽', icon: ArrowDownCircleFill, income: true },
    { id: 3, title: 'Подписка', subtitle: 'Вчера, 18:06', amount: '−490 ₽', icon: CreditcardFill },
  ],
  usd: [
    { id: 1, title: 'App Store', subtitle: 'Сегодня, 08:20', amount: '−$12.99', icon: CreditcardFill },
    { id: 2, title: 'Пополнение', subtitle: 'Вчера, 16:32', amount: '+$100.00', icon: ArrowDownCircleFill, income: true },
  ],
}

function CardsSection({ showNotice }: { showNotice: NoticeHandler }) {
  const [activeCardIndex, setActiveCardIndex] = useState(0)
  const [settingsCardId, setSettingsCardId] = useState<string | null>(null)
  const activeCard = bankCards[activeCardIndex] ?? bankCards[0]
  const activePayments = cardPayments[activeCard.id as keyof typeof cardPayments]
  const selectedCard = bankCards.find((card) => card.id === settingsCardId) ?? bankCards[0]

  return (
    <div className="overflow-x-hidden">
      <main className={`mx-auto w-full max-w-[560px] pb-6 transition-[transform,opacity] duration-300 ease-out ${settingsCardId ? '-translate-x-[22%] opacity-60' : 'translate-x-0 opacity-100'}`}>
        <div
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-safe-4 pb-2 pt-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={(event) => {
            const rail = event.currentTarget
            const cardWidth = rail.firstElementChild?.getBoundingClientRect().width ?? rail.clientWidth
            setActiveCardIndex(Math.max(0, Math.min(bankCards.length - 1, Math.round(rail.scrollLeft / (cardWidth + 12)))))
          }}
        >
          {bankCards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => {
                haptic('light')
                setSettingsCardId(card.id)
              }}
              className="w-[calc(100%-32px)] shrink-0 snap-center appearance-none border-0 bg-transparent p-0 text-left"
              aria-label={`Открыть настройки: ${card.name}`}
            >
              <Card
                raised
                className={`!m-0 overflow-hidden !rounded-[28px] !bg-gradient-to-br ${card.gradient} !text-white`}
                contentWrapPadding="p-5"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[13px] font-medium text-white/65">Виртуальная карта</div>
                    <div className="mt-1 text-[18px] font-semibold">{card.name}</div>
                  </div>
                  <div className="text-[22px] font-black italic tracking-[-0.08em]">VISA</div>
                </div>
                <div className="mt-8 text-[27px] font-semibold tabular-nums">{card.balance}</div>
                <div className="mt-6 flex items-end justify-between">
                  <span className="font-mono text-[15px] tracking-[0.12em] text-white/90">•••• {card.last4}</span>
                  <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium">{card.currency} · ДЕМО</span>
                </div>
              </Card>
            </button>
          ))}
        </div>

        <div className="mt-1 flex justify-center gap-1.5" aria-label="Положение в карусели">
          {bankCards.map((card, index) => (
            <span
              key={card.id}
              className={`h-1.5 rounded-full transition-all ${activeCardIndex === index ? 'w-5 bg-primary' : 'w-1.5 bg-black/20 dark:bg-white/25'}`}
            />
          ))}
        </div>

        <div className="mt-6 px-safe-4">
          <h2 className="m-0 text-[21px] font-semibold tracking-tight text-black dark:text-white">Быстрые действия</h2>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2 px-safe-4">
          <Button rounded tonal className="!m-0 !h-[60px] !min-w-0 !px-1" onClick={() => showNotice(`Пополнение карты •••• ${activeCard.last4}: скоро будет доступно`)}>
            <span className="flex min-w-0 flex-col items-center gap-1 normal-case"><ArrowDownCircleFill className="text-[21px]" /><span className="w-full truncate text-[10px]">Пополнить</span></span>
          </Button>
          <Button rounded tonal className="!m-0 !h-[60px] !min-w-0 !px-1" onClick={() => showNotice(`Реквизиты карты •••• ${activeCard.last4}: демо`)}>
            <span className="flex min-w-0 flex-col items-center gap-1 normal-case"><DocOnDoc className="text-[21px]" /><span className="w-full truncate text-[10px]">Реквизиты</span></span>
          </Button>
          <Button rounded tonal className="!m-0 !h-[60px] !min-w-0 !px-1" onClick={() => setSettingsCardId(activeCard.id)}>
            <span className="flex min-w-0 flex-col items-center gap-1 normal-case"><WalletFill className="text-[21px]" /><span className="w-full truncate text-[10px]">Wallet</span></span>
          </Button>
          <Button rounded tonal className="!m-0 !h-[60px] !min-w-0 !px-1" onClick={() => setSettingsCardId(activeCard.id)}>
            <span className="flex min-w-0 flex-col items-center gap-1 normal-case"><Ellipsis className="text-[21px]" /><span className="w-full truncate text-[10px]">Ещё</span></span>
          </Button>
        </div>

        <div className="mb-2 mt-7 flex items-end justify-between px-safe-4">
          <div>
            <h2 className="m-0 text-[21px] font-semibold tracking-tight text-black dark:text-white">Платежи по карте</h2>
            <div className="mt-0.5 text-[12px] text-black/40 dark:text-white/40">Visa •••• {activeCard.last4}</div>
          </div>
          <button type="button" className="border-0 bg-transparent p-0 text-[13px] text-primary" onClick={() => showNotice(`Вся история карты •••• ${activeCard.last4}`)}>Все</button>
        </div>
        <List strong inset dividers className="!mt-0">
          {activePayments.map((payment) => {
            const Icon = payment.icon
            return (
              <ListItem
                key={`${activeCard.id}-${payment.id}`}
                link
                chevron={false}
                onClick={() => showNotice(payment.title)}
                innerClassName="!min-w-0 !py-3"
                media={
                  <span className={`flex h-10 w-10 items-center justify-center rounded-full ${payment.income ? 'bg-green-500/15 text-green-500' : 'bg-primary/15 text-primary'}`}>
                    <Icon className="text-[20px]" />
                  </span>
                }
                innerChildren={
                  <span className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_90px] items-center gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[16px] font-semibold leading-6 text-black dark:text-white">{payment.title}</span>
                      <span className="block truncate text-[12px] leading-5 text-black/45 dark:text-white/45">{payment.subtitle}</span>
                    </span>
                    <span className={`whitespace-nowrap text-right text-[15px] font-medium tabular-nums ${payment.income ? 'text-green-500' : 'text-black dark:text-white'}`}>{payment.amount}</span>
                  </span>
                }
              />
            )
          })}
        </List>

        <p className="mx-auto mt-5 max-w-[360px] px-5 text-center text-[12px] leading-relaxed text-black/30 dark:text-white/30">
          Карты показаны для демонстрации. Реальные операции появятся после подключения банковского провайдера.
        </p>
      </main>

      <CardPushView
        card={selectedCard}
        open={settingsCardId !== null}
        onClose={() => setSettingsCardId(null)}
        showNotice={showNotice}
      />
    </div>
  )
}

function CardPushView({
  card,
  open,
  onClose,
  showNotice,
}: {
  card: (typeof bankCards)[number]
  open: boolean
  onClose: () => void
  showNotice: NoticeHandler
}) {
  const swipeStart = useRef<number | null>(null)
  const payments = cardPayments[card.id as keyof typeof cardPayments]

  return createPortal(
    <section
      aria-hidden={!open}
      className={`fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#f3f3f8] transition-transform duration-300 ease-out dark:bg-black ${open ? 'translate-x-0 shadow-[-18px_0_50px_rgba(0,0,0,.18)]' : 'pointer-events-none translate-x-full'}`}
      onPointerDown={(event) => {
        if (event.clientX <= 28) swipeStart.current = event.clientX
      }}
      onPointerUp={(event) => {
        if (swipeStart.current !== null && event.clientX - swipeStart.current > 72) onClose()
        swipeStart.current = null
      }}
      onPointerCancel={() => {
        swipeStart.current = null
      }}
    >
      <Navbar
        title="Карта"
        subtitle={`Visa •••• ${card.last4}`}
        left={
          <KLink onClick={onClose} aria-label="Назад" className="!-ml-2 !gap-0 !text-primary">
            <ChevronLeft className="text-[29px]" />
            <span className="-ml-1 text-[17px]">Назад</span>
          </KLink>
        }
      />

      <PullToRefreshContent onRefreshed={() => showNotice('Данные карты обновлены')}>
        <main className="mx-auto w-full max-w-[560px]">
          <div className="px-safe-4 pt-5">
            <Card
              raised
              className={`!m-0 overflow-hidden !rounded-[28px] !bg-gradient-to-br ${card.gradient} !text-white`}
              contentWrapPadding="p-5"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[13px] font-medium text-white/65">Виртуальная карта</div>
                  <div className="mt-1 text-[18px] font-semibold">{card.name}</div>
                </div>
                <div className="text-[22px] font-black italic tracking-[-0.08em]">VISA</div>
              </div>
              <div className="mt-8 text-[27px] font-semibold tabular-nums">{card.balance}</div>
              <div className="mt-6 flex items-end justify-between">
                <span className="font-mono text-[15px] tracking-[0.12em] text-white/90">•••• {card.last4}</span>
                <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium">{card.currency} · ДЕМО</span>
              </div>
            </Card>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2 px-safe-4">
            <Button rounded tonal className="!m-0 !h-[62px] !min-w-0 !px-1" onClick={() => showNotice('Пополнение карты: скоро будет доступно')}>
              <span className="flex min-w-0 flex-col items-center gap-1 normal-case"><ArrowDownCircleFill className="text-[21px]" /><span className="text-[10px]">Пополнить</span></span>
            </Button>
            <Button rounded tonal className="!m-0 !h-[62px] !min-w-0 !px-1" onClick={() => showNotice('Реквизиты будут доступны после выпуска карты')}>
              <span className="flex min-w-0 flex-col items-center gap-1 normal-case"><DocOnDoc className="text-[21px]" /><span className="text-[10px]">Реквизиты</span></span>
            </Button>
            <Button rounded tonal className="!m-0 !h-[62px] !min-w-0 !px-1" onClick={() => showNotice('Заморозка карты: скоро будет доступна')}>
              <span className="flex min-w-0 flex-col items-center gap-1 normal-case"><Snow className="text-[21px]" /><span className="text-[10px]">Заморозить</span></span>
            </Button>
          </div>

          <List strong inset dividers className="!mt-5">
            <ListItem link title="Лимиты и операции" subtitle="Настроить ограничения" media={<SliderHorizontal3 className="text-[22px] text-primary" />} onClick={() => showNotice('Лимиты карты: скоро будут доступны')} />
            <ListItem link title="Безопасность карты" subtitle="Платежи в интернете и за границей" media={<LockShieldFill className="text-[22px] text-primary" />} onClick={() => showNotice('Настройки безопасности: скоро будут доступны')} />
          </List>

          <div className="mt-6 space-y-2 px-safe-4">
            <Button rounded large className="!m-0 !w-full !bg-black !text-white dark:!bg-white dark:!text-black" onClick={() => showNotice('Apple Wallet: требуется токенизация карты')}>
              <span className="flex items-center justify-center gap-2 normal-case"><LogoApple className="text-[22px]" />Добавить в Apple Wallet</span>
            </Button>
            <Button rounded large tonal className="!m-0 !w-full" onClick={() => showNotice('Google Wallet: требуется токенизация карты')}>
              <span className="flex items-center justify-center gap-2 normal-case"><LogoGoogle className="text-[21px]" />Добавить в Google Wallet</span>
            </Button>
          </div>

          <div className="mb-2 mt-8 px-safe-4">
            <h2 className="m-0 text-[21px] font-semibold tracking-tight text-black dark:text-white">История карты</h2>
          </div>
          <List strong inset dividers className="!mt-0">
            {payments.map((payment) => {
              const Icon = payment.icon
              return (
                <ListItem
                  key={`${card.id}-push-${payment.id}`}
                  link
                  chevron={false}
                  onClick={() => showNotice(payment.title)}
                  media={<span className={`flex h-10 w-10 items-center justify-center rounded-full ${payment.income ? 'bg-green-500/15 text-green-500' : 'bg-primary/15 text-primary'}`}><Icon className="text-[20px]" /></span>}
                  innerChildren={<span className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_90px] items-center gap-2"><span className="min-w-0"><span className="block truncate text-[16px] font-semibold text-black dark:text-white">{payment.title}</span><span className="block truncate text-[12px] text-black/45 dark:text-white/45">{payment.subtitle}</span></span><span className={`whitespace-nowrap text-right text-[15px] font-medium tabular-nums ${payment.income ? 'text-green-500' : 'text-black dark:text-white'}`}>{payment.amount}</span></span>}
                />
              )
            })}
          </List>
        </main>
      </PullToRefreshContent>
    </section>,
    document.body,
  )
}

function ProfileSection({
  user,
  initials,
  showNotice,
}: {
  user: ReturnType<typeof getUser>
  initials: string
  showNotice: NoticeHandler
}) {
  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Кирилл'
  const [profilePage, setProfilePage] = useState<'personal' | 'security' | 'notifications' | 'currency' | 'provider' | 'support' | null>(null)

  return (
    <>
    <main className={`mx-auto w-full max-w-[560px] pb-6 transition-[transform,opacity] duration-300 ease-out ${profilePage ? '-translate-x-[22%] opacity-60' : 'translate-x-0 opacity-100'}`}>
      <section className="px-safe-4 pb-3 pt-7 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-primary text-[28px] font-semibold text-white">
          {user?.photo_url ? <img src={user.photo_url} alt="" className="h-full w-full object-cover" /> : initials}
        </div>
        <h2 className="mb-0 mt-3 text-[22px] font-semibold text-black dark:text-white">{displayName}</h2>
        <div className="mt-1 text-[14px] text-black/45 dark:text-white/45">{user?.username ? `@${user.username}` : 'Профиль кошелька'}</div>
      </section>

      <List strong inset dividers className="!mt-4">
        <ListItem link title="Личные данные" subtitle="Имя и документы" media={<PersonCropCircleFill className="text-[22px] text-primary" />} onClick={() => setProfilePage('personal')} />
        <ListItem link title="Безопасность" subtitle="Код доступа и устройства" media={<LockShieldFill className="text-[22px] text-primary" />} onClick={() => setProfilePage('security')} />
        <ListItem link title="Уведомления" subtitle="Платежи и курсы" media={<BellFill className="text-[22px] text-primary" />} onClick={() => setProfilePage('notifications')} />
      </List>

      <List strong inset dividers>
        <ListItem link title="Основная валюта" after="RUB" media={<Globe className="text-[22px] text-primary" />} onClick={() => setProfilePage('currency')} />
        <ListItem link title="Банковский провайдер" subtitle="Не подключён" media={<BuildingColumnsFill className="text-[22px] text-primary" />} onClick={() => setProfilePage('provider')} />
        <ListItem link title="Помощь и поддержка" media={<QuestionCircleFill className="text-[22px] text-primary" />} onClick={() => setProfilePage('support')} />
      </List>
    </main>
    <ProfileSettingsPushView page={profilePage} onClose={() => setProfilePage(null)} showNotice={showNotice} displayName={displayName} />
    </>
  )
}

const profilePageTitles = {
  personal: 'Личные данные',
  security: 'Безопасность',
  notifications: 'Уведомления',
  currency: 'Основная валюта',
  provider: 'Банковский провайдер',
  support: 'Поддержка',
} as const

function ProfileSettingsPushView({
  page,
  onClose,
  showNotice,
  displayName,
}: {
  page: keyof typeof profilePageTitles | null
  onClose: () => void
  showNotice: NoticeHandler
  displayName: string
}) {
  const [displayPage, setDisplayPage] = useState<keyof typeof profilePageTitles>('personal')
  useEffect(() => {
    if (page) setDisplayPage(page)
  }, [page])

  return (
    <PushViewShell open={page !== null} title={profilePageTitles[displayPage]} subtitle="Настройки профиля" onClose={onClose} onRefreshed={() => showNotice('Данные профиля обновлены')}>
      <main className="mx-auto w-full max-w-[560px] pb-5 pt-3">
        {displayPage === 'personal' && (
          <List strong inset dividers>
            <ListItem title="Имя" after={displayName} />
            <ListItem title="Статус проверки" after="Не пройдена" />
            <ListItem link title="Документы" subtitle="Паспорт и подтверждение адреса" onClick={() => showNotice('Загрузка документов появится после подключения KYC')} />
            <ListItem link title="Изменить данные" onClick={() => showNotice('Редактирование данных: скоро будет доступно')} />
          </List>
        )}

        {displayPage === 'security' && (
          <List strong inset dividers>
            <ListItem link title="Код доступа" subtitle="Для входа и подтверждения операций" after="Выкл." onClick={() => showNotice('Код доступа: скоро будет доступен')} />
            <ListItem link title="Двухфакторная защита" subtitle="Дополнительный код подтверждения" after="Выкл." onClick={() => showNotice('2FA: скоро будет доступна')} />
            <ListItem link title="Активные устройства" after="1" onClick={() => showNotice('Это устройство активно')} />
            <ListItem link title="Сменить пароль" onClick={() => showNotice('Смена пароля: скоро будет доступна')} />
          </List>
        )}

        {displayPage === 'notifications' && (
          <List strong inset dividers>
            <ListItem title="Платежи и переводы" after="Вкл." />
            <ListItem title="Пополнения" after="Вкл." />
            <ListItem title="Изменения курсов" after="Выкл." />
            <ListItem title="Новости сервиса" after="Выкл." />
          </List>
        )}

        {displayPage === 'currency' && (
          <List strong inset dividers>
            {['RUB — Российский рубль', 'USD — Доллар США', 'EUR — Евро'].map((currency, index) => (
              <ListItem key={currency} link title={currency} after={index === 0 ? '✓' : undefined} onClick={() => showNotice(`Выбрана валюта: ${currency.slice(0, 3)}`)} />
            ))}
          </List>
        )}

        {displayPage === 'provider' && (
          <>
            <Card className="!mx-4 text-center" contentWrapPadding="p-5">
              <BuildingColumnsFill className="mx-auto text-[42px] text-primary" />
              <h2 className="mb-0 mt-3 text-[19px] font-semibold">Провайдер не подключён</h2>
              <p className="mb-0 mt-2 text-[13px] leading-5 text-black/45 dark:text-white/45">После подключения станут доступны выпуск карт, пополнение, вывод и реальные платежи.</p>
            </Card>
            <div className="px-safe-4"><Button rounded large className="!m-0 !w-full" onClick={() => showNotice('Заявка на подключение подготовлена')}><span className="normal-case">Подключить провайдера</span></Button></div>
          </>
        )}

        {displayPage === 'support' && (
          <List strong inset dividers>
            <ListItem link title="Чат с поддержкой" subtitle="Обычно отвечаем за несколько минут" onClick={() => showNotice('Чат поддержки: скоро будет доступен')} />
            <ListItem link title="Частые вопросы" onClick={() => showNotice('Раздел помощи: скоро будет доступен')} />
            <ListItem link title="Сообщить о проблеме" onClick={() => showNotice('Форма обращения: скоро будет доступна')} />
          </List>
        )}
      </main>
    </PushViewShell>
  )
}

function WalletSkeleton() {
  return (
    <List strong inset className="!mt-0">
      {assets.map((asset) => (
        <ListItem
          key={asset.code}
          className="skeleton-text skeleton-effect-wave"
          chevron={false}
          innerClassName="!min-w-0 !py-3"
          media={<span className="skeleton-block h-11 w-11 animate-pulse rounded-full bg-black/10 dark:bg-white/10" />}
          innerChildren={
            <span className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_72px_14px] items-center gap-2">
              <span className="min-w-0">
                <span className="block h-3 w-24 animate-pulse rounded-full bg-black/10 dark:bg-white/10" />
                <span className="mt-2 block h-3 w-16 animate-pulse rounded-full bg-black/[.07] dark:bg-white/[.07]" />
              </span>
              <span className="ml-auto block h-8 w-14 animate-pulse rounded-lg bg-black/[.07] dark:bg-white/[.07]" />
              <span />
            </span>
          }
        />
      ))}
    </List>
  )
}
