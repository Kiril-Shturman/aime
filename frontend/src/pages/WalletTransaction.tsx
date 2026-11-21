import { useState } from 'react'
import { List, ListItem } from 'konsta/react'
import { Popup, Page, Navbar, NavRight, Link } from 'framework7-react'
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, QrCode, CreditCard, Gift, Ticket, Copy, Check, Clock, X, RotateCcw, SlidersHorizontal, ReceiptText } from 'lucide-react'
import type { WalletTransaction } from '../lib/wallet-api'

type Kind = 'deposit'|'ruble_deposit'|'withdrawal'|'transfer'|'check'|'exchange'|'qr'|'card_payment'|'card_topup'|'card_issue'|'refund'|'referral'|'adjustment'|'other'
type Status = 'completed'|'processing'|'failed'|'refunded'
export interface TransactionView { id:string; kind:Kind; status:Status; amount:string; asset:string; date:string; rows:[string,string][]; demo?:boolean }
const kinds = {
  deposit: {title:'Пополнение криптовалютой',icon:ArrowDownLeft}, ruble_deposit:{title:'Пополнение рублями',icon:ArrowDownLeft},
  withdrawal:{title:'Вывод криптовалюты',icon:ArrowUpRight}, transfer:{title:'Перевод пользователю',icon:ArrowUpRight}, check:{title:'Крипточек',icon:Ticket},
  exchange:{title:'Обмен валют',icon:ArrowLeftRight}, qr:{title:'Оплата по QR-коду',icon:QrCode}, card_payment:{title:'Покупка картой',icon:CreditCard},
  adjustment:{title:'Корректировка баланса',icon:SlidersHorizontal}, other:{title:'Операция',icon:ReceiptText},
  card_topup:{title:'Пополнение карты',icon:CreditCard}, card_issue:{title:'Выпуск карты',icon:CreditCard}, refund:{title:'Возврат средств',icon:RotateCcw}, referral:{title:'Реферальное начисление',icon:Gift},
}
const statuses = {completed:{label:'Выполнено',icon:Check},processing:{label:'В обработке',icon:Clock},failed:{label:'Не выполнено',icon:X},refunded:{label:'Возвращено',icon:RotateCcw}}
const incoming = (kind:Kind)=>['deposit','ruble_deposit','refund','referral'].includes(kind)
const number = (value:string)=>Number(value).toLocaleString('en-US',{maximumFractionDigits:8})
function transactionKind(type: string): Kind {
  if (type.startsWith('withdrawal_') || type === 'withdrawal') return 'withdrawal'
  if (type.startsWith('qr_')) return 'qr'
  if (type.startsWith('transfer')) return 'transfer'
  if (type === 'admin_adjustment' || type === 'adjustment') return 'adjustment'
  if (type === 'card_issue_refund' || type === 'deposit_return') return 'refund'
  if (type === 'deposit' || type === 'card_issue' || type === 'card_topup' || type === 'card_payment') return type
  return 'other'
}

export function transactionListPresentation(item: WalletTransaction) {
  const kind = transactionKind(item.type)
  const title = item.type === 'qr_failed' ? 'Платёж не прошёл'
    : item.type === 'qr_refunded' ? 'Возврат QR'
    : kind === 'qr' ? String(item.detail.merchant_name || 'Оплата QR')
    : item.type === 'card_issue_refund' ? 'Возврат за выпуск карты'
    : item.type === 'deposit_return' ? 'Возврат пополнения'
    : item.type === 'withdrawal_failed' ? 'Вывод не выполнен'
    : kind === 'deposit' ? 'Пополнение'
    : kinds[kind].title
  return { title, icon: kinds[kind].icon }
}

