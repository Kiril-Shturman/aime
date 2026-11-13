import { ReferralProgram, WithdrawalMethods, WithdrawalForm, withdrawalTitles, type WithdrawalMethod } from './WalletPrograms'
import DocTextFill from 'framework7-icons/react/esm/DocTextFill.js'
import Framework7 from 'framework7/lite-bundle'
import Framework7React, { List as F7List, ListItem as F7ListItem, Messages, Message, Messagebar, ListInput as F7ListInput, Toggle as F7Toggle, App as F7App, Popup as F7Popup, Navbar as F7Navbar, NavRight, Link as F7Link, Page as F7Page } from 'framework7-react'
import './WalletFramework7.css'
import 'framework7/components/popup/css'
import './WalletProfile.css'
import './WalletCard.css'
import {
  useCallback,
  useId,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { Button, Card, Link as KLink, List, ListItem, Navbar, Page, Popover, Preloader, Tabbar, TabbarLink, ToolbarPane } from 'konsta/react'
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
import PersonCropCircleFill from 'framework7-icons/react/esm/PersonCropCircleFill.js'
import PlusCircleFill from 'framework7-icons/react/esm/PlusCircleFill.js'
import Qrcode from 'framework7-icons/react/esm/Qrcode.js'
import QuestionCircleFill from 'framework7-icons/react/esm/QuestionCircleFill.js'
import SliderHorizontal3 from 'framework7-icons/react/esm/SliderHorizontal3.js'
import Snow from 'framework7-icons/react/esm/Snow.js'
import SunMax from 'framework7-icons/react/esm/SunMax.js'
import WalletFill from 'framework7-icons/react/esm/WalletFill.js'
import { applyTgTheme, getUser, haptic, tg } from '../lib/telegram'
import { useTheme } from '../store/ThemeStore'

type Action = {
  label: string
  icon: ComponentType<{ className?: string }>
}

import WalletAssetPanel from './WalletAssetPanel'
import { WalletLiveProvider, useLiveWallet, WalletConnectionNote, LiveDepositPanel,  LiveHistory, LiveQrPanel, cryptoAmount, usd, usdPrice } from './WalletLive'

type Asset = {
  code: string
  name: string
  rate: string
  color: string
  iconColor: string
  icon: ReactNode
}

Framework7.use(Framework7React)

type WalletTab = 'wallet' | 'history' | 'cards' | 'profile'
type CryptoFlow = { kind: 'deposit' | 'withdraw' | 'exchange'; assetCode?: string }

const tabMeta: Record<WalletTab, { title: string; subtitle: string }> = {
  wallet: { title: 'Кошелёк', subtitle: 'Все активы' },
  history: { title: 'История', subtitle: 'Платежи и переводы' },
  cards: { title: 'Карты', subtitle: 'Виртуальные карты Visa' },
  profile: { title: 'Профиль', subtitle: 'Настройки аккаунта' },
}

const actions: Action[] = [
  { label: 'QR-код', icon: Qrcode },
  { label: 'Пополнить', icon: PlusCircleFill },
  { label: 'Вывести', icon: ArrowUpCircleFill },
  { label: 'Обменять', icon: ArrowRightArrowLeft },
]

const walletActionClass = '!m-0 !h-[62px] !min-w-0 !rounded-[22px] !bg-black/[.055] !px-1 !text-primary active:!bg-black/10 dark:!bg-white/[.10] dark:active:!bg-white/[.16]'
function WalletActionGrid({items, label = 'Действия с кошельком'}: {items: {label:string; icon:Action['icon']; onClick:()=>void}[];label?:string}) {
  return <section className="grid grid-cols-4 gap-2 px-safe-4" aria-label={label}>
    {items.map(({label,icon:Icon,onClick}) => <Button key={label} rounded clear onClick={onClick} className={walletActionClass}><span className="flex min-w-0 flex-col items-center justify-center gap-1"><Icon className="text-[22px]"/><span className="w-full truncate text-[10px] font-medium leading-none normal-case">{label}</span></span></Button>)}
  </section>
}

const rubleAsset: Asset = { code: 'RUB', name: 'Рубли', rate: '', color: '#F5A623', iconColor: '#fff', icon: <span className="text-[27px] font-medium">₽</span> }
const assets: Asset[] = [
  { code: 'USDT', name: 'Tether', rate: '', color: '#26A17B', iconColor: '#fff', icon: <SiTether size={25}/> },
  { code: 'TRX', name: 'TRON', rate: '', color: '#ef0027', iconColor: '#fff', icon: <svg viewBox="0 0 32 32" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M4 4 28 9 14 29 4 4Z M4 4 17 12 28 9 M17 12 14 29 M17 12 23 8"/></svg> },
  { code: 'BNB', name: 'BNB', rate: '', color: '#F3BA2F', iconColor: '#fff', icon: <SiBnbchain size={25}/> },
  { code: 'ETH', name: 'Ethereum', rate: '', color: '#627EEA', iconColor: '#fff', icon: <SiEthereum size={25}/> },
  { code: 'GRAM', name: 'Gram', rate: '', color: '#0098EA', iconColor: '#fff', icon: <SiTon size={25}/> },
  { code: 'SOL', name: 'Solana', rate: '', color: '#111', iconColor: '#14F195', icon: <SiSolana size={25}/> },
  { code: 'BTC', name: 'Bitcoin', rate: '', color: '#F7931A', iconColor: '#fff', icon: <SiBitcoin size={25}/> },
  { code: 'XAUT', name: 'GOLD (XAUT)', rate: '', color: '#c89b43', iconColor: '#fff', icon: <SiTether size={25}/> },
]

function assetIconStyle(asset: Pick<Asset, 'color' | 'iconColor'>) {
  return {
    backgroundColor: asset.color,
    color: asset.iconColor,
    backgroundImage: `radial-gradient(ellipse at 30% 0%, rgba(255,255,255,.22), transparent 62%), linear-gradient(180deg, color-mix(in srgb, ${asset.color} 62%, white) 0%, color-mix(in srgb, ${asset.color} 90%, white) 43%, ${asset.color} 68%, color-mix(in srgb, ${asset.color} 88%, black) 100%)`,
    boxShadow: 'inset 0 1px 1px rgba(255,255,255,.32), inset 0 -1px 2px rgba(0,0,0,.06)',
  }
}

function CurrencyRow({ asset, deposit = false, balanceHidden = false, onClick }: { asset: Asset; deposit?: boolean; balanceHidden?: boolean; onClick?: () => void }) {
  const live = useLiveWallet()
  const rate = live.rate(asset.code)
  const rubles = asset.code === 'RUB'
  return <ListItem link={!!onClick} chevron={false} onClick={onClick} contentClassName="!h-[64px]" innerClassName="!min-w-0 !h-[64px] !py-2 after:!opacity-30" media={<span className="wpay-currency-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full [&>svg]:!h-6 [&>svg]:!w-6" style={assetIconStyle(asset)}>{asset.icon}</span>} innerChildren={
    <span className="flex h-full w-full min-w-0 items-center justify-between gap-3">
      <span className="min-w-0"><span className="block truncate text-[17px] font-semibold leading-6 text-black dark:text-white">{asset.name}</span><span className="mt-0.5 block truncate text-[14px] leading-5 text-black/45 dark:text-white/45">{asset.code}{!rubles && ` · ${rate !== null ? usdPrice(rate) : '—'}`}</span></span>
      {deposit ? <ChevronRight className="shrink-0 text-[19px] text-black/25 dark:text-white/30"/> : <span className="shrink-0 text-right"><span className="block text-[16px] font-medium leading-6 tabular-nums text-black dark:text-white">{balanceHidden ? '••••' : rubles ? '— ₽' : live.ready ? cryptoAmount(live.balance(asset.code)) : '—'}</span>{!rubles && <span className="block text-[12px] leading-5 tabular-nums text-black/40 dark:text-white/40">{balanceHidden ? '••••' : live.ready && rate !== null ? usd(Number(live.balance(asset.code)) * rate) : '—'}</span>}</span>}
    </span>
  }/>
}

const PULL_THRESHOLD = 58
const PULL_MAX_DISTANCE = 96

function usePullToRefresh<T extends HTMLElement>(
  scrollRef: RefObject<T | null>,
  {
    onRefreshStart,
    onRefreshed,
    delay = 800,
    softPull = false,
  }: {
    onRefreshStart?: () => void
    onRefreshed: () => void
    delay?: number
    softPull?: boolean
  },
) {
  const startY = useRef<number | null>(null)
  const startX = useRef(0)
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
    const rawDelta = clientY - startY.current
    const delta = softPull ? Math.max(0,rawDelta-10)*0.85 : rawDelta
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
  }, [scrollRef,softPull])

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
      startX.current = event.touches[0].clientX
      startY.current = event.touches[0].clientY
      setDragging(true)
    }
    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      if(softPull && startY.current!==null){
        const dx=Math.abs(event.touches[0].clientX-startX.current)
        const dy=Math.abs(event.touches[0].clientY-startY.current)
        if(dx>10 && dx>dy){startY.current=null;return}
      }
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
  }, [finish, scrollRef, updateDistance,softPull])

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
  const {theme}=useTheme()
  useEffect(()=>{
    const host=document.querySelector<HTMLElement>('.wpay-f7-root')
    const sync=()=>{
      const style=getComputedStyle(document.documentElement)
      const top=parseFloat(style.getPropertyValue('--tg-safe-area-inset-top'))||0
      const controls=parseFloat(style.getPropertyValue('--tg-content-safe-area-inset-top'))||0
      host?.style.setProperty('--f7-popup-push-offset',`${Math.max(16,top+controls)+8}px`)
    }
    sync()
    const observer=new MutationObserver(sync)
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['style']})
    return()=>observer.disconnect()
  },[])
  return <F7App name="WPay" theme="ios" darkMode={theme==='dark'} className={`wpay-f7-root ios ${theme==='dark'?'dark':''}`} style={{height:'100%', '--f7-safe-area-top':'max(env(safe-area-inset-top, 0px), var(--tg-safe-area-inset-top, 0px))', '--f7-popup-push-offset':'max(16px, calc(var(--tg-safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px)))'} as React.CSSProperties}><div className="view wpay-main-view"><WalletLiveProvider><WalletScreen/></WalletLiveProvider></div></F7App>
}

