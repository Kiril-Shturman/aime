import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronDown, CreditCard, Plus, Sparkles } from 'lucide-react'
import SquareStack from 'framework7-icons/react/esm/SquareStack.js'
import MoneyRublCircleFill from 'framework7-icons/react/esm/MoneyRublCircleFill.js'
import Percent from 'framework7-icons/react/esm/Percent.js'
import {
  BlockTitle,
  Button,
  Glass,
  List,
  ListItem,
  Navbar,
  NavbarBackLink,
  Page,
  Segmented,
  SegmentedButton,
} from 'konsta/react'
import { haptic } from '../lib/telegram'

type Period = 'monthly' | 'quarterly' | 'semiannual' | 'yearly'

// Скидка по сроку и человеческая подпись — вынесены рядом, чтобы
// править в одном месте.
const PERIODS: {
  id: Period
  label: string
  months: number
  discount: number
}[] = [
  { id: 'monthly', label: 'Месяц', months: 1, discount: 0 },
  { id: 'quarterly', label: '3 месяца', months: 3, discount: 0.05 },
  { id: 'semiannual', label: 'Полгода', months: 6, discount: 0.1 },
  { id: 'yearly', label: 'Год', months: 12, discount: 0.17 },
]
type Variant = 'base' | 'plus'

interface Tier {
  id: string
  name: string
  description: string
  accent: string
  ring?: string
  variants: Record<Variant, { price: number; tokens: number }>
  providers: 'text' | 'text+image' | 'all' | 'all+video'
  perks?: string[]
  featured?: boolean
}

// Взято из бэкенда ai-webapi (PlanInitializationService.cs).
// Токены — округлённо от формулы Price / (USD·1.03) · 137,
// с поправкой DiscountCoefficient у Elite (0.85) и Ultra (0.75).
// Базовые фичи для всех тарифов — как в ai-webapi (features: chatbot,
// shareChat, voiceInput, onlineSupport).
const BASE_FEATURES = [
  'Чат-бот с ИИ',
  'Поделиться чатом',
  'Голосовой ввод',
  'Поддержка онлайн',
]

