import { useRef, useState, type ReactNode } from 'react'
import { Button, Card, List, ListItem, Popover } from 'konsta/react'
import Ellipsis from 'framework7-icons/react/esm/Ellipsis.js'
import ArrowUpCircleFill from 'framework7-icons/react/esm/ArrowUpCircleFill.js'
import WalletMarketChart, { chartPeriods } from './WalletMarketChart'
import { cryptoAmount, usd, useLiveWallet } from './WalletLive'

const descriptions: Record<string, {title:string; text:string}> = {
  USDT: {title:'Что такое Доллары?',text:'В кошельке доллары представлены токеном USDT (Tether). Это цифровой актив, ориентированный на стоимость доллара США. Баланс хранится в USDT; при пополнении важно выбрать правильную сеть.'},
  TRX: {title:'Что такое TRON?',text:'TRX — основная криптовалюта сети TRON. Она используется для переводов и операций в этой сети. Реквизиты и доступность пополнения зависят от подключённого провайдера.'},
  BNB: {title:'Что такое BNB?',text:'BNB — криптовалюта экосистемы BNB Chain. Используется для переводов и оплаты сетевых комиссий. При отправке нужно сверить сеть с реквизитами получателя.'},
  ETH: {title:'Что такое Ethereum?',text:'ETH — основная криптовалюта Ethereum, сети для переводов и приложений на смарт-контрактах. Для пополнения используйте сеть, указанную в реквизитах.'},
  GRAM: {title:'Что такое Gram?',text:'GRAM — цифровой актив в вашем кошельке. Доступные сети, способы пополнения и условия операций показываются при подключении провайдера. Перед переводом сверяйте тикер актива и сеть.'},
  SOL: {title:'Что такое Solana?',text:'SOL — основная криптовалюта сети Solana. Используется для переводов и оплаты операций в сети. Пополняйте баланс только по реквизитам выбранной сети.'},
  BTC: {title:'Что такое Bitcoin?',text:'BTC — криптовалюта сети Bitcoin. Переводы записываются в блокчейн и подтверждаются участниками сети. Перед отправкой проверяйте адрес и выбранную сеть.'},
  XAUT: {title:'Что такое GOLD (XAUT)?',text:'XAUT (Tether Gold) — цифровой токен, связанный с золотом. Его стоимость выражается отдельно от долларового баланса. Сети и доступные операции зависят от программы провайдера.'},
}

