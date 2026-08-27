import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import {
  Block,
  BlockTitle,
  List,
  ListItem,
  Navbar,
  NavbarBackLink,
  Page,
} from 'konsta/react'

interface Tx {
  id: string
  date: string // ISO
  kind: 'topup' | 'subscription' | 'refund' | 'referral' | 'bonus'
  title: string
  tokens: number // положительные — приход, отрицательные — списание
  rub?: number
  status: 'success' | 'pending' | 'cancelled'
}

const MOCK: Tx[] = [
  { id: 't1', date: '2026-08-25', kind: 'subscription', title: 'Подписка Pro',    tokens:  2200, rub: 1490, status: 'success' },
  { id: 't2', date: '2026-08-20', kind: 'topup',        title: 'Пополнение баланса', tokens:  500,  rub: 350,  status: 'success' },
  { id: 't3', date: '2026-08-14', kind: 'bonus',        title: 'Бонус за реферала',  tokens:  100,  status: 'success' },
  { id: 't4', date: '2026-08-05', kind: 'topup',        title: 'Пополнение баланса', tokens: 1000, rub: 700,  status: 'success' },
  { id: 't5', date: '2026-07-25', kind: 'subscription', title: 'Подписка Start',   tokens:  750,  rub: 490,  status: 'success' },
  { id: 't6', date: '2026-07-14', kind: 'refund',       title: 'Возврат средств',  tokens: -300, rub: 210,  status: 'success' },
  { id: 't7', date: '2026-07-02', kind: 'topup',        title: 'Пополнение баланса', tokens:  500,  rub: 350,  status: 'pending' },
]

const KIND_LABEL: Record<Tx['kind'], string> = {
  topup: 'Пополнение',
  subscription: 'Подписка',
  refund: 'Возврат',
  referral: 'Реферал',
  bonus: 'Бонус',
}

const KIND_COLOR: Record<Tx['kind'], string> = {
  topup: '#2a8bff',
  subscription: '#a855f7',
  refund: '#f59e0b',
  referral: '#10b981',
  bonus: '#ec4899',
}

const STATUS_LABEL: Record<Tx['status'], string> = {
  success: 'Выполнено',
  pending: 'В обработке',
  cancelled: 'Отменено',
}

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

function fmtDay(d: string) {
  const dt = new Date(d)
  return `${dt.getDate()} ${MONTHS[dt.getMonth()].toLowerCase().slice(0, 3)}`
}

export default function TransactionsPage() {
  const nav = useNavigate()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth())
  const [year, setYear] = useState(now.getFullYear())
  const [q, setQ] = useState('')

  const isCurrent =
    month === now.getMonth() && year === now.getFullYear()

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11)
      setYear((y) => y - 1)
    } else setMonth((m) => m - 1)
  }
  const nextMonth = () => {
    if (isCurrent) return
    if (month === 11) {
      setMonth(0)
      setYear((y) => y + 1)
    } else setMonth((m) => m + 1)
  }

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return MOCK.filter((t) => {
      const d = new Date(t.date)
      if (d.getMonth() !== month || d.getFullYear() !== year) return false
      if (!query) return true
      return (
        t.title.toLowerCase().includes(query) ||
        KIND_LABEL[t.kind].toLowerCase().includes(query)
      )
    })
  }, [month, year, q])

  return (
    <Page className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="История транзакций"
        left={
          <NavbarBackLink text="Профиль" onClick={() => nav('/profile')} />
        }
      />

      <div className="mx-auto w-full max-w-[720px]">
        {/* Селектор месяца */}
        <Block className="!mt-4">
          <div className="flex items-center justify-between rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-2 py-2">
            <button
              type="button"
              onClick={prevMonth}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-black dark:text-white active:opacity-60"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="text-center">
              <div className="text-[15px] font-semibold text-black dark:text-white">
                {MONTHS[month]}
              </div>
              <div className="text-[12px] text-black/50 dark:text-white/40">
                {year}
              </div>
            </div>
            <button
              type="button"
              onClick={nextMonth}
              disabled={isCurrent}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-black dark:text-white active:opacity-60 disabled:opacity-30"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </Block>

        {/* Поиск */}
        <Block className="!mt-2">
          <label className="flex items-center gap-2 h-10 px-3 rounded-full bg-black/[.04] dark:bg-white/[.06]">
            <Search size={16} className="text-black/45 dark:text-white/45" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по транзакциям"
              className="flex-1 bg-transparent outline-none text-[14px] text-black dark:text-white placeholder-black/40 dark:placeholder-white/40"
            />
          </label>
        </Block>

        {filtered.length === 0 ? (
          <Block>
            <div className="py-8 text-center text-[14px] text-black/50 dark:text-white/40">
              {q
                ? `Ничего не нашлось по «${q}»`
                : 'Нет транзакций за этот период'}
            </div>
          </Block>
        ) : (
          <>
            <BlockTitle>Транзакции</BlockTitle>
            <List strong inset>
              {filtered.map((t) => (
                <ListItem
                  key={t.id}
                  media={
                    <span
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
                      style={{ background: KIND_COLOR[t.kind] }}
                    >
                      {KIND_LABEL[t.kind].slice(0, 3).toUpperCase()}
                    </span>
                  }
                  title={t.title}
                  subtitle={
                    <>
                      {fmtDay(t.date)} · {STATUS_LABEL[t.status]}
                    </>
                  }
                  after={
                    <div className="text-right">
                      <div
                        className={`text-[15px] font-semibold tabular-nums ${
                          t.tokens >= 0
                            ? 'text-[#10B981]'
                            : 'text-[#ff3b30]'
                        }`}
                      >
                        {t.tokens >= 0 ? '+' : '−'}
                        {Math.abs(t.tokens).toLocaleString('ru-RU')}
                      </div>
                      {t.rub != null && (
                        <div className="text-[12px] text-black/45 dark:text-white/40">
                          {t.rub.toLocaleString('ru-RU')} ₽
                        </div>
                      )}
                    </div>
                  }
                />
              ))}
            </List>
          </>
        )}
      </div>
    </Page>
  )
}