function WalletScreen() {
  const live = useLiveWallet()
  const [qrValue, setQrValue] = useState<string | null>(null)
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
    document.title = 'WPay · Кошелёк'
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

  function scanPaymentQr() {
    const telegram = tg()
    if (!telegram?.showScanQrPopup || !telegram.isVersionAtLeast?.('6.4')) {
      showNotice('Откройте миниапку в Telegram для сканирования QR-кода')
      return
    }
    try {
      telegram.showScanQrPopup({ text: 'Наведите камеру на QR СБП' }, data => {
        if (!data) return false
        setQrValue(data); haptic('success'); return true
      })
    } catch {
      showNotice('Не удалось открыть сканер Telegram. Переоткройте миниапку')
    }
  }

  const pull = usePullToRefresh(pageRef, {
    softPull: activeTab==='cards',
    delay: 900,
    onRefreshStart: () => setLoading(true),
    onRefreshed: () => {
      setLoading(false)
      void live.refresh(true)
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
    document.querySelector('.k-app') ?? document.body,
  )

  return (
    <Page
      ref={pageRef}
      className="wpay-viewport overscroll-y-none pb-[calc(96px+env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      onPointerDown={pull.pointerDown}
      onPointerMove={pull.pointerMove}
      onPointerUp={pull.finish}
      onPointerCancel={pull.finish}
    >
      <WalletNavbar
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
                {balanceHidden ? '••••••' : live.ready ? usd(live.total) : '—'}
              </div>
              <div className="mt-3 text-[14px] text-black/40 dark:text-white/40">
                {live.ready ? 'Доступно в криптовалюте' : 'Ожидает подключения'}
              </div>
            </>
          )}
        </section>

        <WalletActionGrid items={actions.map(action=>({...action,onClick:()=>{
          if(action.label==='QR-код')scanPaymentQr()
          else if(action.label==='Пополнить')setCryptoFlow({kind:'deposit'})
          else if(action.label==='Вывести')setCryptoFlow({kind:'withdraw'})
          else if(action.label==='Обменять')setCryptoFlow({kind:'exchange'})
        }}))}/>

        <List strong inset className="!mb-0 !mt-6 overflow-hidden !rounded-[30px] [&>ul]:!rounded-[30px]">
          {loading ? <CurrencySkeletonRow rubles/> : <CurrencyRow asset={rubleAsset} balanceHidden={balanceHidden}/>}
        </List>

        <section className="mt-8">
          <div className="mb-2 flex items-end justify-between px-safe-4">
            <h2 className="m-0 text-[21px] font-semibold tracking-tight text-black dark:text-white">Криптовалюты</h2>
            <span className="text-[13px] text-black/40 dark:text-white/40">Всего: {live.ready ? usd(live.total) : '—'}</span>
          </div>

          {loading ? <WalletSkeleton /> : (
            <List strong inset dividers className="!mt-0 overflow-hidden !rounded-[32px] [&>ul]:!rounded-[32px]">
              {assets.map(asset => <CurrencyRow key={asset.code} asset={asset} balanceHidden={balanceHidden} onClick={() => {haptic('light');setSelectedAssetCode(asset.code)}}/>)}
            </List>
          )}
        </section>

        <WalletConnectionNote/>
      </main>}

      {activeTab === 'history' && <LiveHistory/>}
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

      {qrValue !== null && <LiveQrPanel initialQr={qrValue} onClose={() => setQrValue(null)}/>}

      {/* Нижняя панель — та же Konsta Tabbar, что у доски (TabPill); QR-оплата пятой кнопкой */}
      <Tabbar
        labels
        icons
        className="wpay-bottom-menu !fixed !left-0 !right-0 !bottom-0 !w-full z-30"
      >
        <ToolbarPane>
          {([
            { id: 'wallet' as const, label: 'Кошелёк', icon: WalletFill },
            { id: 'cards' as const, label: 'Карты', icon: CreditcardFill },
            { id: 'history' as const, label: 'История', icon: ClockFill },
            { id: 'profile' as const, label: 'Профиль', icon: PersonCropCircleFill },
          ]).map(({ id, label, icon: Icon }) => (
            <TabbarLink
              key={id}
              active={activeTab === id}
              onClick={() => selectTab(id)}
              icon={<Icon className="w-6 h-6" />}
              label={label}
            />
          ))}
        </ToolbarPane>
      </Tabbar>

      <div
        role="status"
        className={`pointer-events-none fixed bottom-[calc(88px+env(safe-area-inset-bottom))] left-1/2 z-[13000] -translate-x-1/2 whitespace-nowrap rounded-full bg-black px-4 py-2.5 text-[13px] font-medium text-white shadow-xl transition-all dark:bg-white dark:text-black ${notice ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}
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
  assetSurface = false,
}: {
  children: ReactNode
  onRefreshed: () => void
  assetSurface?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pull = usePullToRefresh(scrollRef, { onRefreshed })
  const indicatorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!assetSurface || !indicatorRef.current) return
    const indicator = indicatorRef.current
    const updateSurface = () => scrollRef.current?.style.setProperty(
      '--wpay-pull-distance', `${indicator.getBoundingClientRect().height}px`,
    )
    // Follow the rendered height, including the refresh indicator's closing transition.
    const observer = new ResizeObserver(updateSurface)
    observer.observe(indicator)
    updateSurface()
    return () => observer.disconnect()
  }, [assetSurface])

  return (
    <div
      ref={scrollRef}
      className={`flex-1 min-h-0 overscroll-y-none overflow-y-auto ${assetSurface ? 'wpay-asset-scroll pb-0' : 'pb-[calc(32px+env(safe-area-inset-bottom))]'} [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
      onPointerDown={pull.pointerDown}
      onPointerMove={pull.pointerMove}
      onPointerUp={pull.finish}
      onPointerCancel={pull.finish}
    >
      <div ref={indicatorRef}>
        <PullRefreshIndicator distance={pull.distance} refreshing={pull.refreshing} dragging={pull.dragging} />
      </div>
      {children}
    </div>
  )
}

function AssetPushView({asset,onClose,showNotice,openFlow}: {asset:Asset|null;onClose:()=>void;showNotice:NoticeHandler;openFlow:(kind:CryptoFlow['kind'],assetCode:string)=>void}) {
  const [displayAsset,setDisplayAsset]=useState(asset??assets[0])
  const live=useLiveWallet()
  useEffect(()=>{if(asset)setDisplayAsset(asset)},[asset])
  return <PushViewShell open={asset!==null} assetSurface title={displayAsset.name} subtitle={displayAsset.code} onClose={onClose} onRefreshed={()=>{void live.refresh(true);showNotice('Обновляем баланс')}}><WalletAssetPanel active={asset!==null} key={displayAsset.code} code={displayAsset.code} name={displayAsset.name} icon={displayAsset.icon} color={displayAsset.color} iconColor={displayAsset.iconColor} onDeposit={()=>openFlow('deposit',displayAsset.code)} onWithdraw={()=>openFlow('withdraw',displayAsset.code)} onExchange={()=>openFlow('exchange',displayAsset.code)}/></PushViewShell>
}

function WalletNavbar({title, subtitle, left, right, assetSurface = false}: {title: string; subtitle?: string; left?: ReactNode; right?: ReactNode; assetSurface?: boolean}) {
  const [opened, setOpened] = useState(false)
  const target = useRef<HTMLElement | null>(null)
  const {theme, toggle} = useTheme()
  return <>
    <Navbar title={title} subtitle={subtitle} left={left} colors={assetSurface ? {bgIos: 'bg-gradient-to-b from-white to-transparent dark:from-[#1c1c1e]'} : undefined} right={right ?? <span ref={target} className="inline-flex h-11 w-11"><KLink iconOnly aria-label="Ещё" onClick={()=>setOpened(true)} className="!h-full !w-full !text-black dark:!text-white"><Ellipsis className="text-[25px]"/></KLink></span>}/>
    {!right && createPortal(<Popover opened={opened} target={target} onBackdropClick={()=>setOpened(false)} className="!z-[100] !w-64"><List nested className="!my-0"><ListItem link title={theme==='dark'?'Светлая тема':'Тёмная тема'} media={theme==='dark'?<SunMax className="text-[22px] text-primary"/>:<MoonStars className="text-[22px] text-primary"/>} onClick={()=>{toggle();setOpened(false)}}/></List></Popover>,document.querySelector('.k-app') ?? document.body)}
  </>
}

function PushViewShell({
  open,
  title,
  subtitle,
  onClose,
  children,
  zClass = 'z-[60]',
  onRefreshed,
  assetSurface = false,
  scrollContent = true,
  interactiveSwipe = false,
}: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  zClass?: string
  onRefreshed?: () => void
  assetSurface?: boolean
  scrollContent?: boolean
  interactiveSwipe?: boolean
}) {
  const { theme } = useTheme()
  useEffect(() => { applyTgTheme(theme) }, [open, theme])
  const swipeStart = useRef<number | null>(null)
  const [swipeOffset,setSwipeOffset]=useState(0)
  const [swiping,setSwiping]=useState(false)
  useEffect(()=>{if(!open){setSwipeOffset(0);setSwiping(false)}},[open])

  const navbar = (
      <WalletNavbar
        title={title}
        assetSurface={assetSurface}
        subtitle={subtitle}
        left={
          <KLink onClick={onClose} aria-label="Назад" className="!-ml-2 !gap-0 !text-primary">
            <ChevronLeft className="text-[29px]" />
            <span className="-ml-1 text-[17px]">Назад</span>
          </KLink>
        }
      />
  )

  return createPortal(
    <section
      aria-hidden={!open}
      data-push-view={interactiveSwipe ? 'interactive' : undefined}
      style={interactiveSwipe && open ? {transform:`translateX(${swipeOffset}px)`,transitionDuration:swiping?'0ms':undefined}:undefined}
      data-wallet-surface={assetSurface ? 'asset' : 'grouped'}
      className={`wpay-viewport fixed inset-0 ${zClass} flex flex-col overflow-hidden ${assetSurface ? 'bg-white dark:bg-[#1c1c1e]' : 'bg-[#efeff4] dark:bg-black'} transition-transform duration-300 ease-out ${open ? 'translate-x-0 shadow-[-18px_0_50px_rgba(0,0,0,.18)]' : 'pointer-events-none translate-x-full'}`}
      onPointerDown={(event) => {
        if (event.clientX <= 28) {
          swipeStart.current = event.clientX
          if(interactiveSwipe){setSwiping(true);event.currentTarget.setPointerCapture(event.pointerId)}
        }
      }}
      onPointerMove={event=>{if(interactiveSwipe && swipeStart.current!==null)setSwipeOffset(Math.max(0,event.clientX-swipeStart.current))}}
      onPointerUp={(event) => {
        if (swipeStart.current !== null && event.clientX - swipeStart.current > 72) onClose()
        setSwiping(false);setSwipeOffset(0)
        swipeStart.current = null
      }}
      onPointerCancel={() => {
        setSwiping(false);setSwipeOffset(0)
        swipeStart.current = null
      }}
    >
      {scrollContent ? <PullToRefreshContent assetSurface={assetSurface} onRefreshed={onRefreshed ?? (() => {})}>{navbar}{children}</PullToRefreshContent> : <>{navbar}{children}</>}
    </section>,
    document.querySelector('.k-app') ?? document.body,
  )
}

