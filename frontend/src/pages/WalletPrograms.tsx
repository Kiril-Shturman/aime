import ChevronRight from "framework7-icons/react/esm/ChevronRight.js";
import WalletReferralHero from "./WalletReferralHero";
import { useState } from "react";
import { Button, Card } from "konsta/react";
const surface = "!m-0 !rounded-[28px]";
export {
  WithdrawalMethods,
  WithdrawalForm,
  withdrawalTitles,
} from "./WalletWithdrawal";
export type { WithdrawalMethod } from "./WalletWithdrawal";
export function ReferralProgram() {
  const [period, setPeriod] = useState(30),
    [conditions, setConditions] = useState(false);
  return (
    <div className="flex flex-col gap-5 px-4 pt-3 pb-6">
      <WalletReferralHero />
      <div className="grid grid-cols-2 gap-3">
        {[
          ["Приглашено", "—", "пользователей"],
          ["Вознаграждения", "—", "USDT за всё время"],
        ].map(([label, value, caption]) => (
          <div
            key={label}
            className="rounded-[26px] bg-white p-5 dark:bg-[#1c1c1e]"
          >
            <p className="text-[14px] text-black/45 dark:text-white/45">
              {label}
            </p>
            <p className="mt-3 text-[32px] font-semibold tabular-nums text-black dark:text-white">
              {value}
            </p>
            <p className="mt-1 text-[12px] text-black/35 dark:text-white/35">
              {caption}
            </p>
          </div>
        ))}
      </div>
      <Card className={surface} contentWrapPadding="p-5">
        <h3 className="text-[20px] font-semibold text-black dark:text-white">
          Ваша ссылка
        </h3>
        <div className="mt-4 rounded-[18px] bg-black/5 px-4 py-3 dark:bg-white/5">
          <input
            aria-label="Реферальная ссылка"
            readOnly
            value=""
            placeholder="Ссылка появится после запуска"
            className="w-full bg-transparent text-[14px] text-black placeholder:text-black/35 dark:text-white dark:placeholder:text-white/35"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button data-wpay-primary="" rounded tonal disabled>
            Скопировать
          </Button>
          <Button data-wpay-primary="" rounded disabled>
            Поделиться
          </Button>
        </div>
        <p className="mt-3 text-[12px] leading-5 text-black/40 dark:text-white/40">
          Персональные ссылки пока не выпускаются.
        </p>
      </Card>
      <Card className={surface} contentWrapPadding="p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[20px] font-semibold text-black dark:text-white">
            Активность
          </h3>
          <span className="text-[13px] text-black/40 dark:text-white/40">
            Приглашения
          </span>
        </div>
        <div className="mt-4 flex gap-1 rounded-full bg-black/5 p-1 dark:bg-white/5">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={period === days}
              onClick={() => setPeriod(days)}
              className={`min-h-9 flex-1 rounded-full text-[14px] ${period === days ? "bg-white font-semibold text-black shadow-sm dark:bg-[#3a3a3c] dark:text-white" : "text-black/45 dark:text-white/45"}`}
            >
              {days} дней
            </button>
          ))}
        </div>
        <div
          className="relative mt-5 h-40 overflow-hidden rounded-[16px]"
          role="img"
          aria-label={`График приглашений за ${period} дней: данные пока недоступны`}
        >
          <svg
            className="h-full w-full text-black/10 dark:text-white/10"
            viewBox="0 0 300 160"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {[20, 60, 100, 140].map((y) => (
              <line
                key={y}
                x1="0"
                y1={y}
                x2="300"
                y2={y}
                stroke="currentColor"
                strokeDasharray="3 5"
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="rounded-full bg-white px-4 py-2 text-[14px] font-medium text-black/45 dark:bg-[#1c1c1e] dark:text-white/45">
              Статистика ещё не подключена
            </span>
          </div>
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-black/35 dark:text-white/35">
          <span>
            {new Date(Date.now() - (period - 1) * 86400000).toLocaleDateString(
              "ru-RU",
              { day: "numeric", month: "short" },
            )}
          </span>
          <span>Сегодня</span>
        </div>
      </Card>
      <Card className={surface} contentWrapPadding="p-5">
        <button
          type="button"
          aria-expanded={conditions}
          onClick={() => setConditions(!conditions)}
          className="flex min-h-9 w-full items-center justify-between gap-3 text-left text-[20px] font-semibold text-black dark:text-white"
        >
          Как это работает
          <ChevronRight
            className={`text-[18px] text-black/35 transition-transform dark:text-white/35 ${conditions ? "rotate-90" : ""}`}
          />
        </button>
        {conditions && (
          <ol className="mt-5 space-y-4">
            {[
              [
                "01",
                "Поделитесь ссылкой",
                "После запуска программы здесь появится персональная ссылка.",
              ],
              [
                "02",
                "Приглашайте друзей",
                "По ссылке будут учитываться новые участники программы.",
              ],
              [
                "03",
                "Следите за результатами",
                "Начисления будут доступны по опубликованным условиям программы.",
              ],
            ].map(([number, title, text]) => (
              <li key={number} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-semibold text-primary dark:bg-primary/20">
                  {number}
                </span>
                <span>
                  <strong className="text-[16px] font-semibold text-black dark:text-white">
                    {title}
                  </strong>
                  <span className="mt-1 block text-[14px] leading-5 text-black/45 dark:text-white/45">
                    {text}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 text-[13px] leading-5 text-black/40 dark:text-white/40">
          Программа готовится к запуску. Размер вознаграждений, условия
          начисления и вывода пока не опубликованы.
        </p>
      </Card>
    </div>
  );
}
