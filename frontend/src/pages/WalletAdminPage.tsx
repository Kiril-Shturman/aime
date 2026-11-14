import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowLeft, Coins, Database, LayoutDashboard, Megaphone, RefreshCw, Search, Send, Server, ShieldCheck, Users } from 'lucide-react'
import { walletRequest } from '../lib/wallet-api'

type Json = Record<string, unknown>
type Tab = 'overview' | 'data' | 'payments' | 'crypto' | 'goswap' | 'broadcasts'
type AdminOverview = { users:number; events:number; liabilities:Json[]; states:Record<string,Record<string,number>>; recent:Json[]; provider:{balance:Json[]} }
type UsersData = { items:Json[]; total:number }
type DatabaseData = { tables:Record<string,number>; table:string; columns:string[]; items:Json[]; offset:number; count:number }
type PaymentsData = Record<'events'|'quotes'|'invoices'|'transfers'|'withdrawals', Json[]>
type CryptoData = { addresses:Json[]; deposits:Json[]; balances:Json[] }
type GoSwapData = Record<string,{ok:boolean;result?:unknown;error?:string;detail?:string}>
type BroadcastData = { items:Json[] }

const card = 'rounded-[22px] border border-black/[.06] bg-white p-4 shadow-sm dark:border-white/[.08] dark:bg-white/[.07]'
const input = 'w-full rounded-2xl border-0 bg-black/[.045] px-4 py-3 text-[15px] outline-none ring-blue-500/40 focus:ring-2 dark:bg-white/[.08]'

