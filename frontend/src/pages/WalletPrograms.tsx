import ChevronRight from "framework7-icons/react/esm/ChevronRight.js";
import WalletReferralHero from "./WalletReferralHero";
import { useEffect, useMemo, useState } from "react";
import { Button, Card } from "konsta/react";
import { walletRequest } from "../lib/wallet-api";
import { haptic, tg } from "../lib/telegram";
const surface = "!m-0 !rounded-[28px]";
export {
  WithdrawalMethods,
  WithdrawalForm,
  withdrawalTitles,
} from "./WalletWithdrawal";
export type { WithdrawalMethod } from "./WalletWithdrawal";
type ReferralData = {
  link: string;
  invited: number;
  rewards: Record<string, string>;
  activity: { day: string; count: number }[];
  rewards_enabled: boolean;
};
export function ReferralProgram() {
  const [period, setPeriod] = useState(30),
    [conditions, setConditions] = useState(false),
    [data, setData] = useState<ReferralData | null>(null),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    walletRequest<ReferralData>("referrals", undefined, controller.signal)
      .then(setData)
      .catch((reason) => {
        if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Не удалось загрузить данные");
      });
    return () => controller.abort();
  }, []);
  const activity = useMemo(() => {
    const cutoff = Date.now() - (period - 1) * 86400000;
    return (data?.activity || []).filter((row) => Date.parse(row.day) >= cutoff);
  }, [data, period]);
  const maxActivity = Math.max(1, ...activity.map((row) => Number(row.count)));
  async function copyLink() {
    if (!data?.link) return;
    await navigator.clipboard.writeText(data.link);
    setCopied(true); haptic("success");
    window.setTimeout(() => setCopied(false), 1800);
  }
  function shareLink() {
    if (!data?.link) return;
    const url = `https://t.me/share/url?url=${encodeURIComponent(data.link)}&text=${encodeURIComponent("Присоединяйся ко мне в WPay")}`;
    if (tg()?.openTelegramLink) tg()?.openTelegramLink?.(url); else window.open(url, "_blank", "noopener,noreferrer");
    haptic("light");
  }
  return (
    <div className="flex flex-col gap-5 px-4 pt-3 pb-6">
      <WalletReferralHero />
      <div className="grid grid-cols-2 gap-3">
        {[
          ["Приглашено", data ? String(data.invited) : "—", "пользователей"],
          ["Вознаграждения", data ? (data.rewards.USDT || "0") : "—", "USDT за всё время"],
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
            value={data?.link || ""}
            placeholder="Ссылка появится после запуска"
            className="w-full bg-transparent text-[14px] text-black placeholder:text-black/35 dark:text-white dark:placeholder:text-white/35"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button data-wpay-primary="" rounded tonal disabled={!data?.link} onClick={() => void copyLink()}>
            {copied ? "Скопировано" : "Скопировать"}
          </Button>
          <Button data-wpay-primary="" rounded disabled={!data?.link} onClick={shareLink}>
            Поделиться
          </Button>
        </div>
        <p className="mt-3 text-[12px] leading-5 text-black/40 dark:text-white/40">
          {error || "Друг должен впервые запустить бота именно по этой ссылке. Пригласивший закрепляется один раз."}
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
        <div className="relative mt-5 flex h-40 items-end gap-1 overflow-hidden rounded-[16px] border-b border-black/10 px-2 pt-3 dark:border-white/10" role="img" aria-label={`График приглашений за ${period} дней`}>
          {activity.length ? activity.map((row) => (
            <div key={row.day} title={`${row.day}: ${row.count}`} className="min-w-2 flex-1 rounded-t-md bg-primary/70" style={{ height: `${Math.max(8, Number(row.count) / maxActivity * 100)}%` }} />
          )) : <div className="m-auto self-center text-[14px] text-black/40 dark:text-white/40">За этот период приглашений пока нет</div>}
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
                "Скопируйте персональную ссылку или отправьте её через Telegram.",
              ],
              [
                "02",
                "Приглашайте друзей",
                "Засчитывается новый пользователь, впервые запустивший бота по вашей ссылке.",
              ],
              [
                "03",
                "Следите за результатами",
                "Количество приглашённых и активность обновляются автоматически.",
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
          Учёт приглашений уже работает. Денежные вознаграждения пока не
          начисляются — ставка и условия будут включены только после публикации правил.
        </p>
      </Card>
    </div>
  );
}
