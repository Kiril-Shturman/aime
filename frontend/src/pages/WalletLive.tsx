import ArrowDownCircleFill from 'framework7-icons/react/esm/ArrowDownCircleFill.js'
import Qrcode from 'framework7-icons/react/esm/Qrcode.js'
import Clock from 'framework7-icons/react/esm/Clock.js'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'react-qr-code'
import { Button, Card, Navbar, Link as KLink, Preloader, List, ListItem } from 'konsta/react'
import { getMarketUsdRates } from '../lib/market-data'
import { tg } from '../lib/telegram'
import { walletRequest, WalletApiError, type Deposit, type QrQuote, type WalletOverview } from '../lib/wallet-api'

const supportedDepositNetworks: Record<string,string[]> = {USDT:['BSC','ETH','TON','SOL','TRON'],ETH:['ETH'],BNB:['BSC'],TON:['TON'],SOL:['SOL']}
const empty: WalletOverview = { balances: [], rates: [], transactions: [] }
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
export const usdPrice = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 6 : n < 10 ? 4 : 2 })
export const cryptoAmount = (n: string | number) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 8 })
interface WalletContextValue {
  data: WalletOverview; ready: boolean; configured: boolean; loading: boolean; error: string
  refresh: (sync?: boolean) => Promise<void>; balance: (asset: string) => string; rate: (asset: string) => number | null; total: number
}
const WalletContext = createContext<WalletContextValue | null>(null)
export function useLiveWallet() { const value = useContext(WalletContext); if (!value) throw Error('Wallet provider missing'); return value }
export function WalletLiveProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState(empty), [ready, setReady] = useState(false), [configured, setConfigured] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [marketRates,setMarketRates] = useState<Record<string,number>>({})
  const marketRequest=useRef<AbortController|null>(null)
  const refreshMarket=useCallback(async()=>{
    if(marketRequest.current)return
    const controller=new AbortController();marketRequest.current=controller
    try {const rates=await getMarketUsdRates(controller.signal);if(!controller.signal.aborted)setMarketRates(previous=>({...previous,...rates}))} catch { /* Keep the last quote on a temporary market-data failure. */ }
    finally {if(marketRequest.current===controller)marketRequest.current=null}
  },[])
  useEffect(()=>{
    const update=()=>{if(document.visibilityState==='visible')void refreshMarket()}
    const timer=window.setInterval(update,60000)
    document.addEventListener('visibilitychange',update)
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',update);marketRequest.current?.abort();marketRequest.current=null}
  },[refreshMarket])
  const refresh = useCallback(async (sync = false) => {
    void refreshMarket()
    setLoading(true)
    try {
      const status = await walletRequest<{ configured: boolean }>('status')
      setConfigured(status.configured)
      if (!status.configured) { setReady(false); setError('Пополнения ещё не подключены. Ожидается настройка GoSwap.'); return }
      if (sync) await walletRequest('sync', {})
      setData(await walletRequest<WalletOverview>('overview')); setReady(true); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось обновить кошелёк') }
    finally { setLoading(false) }
  }, [refreshMarket])
  useEffect(() => { void refresh() }, [refresh])
  const balance = useCallback((asset: string) => data.balances.find(x => x.asset === asset)?.available ?? '0', [data])
  const rate = useCallback((asset: string) => {
    if (marketRates[asset] !== undefined) return marketRates[asset]
    if (asset === 'USDT' || asset === 'USDC') return 1
    const entry = data.rates.find(x => x.source === asset && x.target === 'USD' && x.is_valid)
    return entry ? Number(entry.rate) : null
  }, [data, marketRates])
  const total = useMemo(() => data.balances.reduce((sum, x) => sum + Number(x.available) * (rate(x.asset) ?? 0), 0), [data, rate])
  return <WalletContext.Provider value={{ data, ready, configured, loading, error, refresh, balance, rate, total }}>{children}</WalletContext.Provider>
}
export function WalletConnectionNote() { const wallet = useLiveWallet(); return <p role="status" className="mx-auto my-5 max-w-[420px] px-5 text-center text-[13px] leading-relaxed text-black/45 dark:text-white/45">{wallet.error || 'Баланс и операции обновляются через GoSwap.'}</p> }

