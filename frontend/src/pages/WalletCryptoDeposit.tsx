import { currencyNames } from "../wallet/catalog";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Card } from "konsta/react";
import { Check, Copy, ShieldAlert } from "lucide-react";
import QRCode from "react-qr-code";
import WalletNetworkIcon from "./WalletNetworkIcon";
import {
  addressNetworkNames,
  addressNetworkStandards,
  type WalletAddressSelection,
} from "./WalletAddressDetails";

export default function WalletCryptoDeposit({
  code,
  entry,
  icon,
  color,
  iconColor,
}: {
  code: string;
  entry: WalletAddressSelection;
  icon: ReactNode;
  color: string;
  iconColor: string;
}) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(""),
    [copyTick, setCopyTick] = useState(0);
  useEffect(() => {
    setCopied(false);
    setError("");
  }, [entry]);
  useEffect(() => {
    if (!copyTick) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
      setError("");
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [copyTick]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(entry.address);
      setCopied(true);
      setError("");
    } catch {
      setError("Не удалось скопировать адрес");
    } finally {
      setCopyTick((value) => value + 1);
    }
  }
  const network = entry.chain === "nile" ? "TRON Nile (тестовая сеть)" :
    (addressNetworkNames[entry.network] ?? entry.network);
  const standard = addressNetworkStandards[entry.network];
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-col gap-6 px-4 pb-28 pt-5 text-black dark:text-white">
      <section
        aria-label="QR-код пополнения"
        className="flex flex-col items-center py-3"
      >
        <div className="relative rounded-[28px] bg-white p-4">
          <QRCode
            value={
              entry.demo ? "WPAY-DEMO-NOT-A-PAYMENT-ADDRESS" : entry.address
            }
            size={210}
          />
          {entry.demo && (
            <span className="absolute inset-x-2 top-1/2 -translate-y-1/2 rounded-xl bg-white/95 px-2 py-2 text-center text-[13px] font-semibold text-black">
              Пример QR-кода
            </span>
          )}
        </div>
      </section>
      <section aria-label="Реквизиты кошелька">
        <h2 className="mb-3 px-2 text-[16px] font-semibold text-black/50 dark:text-white/50">
          Реквизиты кошелька
        </h2>
        <Card className="!m-0 !rounded-[28px]" contentWrapPadding="px-4 py-0">
          <dl>
            <div className="flex min-h-14 items-center justify-between gap-4 border-b border-black/[.06] py-3 dark:border-white/[.08]">
              <dt className="text-[15px] text-black/45 dark:text-white/45">
                Валюта
              </dt>
              <dd className="flex items-center gap-2 text-[16px] font-semibold">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full [&>svg]:!h-[18px] [&>svg]:!w-[18px]"
                  style={{
                    color: iconColor,
                    backgroundColor: color,
                    backgroundImage: `linear-gradient(180deg,color-mix(in srgb,${color} 62%,white),${color})`,
                  }}
                >
                  {icon}
                </span>
                {currencyNames[code] ?? code} · {code}
              </dd>
            </div>
            <div className="flex min-h-14 items-center justify-between gap-4 py-3">
              <dt className="text-[15px] text-black/45 dark:text-white/45">
                Сеть
              </dt>
              <dd className="flex min-w-0 items-center gap-2 text-right text-[15px] font-medium">
                <span className="wpay-deposit-network-avatar">
                  <WalletNetworkIcon network={entry.network} />
                </span>
                <span>
                  {network}
                  {standard && !["BTC", "TRX"].includes(code)
                    ? " · " + standard
                    : ""}
                </span>
              </dd>
            </div>
          </dl>
        </Card>
      </section>
      <section className="rounded-[28px] bg-white p-4 dark:bg-[#1c1c1e]" aria-label="Адрес пополнения">
        <p className="text-[13px] text-black/45 dark:text-white/45">Адрес</p>
        <button type="button" aria-label="Скопировать адрес пополнения" onClick={() => void copy()}
          className="mt-2 flex min-h-9 w-full items-center justify-between gap-3 text-left text-[14px] text-blue-600 dark:text-blue-400">
          <span className="min-w-0 break-all">{entry.address}</span>
          {copied ? <Check size={19} className="shrink-0" /> : <Copy size={19} className="shrink-0" />}
        </button>
      </section>
      <div className="flex gap-3 px-2">
        <ShieldAlert
          size={23}
          className="mt-0.5 shrink-0 text-orange-500 dark:text-orange-400"
        />
        <p className="text-[14px] leading-6 text-black/50 dark:text-white/50">
          Отправляйте только{" "}
          <strong className="font-semibold text-black/75 dark:text-white/75">
            {code}
          </strong>{" "}
          в сети{" "}
          <strong className="font-semibold text-black/75 dark:text-white/75">
            {network}
            {standard ? " (" + standard + ")" : ""}
          </strong>
          . Перевод в другой сети может привести к потере средств.
        </p>
      </div>
      {entry.provider === "wpay" && (
        <p className="px-2 text-[14px] text-black/45 dark:text-white/45">
          Перевод поступит на ваш кошелёк в блокчейне. Его баланс отображается отдельно от общего баланса приложения.
        </p>
      )}
      {entry.min_deposit && code === "USDT" && (
        <p className="px-2 text-[14px] text-black/45 dark:text-white/45">
          Минимум пополнения: {entry.min_deposit} USDT. Переводы меньше минимума
          не зачисляются.
        </p>
      )}
      <Button
        data-wpay-primary=""
        rounded
        className="wpay-bottom-action"
        onClick={() => void copy()}
      >
        Скопировать адрес
      </Button>
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-[max(80px,calc(env(safe-area-inset-bottom,0px)+72px))] left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-black px-5 py-3 text-[15px] font-medium text-white shadow-lg transition-[transform,opacity] duration-200 motion-reduce:transition-none dark:bg-white dark:text-black ${copied || error ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}
      >
        {copied && <Check size={18} />} {error || (copied ? "Скопировано" : "")}
      </div>
    </main>
  );
}
