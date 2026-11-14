import { useCallback, useEffect, useState } from 'react'
import { Activity, ArrowLeft, Database, RefreshCw, ShieldCheck, Users, WalletCards } from 'lucide-react'
import { walletRequest } from '../lib/wallet-api'

type AdminOverview = {
  users: number
  events: number
  liabilities: { asset: string; available: string; reserved: string; total: string }[]
  states: Record<string, Record<string, number>>
  recent: { event_id: string; user_id: string; asset: string; amount: string; type: string; created_at: string }[]
  provider: {
    app: Record<string, unknown>
    balance: { currency_code?: string; asset?: string; available?: string }[]
    currencies: unknown[]
  }
}

const card = 'rounded-[24px] border border-black/[.06] bg-white p-4 shadow-sm dark:border-white/[.08] dark:bg-white/[.07]'

function amount(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toLocaleString('ru-RU', { maximumFractionDigits: 8 }) : value
}

function stateCount(states: Record<string, number>) {
  return Object.values(states).reduce((total, value) => total + value, 0)
}

export default function WalletAdminPage() {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await walletRequest<AdminOverview>('admin-overview'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить админку')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <main className="min-h-full bg-[#f2f2f7] px-4 pb-10 pt-[max(18px,env(safe-area-inset-top))] text-[#111] dark:bg-[#08090b] dark:text-white">
      <div className="mx-auto max-w-3xl">
        <header className="mb-5 flex items-center justify-between gap-3">
          <button onClick={() => { window.location.href = '/wallet' }} className="flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm dark:bg-white/10" aria-label="Назад в кошелёк"><ArrowLeft size={21}/></button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[.12em] text-emerald-600"><ShieldCheck size={15}/> WPay</div>
            <h1 className="truncate text-[25px] font-bold leading-tight">Админка</h1>
          </div>
          <button onClick={() => void load()} disabled={loading} className="flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm disabled:opacity-50 dark:bg-white/10" aria-label="Обновить"><RefreshCw size={20} className={loading ? 'animate-spin' : ''}/></button>
        </header>

        {error && <section className={`${card} border-red-500/20 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300`}><div className="font-semibold">Доступ не получен</div><p className="mt-1 text-sm opacity-80">{error}. Откройте админку командой /admin в боте.</p></section>}

        {data && <div className="space-y-4">
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Пользователи', value: data.users, icon: Users },
              { label: 'Операции', value: data.events, icon: Activity },
              { label: 'Котировки', value: stateCount(data.states.quotes || {}), icon: Database },
              { label: 'Активы', value: data.liabilities.length, icon: WalletCards },
            ].map(({ label, value, icon: Icon }) => <div key={label} className={card}><Icon size={19} className="mb-3 text-blue-500"/><div className="text-2xl font-bold tabular-nums">{value}</div><div className="mt-1 text-xs text-black/50 dark:text-white/50">{label}</div></div>)}
          </section>

          <section className={card}>
            <h2 className="text-[17px] font-semibold">Баланс провайдера</h2>
            <div className="mt-3 divide-y divide-black/[.06] dark:divide-white/[.08]">
              {data.provider.balance.length ? data.provider.balance.map((row, index) => <div key={`${row.currency_code || row.asset}-${index}`} className="flex items-center justify-between py-3"><span className="font-medium">{row.currency_code || row.asset || '—'}</span><span className="font-semibold tabular-nums">{amount(String(row.available ?? '0'))}</span></div>) : <div className="py-3 text-sm opacity-50">Нет данных</div>}
            </div>
          </section>

          <section className={card}>
            <h2 className="text-[17px] font-semibold">Обязательства перед пользователями</h2>
            <div className="mt-3 divide-y divide-black/[.06] dark:divide-white/[.08]">
              {data.liabilities.length ? data.liabilities.map(row => <div key={row.asset} className="py-3"><div className="flex items-center justify-between"><span className="font-medium">{row.asset}</span><span className="font-semibold tabular-nums">{amount(row.total)}</span></div><div className="mt-1 text-xs text-black/45 dark:text-white/45">Доступно {amount(row.available)} · В резерве {amount(row.reserved)}</div></div>) : <div className="py-3 text-sm opacity-50">Пользовательских остатков пока нет</div>}
            </div>
          </section>

          <section className={card}>
            <h2 className="text-[17px] font-semibold">Состояния операций</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {Object.entries(data.states).map(([group, states]) => <div key={group} className="rounded-2xl bg-black/[.035] p-3 dark:bg-white/[.06]"><div className="text-xs font-semibold uppercase tracking-wide opacity-50">{group}</div>{Object.keys(states).length ? Object.entries(states).map(([name, count]) => <div key={name} className="mt-2 flex justify-between text-sm"><span>{name}</span><b>{count}</b></div>) : <div className="mt-2 text-sm opacity-40">Нет</div>}</div>)}
            </div>
          </section>

          <section className={card}>
            <h2 className="text-[17px] font-semibold">Последние операции</h2>
            <div className="mt-2 divide-y divide-black/[.06] dark:divide-white/[.08]">
              {data.recent.length ? data.recent.map(row => <div key={row.event_id} className="py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-medium">{row.type}</div><div className="mt-1 truncate text-xs text-black/45 dark:text-white/45">{row.user_id} · {new Date(row.created_at).toLocaleString('ru-RU')}</div></div><div className="shrink-0 text-sm font-semibold tabular-nums">{amount(row.amount)} {row.asset}</div></div></div>) : <div className="py-4 text-sm opacity-50">Операций пока нет</div>}
            </div>
          </section>
        </div>}

        {loading && !data && !error && <div className="py-24 text-center text-sm opacity-50">Загружаю данные…</div>}
      </div>
    </main>
  )
}