function text(value: unknown) { return value === null || value === undefined || value === '' ? '—' : String(value) }
function amount(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number.toLocaleString('ru-RU',{maximumFractionDigits:8}) : text(value) }
function date(value: unknown) { if (!value) return '—'; const parsed = new Date(String(value)); return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('ru-RU') }
function json(value: unknown) { return JSON.stringify(value, null, 2) }
function details(value: unknown, label='Все данные') { return <details className="mt-2"><summary className="cursor-pointer text-xs text-blue-500">{label}</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/[.04] p-3 text-[11px] dark:bg-black/30">{json(value)}</pre></details> }
function stateTotal(value:Record<string,number>|undefined) { return Object.values(value||{}).reduce((sum,item)=>sum+item,0) }

const tabs:{id:Tab;label:string;icon:typeof Database}[] = [
  {id:'overview',label:'Главная',icon:LayoutDashboard}, {id:'data',label:'БД',icon:Database},
  {id:'payments',label:'Оплаты',icon:Activity}, {id:'crypto',label:'Крипта',icon:Coins},
  {id:'goswap',label:'GoSwap',icon:Server}, {id:'broadcasts',label:'Рассылки',icon:Megaphone},
]

export default function WalletAdminPage() {
  const [tab,setTab]=useState<Tab>('overview')
  const [payload,setPayload]=useState<unknown>(null)
  const [payloadTab,setPayloadTab]=useState<Tab|null>(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [table,setTable]=useState('')
  const [query,setQuery]=useState('')

  const load=useCallback(async()=>{
    setLoading(true);setError('')
    try {
      if(tab==='overview') { setPayload(await walletRequest<AdminOverview>('admin-overview'));setPayloadTab(tab) }
      if(tab==='data') {
        const suffix=`?${new URLSearchParams({... (table?{table}:{}),... (query?{q:query}:{})})}`
        const [users,database]=await Promise.all([walletRequest<UsersData>('admin-users'),walletRequest<DatabaseData>(`admin-database${suffix}`)])
        setTable(database.table);setPayload({users,database});setPayloadTab(tab)
      }
      if(tab==='payments') { setPayload(await walletRequest<PaymentsData>('admin-payments'));setPayloadTab(tab) }
      if(tab==='crypto') { setPayload(await walletRequest<CryptoData>('admin-crypto'));setPayloadTab(tab) }
      if(tab==='goswap') { setPayload(await walletRequest<GoSwapData>('admin-goswap'));setPayloadTab(tab) }
      if(tab==='broadcasts') { setPayload(await walletRequest<BroadcastData>('admin-broadcasts'));setPayloadTab(tab) }
    } catch(reason) { setError(reason instanceof Error?reason.message:'Не удалось загрузить данные') }
    finally { setLoading(false) }
  },[tab,table,query])

  useEffect(()=>{void load()},[tab]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(tab==='data'&&payloadTab==='data')void load()},[table,query]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready=payloadTab===tab
  return <main className="min-h-full bg-[radial-gradient(circle_at_85%_0%,rgba(0,122,255,.10),transparent_34%),#f2f2f7] text-[#111] dark:bg-[radial-gradient(circle_at_85%_0%,rgba(10,132,255,.16),transparent_32%),#08090b] dark:text-white">
    <aside className="fixed inset-y-0 left-0 z-50 flex w-[78px] flex-col border-r border-black/[.06] bg-white/85 px-2 pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(14px,env(safe-area-inset-top))] shadow-[8px_0_30px_rgba(0,0,0,.04)] backdrop-blur-2xl sm:w-[220px] sm:px-3 dark:border-white/[.08] dark:bg-[#111216]/88">
      <button onClick={()=>{window.location.href='/wallet'}} className="mb-5 flex h-12 items-center justify-center gap-3 rounded-2xl bg-black/[.045] sm:justify-start sm:px-3 dark:bg-white/[.07]"><ArrowLeft size={20}/><span className="hidden text-sm font-semibold sm:block">В кошелёк</span></button>
      <div className="mb-5 hidden px-3 sm:block"><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.15em] text-emerald-600"><ShieldCheck size={15}/> WPay</div><div className="mt-1 text-xl font-bold">Управление</div></div>
      <nav className="space-y-1.5">{tabs.map(item=><button key={item.id} onClick={()=>setTab(item.id)} className={`flex h-12 w-full items-center justify-center gap-3 rounded-2xl text-sm font-semibold transition sm:justify-start sm:px-3 ${tab===item.id?'bg-blue-500 text-white shadow-lg shadow-blue-500/20':'text-black/50 hover:bg-black/[.04] dark:text-white/55 dark:hover:bg-white/[.06]'}`}><item.icon size={20}/><span className="hidden sm:block">{item.label}</span></button>)}</nav>
      <div className="mt-auto hidden rounded-2xl bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-700 sm:block dark:text-emerald-300"><b>Защищённый доступ</b><br/>Только Telegram-администраторы</div>
    </aside>
    <div className="min-h-full pl-[78px] sm:pl-[220px]">
      <div className="mx-auto max-w-6xl px-3 pb-12 pt-[max(16px,env(safe-area-inset-top))] sm:px-6">
        <header className="sticky top-0 z-30 mb-5 flex items-center gap-3 rounded-[24px] border border-white/50 bg-white/75 p-3 shadow-sm backdrop-blur-xl dark:border-white/[.07] dark:bg-[#15161a]/75">
          <div className="min-w-0 flex-1"><div className="text-[10px] font-bold uppercase tracking-[.14em] text-blue-500">WPay Admin</div><h1 className="truncate text-[22px] font-bold">{tabs.find(item=>item.id===tab)?.label}</h1></div>
          <button onClick={()=>void load()} disabled={loading} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/[.045] disabled:opacity-50 dark:bg-white/[.08]"><RefreshCw size={19} className={loading?'animate-spin':''}/></button>
        </header>
        {error&&<div className={`${card} mb-4 border-red-500/20 bg-red-50 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300`}>{error}</div>}
        {!ready?<div className="py-24 text-center text-sm opacity-45">Загружаю…</div>:<TabContent tab={tab} payload={payload} table={table} query={query} setTable={setTable} setQuery={setQuery} reload={load}/>}
      </div>
    </div>
  </main>
}

function TabContent({tab,payload,table,query,setTable,setQuery,reload}:{tab:Tab;payload:unknown;table:string;query:string;setTable:(v:string)=>void;setQuery:(v:string)=>void;reload:()=>Promise<void>}) {
  if(!payload)return null
  if(tab==='overview')return <Overview data={payload as AdminOverview}/>
  if(tab==='data')return <DataView data={payload as {users:UsersData;database:DatabaseData}} table={table} query={query} setTable={setTable} setQuery={setQuery}/>
  if(tab==='payments')return <Payments data={payload as PaymentsData}/>
  if(tab==='crypto')return <Crypto data={payload as CryptoData}/>
  if(tab==='goswap')return <GoSwap data={payload as GoSwapData}/>
  return <Broadcasts data={payload as BroadcastData} reload={reload}/>
}

function Overview({data}:{data:AdminOverview}) {
  const metrics=[['Пользователи',data.users,Users],['Операции',data.events,Activity],['Котировки',stateTotal(data.states.quotes),Database],['Активы',data.liabilities.length,Coins]] as const
  return <div className="space-y-4"><section className="grid grid-cols-2 gap-3 sm:grid-cols-4">{metrics.map(([label,value,Icon])=><div key={label} className={card}><Icon size={19} className="mb-3 text-blue-500"/><div className="text-2xl font-bold">{value}</div><div className="text-xs opacity-50">{label}</div></div>)}</section>
    <section className={card}><h2 className="font-semibold">Баланс GoSwap</h2>{data.provider.balance.map((row,index)=><Row key={index} title={text(row.currency_code||row.asset)} right={amount(row.available)}/>)}</section>
    <section className={card}><h2 className="font-semibold">Обязательства пользователям</h2>{data.liabilities.length?data.liabilities.map((row,index)=><Row key={index} title={text(row.asset)} subtitle={`Доступно ${amount(row.available)} · резерв ${amount(row.reserved)}`} right={amount(row.total)}/>):<Empty/>}</section>
    <section className={card}><h2 className="font-semibold">Последние операции</h2>{data.recent.length?data.recent.slice(0,20).map((row,index)=><Row key={index} title={text(row.type)} subtitle={`${text(row.user_id)} · ${date(row.created_at)}`} right={`${amount(row.amount)} ${text(row.asset)}`}/>):<Empty/>}</section></div>
}

function DataView({data,table,query,setTable,setQuery}:{data:{users:UsersData;database:DatabaseData};table:string;query:string;setTable:(v:string)=>void;setQuery:(v:string)=>void}) {
  const [mode,setMode]=useState<'users'|'tables'>('users')
  const [draft,setDraft]=useState(query)
  return <div className="space-y-4"><div className="grid grid-cols-2 gap-2 rounded-2xl bg-black/[.04] p-1 dark:bg-white/[.06]">{(['users','tables'] as const).map(value=><button key={value} onClick={()=>setMode(value)} className={`rounded-xl py-2 text-sm font-semibold ${mode===value?'bg-white shadow dark:bg-white/10':''}`}>{value==='users'?'Пользователи':'Таблицы БД'}</button>)}</div>
    {mode==='users'?<section className="space-y-3"><div className="text-sm opacity-55">Всего: {data.users.total}</div>{data.users.items.map((user,index)=><article key={index} className={card}><div className="flex justify-between gap-3"><div><b>{user.first_name?text(user.first_name):text(user.user_id)}</b><div className="text-sm opacity-50">{user.telegram_username?`@${text(user.telegram_username)} · `:''}{text(user.user_id)}</div></div><span className="text-xs text-emerald-600">{text(user.status)}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><span>Последний вход<br/><b>{date(user.last_seen)}</b></span><span>Бот запущен<br/><b>{date(user.bot_started_at)}</b></span><span>Операций: <b>{text(user.event_count)}</b></span><span>Адресов: <b>{text(user.address_count)}</b></span></div>{Array.isArray(user.balances)&&user.balances.length>0&&<div className="mt-3">{(user.balances as Json[]).map((balance,i)=><Row key={i} title={text(balance.asset)} right={`${amount(balance.available)} / ${amount(balance.reserved)}`}/>)}</div>}{details(user)}</article>)}</section>:
    <section className="space-y-3"><div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"><select value={table} onChange={event=>setTable(event.target.value)} className={input}>{Object.entries(data.database.tables).map(([name,count])=><option key={name} value={name}>{name} ({count})</option>)}</select><div className="relative"><Search className="absolute left-3 top-3.5 opacity-35" size={17}/><input value={draft} onChange={event=>setDraft(event.target.value)} className={`${input} pl-10`} placeholder="Поиск по таблице"/></div><button onClick={()=>setQuery(draft)} className="rounded-2xl bg-blue-500 px-5 py-3 text-sm font-semibold text-white">Найти</button></div>{data.database.items.map((row,index)=><article key={index} className={card}><div className="text-xs font-semibold text-blue-500">rowid {text(row.rowid)}</div>{Object.entries(row).filter(([key])=>key!=='rowid').slice(0,5).map(([key,value])=><div key={key} className="mt-2 grid grid-cols-[110px_1fr] gap-2 text-xs"><span className="truncate opacity-45">{key}</span><span className="break-all">{typeof value==='object'?json(value):text(value)}</span></div>)}{details(row)}</article>)}</section>}
  </div>
}

function Payments({data}:{data:PaymentsData}) { const [kind,setKind]=useState<keyof PaymentsData>('events'); return <div className="space-y-3"><div className="flex gap-2 overflow-x-auto pb-1">{(Object.keys(data) as (keyof PaymentsData)[]).map(key=><button key={key} onClick={()=>setKind(key)} className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold ${kind===key?'bg-blue-500 text-white':'bg-white dark:bg-white/10'}`}>{key} · {data[key].length}</button>)}</div>{data[kind].length?data[kind].map((row,index)=><article key={index} className={card}><Row title={text(row.type||row.status||row.state||kind)} subtitle={`${text(row.user_id)} · ${date(row.created_at)}`} right={`${amount(row.amount)} ${text(row.asset)}`}/>{details(row)}</article>):<section className={card}><Empty/></section>}</div> }

function Crypto({data}:{data:CryptoData}) { const [kind,setKind]=useState<'addresses'|'deposits'|'balances'>('addresses'); const rows=data[kind]; return <div className="space-y-3"><div className="grid grid-cols-3 gap-2">{(['addresses','deposits','balances'] as const).map(key=><button key={key} onClick={()=>setKind(key)} className={`rounded-2xl py-2 text-xs font-semibold ${kind===key?'bg-blue-500 text-white':'bg-white dark:bg-white/10'}`}>{key} · {data[key].length}</button>)}</div>{rows.length?rows.map((row,index)=><article key={index} className={card}><Row title={text(row.network||row.asset||row.type)} subtitle={text(row.user_id)} right={amount(row.available||row.amount||'')}/>{details(row)}</article>):<section className={card}><Empty/></section>}</div> }

function GoSwap({data}:{data:GoSwapData}) { return <div className="space-y-3">{Object.entries(data).map(([name,value])=><section key={name} className={card}><div className="flex items-center justify-between"><h2 className="font-semibold capitalize">{name}</h2><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${value.ok?'bg-emerald-500/10 text-emerald-600':'bg-red-500/10 text-red-500'}`}>{value.ok?'OK':'ERROR'}</span></div>{value.ok?details(value.result,'Открыть данные'):<p className="mt-2 text-sm text-red-500">{value.detail||value.error}</p>}</section>)}</div> }

function Broadcasts({data,reload}:{data:BroadcastData;reload:()=>Promise<void>}) {
  const [message,setMessage]=useState('');const [target,setTarget]=useState<'self'|'all'>('self');const [buttonText,setButtonText]=useState('');const [buttonUrl,setButtonUrl]=useState('');const [sending,setSending]=useState(false);const [notice,setNotice]=useState('')
  const canSend=useMemo(()=>message.trim().length>0&&!sending,[message,sending])
  async function send(){if(!canSend)return;if(target==='all'&&!window.confirm('Отправить сообщение всем пользователям, запустившим бота?'))return;setSending(true);setNotice('');try{const result=await walletRequest<{total:number}>('admin-broadcasts',{text:message,target,button_text:buttonText,button_url:buttonUrl});setNotice(`Рассылка запущена. Получателей: ${result.total}`);setMessage('');await reload()}catch(reason){setNotice(reason instanceof Error?reason.message:'Ошибка отправки')}finally{setSending(false)}}
  return <div className="space-y-4"><section className={card}><h2 className="font-semibold">Новая рассылка</h2><textarea value={message} onChange={event=>setMessage(event.target.value)} className={`${input} mt-3 min-h-32 resize-y`} maxLength={4096} placeholder="Текст сообщения"/><div className="mt-2 text-right text-xs opacity-40">{message.length}/4096</div><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={()=>setTarget('self')} className={`rounded-2xl py-3 text-sm font-semibold ${target==='self'?'bg-blue-500 text-white':'bg-black/[.04] dark:bg-white/[.07]'}`}>Тест себе</button><button onClick={()=>setTarget('all')} className={`rounded-2xl py-3 text-sm font-semibold ${target==='all'?'bg-blue-500 text-white':'bg-black/[.04] dark:bg-white/[.07]'}`}>Всем</button></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><input value={buttonText} onChange={event=>setButtonText(event.target.value)} className={input} placeholder="Текст кнопки (необязательно)"/><input value={buttonUrl} onChange={event=>setButtonUrl(event.target.value)} className={input} placeholder="https://…"/></div><button onClick={()=>void send()} disabled={!canSend} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-500 py-3.5 font-semibold text-white disabled:opacity-40"><Send size={18}/>{sending?'Отправляю…':target==='self'?'Отправить себе':'Запустить рассылку'}</button>{notice&&<p className="mt-3 text-sm">{notice}</p>}</section><section className={card}><h2 className="font-semibold">История рассылок</h2>{data.items.length?data.items.map((row,index)=><div key={index} className="border-b border-black/[.06] py-3 last:border-0 dark:border-white/[.08]"><Row title={text(row.text)} subtitle={`${date(row.created_at)} · ${text(row.target)}`} right={`${text(row.sent)}/${text(row.total)}`}/><div className="mt-1 text-xs opacity-45">Статус: {text(row.status)} · ошибок {text(row.failed)}</div></div>):<Empty/>}</section></div>
}

function Row({title,subtitle,right}:{title:string;subtitle?:string;right?:string}) { return <div className="flex items-start justify-between gap-3 border-b border-black/[.05] py-3 last:border-0 dark:border-white/[.07]"><div className="min-w-0"><div className="break-words text-sm font-medium">{title}</div>{subtitle&&<div className="mt-1 break-all text-xs opacity-45">{subtitle}</div>}</div>{right&&<div className="shrink-0 text-right text-sm font-semibold tabular-nums">{right}</div>}</div> }
function Empty(){return <div className="py-5 text-center text-sm opacity-40">Данных пока нет</div>}