export function LiveDepositPanel({ defaultAsset = 'USDT' }: { defaultAsset?: string }) {
  const wallet = useLiveWallet()
  const [asset, setAsset] = useState(supportedDepositNetworks[defaultAsset] ? defaultAsset : 'USDT'), [network, setNetwork] = useState('BSC'), [amount, setAmount] = useState(''), [deposit, setDeposit] = useState<Deposit | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [currencies, setCurrencies] = useState<string[]>(['USDT'])
  useEffect(() => { if (wallet.configured) walletRequest<{ code: string }[]>('currencies').then(rows => setCurrencies(rows.map(x => x.code).filter(code => supportedDepositNetworks[code]))).catch(() => {}) }, [wallet.configured])
  useEffect(() => { setDeposit(null); setError('') }, [asset, network, amount])
  useEffect(() => { setAsset(supportedDepositNetworks[defaultAsset] ? defaultAsset : 'USDT') }, [defaultAsset])
  useEffect(() => { if (!supportedDepositNetworks[asset]?.includes(network)) setNetwork(supportedDepositNetworks[asset]?.[0] ?? 'BSC') }, [asset, network])
  async function createDeposit() {
    setBusy(true); setError('')
    try { setDeposit(await walletRequest<Deposit>('deposit', { asset, network, ...(network === 'TRON' ? { amount: amount.replace(',', '.') } : {}) })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось получить реквизиты') }
    finally { setBusy(false) }
  }
  function openProvider() {
    const raw = deposit?.mini_app_url || deposit?.url
    if (!raw) return
    try {
      const url = new URL(raw)
      if (url.protocol !== 'https:' || !['t.me', 'goswap.site'].includes(url.hostname)) throw Error()
      if (url.hostname === 't.me' && tg()?.openTelegramLink) tg()?.openTelegramLink?.(raw)
      else if (tg()?.openLink) tg()?.openLink?.(raw)
      else window.open(raw, '_blank', 'noopener,noreferrer')
    } catch { setError('Не удалось открыть платёжное окно') }
  }
  return <main className="mx-auto w-full max-w-[560px] space-y-4 px-4 py-5">
    <Card className="!m-0 !rounded-[30px]" contentWrapPadding="p-4">
      <label className="block text-[14px] text-black/60 dark:text-white/60">Валюта
        <select aria-label="Валюта пополнения" value={asset} onChange={e => setAsset(e.target.value)} className="mt-2 block w-full rounded-[18px] bg-black/5 p-3 text-[17px] text-black dark:bg-white/10 dark:text-white">
          {[...new Set([asset, ...currencies])].map(code => <option key={code}>{code}</option>)}
        </select>
      </label>
      <label className="mt-4 block text-[14px] text-black/60 dark:text-white/60">Сеть
        <select aria-label="Сеть пополнения" value={network} onChange={e => setNetwork(e.target.value)} className="mt-2 block w-full rounded-[18px] bg-black/5 p-3 text-[17px] text-black dark:bg-white/10 dark:text-white">
          {(supportedDepositNetworks[asset] ?? []).map(code => <option key={code}>{code}</option>)}
        </select>
      </label>
      {network === 'TRON' && <label className="mt-4 block text-[14px] text-black/60 dark:text-white/60">Сумма USDT<input aria-label="Сумма пополнения USDT" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Например, 100" className="mt-2 block w-full rounded-[18px] bg-black/5 p-3 text-[20px] text-black dark:bg-white/10 dark:text-white"/></label>}
    </Card>
    <p className="text-[13px] leading-relaxed text-black/50 dark:text-white/50">{network === 'TRON' ? 'Для TRON нужна заявка с точной суммой. Отправьте именно сумму из ответа до окончания срока.' : 'GoSwap откроет окно с адресом, QR-кодом и условиями выбранной сети. Отправляйте только указанную валюту в выбранной сети.'}</p>
    <Button rounded large disabled={!wallet.configured || busy || (network === 'TRON' && !amount)} onClick={() => void createDeposit()} className="!m-0 !w-full">{busy ? 'Получаем реквизиты…' : 'Получить реквизиты'}</Button>
    {(error || (!wallet.configured && wallet.error)) && <p role="alert" className="text-[14px] leading-relaxed text-red-500">{error || wallet.error}</p>}
    {deposit && <Card className="!m-0 !rounded-[30px]" contentWrapPadding="p-4">
      {deposit.address && <><div className="mx-auto w-fit rounded-2xl bg-white p-3"><QRCode value={deposit.address} size={168}/></div><p className="mt-4 break-all font-mono text-[13px] text-black dark:text-white">{deposit.address}</p><Button rounded tonal onClick={() => void navigator.clipboard.writeText(deposit.address!)}>Скопировать адрес</Button></>}
      {deposit.amount && <p className="mt-4 text-[22px] font-semibold text-black dark:text-white">Точно {deposit.amount} USDT</p>}
      {deposit.expires_at && <p className="text-[13px] text-black/50 dark:text-white/50">Отправить до {new Date(deposit.expires_at).toLocaleTimeString('ru-RU')}</p>}
      {(deposit.url || deposit.mini_app_url) && <Button rounded large onClick={openProvider} className="!mt-4 !w-full">Открыть окно GoSwap</Button>}
      <Button rounded tonal onClick={() => void wallet.refresh(true)} className="!mt-3 !w-full">Проверить зачисление</Button>
    </Card>}
    <p className="text-center text-[12px] text-black/40 dark:text-white/40">Ввод рублей пока не подключён: для него нет опубликованного метода API.</p>
  </main>
}

export function LiveHistory() {
  const wallet = useLiveWallet(), [filter, setFilter] = useState('all'), [query, setQuery] = useState('')
  const items = wallet.data.transactions.filter(x => (filter === 'all' || (filter === 'income' ? Number(x.amount) > 0 : x.type.startsWith('qr_'))) && `${x.asset} ${x.type} ${x.detail.merchant_name ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  const groups = new Map<string, typeof items>()
  for (const item of [...items].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))) {
    const date = new Date(item.created_at).toLocaleDateString('ru-RU', {day:'numeric',month:'long',year:'numeric'})
    groups.set(date,[...(groups.get(date) ?? []),item])
  }
  return <main className="mx-auto w-full max-w-[560px] pb-6 pt-5">
    <div className="px-4">
      <input aria-label="Поиск операций" placeholder="Поиск операций" value={query} onChange={e=>setQuery(e.target.value)} className="h-12 w-full rounded-[22px] bg-black/5 px-4 text-[17px] text-black outline-none focus-visible:ring-2 focus-visible:ring-primary dark:bg-white/10 dark:text-white"/>
      <div className="mt-4 flex gap-1 rounded-[22px] bg-black/5 p-1 dark:bg-white/10" aria-label="Фильтр операций">
        {[['all','Все'],['income','Пополнения'],['expense','Платежи']].map(([id,label])=><button key={id} type="button" aria-pressed={filter===id} onClick={()=>setFilter(id)} className={`min-h-11 min-w-0 flex-1 rounded-[18px] px-2 text-[15px] font-medium transition-colors ${filter===id?'bg-white text-black shadow-sm dark:bg-[#2c2c2e] dark:text-white':'text-black/50 dark:text-white/50'}`}>{label}</button>)}
      </div>
    </div>
    {[...groups].map(([date,transactions])=><section key={date} aria-label={date}>
      <h2 className="mb-2 mt-7 px-4 text-[21px] font-semibold tracking-tight text-black dark:text-white">{date}</h2>
      <List strong inset dividers className="!mt-0 overflow-hidden !rounded-[32px] [&>ul]:!rounded-[32px]">
        {transactions.map(item=>{
          const income=Number(item.amount)>0
          const failed=item.type==='qr_failed'
          const Icon=income?ArrowDownCircleFill:Qrcode
          const title=item.type==='deposit'?'Пополнение':item.type==='qr_refunded'?'Возврат QR':failed?'Платёж не прошёл':String(item.detail.merchant_name||'Оплата QR')
          return <ListItem key={item.event_id} chevron={false} contentClassName="!h-16" innerClassName="!min-w-0 !h-16 !py-2 after:!opacity-30" media={<span className={`wpay-currency-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${failed?'bg-gradient-to-b from-orange-300 to-orange-500 dark:from-orange-400 dark:to-orange-600':income?'bg-gradient-to-b from-green-300 to-green-500 dark:from-green-400 dark:to-green-600':'bg-gradient-to-b from-blue-300 to-blue-500 dark:from-blue-400 dark:to-blue-600'}`}><Icon className="text-[23px]"/></span>} innerChildren={<span className="flex h-full min-w-0 items-center justify-between gap-3"><span className="min-w-0"><span className="block truncate text-[17px] font-semibold leading-6 text-black dark:text-white">{title}</span><span className="mt-0.5 block text-[14px] leading-5 text-black/45 dark:text-white/45">{new Date(item.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})} · {item.asset}</span></span><span className="shrink-0 text-right"><span className={`block text-[16px] font-medium leading-6 tabular-nums ${income?'text-green-600 dark:text-green-400':'text-black dark:text-white'}`}>{income?'+':''}{cryptoAmount(item.amount)}</span><span className="block text-[12px] leading-5 text-black/40 dark:text-white/40">{item.asset}</span></span></span>}/>
        })}
      </List>
    </section>)}
    {!items.length && <div className="mx-4 mt-7 rounded-[32px] bg-white px-6 py-10 text-center dark:bg-[#1c1c1e]" role="status"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-b from-blue-300 to-blue-500 text-white dark:from-blue-400 dark:to-blue-600"><Clock className="text-[28px]"/></span><h2 className="mt-4 text-[21px] font-semibold text-black dark:text-white">{query||filter!=='all'?'Ничего не найдено':'Операций пока нет'}</h2><p className="mt-2 text-[15px] leading-relaxed text-black/45 dark:text-white/45">{query||filter!=='all'?'Попробуйте изменить поиск или фильтр.':wallet.ready?'Здесь появятся ваши пополнения и платежи.':wallet.loading?'Загружаем историю…':wallet.error}</p></div>}
    <div className="mt-5 px-4"><Button rounded tonal disabled={wallet.loading} className="!m-0 !h-12 !w-full !rounded-[22px]" onClick={()=>void wallet.refresh(true)}>{wallet.loading?'Обновляем…':'Обновить историю'}</Button></div>
  </main>
}

export function LiveQrPanel({ initialQr, onClose }: { initialQr: string; onClose: () => void }) {
  const wallet = useLiveWallet(), [qr, setQr] = useState(initialQr), [quote, setQuote] = useState<QrQuote | null>(null), [status, setStatus] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [clock, setClock] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => { if (status !== 'processing' && status !== 'reserved') return; const timer = window.setInterval(() => void wallet.refresh(), 5000); return () => clearInterval(timer) }, [status, wallet.refresh])
  useEffect(() => { const item = wallet.data.transactions.find(x => x.detail.spend_id === quote?.spend_id); if (item) setStatus(item.type.replace('qr_', '')) }, [wallet.data, quote])
  const expired = quote ? new Date(quote.expires_at).getTime() <= clock : false
  async function getQuote() { setBusy(true); setError(''); try { setQuote(await walletRequest<QrQuote>('quote', { qr })); setStatus('') } catch(e) { setError(e instanceof Error ? e.message : 'Ошибка котировки') } finally { setBusy(false) } }
  async function pay() { if (!quote) return; setBusy(true); setError(''); try { const payment = await walletRequest<{status: string}>('pay', {quote_id: quote.quote_id}); setStatus(payment.status); await wallet.refresh() } catch(e) { if (!(e instanceof WalletApiError) || !['INSUFFICIENT_FUNDS','QUOTE_EXPIRED','QUOTE_NOT_FOUND','AUTH_REQUIRED','NOT_CONFIGURED','INVALID_REQUEST'].includes(e.code)) setStatus('reserved'); setError(e instanceof Error ? e.message : 'Проверьте статус платежа') } finally { setBusy(false) } }
  const statuses: Record<string,string> = {processing:'Платёж обрабатывается',reserved:'Проверяем статус платежа',completed:'Оплата выполнена',failed:'Платёж не прошёл, резерв возвращён',refunded:'Платёж отменён, средства возвращены'}
  return createPortal(<section className="wpay-viewport fixed inset-0 z-[90] flex flex-col bg-[#efeff4] dark:bg-black"><Navbar title="Оплата СБП QR" left={<KLink onClick={onClose}>Закрыть</KLink>}/><main className="mx-auto w-full max-w-[560px] flex-1 space-y-4 overflow-y-auto px-4 py-5"><p className="text-[14px] leading-relaxed text-black/50 dark:text-white/50">Оплата в рублях со списанием USDT. Сначала проверьте сумму и получателя.</p><textarea aria-label="Строка платёжного QR" value={qr} disabled={!!status} onChange={e => {setQr(e.target.value);setQuote(null)}} placeholder="https://qr.nspk.ru/… или ST00012|…" className="min-h-28 w-full rounded-2xl bg-white p-4 text-[15px] text-black dark:bg-white/10 dark:text-white"/><Button rounded large disabled={!wallet.configured || busy || !qr || !!status} onClick={() => void getQuote()} className="!w-full">{busy ? <Preloader/> : 'Узнать сумму'}</Button>{quote && <Card className="!m-0" contentWrapPadding="p-5"><p className="text-[14px] text-black/50 dark:text-white/50">Получатель</p><b className="mt-1 block text-[20px] text-black dark:text-white">{quote.merchant_name || 'Не указан'}</b><p className="mt-5 text-[28px] text-black dark:text-white">{quote.amount_rub} ₽</p><p className="text-[16px] text-black/60 dark:text-white/60">Спишется {quote.amount} {quote.asset}</p><p className="mt-3 text-[13px] text-black/45 dark:text-white/45">{expired ? 'Котировка истекла' : `Действует до ${new Date(quote.expires_at).toLocaleTimeString('ru-RU')}`}</p>{!status && <Button rounded large disabled={busy || expired} onClick={() => void pay()} className="!mt-4 !w-full">Подтвердить оплату</Button>}</Card>}{status && <p role="status" className="text-center text-[18px] text-black dark:text-white">{statuses[status] || status}</p>}{status === 'reserved' && <Button rounded tonal disabled={busy} onClick={() => void pay()} className="!w-full">Повторить запрос с тем же номером</Button>}{(error || !wallet.configured) && <p role="alert" className="text-[14px] leading-relaxed text-red-500">{error || wallet.error}</p>}</main></section>, document.querySelector('.k-app') ?? document.body)
}
export { usd }
