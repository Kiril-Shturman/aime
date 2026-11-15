import {
  networkStandards as addressNetworkStandards,
  networkNames as addressNetworkNames,
} from "../wallet/catalog";
import { useEffect, useState, type ReactNode } from "react";
import { Card, List } from "konsta/react";
import { Copy, Check } from "lucide-react";
import type { ChainBalance } from "./WalletChainPortfolio";
import { haptic } from "../lib/telegram";
import WalletNetworkIcon from "./WalletNetworkIcon";
import { chainAmount } from "../lib/chain-amount";
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
  amount: number | string | null;
  custody_id?: string;
  observed_at?: number;
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
  const [observed, setObserved] = useState<ChainBalance | null>(null);
  const [balanceError, setBalanceError] = useState("");
  useEffect(() => {
    if (!entry.custody_id) return;
    const abort = new AbortController();
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const result = await walletRequest<ChainBalance>(
          `custody-balance?wallet_id=${encodeURIComponent(entry.custody_id!)}&asset=${encodeURIComponent(code)}`,
          undefined,
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setObserved(result);
          setBalanceError(result.error ?? "");
        }
      } catch (reason) {
        if (!abort.signal.aborted) {
          setObserved({
            wallet_id: entry.custody_id!,
            asset: code,
            network: entry.network,
            chain_env: "",
            amount: null,
            checked_at: Date.now() / 1000,
            status: "unavailable",
            error: "",
          });
          setBalanceError(
            reason instanceof Error
              ? reason.message
              : "Не удалось прочитать баланс",
          );
        }
      } finally {
        running = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      abort.abort();
      window.clearInterval(timer);
    };
  }, [entry.custody_id, entry.network, code]);
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
    if (entry.demo || entry.custody_id) return;
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
  const rubRate = rubQuote
    ? Number(rubQuote.rate)
    : inverseRubQuote && Number(inverseRubQuote.rate) > 0
      ? 1 / Number(inverseRubQuote.rate)
      : null;
  const amount = entry.demo
    ? null
    : entry.custody_id &&
        observed?.wallet_id === entry.custody_id &&
        observed.asset === code
      ? observed.amount
      : entry.amount;
  const rubAmount =
    amount !== null && entry.rate !== null && rubRate !== null
      ? Number(amount) * entry.rate * rubRate
      : null;
  const history: TransactionView[] = entry.demo
    ? []
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
          {amount !== null
            ? entry.custody_id
              ? chainAmount(String(amount))
              : cryptoAmount(amount)
            : "—"}{" "}
          <span className="text-[30px] font-medium text-black/40 dark:text-white/40">
            {code}
          </span>
        </p>
        <div className="wpay-address-fiat mt-2 flex items-center justify-center gap-3 whitespace-nowrap text-black/45 dark:text-white/45">
          <span className="tabular-nums">
            {amount !== null && entry.rate !== null
              ? usd(Number(amount) * entry.rate)
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
      {balanceError && (
        <p role="alert" className="text-[14px] text-red-600 dark:text-red-400">
          {balanceError}
        </p>
      )}
      {entry.custody_id && (
        <p className="text-center text-[12px] text-black/45 dark:text-white/45">
          Баланс из сети · обновление каждые 30 секунд
        </p>
      )}
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