export function transactionFromApi(item:WalletTransaction):TransactionView {
  const d=item.detail
  const kind = transactionKind(item.type)
  const status: Status = item.type === 'withdrawal_failed' || item.type === 'qr_failed' ||
    (item.type === 'card_topup' && d.status === 'failed') ? 'failed'
    : item.type === 'qr_refunded' ? 'refunded'
    : item.type === 'qr_processing' || (['card_issue','card_topup'].includes(item.type) && d.status === 'processing')
      || (kind === 'withdrawal' && ['processing', 'broadcast'].includes(String(d.status))) ? 'processing'
    : 'completed'
  const rows:[string,string][]=[]
  for(const [label,key] of [['Получатель','merchant_name'],['Сумма покупки, ₽','amount_rub'],['Сеть','network'],['Адрес','address'],['Хеш транзакции','tx_hash'],['Курс, ₽ за 1 USDT','rate'],['Номер платежа','payment_id'],['Ваш номер платежа','spend_id'],['Причина','failure_reason']] as const) {
    if(d[key]!==undefined&&d[key]!==null&&d[key]!=='') rows.push([label,String(d[key])])
  }
  for (const [label,key] of [['Карта','card'],['На карту, USDT','card_credit'],['Номер операции','operation_id'],['Тариф','plan'],['Комиссия провайдера, USDT','provider_fee'],['Комиссия wPay, USDT','service_fee'],['Основание','reason']] as const) { if(d[key]!==undefined&&d[key]!==null&&d[key]!=='') rows.push([label,String(d[key])]) }
  if (kind === 'withdrawal') {
    if (d.recipient && !d.address) rows.push(['Адрес получателя', String(d.recipient)])
    if (d.transaction_hash && !d.tx_hash) rows.push(['Хеш транзакции', String(d.transaction_hash)])
    if (d.fee != null) rows.push(['Комиссия', `${d.fee} ${item.asset}`])
  }
  return {id:item.event_id,kind,status,amount:status==='failed'?'0':item.amount,asset:item.asset,date:item.created_at,rows}
}
const examples:TransactionView[] = [
  ['deposit','150','USDT',[['Сеть','TRON · TRC20'],['Отправитель','Внешний кошелёк']]],
  ['ruble_deposit','10000','RUB',[['Способ','СБП'],['Банк','Банк отправителя']]],
  ['withdrawal','-50','USDT',[['Сеть','TRON · TRC20'],['Получатель','Внешний кошелёк'],['Комиссия сети','1 USDT']]],
  ['transfer','-25','USDT',[['Получатель','@username'],['Комментарий','За ужин']]],
  ['check','-10','USDT',[['Получатель','Предъявитель чека'],['Состояние чека','Активирован']]],
  ['exchange','-100','USDT',[['Получено','0.0011 BTC'],['Курс','1 BTC = 90,909.09 USDT'],['Комиссия','Включена в курс']]],
  ['qr','-9.13','USDT',[['Получатель','Кофейня'],['Сумма покупки','700 ₽'],['Курс','76.67 ₽ за 1 USDT']]],
  ['card_payment','-20','USD',[['Магазин','OpenAI'],['Карта','Visa · •• 0001'],['Категория','Подписки']]],
  ['card_topup','100','USD',[['Карта','Visa · •• 0001'],['Списано с кошелька','100 USDT']]],
  ['card_issue','-5','USD',[['Карта','Виртуальная Visa'],['Тариф','Пример тарифа']]],
  ['refund','20','USD',[['Магазин','OpenAI'],['Карта','Visa · •• 0001'],['Основание','Отмена покупки']]],
  ['referral','3','USDT',[['Основание','Комиссия за операции приглашённых'],['Период','Ноябрь 2026']]],
].map((entry,index)=>({id:`example-${index+1}`,kind:entry[0] as Kind,amount:entry[1] as string,asset:entry[2] as string,rows:entry[3] as [string,string][],status:'completed',date:'2026-11-13T09:30:00Z',demo:true}))

export function TransactionDetails({item,onClose}:{item:TransactionView|null;onClose:()=>void}) {
  return <Popup push opened={!!item} className="wpay-profile-popup wpay-card-popup" closeByBackdropClick closeOnEscape swipeToClose="to-bottom" swipeHandler=".navbar" onPopupClosed={onClose}>
    <div className="view"><Page><Navbar transparent><span slot="title">Детали операции</span><NavRight><Link popupClose aria-label="Закрыть детали операции"><i className="icon icon-close"/></Link></NavRight></Navbar>
      {item && <TransactionDetailContent key={item.id} model={item}/>}
    </Page></div>
  </Popup>
}

