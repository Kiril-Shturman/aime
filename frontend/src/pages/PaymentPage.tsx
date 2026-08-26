import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, CreditCard, Shield } from 'lucide-react'
import {
  Block,
  BlockTitle,
  Button,
  List,
  ListItem,
  Navbar,
  NavbarBackLink,
  Page,
  Preloader,
} from 'konsta/react'
import { haptic } from '../lib/telegram'

type Method = 'card' | 'yoomoney' | 'sbp'

// Реальные тиры и цены из бэкенда ai-webapi (PlanInitializationService.cs).
type Variant = 'base' | 'plus'
type Period = 'monthly' | 'quarterly' | 'semiannual' | 'yearly'

// Скидка и число месяцев в периоде — держим синхронно с TariffsPage.
const PERIODS: Record<Period, { months: number; discount: number; label: string }> =
  {
    monthly: { months: 1, discount: 0, label: 'месяц' },
    quarterly: { months: 3, discount: 0.05, label: '3 месяца' },
    semiannual: { months: 6, discount: 0.1, label: 'полгода' },
    yearly: { months: 12, discount: 0.17, label: 'год' },
  }

const TIERS: Record<
  string,
  { name: string; accent: string; base: { price: number; tokens: number }; plus: { price: number; tokens: number } }
> = {
  start: {
    name: 'Start',
    accent: '#2a8bff',
    base: { price: 490, tokens: 750 },
    plus: { price: 690, tokens: 1050 },
  },
  pro: {
    name: 'Pro',
    accent: '#a855f7',
    base: { price: 1490, tokens: 2200 },
    plus: { price: 1990, tokens: 2950 },
  },
  premium: {
    name: 'Premium',
    accent: '#ec4899',
    base: { price: 3990, tokens: 5900 },
    plus: { price: 4490, tokens: 6650 },
  },
  elite: {
    name: 'Elite',
    accent: '#f59e0b',
    base: { price: 6990, tokens: 12160 },
    plus: { price: 7990, tokens: 13900 },
  },
  ultra: {
    name: 'Ultra',
    accent: '#ef4444',
    base: { price: 12990, tokens: 25640 },
    plus: { price: 14990, tokens: 29600 },
  },
}

const METHODS: { id: Method; label: string; note: string }[] = [
  { id: 'card', label: 'Банковская карта', note: 'Visa, MasterCard, Мир' },
  { id: 'yoomoney', label: 'ЮMoney', note: 'Кошелёк ЮMoney' },
  { id: 'sbp', label: 'СБП', note: 'Система быстрых платежей' },
]

export default function PaymentPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const planId = params.get('plan') ?? 'pro'
  const variant = (params.get('variant') ?? 'base') as Variant
  const rawPeriod = (params.get('period') ?? 'monthly') as Period
  const period: Period = PERIODS[rawPeriod] ? rawPeriod : 'monthly'
  const tier = TIERS[planId] ?? TIERS.pro
  const monthly = tier[variant].price
  const tokens = tier[variant].tokens
  const info = PERIODS[period]

  const [method, setMethod] = useState<Method>('card')
  const [autoRenew, setAutoRenew] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const price = Math.round(monthly * info.months * (1 - info.discount))
  const format = (n: number) => new Intl.NumberFormat('ru-RU').format(n)

  const savings = useMemo(
    () => (info.discount > 0 ? monthly * info.months - price : 0),
    [monthly, price, info],
  )

  const pay = async () => {
    if (loading) return
    haptic('light')
    setError(null)
    setLoading(true)
    try {
      // TODO: POST /ai/api/payment/ через сгенерированный клиент
      await new Promise((r) => setTimeout(r, 800))
      setError('Бэк оплаты пока не подключён')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="Оплата подписки"
        left={
          <NavbarBackLink text="Тарифы" onClick={() => nav('/tariffs')} />
        }
      />

      <div className="mx-auto w-full max-w-[720px]">
        <BlockTitle>Ваш план</BlockTitle>
        <div className="px-4">
          <div
            className="rounded-3xl px-5 py-4 text-white"
            style={{
              background: `linear-gradient(135deg, ${tier.accent}, ${tier.accent}CC)`,
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] uppercase tracking-wider opacity-80">
                  aiStore
                </div>
                <div className="text-[24px] font-extrabold leading-tight">
                  {tier.name} {variant === 'plus' && 'Plus'}
                </div>
                <div className="text-[13px] opacity-85 mt-0.5">
                  {format(tokens)} токенов в месяц
                </div>
              </div>
              <div className="text-right">
                <div className="text-[28px] font-extrabold leading-none tabular-nums">
                  {format(price)} ₽
                </div>
                <div className="text-[12px] opacity-80 mt-1">
                  / {info.label}
                </div>
              </div>
            </div>
            {savings > 0 && (
              <div className="mt-3 inline-block text-[12px] font-semibold bg-white/25 px-2 py-1 rounded-full">
                Экономия {format(savings)} ₽ против оплаты по месяцам
              </div>
            )}
          </div>
        </div>

        <BlockTitle>Способ оплаты</BlockTitle>
        <List strong inset>
          {METHODS.map((m) => (
            <ListItem
              key={m.id}
              onClick={() => setMethod(m.id)}
              title={m.label}
              subtitle={m.note}
              media={
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    method === m.id
                      ? 'bg-[#2a8bff] text-white'
                      : 'bg-black/[.06] dark:bg-white/[.08] text-black/60 dark:text-white/55'
                  }`}
                >
                  <CreditCard size={16} />
                </span>
              }
              after={
                method === m.id ? (
                  <Check size={18} className="text-[#2a8bff]" />
                ) : undefined
              }
            />
          ))}
        </List>

        <BlockTitle>Опции</BlockTitle>
        <List strong inset>
          <ListItem
            onClick={() => setAutoRenew((v) => !v)}
            title="Автопродление"
            subtitle="Списание в конце срока, отменить можно в любой момент"
            after={
              <span
                className={`text-[13px] font-semibold ${
                  autoRenew ? 'text-[#2a8bff]' : 'text-black/45 dark:text-white/40'
                }`}
              >
                {autoRenew ? 'Вкл' : 'Выкл'}
              </span>
            }
          />
        </List>

        <Block>
          <div className="flex items-center justify-between rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-4 py-3">
            <div>
              <div className="text-[13px] text-black/60 dark:text-white/55">
                К оплате
              </div>
              <div className="text-[24px] font-extrabold tabular-nums text-black dark:text-white leading-tight">
                {format(price)} ₽
              </div>
            </div>
            <Shield size={22} className="text-black/45 dark:text-white/40" />
          </div>
        </Block>

        {error && (
          <Block className="!mt-0 !mb-0">
            <p className="text-[14px] text-[#ff3b30] text-center">{error}</p>
          </Block>
        )}

        <Block>
          {loading ? (
            <div className="h-14 flex items-center justify-center">
              <Preloader
                colors={{ iconIos: 'text-black/45 dark:text-white/45' }}
              />
            </div>
          ) : (
            <Button large rounded className="!h-14" onClick={pay}>
              Оплатить {format(price)} ₽
            </Button>
          )}
          <p className="mt-3 text-center text-[12px] text-black/45 dark:text-white/40 leading-snug">
            Нажимая «Оплатить», вы соглашаетесь с условиями подписки и
            правилами оплаты. Платежи проходят через ЮKassa.
          </p>
        </Block>
      </div>
    </Page>
  )
}
