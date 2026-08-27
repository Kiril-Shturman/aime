import { useNavigate } from 'react-router-dom'
import { Navbar, NavbarBackLink, Page } from 'konsta/react'
import BitcoinCircleFill from 'framework7-icons/react/esm/BitcoinCircleFill.js'
import { haptic } from '../lib/telegram'

// Заглушка баланса токенов — из ai-webapi subscription-overview.
// Реальные данные из /api/subscription/user/tokens прикрутим на Шаге 2.
const BALANCE = 10_240
const LIMIT = 100_000

export default function BalancePage() {
  const nav = useNavigate()
  const progress = LIMIT ? Math.min(1, BALANCE / LIMIT) : 0
  const nf = new Intl.NumberFormat('ru-RU')

  return (
    <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="Мои токены"
        left={<NavbarBackLink text="Назад" onClick={() => nav(-1)} />}
      />

      <div className="mx-auto w-full max-w-[560px] px-safe-4 mt-4">
        {/* Крупная карточка с балансом и прогресс-баром */}
        <div className="rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 p-5">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-full flex items-center justify-center bg-[#f59e0b]/15 text-[#f59e0b] text-[24px]">
              <BitcoinCircleFill />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-black/55 dark:text-white/50">
                Осталось токенов
              </div>
              <div className="text-[24px] font-semibold text-black dark:text-white tabular-nums leading-tight">
                {nf.format(BALANCE)}
                <span className="text-[15px] font-medium text-black/45 dark:text-white/40 ms-1">
                  / {nf.format(LIMIT)}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 h-2 rounded-full bg-black/[.06] dark:bg-white/[.08] overflow-hidden">
            <span
              className="block h-full bg-[#f59e0b] rounded-full transition-[width]"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[12px] text-black/45 dark:text-white/40">
            <span>Использовано {nf.format(LIMIT - BALANCE)}</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>

          <button
            type="button"
            onClick={() => {
              haptic('light')
              nav('/tariffs')
            }}
            className="mt-5 w-full h-11 rounded-full bg-[#2a8bff] text-white text-[15px] font-semibold active:opacity-80"
          >
            Пополнить токены
          </button>
        </div>

        <div className="mt-4 rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 px-4 py-4">
          <div className="text-[13px] text-black/60 dark:text-white/55 leading-relaxed">
            Токены расходуются на запросы к нейросетям. Неиспользованные
            токены не переносятся на следующий период. Расход по каждой
            модели — на странице «Расход токенов».
          </div>
        </div>
      </div>
    </Page>
  )
}
