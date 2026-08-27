import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, HelpCircle } from 'lucide-react'
import { Navbar, NavbarBackLink, Page } from 'konsta/react'
import { haptic } from '../lib/telegram'

// FAQ — тексты из ai-webapi (assets/i18n/ru.json → faq). Категории: общие,
// токены, подписки. <strong> в ответах заменил на **markdown-подобное
// bold**, рендерю просто в текст (без markdown-парсера).

interface QA {
  q: string
  a: string
}

interface Category {
  id: string
  label: string
  items: QA[]
}

const CATEGORIES: Category[] = [
  {
    id: 'general',
    label: 'Общие вопросы',
    items: [
      {
        q: 'Что такое aiMe?',
        a: 'aiMe — это платформа, которая объединяет все популярные AI-модели в одном месте. Вы можете общаться с ChatGPT, Claude, Gemini, Grok и другими моделями, не переключаясь между разными сервисами. Просто выберите нужную модель и начните работать.',
      },
      {
        q: 'Как начать пользоваться сервисом?',
        a: 'Зарегистрируйтесь через Telegram или Google аккаунт. После регистрации вы получите приветственные токены, которых хватит для тестирования сервиса. Выберите AI-модель на главной странице и начните диалог.',
      },
      {
        q: 'Какие AI-модели доступны?',
        a: 'Мы предоставляем доступ к ведущим моделям: ChatGPT (GPT-4o, GPT-4o mini), Claude (3.5 Sonnet, 3.5 Haiku), Gemini (2.0 Flash, Pro 1.5), Grok, DeepSeek, Perplexity, Qwen и другим. Список моделей постоянно расширяется.',
      },
      {
        q: 'Как защищены мои данные?',
        a: 'Мы серьёзно относимся к конфиденциальности. Ваши диалоги зашифрованы и не передаются третьим лицам. Мы соблюдаем требования 152-ФЗ о персональных данных и используем шифрование для хранения чувствительной информации.',
      },
    ],
  },
  {
    id: 'tokens',
    label: 'Токены и баланс',
    items: [
      {
        q: 'Что такое токены?',
        a: 'Токены — это внутренняя валюта платформы, которая используется для оплаты запросов к AI-моделям. Каждый запрос списывает определённое количество токенов в зависимости от модели и объёма сгенерированного текста.',
      },
      {
        q: 'Как пополнить токены?',
        a: 'Перейдите в раздел «Мои токены» в профиле и выберите сумму пополнения. Мы принимаем оплату банковскими картами и через СБП. Токены зачисляются моментально после оплаты.',
      },
      {
        q: 'Сгорают ли токены?',
        a: 'Токены подписки сгорают в конце периода. Токены, купленные разово, срока действия не имеют и остаются на балансе, даже если подписка неактивна.',
      },
      {
        q: 'Сколько стоят токены?',
        a: 'Стоимость зависит от выбранной AI-модели. Например, GPT-4o стоит примерно 10–15 токенов за 1000 символов, более доступные модели вроде GPT-4o mini или Claude Haiku — 1–3 токена. Точную стоимость вы видите в разделе «Расход токенов».',
      },
    ],
  },
  {
    id: 'subscriptions',
    label: 'Подписки и тарифы',
    items: [
      {
        q: 'Что даёт подписка?',
        a: 'Подписка включает фиксированное количество токенов ежемесячно по выгодной цене. Например, тариф Start даёт 100 000 токенов/месяц, Pro — 250 000, Premium — 500 000. Подписчики также получают бонусные токены при первой оплате.',
      },
      {
        q: 'В чём разница между тарифами?',
        a: 'Тарифы отличаются количеством включённых токенов и бонусами. Чем выше тариф, тем больше токенов и тем выгоднее цена за токен. Тариф Universal — корпоративный, с индивидуальными условиями.',
      },
      {
        q: 'Как перейти на другой тариф?',
        a: 'Перейдите в раздел «Тарифы», выберите нужный план и оплатите. Если у вас уже есть активная подписка, неиспользованные дни текущего тарифа будут пересчитаны и зачтены при переходе на новый.',
      },
      {
        q: 'Можно ли отменить подписку?',
        a: 'Да, вы можете отменить подписку в любое время. В разделе «Настройки → Автопродление» отключите автоматическое продление. Подписка останется активной до конца оплаченного периода.',
      },
      {
        q: 'Что такое автопродление?',
        a: 'Автопродление автоматически продлевает вашу подписку до истечения срока действия, используя сохранённую карту. Автопродление удобно, чтобы не терять доступ к сервису.',
      },
    ],
  },
]

// Одна раскрывашка с вопросом и ответом. Дизайн — iOS Settings-style
// row: вопрос сверху, шеврон справа, ответ распахивается ниже.
function QAItem({ item }: { item: QA }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          haptic('light')
          setOpen((v) => !v)
        }}
        className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-black/[.04] dark:active:bg-white/[.04]"
      >
        <span className="flex-1 min-w-0 text-[15px] font-medium text-black dark:text-white">
          {item.q}
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-black/40 dark:text-white/40 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="px-4 pb-3 -mt-1 text-[13px] text-black/60 dark:text-white/55 leading-relaxed">
          {item.a}
        </div>
      )}
    </div>
  )
}

export default function FaqPage() {
  const nav = useNavigate()

  return (
    <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="FAQ"
        left={<NavbarBackLink text="Назад" onClick={() => nav(-1)} />}
      />

      <div className="mx-auto w-full max-w-[560px] px-safe-4 mt-4">
        {/* Заглавие + описание */}
        <div className="rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 p-5">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-full flex items-center justify-center bg-[#2a8bff]/12 text-[#2a8bff]">
              <HelpCircle size={22} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[17px] font-semibold text-black dark:text-white leading-tight">
                Часто задаваемые вопросы
              </div>
              <div className="text-[13px] text-black/55 dark:text-white/50 mt-0.5">
                Ответы на самые популярные вопросы о сервисе
              </div>
            </div>
          </div>
        </div>

        {/* Категории */}
        {CATEGORIES.map((cat) => (
          <div key={cat.id} className="mt-6">
            <div className="text-[13px] font-medium uppercase tracking-wide text-black/45 dark:text-white/40 px-4 mb-2">
              {cat.label}
            </div>
            <div className="rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 overflow-hidden">
              <div className="divide-y divide-black/[.06] dark:divide-white/[.06]">
                {cat.items.map((item, i) => (
                  <QAItem key={i} item={item} />
                ))}
              </div>
            </div>
          </div>
        ))}

        {/* Футер: связаться с поддержкой */}
        <div className="mt-6 rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 p-5 text-center mb-4">
          <div className="text-[15px] font-semibold text-black dark:text-white">
            Не нашли ответ?
          </div>
          <div className="text-[13px] text-black/55 dark:text-white/50 mt-1">
            Свяжитесь с поддержкой — обязательно поможем
          </div>
          <button
            type="button"
            onClick={() => {
              haptic('light')
              nav('/support')
            }}
            className="mt-4 w-full h-11 rounded-full bg-[#2a8bff] text-white text-[15px] font-semibold active:opacity-80"
          >
            Связаться с поддержкой
          </button>
        </div>
      </div>
    </Page>
  )
}