function NotificationSheet({open,title,onClose,children}: ComponentProps<typeof PushViewShell>) {
  const Icon=(title==='Карта'||title==='Новая карта')?CreditcardFill:title==='Безопасность'?LockShieldFill:title==='Основная валюта'?Globe:title==='Поддержка'?QuestionCircleFill:BellFill
  const color=(title==='Карта'||title==='Новая карта')?'#007aff':title==='Безопасность'?'#30c759':title==='Основная валюта'?'#8e8e93':title==='Поддержка'?'#ff9500':'#ff3b30'
  return <F7Popup push opened={open} className={`wpay-profile-popup ${title==='Карта'?'wpay-card-popup':''}`} closeByBackdropClick closeOnEscape swipeToClose="to-bottom" swipeHandler=".wpay-profile-popup .navbar" onPopupClosed={onClose}>
    <div className="view">
      <F7Page>
        <F7Navbar large={title!=='Карта'} transparent>
          {title!=='Карта' && <span slot="title" className="inline-flex items-center gap-2"><Icon className="text-[20px]" style={{color}}/>{title}</span>}
          {title!=='Карта' && <span slot="title-large" className="inline-flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] text-white" style={{background:`linear-gradient(to bottom,color-mix(in srgb, ${color} 75%, white),${color})`}}><Icon className="text-[27px]"/></span>{title}</span>}
          <NavRight><F7Link popupClose aria-label={`Закрыть ${title.toLowerCase()}`}><i className="icon icon-close"/></F7Link></NavRight>
        </F7Navbar>
        {children}
      </F7Page>
    </div>
  </F7Popup>
}