const TIERS: Tier[] = [
  {
    id: 'start',
    name: 'Start',
    description: 'Знакомство с платформой и основные текстовые модели',
    accent: '#2a8bff',
    variants: {
      base: { price: 490, tokens: 750 },
      plus: { price: 690, tokens: 1050 },
    },
    providers: 'text',
    perks: [
      '11 текстовых моделей: GPT, Claude, Gemini, Grok, DeepSeek…',
      'История чатов и поиск по ней',
      'Экспорт диалогов в файл',
      'Веб-поиск внутри промптов',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Продвинутые модели и генерация изображений',
    accent: '#a855f7',
    ring: 'ring-[#a855f7]',
    variants: {
      base: { price: 1490, tokens: 2200 },
      plus: { price: 1990, tokens: 2950 },
    },
    providers: 'text+image',
    perks: [
      'Всё из Start',
      'Midjourney, ChatGPT Image, Nano-Banana',
      'Загрузка файлов и картинок в чат',
      'MCP-ключи для внешних интеграций',
      'Общий доступ к чатам по ссылке',
    ],
    featured: true,
  },
  {
    id: 'premium',
    name: 'Premium',
    description: 'Все текстовые и все графические модели',
    accent: '#ec4899',
    variants: {
      base: { price: 3990, tokens: 5900 },
      plus: { price: 4490, tokens: 6650 },
    },
    providers: 'all',
    perks: [
      'Всё из Pro',
      'Все графические модели: Flux, Sourceful, Kling Image',
      'Приоритетная обработка запросов',
      'Расширенное хранилище истории',
      'Кастомные пресеты промптов',
    ],
  },
  {
    id: 'elite',
    name: 'Elite',
    description: 'Скидка 15% на все токены + премиум-модели',
    accent: '#f59e0b',
    variants: {
      base: { price: 6990, tokens: 12160 },
      plus: { price: 7990, tokens: 13900 },
    },
    providers: 'all',
    perks: [
      'Всё из Premium',
      'Скидка 15% на все токены',
      'Приоритетная поддержка в чате',
      'Ранний доступ к новым моделям',
      'Персональные лимиты по запросу',
    ],
  },
  {
    id: 'ultra',
    name: 'Ultra',
    description: 'Всё, что есть, плюс видео и приоритет',
    accent: '#ef4444',
    variants: {
      base: { price: 12990, tokens: 25640 },
      plus: { price: 14990, tokens: 29600 },
    },
    providers: 'all+video',
    perks: [
      'Всё из Elite',
      'Генерация видео: Sora 2, Veo 3, Kling',
      'Скидка 25% на токены',
      'Приоритет №1 в очереди',
      'Персональный AI-консультант',
      'Индивидуальный SLA по запросу',
    ],
  },
]

// Провайдеры — id, файл лого, человеческое имя, тип. Порядок и состав
// повторяют allowedProviders из PlanInitializationService.cs (ai-webapi).
interface Provider {
  id: string
  file: string
  name: string
  kind: 'text' | 'image' | 'video'
}
const PROVIDERS: Provider[] = [
  // текст
  { id: 'chatgpt', file: 'gpt.png', name: 'ChatGPT', kind: 'text' },
  { id: 'claude', file: 'claude.png', name: 'Claude', kind: 'text' },
  { id: 'gemini', file: 'gemini.png', name: 'Gemini', kind: 'text' },
  { id: 'grok', file: 'grok.png', name: 'Grok', kind: 'text' },
  { id: 'deepseek', file: 'deepseek.png', name: 'DeepSeek', kind: 'text' },
  { id: 'perplexity', file: 'perplexity.png', name: 'Perplexity', kind: 'text' },
  { id: 'qwen', file: 'qwen.png', name: 'Qwen', kind: 'text' },
  { id: 'arcee', file: 'arcee.png', name: 'Arcee', kind: 'text' },
  { id: 'nvidia', file: 'nvidea.png', name: 'NVIDIA', kind: 'text' },
  { id: 'meta', file: 'metaai.png', name: 'Meta AI', kind: 'text' },
  { id: 'relace', file: 'relace.png', name: 'Relace', kind: 'text' },
  // + для Premium+ (allowedProviders = [] у Premium/Elite/Ultra = все)
  { id: 'moonshot', file: 'moonshot.png', name: 'Moonshot', kind: 'text' },
  { id: 'stepfun', file: 'stepfun.png', name: 'Stepfun', kind: 'text' },
  { id: 'nous', file: 'nous.png', name: 'Nous', kind: 'text' },
  { id: 'baidu', file: 'baidu.png', name: 'Baidu', kind: 'text' },
  // картинки
  { id: 'chatgpt-image', file: 'dalle.png', name: 'OpenAI', kind: 'image' },
  { id: 'midjourney', file: 'midjourney.png', name: 'Midjourney', kind: 'image' },
  { id: 'nanobanana', file: 'NanoBanana.png', name: 'Nano-Banana', kind: 'image' },
  { id: 'sourceful', file: 'Sourceful.png', name: 'Sourceful', kind: 'image' },
  { id: 'flux', file: 'blclabs.png', name: 'Flux', kind: 'image' },
  // видео (только у Ultra)
  { id: 'sora2', file: 'sora-optimized.png', name: 'Sora 2', kind: 'video' },
  { id: 'veo3', file: 'veo3.png', name: 'Veo 3', kind: 'video' },
  { id: 'kling', file: 'klingai.png', name: 'Kling', kind: 'video' },
  { id: 'hailuo', file: 'hailuo.png', name: 'Hailuo', kind: 'video' },
  { id: 'seedance', file: 'seedance.png', name: 'Seedance', kind: 'video' },
  { id: 'wan', file: 'wan.png', name: 'Wan', kind: 'video' },
]

// allowedProviders по тирам — как в PlanInitializationService.cs.
// Пустой массив = «все» (Premium и выше).
const TIER_PROVIDER_IDS: Record<string, string[] | null> = {
  start: [
    'chatgpt', 'claude', 'gemini', 'grok', 'deepseek',
    'perplexity', 'qwen', 'arcee', 'nvidia', 'meta', 'relace',
  ],
  pro: [
    'chatgpt', 'claude', 'gemini', 'grok', 'deepseek',
    'perplexity', 'qwen', 'arcee', 'nvidia', 'meta', 'relace',
    'chatgpt-image', 'midjourney', 'nanobanana',
  ],
  premium: null,
  elite: null,
  ultra: null,
}

const FAQ = [
  {
    q: 'Что такое токены?',
    a: 'Единица оплаты у AI-моделей. Короткий ответ — 200–500 токенов, длинный разбор кода — до 5000. Разные модели стоят по-разному.',
  },
  {
    q: 'Base и Plus — в чём разница?',
    a: 'Один и тот же набор моделей, но у Plus в пакете больше токенов на месяц. Удобно, если знакомый лимит вам тесен, а прыгать через тир не хочется.',
  },
  {
    q: 'Можно ли поменять тариф в середине месяца?',
    a: 'Да. При переходе выше — доплата за остаток срока. При переходе ниже — разница вернётся токенами.',
  },
  {
    q: 'Есть ли годовая скидка?',
    a: 'Да, при годовой оплате скидка 17% — фактически 2 месяца в подарок.',
  },
  {
    q: 'Что после исчерпания токенов?',
    a: 'Модели перестанут отвечать. Можно докупить пакет отдельно или подождать нового месяца.',
  },
  {
    q: 'Есть ли бесплатный тариф?',
    a: 'Да, Free даёт небольшой пакет токенов навсегда — попробовать без карты.',
  },
]

const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(n)

export default function TariffsPage() {
  const nav = useNavigate()
  const [period, setPeriod] = useState<Period>('monthly')
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const pick = (tierId: string, variant: Variant) => {
    haptic('light')
    nav(
      `/payment/subscription?plan=${tierId}&variant=${variant}&period=${period}`,
    )
  }

  return (
    <Page className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="Тарифы"
        left={
          <NavbarBackLink text="Профиль" onClick={() => nav('/profile')} />
        }
      />

      <div className="mx-auto w-full max-w-[760px]">
        {/* «Как это работает» — в стиле ProjectSheet: без квадратов
            под иконками, иконки просто синим, разделители-хайрлайны. */}
        <BlockTitle>Как это работает</BlockTitle>
        <List strong inset dividers>
          <ListItem
            innerClassName="!min-h-[72px] [&_.text-sm]:!text-[12px] [&_.text-sm]:!leading-snug"
            media={
              <span className="w-8 h-8 flex items-center justify-center shrink-0 text-primary text-[30px]">
                <SquareStack />
              </span>
            }
            title="Тарифы"
            subtitle="Выберите подходящий тарифный план для доступа к нейросетям и количество токенов на старте."
          />
          <ListItem
            innerClassName="!min-h-[72px] [&_.text-sm]:!text-[12px] [&_.text-sm]:!leading-snug"
            media={
              <span className="w-8 h-8 flex items-center justify-center shrink-0 text-primary text-[30px]">
                <MoneyRublCircleFill />
              </span>
            }
            title="Токены"
            subtitle={
              <>
                Токены используются для генерации ответов AI моделей.
                Пополняйте токены для продолжения работы в разделе{' '}
                <button
                  type="button"
                  onClick={() => nav('/tokens')}
                  className="text-primary"
                >
                  мой баланс
                </button>
                .
              </>
            }
          />
          <ListItem
            innerClassName="!min-h-[72px] [&_.text-sm]:!text-[12px] [&_.text-sm]:!leading-snug"
            media={
              <span className="w-8 h-8 flex items-center justify-center shrink-0 text-primary text-[30px]">
                <Percent />
              </span>
            }
            title="Экономия с aiStore"
            subtitle="Оплачивайте сразу за несколько месяцев и получайте скидку плюс расширенный баланс токенов к каждому продлению."
          />
        </List>


        {/* Konsta Strong Segmented — прямо над карточками, во всю ширину блока.
            В тёмной теме перебиваем ярко-белый highlight на приглушённый. */}
        <div className="px-4 mt-6">
          <Segmented
            strong
            rounded
            colors={{ strongHighlightBgIos: 'bg-white dark:bg-white/[.15]' }}
          >
            {PERIODS.map((p) => (
              <SegmentedButton
                key={p.id}
                active={period === p.id}
                onClick={() => setPeriod(p.id)}
              >
                {p.label}
              </SegmentedButton>
            ))}
          </Segmented>
        </div>

        {/* Сетка тиров */}
        <div className="px-4 mt-4 grid gap-3 md:grid-cols-2">
          {TIERS.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              period={period}
              onPick={(v) => pick(tier.id, v)}
            />
          ))}
        </div>

        {/* Что входит — краткая матрица */}
        <BlockTitle className="!mt-8">Что входит</BlockTitle>
        <div className="px-4">
          <div className="rounded-3xl overflow-hidden bg-black/[.04] dark:bg-white/[.06] divide-y divide-black/[.06] dark:divide-white/[.06]">
            <MatrixRow
              label="Текстовые модели (GPT, Claude, Gemini…)"
              cells={['—', '✓', '✓', '✓', '✓', '✓']}
            />
            <MatrixRow
              label="Генерация изображений"
              cells={['—', '—', '✓', '✓', '✓', '✓']}
            />
            <MatrixRow
              label="Генерация видео (Sora 2, Veo 3)"
              cells={['—', '—', '—', '—', '—', '✓']}
            />
            <MatrixRow
              label="Скидка на токены"
              cells={['—', '—', '—', '—', '15%', '25%']}
            />
            <MatrixRow
              label="Приоритетная поддержка"
              cells={['—', '—', '—', '—', '✓', '✓']}
            />
          </div>
        </div>

        {/* FAQ */}
        <BlockTitle className="!mt-8">Частые вопросы</BlockTitle>
        <div className="px-4 flex flex-col gap-2 pb-10">
          {FAQ.map((f, i) => {
            const active = openFaq === i
            return (
              <button
                key={i}
                type="button"
                onClick={() => setOpenFaq(active ? null : i)}
                className="text-left rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-4 py-3 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 text-[15px] font-medium text-black dark:text-white">
                    {f.q}
                  </div>
                  <ChevronDown
                    size={18}
                    className={`shrink-0 opacity-60 transition-transform ${
                      active ? 'rotate-180' : ''
                    }`}
                  />
                </div>
                {active && (
                  <div className="mt-2 text-[14px] text-black/65 dark:text-white/55 leading-snug">
                    {f.a}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </Page>
  )
}

function TierCard({
  tier,
  period,
  onPick,
}: {
  tier: Tier
  period: Period
  onPick: (v: Variant) => void
}) {
  const [variant, setVariant] = useState<Variant>('base')
  const monthly = tier.variants[variant].price
  const periodInfo = PERIODS.find((p) => p.id === period)!
  const displayPrice = useMemo(
    () =>
      Math.round(monthly * periodInfo.months * (1 - periodInfo.discount)),
    [monthly, periodInfo],
  )
  const perMonth = Math.round(monthly * (1 - periodInfo.discount))
  const tokens = tier.variants[variant].tokens
  const periodShort =
    period === 'monthly'
      ? 'мес'
      : period === 'quarterly'
        ? '3 мес'
        : period === 'semiannual'
          ? 'полгода'
          : 'год'

  // Провайдеры этого тира по allowedProviders (null = все, кроме видео;
  // Ultra получает и видео тоже).
  const allowedIds = TIER_PROVIDER_IDS[tier.id]
  const tierProviders =
    allowedIds === null
      ? PROVIDERS.filter((p) =>
          tier.providers === 'all+video' ? true : p.kind !== 'video',
        )
      : PROVIDERS.filter((p) => allowedIds.includes(p.id))
  const textIcons = tierProviders.filter((p) => p.kind === 'text')
  const imageIcons = tierProviders.filter((p) => p.kind === 'image')
  const videoIcons = tierProviders.filter((p) => p.kind === 'video')

  return (
    <Glass
      highlight={false}
      className="relative !rounded-3xl p-5 flex flex-col gap-4 min-h-[520px]
                 !shadow-[0_2px_10px_rgba(0,0,0,0.04)]
                 dark:!shadow-ios-dark-glass
                 transition-transform duration-200 ease-out hover:-translate-y-0.5"
    >
      <div>
        <div className="text-[26px] font-extrabold leading-tight tracking-tight text-black dark:text-white flex items-center gap-2">
          <span>{tier.name}</span>
          {variant === 'plus' && (
            <span
              className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white text-black"
              aria-label="Plus"
            >
              <Plus size={18} strokeWidth={3.25} />
            </span>
          )}
          {/* Скидка-бейдж (когда период даёт %). Цвет зависит от размера. */}
          {periodInfo.discount > 0 && (
            <span
              className={`ml-auto px-2 py-0.5 rounded-full text-[11px] font-bold text-white ${
                periodInfo.discount >= 0.17
                  ? 'bg-[#ef4444]'
                  : periodInfo.discount >= 0.1
                    ? 'bg-[#f59e0b]'
                    : 'bg-[#10B981]'
              }`}
            >
              −{Math.round(periodInfo.discount * 100)}%
            </span>
          )}
        </div>
        <div className="text-[13px] text-black/60 dark:text-white/55 mt-1.5 leading-snug">
          {tier.description}
        </div>
      </div>

      {/* Base/Plus — на всю ширину карточки, показываем токены */}
      <div className="flex w-full rounded-full bg-black/[.06] dark:bg-white/[.10] p-1 text-[13px] font-semibold">
        {(['base', 'plus'] as Variant[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVariant(v)}
            className={`flex-1 py-1.5 rounded-full transition tabular-nums ${
              variant === v
                ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm'
                : 'text-black/55 dark:text-white/50'
            }`}
          >
            {fmt(tier.variants[v].tokens)} токенов
          </button>
        ))}
      </div>

      <div>
        <div className="flex items-baseline gap-2 text-black dark:text-white">
          {periodInfo.discount > 0 && (
            <span className="text-[15px] opacity-45 line-through tabular-nums">
              {fmt(monthly * periodInfo.months)} ₽
            </span>
          )}
          <span className="text-[34px] font-extrabold leading-none tabular-nums tracking-tight">
            {fmt(displayPrice)}
          </span>
          <span className="text-[15px] font-semibold opacity-70">₽</span>
          <span className="text-[13px] opacity-55 ml-1">/ {periodShort}</span>
        </div>
        {period !== 'monthly' && (
          <div className="text-[12px] text-black/50 dark:text-white/40 mt-1">
            ≈ {fmt(perMonth)} ₽/мес · экономия{' '}
            {fmt(monthly * periodInfo.months - displayPrice)} ₽
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-3 py-2 flex items-center gap-2">
        <span
          className="w-5 h-5 rounded-md flex items-center justify-center text-white shrink-0"
          style={{ background: tier.accent }}
        >
          <Sparkles size={12} />
        </span>
        <span className="text-[13px] font-semibold text-black dark:text-white tabular-nums">
          {fmt(tokens)}
        </span>
        <span className="text-[13px] text-black/55 dark:text-white/50">
          токенов в месяц
        </span>
      </div>

      {/* Провайдеры по секциям (аватарки-стопки) — как в ai-webapi.
          При наведении на аватарку в title всплывает имя. */}
      <div className="flex flex-col gap-3">
        <ProviderSection title="Текст" providers={textIcons} />
        {imageIcons.length > 0 && (
          <ProviderSection title="Изображения" providers={imageIcons} />
        )}
        {videoIcons.length > 0 && (
          <ProviderSection title="Видео" providers={videoIcons} />
        )}
      </div>

      {/* Список фич: 4 базовых + имена провайдеров этого тира.
          Свои плюшки (perks) не подмешиваем — как у ai-webapi. */}
      <FeatureList
        items={[
          ...BASE_FEATURES,
          ...tierProviders.map((p) => p.name),
        ]}
      />

      <Button
        large
        rounded
        onClick={() => onPick(variant)}
        className="mt-auto flex items-center justify-center gap-2"
      >
        <CreditCard size={18} />
        Купить {tier.name} {variant === 'plus' ? 'Plus' : ''}
      </Button>
    </Glass>
  )
}

function FeatureList({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false)
  const VISIBLE = 8
  const showToggle = items.length > VISIBLE
  const shown = open || !showToggle ? items : items.slice(0, VISIBLE)
  return (
    <div>
      {/* Двухколоночная сетка — как у ai-webapi. */}
      <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px] text-black/85 dark:text-white/80">
        {shown.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-[#10B981] text-white shrink-0 mt-0.5">
              <Check size={12} strokeWidth={3} />
            </span>
            <span className="min-w-0">{f}</span>
          </li>
        ))}
      </ul>
      {showToggle && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 flex items-center gap-1 text-[12px] font-semibold text-[#2a8bff]"
        >
          {open ? 'Свернуть' : `Показать все (${items.length})`}
          <ChevronDown
            size={12}
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      )}
    </div>
  )
}

function ProviderSection({
  title,
  providers,
}: {
  title: string
  providers: { file: string; name: string }[]
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-black/50 dark:text-white/40 mb-1.5">
        {title}
      </div>
      <div className="flex items-center flex-wrap gap-1 -space-x-1.5">
        {providers.map((p) => (
          <span
            key={p.file}
            title={p.name}
            className="group relative w-7 h-7 rounded-full bg-white ring-2 ring-white dark:ring-black overflow-visible
                       transition-transform duration-150 hover:scale-125 hover:z-30
                       cursor-default"
          >
            <img
              src={`/providers/${p.file}`}
              alt={p.name}
              className="w-full h-full object-cover rounded-full"
            />
            {/* Всплывающее имя над аватаркой — как у ai-webapi */}
            <span
              className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2
                         px-2 py-0.5 rounded-md text-[11px] font-medium text-white bg-black/85
                         whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity
                         shadow-md"
            >
              {p.name}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

function MatrixRow({ label, cells }: { label: string; cells: string[] }) {
  const HEADERS = ['Free', 'Start', 'Pro', 'Premium', 'Elite', 'Ultra']
  return (
    <div className="flex items-center px-4 py-3 gap-3">
      <div className="flex-1 min-w-0 text-[13px] text-black dark:text-white">
        {label}
      </div>
      <div className="grid grid-cols-6 gap-2 shrink-0 w-[210px] md:w-[280px]">
        {cells.map((c, i) => (
          <div
            key={i}
            className="text-center text-[12px] font-semibold text-black/70 dark:text-white/65"
            title={HEADERS[i]}
          >
            {c}
          </div>
        ))}
      </div>
    </div>
  )
}
