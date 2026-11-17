import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Sheet, Preloader } from "framework7-react";
import { Card, Button } from "konsta/react";
import { Copy, Check, ChevronRight } from "lucide-react";
import QRCode from "react-qr-code";
import { walletRequest } from "../lib/wallet-api";
import WalletAssetAvatar from "./WalletAssetAvatar";
import WalletSheetClose from "./WalletSheetClose";
import { cryptoAmount } from "./WalletLive";

const networks: Record<string, string[]> = {
  BTC: ["BTC"],
  ETH: ["ETH"],
  BNB: ["BSC"],
  TON: ["TON"],
  SOL: ["SOL"],
  TRX: ["TRON"],
  USDT: ["BSC", "ETH", "TON", "SOL", "TRON"],
  XAUT: ["ETH"],
};
const names: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  BSC: "BNB Smart Chain",
  TON: "TON",
  SOL: "Solana",
  TRON: "TRON",
};
type Owned = {
  id: string;
  network: string;
  address: string;
  chain_env: string;
  balance?: { amount: string | null; status: string };
};
type Status = { configured: boolean; chain_env: string };

/** Independent chain observations: never presented as spendable provider credit. */
export default function WalletOwnedWallets({
  code,
  active,
  icon,
  color,
  iconColor,
}: {
  code: string;
  active: boolean;
  icon: ReactNode;
  color: string;
  iconColor: string;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [rows, setRows] = useState<Owned[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Owned | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!active || !networks[code]) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const signal = controller.signal;
    setRows([]);
    setStatus(null);
    setError("");
    setLoading(true);
    setSelected(null);
    async function balances() {
      try {
        const result = await walletRequest<{ items: Owned[] }>(
          `custody-asset-balances?asset=${encodeURIComponent(code)}`,
          undefined,
          signal,
        );
        if (!signal.aborted) setRows(result.items);
      } catch (e) {
        if (!signal.aborted)
          setError(e instanceof Error ? e.message : "Баланс сети недоступен");
      } finally {
        if (!signal.aborted) timer = setTimeout(balances, 60_000);
      }
    }
    void (async () => {
      try {
        const capability = await walletRequest<Status>(
          "custody-status",
          undefined,
          signal,
        );
        if (signal.aborted) return;
        setStatus(capability);
        if (!capability.configured) return;
        if (!["mainnet", "testnet"].includes(capability.chain_env))
          throw new Error("Сеть кошелька не определена");
        // Server controls ownership, environment and derivation. Repeat returns the same wallet.
        const created: Owned[] = [];
        for (const network of networks[code]) {
          const row = await walletRequest<Owned>(
            "custody-wallet",
            { network },
            signal,
          );
          if (
            !row.id ||
            typeof row.address !== "string" ||
            !row.address ||
            row.network !== network ||
            row.chain_env !== capability.chain_env
          )
            throw new Error("Получены некорректные реквизиты кошелька");
          created.push(row);
          if (!signal.aborted) setRows([...created]);
        }
        if (!signal.aborted) void balances();
      } catch (e) {
        if (!signal.aborted)
          setError(
            e instanceof Error ? e.message : "Не удалось создать кошелёк",
          );
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, code, retry]);
  useEffect(() => {
    setCopied(false);
  }, [selected]);
  if (!networks[code]) return null;
  const environment = status?.chain_env === "mainnet" ? "Mainnet" : "Testnet";
  return (
    <section className="px-4 pb-3 pt-6" aria-label="Собственные кошельки">
      <div className="mb-3 flex items-center justify-between gap-2 px-2">
        <h3 className="text-[16px] font-semibold text-black/50 dark:text-white/50">
          Мои адреса в сети
        </h3>
        {status?.configured && (
          <span className="text-xs text-black/45 dark:text-white/45">
            wPay · {environment}
          </span>
        )}
      </div>
      <Card className="!m-0 !rounded-[30px]" contentWrapPadding="px-4 py-0">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => setSelected(row)}
            className="flex min-h-16 w-full items-center justify-between gap-3 border-b border-black/[.06] py-2 text-left last:border-0 active:bg-black/10 dark:border-white/[.08] dark:active:bg-white/10"
          >
            <span className="flex min-w-0 items-center gap-3">
              <WalletAssetAvatar
                {...{ icon, color, iconColor }}
                network={row.network}
              />
              <span className="min-w-0">
                <span className="block text-[15px] font-medium">
                  {code} · {names[row.network]}
                </span>
                <span className="block truncate text-xs text-black/45 dark:text-white/45">
                  {row.address.slice(0, 9)}…{row.address.slice(-7)}
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-right text-sm tabular-nums">
                {row.balance?.status === "ok" && row.balance.amount !== null
                  ? cryptoAmount(row.balance.amount)
                  : "—"}
              </span>
              <ChevronRight size={16} className="opacity-30" />
            </span>
          </button>
        ))}
        {loading && (
          <div className="flex items-center gap-3 py-4 text-sm">
            <Preloader size={20} />
            Создаём адреса…
          </div>
        )}
        {status && !status.configured && (
          <p className="py-4 text-sm text-black/50 dark:text-white/50">
            Создание собственных кошельков пока не подключено.
          </p>
        )}
        {error && (
          <div className="py-3 text-sm">
            <p role="status">{error}</p>
            <button
              className="mt-2 text-primary"
              onClick={() => setRetry((n) => n + 1)}
            >
              Повторить
            </button>
          </div>
        )}
      </Card>
      {status?.configured && (
        <p className="px-2 pt-2 text-xs leading-5 text-black/45 dark:text-white/45">
          Собственные адреса wPay. Баланс читается из блокчейна отдельно от
          баланса приложения. Автоматическое зачисление и вывод ещё не
          подключены.
        </p>
      )}
      {createPortal(
        <Sheet
          opened={selected !== null}
          onSheetClosed={() => setSelected(null)}
          backdrop
          closeByBackdropClick
          closeOnEscape
          swipeToClose
          swipeHandler=".owned-address-header"
          className="wpay-exchange-sheet"
        >
          <header className="owned-address-header px-5 pb-4 pt-3">
            <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-black/15 dark:bg-white/20" />
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Адрес {code}</h2>
                <p className="text-sm opacity-50">
                  {selected && names[selected.network]} ·{" "}
                  {selected?.chain_env === "mainnet" ? "Mainnet" : "Testnet"} ·
                  wPay
                </p>
              </div>
              <WalletSheetClose onClick={() => setSelected(null)} />
            </div>
          </header>
          {selected && (
            <div className="overflow-y-auto px-5 pb-8">
              <div className="mx-auto my-4 w-fit rounded-[24px] bg-white p-4">
                <QRCode value={selected.address} size={192} />
              </div>
              <p className="break-all rounded-2xl bg-black/5 p-4 text-center text-sm dark:bg-white/10">
                {selected.address}
              </p>
              <p className="my-4 text-sm opacity-60">
                Это собственный адрес wPay в сети {names[selected.network]}.
                Средства на нём пока нельзя использовать для оплаты карт и
                операций приложения.{" "}
                {selected.chain_env !== "mainnet" &&
                  "Не отправляйте настоящие монеты в тестовую сеть."}
              </p>
              <Button
                large
                rounded
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(selected.address);
                    setCopied(true);
                  } catch {
                    setError("Не удалось скопировать адрес");
                  }
                }}
              >
                <span className="flex items-center gap-2">
                  {copied ? <Check size={18} /> : <Copy size={18} />}
                  {copied ? "Скопировано" : "Скопировать адрес"}
                </span>
              </Button>
            </div>
          )}
        </Sheet>,
        document.body,
      )}
    </section>
  );
}