export function TransactionDetailContent({model}:{model:TransactionView}) {
  const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false)
  const meta=kinds[model.kind], Icon=meta.icon, state=statuses[model.status], StateIcon=state.icon
  const positive=Number(model.amount)>0 || (model.demo && incoming(model.kind))
  const amount=Number(model.amount)
  const date=new Date(model.date)
  async function copy(){try{await navigator.clipboard.writeText(model.id);setCopied(true);setCopyError(false)}catch{setCopyError(true)}}
  return (
      <div className="mx-auto w-full max-w-[560px] px-4 pb-10 pt-5 text-black dark:text-white">
        {model.demo&&<p className="mb-6 text-center text-[13px] font-medium text-black/45 dark:text-white/45">Пример операции · средства не перемещаются</p>}
        <div className="text-center"><span className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full text-white shadow-sm ${positive?'bg-gradient-to-b from-emerald-300 to-emerald-500 dark:from-emerald-400 dark:to-emerald-600':'bg-gradient-to-b from-blue-300 to-blue-500 dark:from-blue-400 dark:to-blue-600'}`}><Icon size={36} strokeWidth={1.8}/></span>
          <h1 className="mt-5 text-[21px] font-semibold tracking-tight">{meta.title}</h1>
          <p className="mt-2 break-words text-[40px] font-semibold leading-tight tracking-tight tabular-nums sm:text-[46px]">{amount!==0?(positive?'+':'−'):''}{number(String(Math.abs(amount)))} <span className="text-[23px] text-black/40 dark:text-white/40">{model.asset}</span></p>
          <span role="status" className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-medium ${model.status==='failed'?'bg-red-500/10 text-red-600 dark:bg-red-400/15 dark:text-red-400':model.status==='processing'?'bg-orange-500/10 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400':'bg-green-500/10 text-green-600 dark:bg-green-400/15 dark:text-green-400'}`}><StateIcon size={15}/>{state.label}</span>
        </div>
        <dl className="mt-8 overflow-hidden rounded-[28px] bg-white px-4 dark:bg-[#1c1c1e]">
          {([['Дата и время',Number.isNaN(date.getTime())?'Не указана':date.toLocaleString('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})],...model.rows] as [string,string][]).map(([label,value],i)=><div key={`${label}-${i}`} className="flex min-h-14 items-center justify-between gap-5 border-b border-black/[.06] py-3 last:border-0 dark:border-white/[.08]"><dt className="max-w-[45%] shrink-0 text-[15px] text-black/45 dark:text-white/45">{label}</dt><dd className="min-w-0 break-words text-right text-[15px] font-medium [overflow-wrap:anywhere]">{value}</dd></div>)}
        </dl>
        <div className="mt-4 rounded-[28px] bg-white p-4 dark:bg-[#1c1c1e]"><p className="text-[13px] text-black/45 dark:text-white/45">ID операции</p><button type="button" onClick={()=>void copy()} className="mt-2 flex min-h-9 w-full items-center justify-between gap-3 text-left text-[14px] text-blue-600 dark:text-blue-400" aria-label="Скопировать ID операции"><span className="min-w-0 break-all">{model.id}</span>{copied?<Check size={19} className="shrink-0"/>:<Copy size={19} className="shrink-0"/>}</button>{copyError&&<p role="alert" className="text-[13px] text-red-600 dark:text-red-400">Не удалось скопировать. Выделите ID вручную.</p>}</div>
        {(model.status==='failed'||model.status==='processing')&&<p className="mt-4 px-3 text-center text-[14px] leading-relaxed text-black/45 dark:text-white/45">{model.status==='failed'?'Платёж не выполнен. Списание по этой операции отсутствует.':'Операция обрабатывается. Дождитесь обновления статуса перед повторной отправкой.'}</p>}
        {model.demo&&<p className="mt-5 px-3 text-center text-[13px] leading-relaxed text-black/40 dark:text-white/40">Данные и тарифы показаны для примера. Доступность операции зависит от подключения провайдера.</p>}
      </div>
  )
}
export function TransactionExamples({onSelect}:{onSelect:(item:TransactionView)=>void}) {
 const [expanded,setExpanded]=useState(false)
 return <section className="mx-4 mt-7"><button type="button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)} className="flex min-h-14 w-full items-center justify-between rounded-[22px] bg-white px-4 text-left text-[16px] font-medium text-blue-600 dark:bg-[#1c1c1e] dark:text-blue-400">Примеры операций <span aria-hidden="true">{expanded?'−':'+'}</span></button>{expanded&&<><p className="px-2 py-3 text-[13px] leading-5 text-black/45 dark:text-white/45">Просмотр дизайна. Это не ваша история операций.</p><List strong inset dividers className="!mx-0 !mt-0 overflow-hidden !rounded-[32px] [&>ul]:!rounded-[32px]">{examples.map(item=>{
 return <TransactionListRow key={item.id} item={item} onSelect={onSelect}/>
 })}</List><div className="mt-3 flex gap-2">{(['processing','failed','refunded'] as const).map(status=><button key={status} type="button" onClick={()=>onSelect({...examples[6],status,amount:status==='failed'?'0':status==='refunded'?'9.13':'-9.13'})} className="min-h-11 flex-1 rounded-2xl bg-white px-2 text-[12px] text-black/60 dark:bg-[#1c1c1e] dark:text-white/60">{statuses[status].label}</button>)}</div></>}</section>
}

export function TransactionListRow({item,onSelect}:{item:TransactionView;onSelect:(item:TransactionView)=>void}) {
 const Icon=kinds[item.kind].icon,positive=incoming(item.kind)
 const context=item.rows.find(([label])=>['Магазин','Получатель','Сеть','Способ','Карта','Получено','Период'].includes(label))?.[1]??'WPay'
 const amount=`${positive?'+':'−'}${number(String(Math.abs(Number(item.amount))))} ${item.asset==='RUB'?'₽':item.asset}`
 return <ListItem link chevron={false} onClick={()=>onSelect(item)} contentClassName="!h-16" innerClassName="!min-w-0 !h-16 !py-2 after:!opacity-30" media={<span className={`wpay-currency-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${positive?'bg-gradient-to-b from-green-300 to-green-500 dark:from-green-400 dark:to-green-600':'bg-gradient-to-b from-blue-300 to-blue-500 dark:from-blue-400 dark:to-blue-600'}`}><Icon size={22}/></span>} innerChildren={<span className="flex h-full min-w-0 items-center justify-between gap-3"><span className="min-w-0"><span className="block truncate text-[17px] font-semibold leading-6 text-black dark:text-white">{kinds[item.kind].title}</span><span className="mt-0.5 block truncate text-[14px] leading-5 text-black/45 dark:text-white/45">{context}{item.demo?' · Демо':''}</span></span><span className={`shrink-0 text-right text-[16px] font-medium tabular-nums ${positive?'text-green-600 dark:text-green-400':'text-black dark:text-white'}`}>{amount}</span></span>}/>
}