function DepositMethodsView({ flow, onClose, showNotice }: { flow: CryptoFlow | null; onClose: () => void; showNotice: NoticeHandler }) {
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => { if (flow) setSelected(null) }, [flow])
  const depositAssets = assets
  return <PushViewShell open={flow !== null} title={selected ? `Пополнить ${selected}` : 'Пополнить'} onClose={() => selected ? setSelected(null) : onClose()}>
    {selected ? <LiveDepositPanel defaultAsset={selected}/> : <main className="mx-auto w-full max-w-[560px] px-4 pb-8 pt-1">
      <p className="mb-4 mt-1 text-center text-[14px] text-black/45 dark:text-white/45">Выберите способ пополнения</p>
      <List strong inset className="!mx-0 !my-0 overflow-hidden !rounded-[30px] [&>ul]:!rounded-[30px]">
        <CurrencyRow asset={rubleAsset} deposit onClick={() => showNotice('Пополнение рублями через СБП пока не подключено')}/>
      </List>
      <h2 className="mb-2 mt-6 px-1 text-[17px] font-semibold text-black/50 dark:text-white/50">Криптовалютой</h2>
      <List strong inset dividers className="!mx-0 !my-0 overflow-hidden !rounded-[30px] [&>ul]:!rounded-[30px]">
        {depositAssets.map(item => <CurrencyRow key={item.code} asset={item} deposit onClick={() => {
          if (!['USDT','BNB','ETH','TON','SOL'].includes(item.code)) {showNotice(`Пополнение ${item.code} пока не подключено у провайдера`);return}
          setSelected(item.code);haptic('light')
        }}/>) }
      </List>
    </main>}
  </PushViewShell>
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
  const live = useLiveWallet()
  const [displayFlow, setDisplayFlow] = useState<CryptoFlow>({ kind: 'withdraw' })
  const [fromCode, setFromCode] = useState('USDT')
  const [toCode, setToCode] = useState('GRAM')
  const [amount, setAmount] = useState('')
  const [assetPicker, setAssetPicker] = useState<'from' | 'to' | null>(null)

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
  const usdRates: Record<string, number> = Object.fromEntries(assets.map(item => [item.code, live.rate(item.code) ?? 0]))
  const balances: Record<string, number> = Object.fromEntries(assets.map(item => [item.code, Number(live.balance(item.code))]))
  const parsedAmount = Number(amount.replace(',', '.')) || 0
  const exchangeRate = (usdRates[fromAsset.code] ?? 0) / (usdRates[toAsset.code] || 1)
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

  if (isDeposit) {
    return <DepositMethodsView flow={flow} onClose={onClose} showNotice={showNotice}/>
  }

  if (!isWithdraw) {
    const pickerAssets = assets.filter((item) => item.code !== (assetPicker === 'from' ? toCode : fromCode))

    const pairs = [['USDT','GRAM'], ['USDT','BNB'], ['USDT','SOL'], ['USDT','BTC'], ['ETH','BTC'], ['GRAM','USDT']]
    const hasRate = live.rate(fromAsset.code) !== null && live.rate(toAsset.code) !== null
    return (
      <PushViewShell open={flow !== null} title="Обмен" onClose={onClose} onRefreshed={() => void live.refresh()}>
        <main className="relative mx-auto w-full max-w-[560px] px-4 pb-8 pt-1">
          <div className="relative">
            <Card className="!m-0 !rounded-[24px]" contentWrapPadding="p-4">
              <div className="flex items-center justify-between gap-2 text-[14px] text-black/45 dark:text-white/45">
                <span>Вы меняете</span>
                <div className="flex items-center gap-2"><WalletFill className="text-[13px]"/><span className="tabular-nums">{live.ready ? formatCrypto(balances[fromAsset.code] ?? 0) : '—'}</span><Button clear inline onClick={() => setAmount(String(balances[fromAsset.code] ?? 0))} className="rounded-md bg-[#3275e9]/[.06] px-2 py-0.5 text-[12px] font-bold tracking-wide text-[#3275e9] dark:bg-blue-400/10 dark:text-blue-400">МАКС</Button></div>
              </div>
              <div className="mt-3 flex h-11 items-center gap-3">
                <Button tonal rounded inline aria-label="Валюта списания" onClick={() => setAssetPicker('from')} className="!w-auto !h-auto !shrink-0 !normal-case flex items-center gap-2 rounded-full bg-black/[.035] py-1 pl-1 pr-3 dark:bg-white/[.06]">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full [&>svg]:!h-[22px] [&>svg]:!w-[22px]" style={assetIconStyle(fromAsset)}>{fromAsset.icon}</span><span className="text-[17px] font-semibold text-black dark:text-white">{fromAsset.code}</span><ChevronRight className="text-[14px] text-black/40 dark:text-white/40"/>
                </Button>
                <input aria-label={`Сумма в ${fromAsset.code}`} inputMode="decimal" autoComplete="off" value={amount} onChange={e=>setAmount(e.target.value.replace(/[^0-9.,]/g,''))} placeholder="0" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-right text-[32px] font-medium leading-none text-black outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/30"/>
              </div>
            </Card>
            <div className="relative z-10 flex h-6 items-center">
              <div aria-hidden="true" className="absolute inset-x-5 top-1/2 h-px bg-black/15 dark:bg-white/20"/>
              <Button tonal rounded inline aria-label="Поменять валюты местами" onClick={swapExchangeAssets} className="absolute left-1/2 top-1/2 z-10 !mt-0 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[5px] border-[#efeff4] bg-white text-[#3275e9] shadow-[0_0_0_1px_rgba(0,0,0,.02)] active:scale-95 dark:border-black dark:bg-[#252528] dark:text-blue-400"><ArrowRightArrowLeft className="rotate-90 text-[21px]"/></Button>
            </div>
            <Card className="!m-0 !rounded-[24px]" contentWrapPadding="p-4">
              <p className="text-[14px] text-black/45 dark:text-white/45">Вы получаете</p>
              <div className="mt-3 flex h-11 items-center gap-3">
                <Button tonal rounded inline aria-label="Валюта получения" onClick={()=>setAssetPicker('to')} className="!w-auto !h-auto !shrink-0 !normal-case flex items-center gap-2 rounded-full bg-black/[.035] py-1 pl-1 pr-3 dark:bg-white/[.06]">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full [&>svg]:!h-[22px] [&>svg]:!w-[22px]" style={assetIconStyle(toAsset)}>{toAsset.icon}</span><span className="text-[17px] font-semibold text-black dark:text-white">{toAsset.code}</span><ChevronRight className="text-[14px] text-black/40 dark:text-white/40"/>
                </Button>
                <output aria-label="Сумма получения" className="min-w-0 flex-1 truncate text-right text-[32px] font-medium leading-none text-black/25 dark:text-white/30">{hasRate && receiveAmount > 0 ? formatCrypto(receiveAmount) : '0'}</output>
              </div>
            </Card>
          </div>
          <p role="status" className="my-4 text-center text-[13px] text-black/40 dark:text-white/40">{hasRate ? `Справочно: 1 ${fromAsset.code} ≈ ${formatCrypto(exchangeRate)} ${toAsset.code}` : 'Курс пока недоступен'}</p>
          <Button large rounded onClick={()=>showNotice('Обмен будет доступен после подключения провайдера')} className="flex h-12 w-full items-center justify-center rounded-[16px] bg-[#3275e9] text-[17px] font-semibold text-white transition-colors active:bg-[#2464d1] dark:bg-[#3275e9] dark:text-white">Продолжить</Button>
          <div className="-mx-4 mt-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="grid w-max grid-flow-col grid-rows-2 gap-2">
              {pairs.map(([from,to],i)=>{ const first=assets.find(x=>x.code===from)!,second=assets.find(x=>x.code===to)!;return <Button tonal rounded inline key={i} aria-label={`Обмен ${from} на ${to}`} onClick={()=>{setFromCode(from);setToCode(to);setAmount('');haptic('light')}} className="flex h-[52px] min-w-[145px] items-center justify-center gap-2 rounded-[20px] bg-white px-3 text-black active:bg-black/5 dark:bg-[#1c1c1e] dark:text-white dark:active:bg-white/10"><span className="flex -space-x-2">{[first,second].map(item=><span key={item.code} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white dark:border-[#1c1c1e] [&>svg]:!h-[17px] [&>svg]:!w-[17px]" style={assetIconStyle(item)}>{item.icon}</span>)}</span><span className="whitespace-nowrap text-[14px] font-medium">{from} / {to}</span></Button>})}
            </div>
          </div>
          <p className="mt-3 text-center text-[12px] leading-4 text-black/35 dark:text-white/35">Обмен пока не подключён. Средства не списываются.</p>

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
                    <Button
                      key={item.code}
                      onClick={() => selectExchangeAsset(item.code)}
                      className="flex items-center gap-3 rounded-2xl border-0 bg-black/[.035] px-3 py-3 text-left dark:bg-white/[.07]"
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                        style={assetIconStyle(item)}
                      >
                        {item.icon}
                      </span>
                      <span>
                        <span className="block text-[16px] font-semibold text-black dark:text-white">{item.code}</span>
                        <span className="block text-[11px] text-black/40 dark:text-white/40">{item.name}</span>
                      </span>
                    </Button>
                  ))}
                </div>
                <Button
                  onClick={() => setAssetPicker(null)}
                  className="mt-2 w-full rounded-2xl border-0 bg-black/[.045] py-3 text-[16px] font-semibold text-primary dark:bg-white/[.08]"
                >
                  Отмена
                </Button>
              </section>
            </div>
          )}
        </main>
      </PushViewShell>
    )
  }

  return <WithdrawalMethodsView open={flow!==null} onClose={onClose}/>
}

function WithdrawalMethodsView({open,onClose}:{open:boolean;onClose:()=>void}) {
  const [method,setMethod]=useState<WithdrawalMethod|null>(null)
  useEffect(()=>{if(open)setMethod(null)},[open])
  return <PushViewShell open={open} title={method?withdrawalTitles[method]:'Вывод'} onClose={()=>method?setMethod(null):onClose()}>
    {method?<WithdrawalForm key={method} method={method}/>:<WithdrawalMethods onSelect={setMethod}/>}
  </PushViewShell>
}

const bankCards = [
  { id: 'rub', name: 'Основная карта', currency: '₽', balance: '0,00 ₽', last4: '0000', network: 'Visa', gradient: 'from-[#1d4ed8] via-[#2563eb] to-[#60a5fa]' },
  { id: 'usd', name: 'Долларовая карта', currency: '$', balance: '$0.00', last4: '0001', network: 'Visa', gradient: 'from-[#312e81] via-[#5b21b6] to-[#a855f7]' },
  { id: 'amex', name: 'Green', currency: '$', balance: '$0.00', last4: '1002', network: 'American Express', gradient: 'from-[#f1f3f6] via-[#cdd3dc] to-[#e6ebf0]' },
]

