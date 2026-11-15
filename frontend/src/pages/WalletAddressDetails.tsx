import {
  networkStandards as addressNetworkStandards,
  networkNames as addressNetworkNames,
} from "../wallet/catalog";
import { useEffect, useState, type ReactNode } from "react";
import { Card, List } from "konsta/react";
import { Copy, Check } from "lucide-react";
import { haptic } from "../lib/telegram";
import WalletNetworkIcon from "./WalletNetworkIcon";
import { cryptoAmount, usd, useLiveWallet } from "./WalletLive";
import { walletRequest } from "../lib/wallet-api";
import {
  TransactionListRow,
  TransactionDetails,
  type TransactionView,
} from "./WalletTransaction";

export interface WalletAddressSelection {
  network: string;
  address: string;
  demo: boolean;
  amount: number | null;
  rate: number | null;
  min_deposit?: string;
}
export {
  networkStandards as addressNetworkStandards,
  networkNames as addressNetworkNames,
} from "../wallet/catalog";
export default function WalletAddressDetails({
  entry,
  code,
  icon,
  color,
  iconColor,
  actions,
}: {
  actions: ReactNode;
  entry: WalletAddressSelection;
  code: string;
  icon: ReactNode;
  color: string;
  iconColor: string;
}) {
  const wallet = useLiveWallet();
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState(""),
    [toastTick, setToastTick] = useState(0);
  useEffect(() => {
    if (!toastTick) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
      setCopyError("");
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [toastTick]);
  const [selectedTransaction, setSelectedTransaction] =
    useState<TransactionView | null>(null);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [deposits, setDeposits] = useState<
    { id: string; amount: string; created_at?: string; status?: string }[]
  >([]);
  useEffect(() => {
    let active = true;
    setError("");
    setDeposits([]);
    setCopied(false);
    setCopyError("");
    if (entry.demo) return;
    setLoading(true);
    walletRequest<{
      items?: {
        deposit_id?: string;
        address?: string;
        network?: string;
        asset?: string;
        amount?: string;
        created_at?: string;
        status?: string;
      }[];
    }>("operations-deposits?count=100")
      .then((result) => {
        if (active)
          setDeposits(
            (result.items ?? [])
              .filter(
                (row) =>
                  row.address === entry.address &&
                  row.network === entry.network &&
                  row.asset === code,
              )
              .map((row, i) => ({
                id: row.deposit_id ?? String(i),
                amount: row.amount ?? "0",
                created_at: row.created_at,
                status: row.status,
              })),
          );
      })
      .catch(() => {
        if (active) setError("Не удалось загрузить поступления");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [entry, code]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(entry.address);
      setCopied(true);
      setCopyError("");
      haptic("light");
    } catch {
      setCopied(false);
      setCopyError("Не удалось скопировать адрес");
    } finally {
      setToastTick((value) => value + 1);
    }
  }
  const name = addressNetworkNames[entry.network] ?? entry.network;
  const rubQuote = wallet.data.rates.find(
    (item) =>
      item.is_valid &&
      ["USD", "USDT"].includes(item.source) &&
      item.target === "RUB",
  );
  const inverseRubQuote = wallet.data.rates.find(
    (item) =>
      item.is_valid &&
      item.source === "RUB" &&
      ["USD", "USDT"].includes(item.target),
  );
  const rubRate = entry.demo
    ? 92.5
    : rubQuote
      ? Number(rubQuote.rate)
      : inverseRubQuote && Number(inverseRubQuote.rate) > 0
        ? 1 / Number(inverseRubQuote.rate)
        : null;
  const rubAmount =
    entry.amount !== null && entry.rate !== null && rubRate !== null
      ? entry.amount * entry.rate * rubRate
      : null;
  const history: TransactionView[] = entry.demo
    ? [0.6, -0.1, 0.5].map((part, index) => ({
        id: `address-example-${entry.network}-${index}`,
        kind: part > 0 ? "deposit" : "withdrawal",
        status: "completed",
        amount: String(Number(((entry.amount ?? 0) * part).toFixed(8))),
        asset: code,
        date: `2026-11-${String(15 - index).padStart(2, "0")}T09:30:00Z`,
        rows: [
          ["Сеть", name],
          ["Адрес", entry.address],
        ],
        demo: true,
      }))
    : deposits.map((row) => ({
        id: row.id,
        kind: "deposit",
        status:
          row.status === "failed"
            ? "failed"
            : row.status === "processing"
              ? "processing"
              : "completed",
        amount: row.amount,
        asset: code,
        date: row.created_at ?? "",
        rows: [
          ["Сеть", name],
          ["Адрес", entry.address],
        ],
      }));

  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-col gap-5 px-4 pb-8 pt-4 text-black dark:text-white">
      <section
        className="wpay-address-hero flex flex-col items-center pb-2 pt-5 text-center"
        aria-label="Баланс адреса"
      >
        <span className="wpay-address-avatar">
          <span
            className="wpay-currency-icon flex h-[72px] w-[72px] items-center justify-center rounded-full [&>svg]:!h-10 [&>svg]:!w-10"
            style={{
              color: iconColor,
              backgroundColor: color,
              backgroundImage: `linear-gradient(180deg,color-mix(in srgb,${color} 62%,white),${color})`,
            }}
          >
            {icon}
          </span>
          <span className="wpay-address-network-badge">
            <WalletNetworkIcon network={entry.network} />
          </span>
        </span>
        <p className="mt-6 text-[40px] font-semibold leading-tight tracking-tight tabular-nums">
          {entry.amount !== null ? cryptoAmount(entry.amount) : "—"}{" "}
          <span className="text-[30px] font-medium text-black/40 dark:text-white/40">
            {code}
          </span>
        </p>
        <div className="wpay-address-fiat mt-2 flex items-center justify-center gap-3 whitespace-nowrap text-black/45 dark:text-white/45">
          <span className="tabular-nums">
            {entry.amount !== null && entry.rate !== null
              ? usd(entry.amount * entry.rate)
              : "—"}
          </span>
          <span aria-label="Баланс адреса в рублях" className="tabular-nums">
            {rubAmount !== null
              ? rubAmount.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }) + " ₽"
              : "— ₽"}
          </span>
        </div>
      </section>
      {actions}
      <section aria-label="Реквизиты кошелька">
        <h2 className="mb-3 px-2 text-[16px] font-semibold text-black/50 dark:text-white/50">
          Реквизиты кошелька
        </h2>
        <Card className="!m-0 !rounded-[26px]" contentWrapPadding="px-4 py-0">
          <dl>
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-black/[.06] py-3 dark:border-white/[.08]">
              <dt className="text-[15px] text-black/45 dark:text-white/45">
                Сеть
              </dt>
              <dd className="text-right text-[15px] font-medium">
                {name}
                {["BTC", "TRX"].includes(code)
                  ? ""
                  : " · " +
                    (addressNetworkStandards[entry.network] ?? entry.network)}
              </dd>
            </div>
            <div className="flex min-h-14 items-center justify-between gap-3 py-2">
              <dt className="text-[15px] text-black/45 dark:text-white/45">
                Адрес
              </dt>
              <dd className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  aria-label="Скопировать полный адрес"
                  onClick={() => void copyAddress()}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary active:bg-black/5 dark:active:bg-white/10"
                >
                  {copied ? <Check size={20} /> : <Copy size={20} />}
                </button>
                <span className="font-mono text-[14px] font-medium">
                  {entry.address.length > 26
                    ? entry.address.slice(0, 12) +
                      "…" +
                      entry.address.slice(-10)
                    : entry.address}
                </span>
              </dd>
            </div>
          </dl>
        </Card>
      </section>
      <section>
        <h2 className="mb-3 px-2 text-[16px] font-semibold text-black/50 dark:text-white/50">
          История транзакций
        </h2>
        {history.length ? (
          <List
            strong
            inset
            dividers
            className="!mx-0 !my-0 overflow-hidden !rounded-[30px] [&>ul]:!rounded-[30px]"
          >
            {history.map((item) => (
              <TransactionListRow
                key={item.id}
                item={item}
                onSelect={setSelectedTransaction}
              />
            ))}
          </List>
        ) : (
          <Card className="!m-0 !rounded-[30px]" contentWrapPadding="px-4 py-2">
            <p className="py-5 text-center text-[14px] text-black/45 dark:text-white/45">
              {loading ? "Загружаем историю…" : error || "Транзакций пока нет"}
            </p>
          </Card>
        )}
      </section>
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-[max(24px,env(safe-area-inset-bottom,0px))] left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-black px-5 py-3 text-[15px] font-medium text-white shadow-lg transition-[transform,opacity] duration-200 motion-reduce:transition-none dark:bg-white dark:text-black ${copied || copyError ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}
      >
        {copied && <Check size={18} />}{" "}
        {copyError || (copied ? "Скопировано" : "")}
      </div>
      <TransactionDetails
        item={selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
      />
    </main>
  );
}