export default function WalletAssetPanel({ code, name, icon, color, iconColor, onDeposit, onWithdraw, onExchange, active = true }: {
  code: string; name: string; icon: ReactNode; color: string; iconColor: string; active?: boolean
  onDeposit: () => void; onWithdraw: () => void; onExchange: () => void
}) {
  const wallet = useLiveWallet()
  const [more, setMore] = useState(false), [allHistory, setAllHistory] = useState(false)
  const moreTarget = useRef<HTMLElement | null>(null)
  const transactions = wallet.data.transactions.filter(item => item.asset === code)
  const about = descriptions[code] ?? {title:`Что такое ${name}?`,text:'Цифровой актив в вашем кошельке.'}
  const displayName = code === 'USDT' ? 'Доллары' : name
  const [period, setPeriod] = useState(3)
  const rate = wallet.rate(code), balance = wallet.balance(code)
  const reserved = wallet.data.balances.find(item => item.asset === code)?.reserved ?? '0'
  return <main className="mx-auto w-full max-w-[560px] bg-[#efeff4] pb-0 dark:bg-black">
    <Card className="!mx-0 !mb-0 !mt-0 !rounded-none !shadow-none !bg-white dark:!bg-[#1c1c1e]" contentWrapPadding="px-5 pb-5 pt-4">
      <div className="flex min-h-[33px] items-end justify-between gap-4 pt-0">
        <h2 className="min-w-0 text-[17px] font-semibold text-black dark:text-white">{displayName}</h2>

      </div>
      <WalletMarketChart code={code} period={period} active={active} icon={<span aria-label={`Иконка ${code}`} className="wpay-currency-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-full [&>svg]:!h-7 [&>svg]:!w-7" style={{color:iconColor,backgroundColor:color,backgroundImage:`linear-gradient(180deg,color-mix(in srgb, ${color} 62%, white),${color} 70%,color-mix(in srgb, ${color} 88%,black))`}}>{icon}</span>}/>
      <div role="group" aria-label="Период графика" className="mt-4 grid grid-cols-5 gap-1 rounded-full bg-black/[.035] p-1 dark:bg-white/[.06]">
        {chartPeriods.map(({label},i)=><Button key={label} inline clear rounded aria-pressed={period===i} onClick={()=>setPeriod(i)} className={`!m-0 !h-8 !w-full !px-1 !text-[13px] !font-medium ${period===i?'!bg-white !text-black !shadow-sm dark:!bg-white/15 dark:!text-white':'!text-black/65 dark:!text-white/65'}`}>{label}</Button>)}
      </div>
    </Card>
    <section className="px-4 pb-3 pt-6">
      <h3 className="mb-3 px-2 text-[16px] font-semibold text-black/50 dark:text-white/50">Ваш портфель</h3>
      <Card className="!m-0 !rounded-[30px]" contentWrapPadding="p-5">
        <p className="text-[29px] font-semibold tracking-tight tabular-nums text-black dark:text-white">{wallet.ready && rate !== null ? usd(Number(balance)*rate) : '—'}</p>
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-black/[.06] pt-4 dark:border-white/[.08]"><span className="text-[14px] text-black/45 dark:text-white/45">Доступно</span><span className="text-[16px] font-medium tabular-nums text-black dark:text-white">{wallet.ready?cryptoAmount(balance):'—'} {code}</span></div>
        {Number(reserved)>0 && <p className="mt-2 text-right text-[12px] text-black/40 dark:text-white/40">В резерве {cryptoAmount(reserved)} {code}</p>}
      </Card>
    </section>
    <section className="px-4 pb-3 pt-4">
      <h3 className="mb-3 px-2 text-[16px] font-semibold text-black/50 dark:text-white/50">История транзакций</h3>
      <Card className="!m-0 !rounded-[30px]" contentWrapPadding="p-5">
        {!transactions.length && <p className="py-3 text-center text-[14px] text-black/45 dark:text-white/45">Операций в {code} пока нет</p>}
        {(allHistory?transactions:transactions.slice(0,3)).map(item=><div key={item.event_id} className="flex items-center justify-between gap-3 border-b border-black/[.06] py-3 first:pt-0 last:border-0 last:pb-0 dark:border-white/[.08]"><span className="min-w-0"><span className="block truncate text-[15px] font-medium text-black dark:text-white">{item.type==='deposit'?'Пополнение':item.type==='qr_refunded'?'Возврат':item.type==='qr_failed'?'Платёж не прошёл':String(item.detail.merchant_name || 'QR-оплата')}</span><span className="mt-1 block text-[12px] text-black/40 dark:text-white/40">{new Date(item.created_at).toLocaleDateString('ru-RU')}</span></span><span className="shrink-0 text-[14px] font-medium tabular-nums text-black dark:text-white">{Number(item.amount)>0?'+':''}{cryptoAmount(item.amount)} {code}</span></div>)}
        {transactions.length>3 && <Button clear rounded className="!mt-3 !w-full" onClick={()=>setAllHistory(value=>!value)}>{allHistory?'Свернуть':'Все транзакции'}</Button>}
      </Card>
    </section>
    <section className="px-4 pb-5 pt-4">
      <h3 className="mb-3 px-2 text-[16px] font-semibold text-black/50 dark:text-white/50">{about.title}</h3>
      <Card className="!m-0 !rounded-[30px]" contentWrapPadding="p-5"><p className="text-[15px] leading-relaxed text-black/65 dark:text-white/65">{about.text}</p></Card>
    </section>
    <div className="wpay-asset-actions pointer-events-none sticky bottom-0 z-10 grid grid-cols-[1fr_1fr_48px] gap-2 bg-transparent px-4 pt-3 dark:bg-transparent [&>button]:pointer-events-auto [&>span]:pointer-events-auto">
      <Button rounded large onClick={onDeposit} className="!px-2 !text-[15px]">Пополнить</Button><Button rounded large onClick={onExchange} className="!px-2 !text-[15px]">Обменять</Button><span ref={moreTarget}><Button rounded large tonal aria-label="Ещё действия" onClick={()=>setMore(true)} className="!w-12 !bg-[#d4e6fb] !px-0 dark:!bg-[#19334f]"><Ellipsis className="text-[24px]"/></Button></span>
    </div>
    <Popover opened={more} target={moreTarget} onBackdropClick={()=>setMore(false)} className="!z-[100] !w-64"><List nested className="!my-0"><ListItem link title="Вывести" media={<ArrowUpCircleFill className="text-[22px] text-primary"/>} onClick={()=>{setMore(false);onWithdraw()}}/></List></Popover>
  </main>
}