const cardPayments = {
  amex: [],
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

type BankCard = (typeof bankCards)[number]
const roundedWalletList = '!mt-0 overflow-hidden !rounded-[32px] [&>ul]:!rounded-[32px]'
function BankCardArtwork({card}: {card:BankCard}) {
  const chipId=useId()
  if(card.id==='amex')return <span role="img" aria-label={`${card.name}, ${card.network}, демо, ${card.balance}, номер заканчивается на ${card.last4}`} className="wpay-classic-card"><img src="/cards/amex-green-classic.png" width="315" height="199" alt="" draggable={false} className="wpay-classic-card-image"/><span className="wpay-classic-card-status">{card.balance}<span>·</span>Демо</span></span>
  return <span role="img" aria-label={`${card.name}, ${card.network}, демо, ${card.balance}, номер заканчивается на ${card.last4}`} className={`wpay-bank-card wpay-bank-card--${card.id}`}>
    <span className="wpay-bank-card-orbit" aria-hidden="true"/>
    <span className="wpay-bank-card-head"><span className="wpay-bank-card-brand">WPay<span className="wpay-bank-card-brand-dot"/></span><span className="wpay-bank-card-tag">{card.currency==='₽'?'RUB':'USD'}<span>·</span>Демо</span></span>
    <span className="wpay-bank-card-middle"><span><span className="wpay-bank-card-name">{card.name}</span><span className="wpay-bank-card-balance">{card.balance}</span></span><span className="wpay-bank-card-chip-group" aria-hidden="true"><svg width="36" height="28" viewBox="0 0 36 28" fill="none"><rect x=".5" y=".5" width="35" height="27" rx="7" fill={`url(#${chipId})`} stroke="#fff" strokeOpacity=".4"/><path d="M12 0v8L8 11H0m36 0h-8l-4-3V0M0 17h8l4 3v8m12 0v-8l4-3h8M12 8h12v12H12z" stroke="#836b40" strokeOpacity=".55" strokeWidth=".75"/><defs><linearGradient id={chipId} x1="0" y1="0" x2="36" y2="28" gradientUnits="userSpaceOnUse"><stop stopColor="#f4e8c7"/><stop offset=".5" stopColor="#c9ad71"/><stop offset="1" stopColor="#efddaf"/></linearGradient></defs></svg><svg width="17" height="24" viewBox="0 0 17 24" fill="none"><path d="M3 8a7 7 0 0 1 0 8m4-11a12 12 0 0 1 0 14m4-17a17 17 0 0 1 0 20" stroke="currentColor" strokeOpacity=".75" strokeWidth="1.6" strokeLinecap="round"/></svg></span></span>
    <span className="wpay-bank-card-bottom"><span><span className="wpay-bank-card-number">••••<span>{card.last4}</span></span><span className="wpay-bank-card-kind">VIRTUAL DEBIT</span></span><span className="wpay-bank-card-visa">VISA</span></span>
  </span>
}

function CardAvatar({card}: {card:BankCard}) {
  return <span className="wpay-currency-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={assetIconStyle({color:card.id==='rub'?'#3275e9':card.id==='amex'?'#42765b':'#7c3aed',iconColor:'#fff'})}><CreditcardFill className="text-[23px]"/></span>
}
function CardsPaymentsList({card,showNotice}: {card:BankCard;showNotice:NoticeHandler}) {
  const payments=cardPayments[card.id as keyof typeof cardPayments]
  if(!payments.length)return <p className="mx-4 rounded-[28px] bg-white px-5 py-6 text-center text-[14px] text-black/40 dark:bg-[#1c1c1e] dark:text-white/40">По этой карте пока нет операций</p>
  return <List strong inset dividers className={roundedWalletList}>
    {payments.map(payment=>{const Icon=payment.icon;return <ListItem key={`${card.id}-${payment.id}`} link chevron={false} onClick={()=>showNotice(`${payment.title} · пример операции`)} contentClassName="!h-16" innerClassName="!min-w-0 !h-16 !py-2 after:!opacity-30" media={<span className={`wpay-currency-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${payment.income?'bg-gradient-to-b from-green-300 to-green-500 text-white dark:from-green-400 dark:to-green-600':'bg-gradient-to-b from-blue-300 to-blue-500 text-white dark:from-blue-400 dark:to-blue-600'}`}><Icon className="text-[22px]"/></span>} innerChildren={<span className="flex h-full min-w-0 items-center justify-between gap-3"><span className="min-w-0"><span className="block truncate text-[17px] font-semibold leading-6 text-black dark:text-white">{payment.title}</span><span className="mt-0.5 block truncate text-[14px] leading-5 text-black/45 dark:text-white/45">{payment.subtitle}</span></span><span className={`shrink-0 text-right text-[16px] font-medium tabular-nums ${payment.income?'text-green-600 dark:text-green-400':'text-black dark:text-white'}`}>{payment.amount}</span></span>}/>})}
  </List>
}
function CardWalletOptions({showNotice}: {showNotice:NoticeHandler}) {
  return <List strong inset dividers className={roundedWalletList}>
    {[{title:'Apple Wallet',subtitle:'Добавить карту',Icon:LogoApple,color:'bg-black text-white dark:bg-white dark:text-black'},{title:'Google Wallet',subtitle:'Добавить карту',Icon:LogoGoogle,color:'bg-gradient-to-b from-blue-300 to-blue-500 text-white dark:from-blue-400 dark:to-blue-600'}].map(({title,subtitle,Icon,color})=><ListItem key={title} link title={title} subtitle={subtitle} contentClassName="!h-16" innerClassName="!h-16 !py-2 after:!opacity-30" titleWrapClassName="pr-6" chevronIcon={<ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-[19px] text-black/25 dark:text-white/30"/>} onClick={()=>showNotice(`${title}: подключение появится после выпуска карты`)} media={<span className={`wpay-currency-icon flex h-11 w-11 items-center justify-center rounded-full ${color}`}><Icon className="text-[24px]"/></span>}/>)}
  </List>
}
const cardOffers=[
  {id:'virtual',name:'Виртуальная USD',caption:'Для ваших онлайн-покупок',network:'Visa',premium:false},
  {id:'premium',name:'Premium USD',caption:'Ещё одна карта для ваших планов',network:'Mastercard',premium:true},
]
type CardOffer=(typeof cardOffers)[number]
function CardOfferArtwork({offer}:{offer:CardOffer}) {
  return <span className={`wpay-bank-card wpay-card-offer ${offer.premium?'wpay-card-offer-premium':''}`}>
    <span className="wpay-bank-card-orbit" aria-hidden="true"/>
    <span className="wpay-bank-card-head"><span className="wpay-bank-card-brand">WPay<span className="wpay-bank-card-brand-dot"/></span><span className="wpay-bank-card-tag">USD · Новая</span></span>
    <span className="wpay-card-offer-plus" aria-hidden="true">+</span>
    <span className="wpay-bank-card-bottom"><span><span className="wpay-card-offer-title">{offer.name}</span><span className="wpay-bank-card-kind">ДОБАВИТЬ КАРТУ</span></span><span className={offer.premium?'text-[12px] font-semibold':'wpay-bank-card-visa'}>{offer.network}</span></span>
  </span>
}
function CardOfferDetails({offer,onOrder,checkout=false}:{offer:CardOffer;onOrder?:()=>void;checkout?:boolean}) {
  return <div className="px-4 pb-7 pt-6"><h2 className="text-[27px] font-semibold tracking-tight text-black dark:text-white">{offer.name}</h2><p className="mt-2 text-[16px] leading-6 text-black/45 dark:text-white/45">{offer.caption}. Отдельная карта в долларах поможет разделить расходы и подписки.</p>
    <List strong dividers className="!mx-0 !mb-5 !mt-5 overflow-hidden !rounded-[28px] [&>ul]:!rounded-[28px]">{['Выпуск карты','Обслуживание','Пополнение'].map(title=><ListItem key={title} title={title} after="Уточняется" contentClassName="!h-14" innerClassName="!h-14 after:!opacity-30"/>)}</List>
    <Button rounded large disabled={checkout} className="!m-0 !w-full !rounded-[22px]" onClick={onOrder}>{checkout?'Выпуск пока недоступен':'Заказать карту'}</Button>
    <p className="mt-3 px-2 text-center text-[13px] leading-5 text-black/40 dark:text-white/40">{checkout?'Провайдер выпуска ещё не подключён. Цена, комиссии и доступные способы оплаты появятся до подтверждения заказа. Средства не списываются.':'Предварительный каталог. Условия и стоимость выпуска пока не опубликованы.'}</p>
  </div>
}
function CardPurchaseView({offer,onSelect,onClose}:{offer:CardOffer|null;onSelect:(offer:CardOffer)=>void;onClose:()=>void}) {
  const [displayOffer,setDisplayOffer]=useState(cardOffers[0])
  useEffect(()=>{if(offer)setDisplayOffer(offer)},[offer])
  return <NotificationSheet open={offer!==null} title="Новая карта" onClose={onClose}><main className="mx-auto w-full max-w-[560px] pb-6"><div className="flex gap-2 px-4 pb-4 pt-3">{cardOffers.map(item=><button key={item.id} type="button" aria-pressed={displayOffer.id===item.id} onClick={()=>onSelect(item)} className={`min-h-10 flex-1 rounded-full px-3 text-[14px] font-medium ${displayOffer.id===item.id?'bg-primary text-white dark:bg-primary':'bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50'}`}>{item.name}</button>)}</div><div className="px-4"><CardOfferArtwork offer={displayOffer}/></div><CardOfferDetails offer={displayOffer} checkout/></main></NotificationSheet>
}

function CardsSection({showNotice}: {showNotice:NoticeHandler}) {
  const [activeCardIndex,setActiveCardIndex]=useState(0)
  const cardDrag=useRef({active:false,startX:0,scrollLeft:0,moved:false})
  const suppressCardClick=useRef(false)
  const [draggingCard,setDraggingCard]=useState(false)
  const finishCardDrag=(event:ReactPointerEvent<HTMLDivElement>)=>{
    const drag=cardDrag.current
    if(!drag.active)return
    drag.active=false
    if(!drag.moved)return
    event.stopPropagation()
    setDraggingCard(false)
    const container=event.currentTarget
    const card=container.firstElementChild as HTMLElement|null
    const step=(card?.offsetWidth??container.clientWidth)+12
    const target=Math.round(container.scrollLeft/step)*step
    container.style.scrollSnapType=''
    container.scrollTo({left:target,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})
    if(container.hasPointerCapture(event.pointerId))container.releasePointerCapture(event.pointerId)
    window.setTimeout(()=>{suppressCardClick.current=false},0)
  }
  const [purchaseOffer,setPurchaseOffer]=useState<CardOffer|null>(null)
  const activeOffer=cardOffers[activeCardIndex-bankCards.length]
  const carouselCount=bankCards.length+cardOffers.length
  const [settingsCardId,setSettingsCardId]=useState<string|null>(null)
  const activeCard=bankCards[activeCardIndex]??bankCards[0]
  const selectedCard=bankCards.find(card=>card.id===settingsCardId)??activeCard
  return <>
    <main className="mx-auto w-full max-w-[560px] pb-6">
      <section aria-label="Ваши карты" className="pt-5">
        <div className={`flex snap-x snap-mandatory gap-3 overflow-x-auto select-none px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${draggingCard?'cursor-grabbing':'cursor-grab'}`} onDragStart={event=>event.preventDefault()} onPointerDown={event=>{
          if(event.pointerType!=='mouse'||event.button!==0)return
          event.stopPropagation()
          cardDrag.current={active:true,startX:event.clientX,scrollLeft:event.currentTarget.scrollLeft,moved:false}
        }} onPointerMove={event=>{
          const drag=cardDrag.current
          if(event.pointerType!=='mouse'||!drag.active)return
          const delta=event.clientX-drag.startX
          if(!drag.moved&&Math.abs(delta)<6)return
          if(!drag.moved){drag.moved=true;suppressCardClick.current=true;setDraggingCard(true);event.currentTarget.style.scrollSnapType='none';event.currentTarget.setPointerCapture(event.pointerId)}
          event.preventDefault();event.stopPropagation()
          event.currentTarget.scrollLeft=drag.scrollLeft-delta
        }} onPointerUp={finishCardDrag} onPointerCancel={finishCardDrag} onLostPointerCapture={finishCardDrag} onPointerLeave={()=>{if(!cardDrag.current.moved)cardDrag.current.active=false}} onClickCapture={event=>{
          if(suppressCardClick.current){event.preventDefault();event.stopPropagation();suppressCardClick.current=false}
        }} onScroll={event=>{
          const container=event.currentTarget
          const card=container.firstElementChild as HTMLElement|null
          if(card)setActiveCardIndex(Math.max(0,Math.min(carouselCount-1,Math.round(container.scrollLeft/(card.offsetWidth+12)))))
        }}>
          {bankCards.map(card=><button key={card.id} type="button" aria-label={`Открыть ${card.name}`} onClick={()=>setSettingsCardId(card.id)} className="min-w-0 shrink-0 basis-full snap-center rounded-[30px] text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"><BankCardArtwork card={card}/></button>)}
          {cardOffers.map(offer=><button key={offer.id} type="button" aria-label={`Заказать ${offer.name}`} onClick={()=>setPurchaseOffer(offer)} className="min-w-0 shrink-0 basis-full snap-center rounded-[30px] text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"><CardOfferArtwork offer={offer}/></button>)}
        </div>
        <div className="mt-2 flex justify-center gap-1.5" aria-label={`Карта ${activeCardIndex+1} из ${carouselCount}`}>
          {[...bankCards,...cardOffers].map((card,index)=><span key={card.id} className={`h-1.5 w-1.5 rounded-full ${index===activeCardIndex?'bg-black/60 dark:bg-white/70':'bg-black/15 dark:bg-white/20'}`}/>)}
        </div>
      </section>
      {activeOffer?<CardOfferDetails offer={activeOffer} onOrder={()=>setPurchaseOffer(activeOffer)}/>:<>
      <div className="h-5" />
      <WalletActionGrid label="Действия с картами" items={[
        {label:'Пополнить',icon:PlusCircleFill,onClick:()=>showNotice('Пополнение карты появится после подключения провайдера')},
        {label:'Реквизиты',icon:DocOnDoc,onClick:()=>setSettingsCardId(activeCard.id)},
        {label:'Wallet',icon:WalletFill,onClick:()=>setSettingsCardId(activeCard.id)},
        {label:'Ещё',icon:Ellipsis,onClick:()=>setSettingsCardId(activeCard.id)},
      ]}/>
      <div className="mb-2 mt-8 flex items-end justify-between px-safe-4"><h2 className="text-[21px] font-semibold tracking-tight text-black dark:text-white">Мои карты</h2><span className="text-[13px] text-black/40 dark:text-white/40">{bankCards.length} карты</span></div>
      <List strong inset dividers className={roundedWalletList}>
        {bankCards.map((card,index)=><ListItem key={card.id} link chevron={false} contentClassName="!h-16" innerClassName="!min-w-0 !h-16 !py-2 after:!opacity-30" onClick={()=>{haptic('light');setActiveCardIndex(index);setSettingsCardId(card.id)}} media={<CardAvatar card={card}/>} innerChildren={<span className="flex h-full min-w-0 items-center justify-between gap-3"><span className="min-w-0"><span className="block truncate text-[17px] font-semibold leading-6 text-black dark:text-white">{card.name}</span><span className="mt-0.5 block text-[14px] leading-5 text-black/45 dark:text-white/45">{card.network} · •••• {card.last4}</span></span><span className="shrink-0 text-right"><span className="block text-[16px] font-medium leading-6 tabular-nums text-black dark:text-white">{card.balance}</span><span className="block text-[12px] leading-5 text-black/40 dark:text-white/40">{card.currency==='₽'?'RUB':'USD'} · Демо</span></span></span>}/>)}
        <ListItem link title="Выпустить карту" subtitle="Новая виртуальная карта" contentClassName="!h-16" innerClassName="!h-16 !py-2 after:!opacity-30" titleWrapClassName="pr-6" chevronIcon={<ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-[19px] text-black/25 dark:text-white/30"/>} media={<span className="wpay-currency-icon flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary dark:bg-primary/20"><PlusCircleFill className="text-[25px]"/></span>} onClick={()=>setPurchaseOffer(cardOffers[0])}/>
      </List>
      <h2 className="mb-2 mt-7 px-safe-4 text-[21px] font-semibold tracking-tight text-black dark:text-white">Оплата телефоном</h2>
      <CardWalletOptions showNotice={showNotice}/>
      <div className="mb-2 mt-7 flex items-end justify-between px-safe-4"><h2 className="text-[21px] font-semibold tracking-tight text-black dark:text-white">Платежи по карте</h2><span className="text-[13px] text-black/40 dark:text-white/40">Демо</span></div>
      <CardsPaymentsList card={activeCard} showNotice={showNotice}/>
      <p className="mx-auto mt-5 max-w-[360px] px-5 text-center text-[12px] leading-relaxed text-black/35 dark:text-white/35">Демонстрационные карты и операции. Выпуск и платежи появятся после подключения банковского провайдера.</p>
      </>}
    </main>
    <CardPurchaseView offer={purchaseOffer} onSelect={setPurchaseOffer} onClose={()=>setPurchaseOffer(null)}/>
    <CardPushView card={selectedCard} open={settingsCardId!==null} onClose={()=>setSettingsCardId(null)} showNotice={showNotice}/>
  </>
}
function CardPushView({card,open,onClose,showNotice}: {card:BankCard;open:boolean;onClose:()=>void;showNotice:NoticeHandler}) {
  return <NotificationSheet open={open} title="Карта" onClose={onClose}>
    <main className="mx-auto w-full max-w-[560px] pb-6">
      <div className="px-safe-4 pb-7 pt-3"><BankCardArtwork card={card}/></div>
      <WalletActionGrid label="Действия с картой" items={[
        {label:'Пополнить',icon:PlusCircleFill,onClick:()=>showNotice('Пополнение карты пока не подключено')},
        {label:'Реквизиты',icon:DocOnDoc,onClick:()=>showNotice('Реквизиты появятся после выпуска карты')},
        {label:'Заморозить',icon:Snow,onClick:()=>showNotice('Заморозка появится после подключения провайдера')},
        {label:'Ещё',icon:Ellipsis,onClick:()=>showNotice('Управление картой появится после подключения провайдера')},
      ]}/>
      <h2 className="mb-2 mt-8 px-safe-4 text-[21px] font-semibold tracking-tight text-black dark:text-white">Управление картой</h2>
      <List strong inset dividers className={roundedWalletList}>
        {[{title:'Лимиты и операции',subtitle:'Ограничения и тарифы',Icon:SliderHorizontal3},{title:'Безопасность',subtitle:'Настройки платежей',Icon:LockShieldFill}].map(({title,subtitle,Icon})=><ListItem key={title} link title={title} subtitle={subtitle} contentClassName="!h-16" innerClassName="!h-16 !py-2 after:!opacity-30" titleWrapClassName="pr-6" chevronIcon={<ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-[19px] text-black/25 dark:text-white/30"/>} media={<span className="wpay-currency-icon flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-b from-blue-300 to-blue-500 text-white dark:from-blue-400 dark:to-blue-600"><Icon className="text-[23px]"/></span>} onClick={()=>showNotice(`${title}: пока недоступно`)}/>)}
      </List>
      <h2 className="mb-2 mt-7 px-safe-4 text-[21px] font-semibold tracking-tight text-black dark:text-white">Оплата телефоном</h2><CardWalletOptions showNotice={showNotice}/>
      <div className="mb-2 mt-7 flex items-end justify-between px-safe-4"><h2 className="text-[21px] font-semibold tracking-tight text-black dark:text-white">История карты</h2><span className="text-[13px] text-black/40 dark:text-white/40">Демо</span></div><CardsPaymentsList card={card} showNotice={showNotice}/>
    </main>
  </NotificationSheet>
}

function ProfileListItem(props: ComponentProps<typeof F7ListItem>) {
  const title=String(props.title ?? '')
  const security=/защит|парол|устройств|доступ|Безопасность/.test(title)
  const notification=/Уведомления|Платежи|Пополнения|курсов|Новости/.test(title)
  const personal=/Имя|данные|проверки|Документы/.test(title)
  const Icon=/Реферальная/.test(title)?PersonCropCircleFill:security?LockShieldFill:notification?BellFill:personal?PersonCropCircleFill:/валюта|RUB|USD|EUR/.test(title)?Globe:/провайдер/.test(title)?BuildingColumnsFill:QuestionCircleFill
  const color=/Реферальная/.test(title)?'#FF9500':security?'#30C759':notification?'#FF3B30':personal?'#5856D6':/валюта|RUB|USD|EUR/.test(title)?'#8E8E93':/вопрос/.test(title)?'#32ADE6':/поддерж|Чат|проблем/.test(title)?'#FF9500':'#AF52DE'
  return <F7ListItem {...props} mediaItem={Boolean(props.subtitle)} external link={props.link ? '#' : undefined} onClick={event=>{if(props.link)event.preventDefault();props.onClick?.(event)}}>
    <span slot="media" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-white" style={{background: `linear-gradient(155deg, color-mix(in srgb, ${color} 78%, white) 0%, ${color} 55%, color-mix(in srgb, ${color} 92%, black) 100%)`, boxShadow: 'inset 0 1px 0 rgb(255 255 255 / .35)'}}><Icon className="text-[27px]"/></span>
    {props.children}
  </F7ListItem>
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
  const [profileName,setProfileName]=useState('')
  const displayName = profileName || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Ваш профиль'
  const [profilePage, setProfilePage] = useState<keyof typeof profilePageTitles | null>(null)

  return (
    <>
    <main className={`wpay-f7-profile ios mx-auto w-full max-w-[560px] pb-6 transition-[transform,opacity] duration-300 ease-out ${profilePage && !['notifications','security','currency','support'].includes(profilePage) ? '-translate-x-[22%] opacity-60' : 'translate-x-0 opacity-100'}`}>
      <section className="px-safe-4 pb-6 pt-7 text-center">
        <div className="wpay-currency-icon mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-gradient-to-b from-blue-300 to-blue-600 text-[34px] font-semibold text-white shadow-sm dark:from-blue-400 dark:to-blue-700">
          {user?.photo_url ? <img src={user.photo_url} alt="" className="h-full w-full object-cover" /> : initials}
        </div>
        <h2 className="mb-0 mt-4 text-[28px] font-semibold text-black dark:text-white">{displayName}</h2>
        <div className="mt-1.5 text-[16px] text-black/45 dark:text-white/45">{user?.username ? `@${user.username}` : 'Профиль кошелька'}</div>
      </section>

      <h2 className="mb-2 px-safe-4 text-[21px] font-semibold tracking-tight text-black dark:text-white">Аккаунт</h2>
      <F7List strong inset dividers className="profile-settings-list">
        <ProfileListItem link title="Личные данные" subtitle="Имя и документы" onClick={() => setProfilePage('personal')} />
        <ProfileListItem link title="Безопасность" subtitle="Код доступа и устройства" onClick={() => setProfilePage('security')} />
        <ProfileListItem link title="Уведомления" subtitle="Платежи и курсы" onClick={() => setProfilePage('notifications')} />
        <ProfileListItem link title="Реферальная программа" subtitle="Приглашайте друзей" onClick={() => setProfilePage('referral')} />
      </F7List>

      <h2 className="mb-2 mt-7 px-safe-4 text-[21px] font-semibold tracking-tight text-black dark:text-white">Настройки и помощь</h2>
      <F7List strong inset dividers className="profile-settings-list">
        <ProfileListItem link title="Основная валюта" after="RUB" onClick={() => setProfilePage('currency')} />
        <ProfileListItem link title="Банковский провайдер" subtitle="Не подключён" onClick={() => setProfilePage('provider')} />
        <ProfileListItem link title="Помощь и поддержка" onClick={() => setProfilePage('support')} />
      </F7List>
      <F7List strong inset dividers className="profile-legal-list">
        <F7ListItem link="#" external title="Пользовательское соглашение" onClick={event=>{event.preventDefault();setProfilePage('terms')}}><DocTextFill slot="media" className="text-[26px] text-[#007aff] dark:text-[#0a84ff]"/></F7ListItem>
        <F7ListItem link="#" external title="Политика конфиденциальности" onClick={event=>{event.preventDefault();setProfilePage('privacy')}}><LockShieldFill slot="media" className="text-[27px] text-[#007aff] dark:text-[#0a84ff]"/></F7ListItem>
      </F7List>
      <p className="px-8 text-[13px] leading-5 text-black/45 dark:text-white/45"><span className="text-primary">Операции с криптовалютой связаны с риском.</span> Стоимость активов может меняться. Перед операцией проверяйте курс, комиссию и реквизиты получателя.</p>
    </main>
    <ProfileSettingsPushView page={profilePage} onClose={() => setProfilePage(null)} showNotice={showNotice} onSaveName={setProfileName} />
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
  referral: 'Рефералы',
  terms: 'Соглашение',
  privacy: 'Конфиденциальность',
} as const

function ProfileSettingsPushView({
  page,
  onClose,
  showNotice,
  onSaveName,
}: {
  page: keyof typeof profilePageTitles | null
  onClose: () => void
  showNotice: NoticeHandler
  onSaveName: (name:string)=>void
}) {
  const user=getUser()
  const [firstName,setFirstName]=useState(user?.first_name ?? '')
  const [lastName,setLastName]=useState(user?.last_name ?? '')
  const notificationKey=`wpay-notifications:${user?.id ?? 'guest'}`
  const [notifications,setNotifications]=useState<Record<string,boolean>>(()=>{
    const defaults={payments:true,deposits:true,rates:false,news:false}
    try {const saved=JSON.parse(localStorage.getItem(notificationKey)||'{}');return Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,typeof saved[key]==='boolean'?saved[key]:value]))} catch {return defaults}
  })
  const [phone,setPhone]=useState('')
  const [email,setEmail]=useState('')
  const [nameSaved,setNameSaved]=useState(false)
  const [chatOpen,setChatOpen] = useState(false)
  const [displayPage, setDisplayPage] = useState<keyof typeof profilePageTitles>('personal')
  useEffect(() => {
    if (page) setDisplayPage(page)
    else setChatOpen(false)
  }, [page])

  const notificationContent=(<>
          <F7List strong inset dividers className="profile-settings-list profile-notifications">
            {[['payments','Платежи и переводы'],['deposits','Пополнения'],['rates','Изменения курсов'],['news','Новости сервиса']].map(([key,title])=><F7ListItem key={key} title={title}><span slot="after"><F7Toggle init={false} name={key} aria-label={title} defaultChecked={notifications[key]} onChange={event=>{const next={...notifications,[key]:event.target.checked};setNotifications(next);try{localStorage.setItem(notificationKey,JSON.stringify(next))}catch{/* Keep current session state. */}}}/></span></F7ListItem>)}
          </F7List>
          <p className="px-6 text-[13px] leading-5 text-black/45 dark:text-white/45">Настройки сохраняются на этом устройстве. Доставка уведомлений пока не подключена.</p>
        </>)

  const securityContent=(<F7List strong inset dividers className="profile-settings-list">
            <ProfileListItem link title="Код доступа" subtitle="Для входа и подтверждения операций" after="Выкл." onClick={() => showNotice('Код доступа: скоро будет доступен')} />
            <ProfileListItem link title="Двухфакторная защита" subtitle="Дополнительный код подтверждения" after="Выкл." onClick={() => showNotice('2FA: скоро будет доступна')} />
            <ProfileListItem link title="Активные устройства" after="1" onClick={() => showNotice('Это устройство активно')} />
            <ProfileListItem link title="Сменить пароль" onClick={() => showNotice('Смена пароля: скоро будет доступна')} />
          </F7List>)
  const currencyContent=(<F7List strong inset dividers className="profile-settings-list">
            {['RUB — Российский рубль', 'USD — Доллар США', 'EUR — Евро'].map((currency, index) => (
              <ProfileListItem key={currency} link title={currency} after={index === 0 ? '✓' : undefined} onClick={() => showNotice(`Выбрана валюта: ${currency.slice(0, 3)}`)} />
            ))}
          </F7List>)
  const supportContent=(<F7List strong inset dividers className="profile-settings-list">
            <ProfileListItem link title="Чат с поддержкой" subtitle="Сообщения и обращения" onClick={() => setChatOpen(true)} />
            <ProfileListItem link title="Частые вопросы" onClick={() => showNotice('Раздел помощи: скоро будет доступен')} />
            <ProfileListItem link title="Сообщить о проблеме" onClick={() => showNotice('Форма обращения: скоро будет доступна')} />
          </F7List>)
  const popupPages=['notifications','security','currency','support']
  return (
    <>
    <PushViewShell open={page !== null && !popupPages.includes(page)} title={profilePageTitles[displayPage]} subtitle="Настройки профиля" onClose={onClose} onRefreshed={() => showNotice('Данные профиля обновлены')}>
      <main className="wpay-f7-profile ios mx-auto w-full max-w-[560px] pb-5 pt-3">
        {displayPage === 'personal' && <>
          <div className="pb-5 pt-4 text-center"><span className="mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-gradient-to-b from-blue-300 to-blue-600 text-[34px] font-semibold text-white dark:from-blue-400 dark:to-blue-700">{user?.photo_url?<img src={user.photo_url} alt="Аватар профиля" className="h-full w-full object-cover"/>:(firstName.trim()[0]||user?.first_name?.[0]||'W').toUpperCase()}</span><p className="mt-3 text-[14px] text-black/45 dark:text-white/45">Фото профиля Telegram</p></div>
          <h2 className="mb-3 mt-3 px-5 text-[21px] font-semibold text-black dark:text-white">Ваши данные</h2>
          <F7List strong inset dividers className="profile-input-list">
            <F7ListInput label="Имя" inputId="profile-first-name" type="text" name="given-name" autocomplete="given-name" placeholder="Введите имя" value={firstName} maxlength={64} onInput={event=>{setFirstName(event.target.value);setNameSaved(false)}} />
            <F7ListInput label="Фамилия" inputId="profile-last-name" type="text" name="family-name" autocomplete="family-name" placeholder="Введите фамилию" value={lastName} maxlength={64} onInput={event=>{setLastName(event.target.value);setNameSaved(false)}} />
          </F7List>
          <F7List strong inset dividers className="profile-input-list">
            <F7ListInput label="Номер телефона" inputId="profile-phone" type="tel" name="tel" autocomplete="tel" placeholder="+7 999 123-45-67" value={phone} maxlength={32} onInput={event=>{setPhone(event.target.value);setNameSaved(false)}} />
            <F7ListInput label="Электронная почта" inputId="profile-email" type="email" name="email" autocomplete="email" placeholder="name@example.com" value={email} maxlength={254} onInput={event=>{setEmail(event.target.value);setNameSaved(false)}} />
            <F7ListInput label="Telegram" inputId="profile-telegram" type="text" readonly value={user?.username?`@${user.username}`:'Имя пользователя не указано'} />
            <F7ListInput label="KYC · Проверка личности" inputId="profile-verification" type="text" readonly value="Не пройдена" />
          </F7List>
          <div className="px-4"><Button rounded large disabled={!firstName.trim()} className="!m-0 !w-full !rounded-[22px]" onClick={()=>{onSaveName([firstName.trim(),lastName.trim()].filter(Boolean).join(' '));setNameSaved(true)}}>Сохранить</Button><p role="status" className="mt-3 px-2 text-center text-[13px] leading-5 text-black/45 dark:text-white/45">{nameSaved?'Данные обновлены в текущей сессии.':'Изменения сохраняются только в текущей сессии WPay. Профиль Telegram не изменится.'}</p></div>
        </>}

        {displayPage === 'provider' && (
          <>
            <Card className="!mx-4 !rounded-[32px] text-center" contentWrapPadding="p-6">
              <BuildingColumnsFill className="mx-auto text-[42px] text-primary" />
              <h2 className="mb-0 mt-3 text-[19px] font-semibold">Провайдер не подключён</h2>
              <p className="mb-0 mt-2 text-[15px] leading-6 text-black/45 dark:text-white/45">После подключения станут доступны выпуск карт, пополнение, вывод и реальные платежи.</p>
            </Card>
            <div className="px-safe-4"><Button rounded large className="!m-0 !w-full" onClick={() => showNotice('Заявка на подключение подготовлена')}><span className="normal-case">Подключить провайдера</span></Button></div>
          </>
        )}

        {displayPage==='referral' && <ReferralProgram/>}
        {(displayPage==='terms'||displayPage==='privacy') && <Card className="!mx-4 !rounded-[28px]" contentWrapPadding="p-6"><DocOnDoc className="text-[32px] text-primary"/><h2 className="mt-4 text-[22px] font-semibold text-black dark:text-white">{displayPage==='terms'?'Пользовательское соглашение':'Политика конфиденциальности'}</h2><p className="mt-3 text-[16px] leading-6 text-black/50 dark:text-white/50">Документ пока не опубликован. Здесь появится актуальная редакция перед запуском сервиса.</p></Card>}
      </main>
    </PushViewShell>
    <NotificationSheet open={page!==null&&popupPages.includes(page)} title={profilePageTitles[displayPage]} onClose={onClose}><main className="wpay-f7-profile ios mx-auto w-full max-w-[560px] pb-5 pt-3">{displayPage==='notifications'?notificationContent:displayPage==='security'?securityContent:displayPage==='currency'?currencyContent:displayPage==='support'?supportContent:null}</main></NotificationSheet>
    <SupportChatPushView open={chatOpen && page!==null} onClose={()=>setChatOpen(false)} />
    </>
  )
}

function SupportChatPushView({open,onClose}: {open:boolean;onClose:()=>void}) {
  const [draft,setDraft]=useState('')
  const [messages,setMessages]=useState<{id:number;text:string;time:string}[]>([])
  const mainRef=useRef<HTMLElement|null>(null)
  const endRef=useRef<HTMLDivElement|null>(null)
  useEffect(()=>{if(open)endRef.current?.scrollIntoView({block:'nearest',behavior:'smooth'})},[messages,open])
  useEffect(()=>{
    if(!open)return
    const viewport=window.visualViewport
    const panel=mainRef.current?.closest('section')
    if(!viewport||!panel)return
    const resize=()=>{panel.style.height=`${viewport.height}px`;panel.style.top=`${viewport.offsetTop}px`;panel.style.bottom='auto'}
    resize();viewport.addEventListener('resize',resize);viewport.addEventListener('scroll',resize)
    return()=>{viewport.removeEventListener('resize',resize);viewport.removeEventListener('scroll',resize);panel.style.height='';panel.style.top='';panel.style.bottom=''}
  },[open])
  function saveDraft() {
    const text=draft.trim()
    if(!text)return
    setMessages(previous=>[...previous,{id:Date.now(),text,time:new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}])
    setDraft('')
    const input=mainRef.current?.querySelector('textarea')
    if(input)input.style.height='46px'
  }
  return <PushViewShell open={open} title="Поддержка" subtitle="WPay" scrollContent={false} zClass="z-[12000]" onClose={onClose}>
    <main ref={mainRef} className="wpay-support-chat mx-auto flex min-h-0 w-full max-w-[560px] flex-1 flex-col">
      <div className="support-thread min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" role="log" aria-label="Переписка с поддержкой" aria-live="polite">
        <div className="support-contact mt-4 flex items-center gap-3 rounded-[24px] bg-white p-4 dark:bg-[#1c1c1e]">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[17px] bg-gradient-to-br from-blue-300 via-blue-500 to-indigo-600 text-white"><QuestionCircleFill className="text-[30px]"/></span>
          <div><h2 className="text-[17px] font-semibold text-black dark:text-white">Команда WPay</h2><p className="mt-0.5 text-[13px] leading-5 text-black/45 dark:text-white/45">Поможем разобраться с кошельком</p></div>
        </div>
        {!messages.length && <div className="support-welcome px-3 pb-5 pt-10"><h3 className="text-[26px] font-semibold tracking-tight text-black dark:text-white">Чем можем помочь?</h3><p className="mt-2 max-w-[290px] text-[15px] leading-6 text-black/45 dark:text-white/45">Выберите тему или опишите вопрос своими словами.</p><div className="mt-5 flex flex-wrap gap-2">{['Пополнение','Оплата по QR','Карты','Другой вопрос'].map(topic=><button key={topic} type="button" className="rounded-full bg-white px-4 py-2.5 text-[14px] font-medium text-primary dark:bg-[#1c1c1e]" onClick={()=>{setDraft(`Вопрос: ${topic.toLowerCase()}. `);mainRef.current?.querySelector('textarea')?.focus()}}>{topic}</button>)}</div></div>}
        <Messages init={false} aria-label="Сообщения поддержки">
          {messages.length>0 && <div className="messages-title"><span>Сегодня</span></div>}
          {messages.map(message=><Message key={message.id} type="sent" text={message.text} first last tail footer={`${message.time} · Не отправлено`}/>)}
          <div ref={endRef}/>
        </Messages>
      </div>
      <div className="support-compose shrink-0 px-4 pt-3">
        <p className="mb-3 text-center text-[12px] leading-4 text-black/45 dark:text-white/45" role="status">Операторы пока не подключены · режим черновика</p>
        <Messagebar init={false} resizable={false} value={draft} placeholder="Сообщение…" onInput={event=>{setDraft(event.target.value);event.target.style.height='0px';event.target.style.height=`${Math.max(46,Math.min(120,event.target.scrollHeight+2))}px`}}>
          <button slot="inner-end" type="button" aria-label="Сохранить черновик обращения" disabled={!draft.trim()} onClick={saveDraft} className="support-send flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-30"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
        </Messagebar>
      </div>
    </main>
  </PushViewShell>
}

function CurrencySkeletonRow({ rubles = false }: { rubles?: boolean }) {
  const block = 'animate-pulse motion-reduce:animate-none rounded-full bg-black/[.07] dark:bg-white/[.09]'
  return <ListItem chevron={false} contentClassName="!h-[64px]" innerClassName="!min-w-0 !h-[64px] !py-2 after:!opacity-30" media={<span className={`block h-11 w-11 shrink-0 ${block}`}/>} innerChildren={
    <span className="flex h-full w-full min-w-0 items-center justify-between gap-3" aria-hidden="true">
      <span className="min-w-0"><span className={`block h-3.5 w-24 max-w-full ${block}`}/><span className={`mt-2 block h-3 w-16 max-w-full ${block}`}/></span>
      <span className="shrink-0"><span className={`ml-auto block h-3.5 w-14 ${block}`}/>{!rubles && <span className={`ml-auto mt-2 block h-3 w-11 ${block}`}/>}</span>
    </span>
  }/>
}

function WalletSkeleton() {
  return <List strong inset dividers className="!mt-0 overflow-hidden !rounded-[32px] [&>ul]:!rounded-[32px]" aria-label="Загрузка криптовалют" aria-busy="true">
    {assets.map(asset => <CurrencySkeletonRow key={asset.code}/>)}
  </List>
}
