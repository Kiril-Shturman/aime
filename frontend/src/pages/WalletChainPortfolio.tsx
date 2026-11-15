import { useEffect, useState, type ReactNode } from "react";
import { Card } from "konsta/react";
import { walletRequest } from "../lib/wallet-api";
import { chainAmount } from "../lib/chain-amount";
import { usd, useLiveWallet } from "./WalletLive";
import WalletAssetAvatar from "./WalletAssetAvatar";
import { networkNames, networkStandards } from "../wallet/catalog";
import type { WalletAddressSelection } from "./WalletAddressDetails";
export type ChainBalance = {
  wallet_id: string;
  asset: string;
  network: string;
  chain_env: string;
  amount: string | null;
  checked_at: number;
  status: "ok" | "unavailable";
  error: string | null;
};
type Row = {
  id: string;
  network: string;
  address: string;
  chain_env: string;
  balance: ChainBalance;
};
type Portfolio = {
  asset: string;
  amount: string | null;
  complete: boolean;
  items: Row[];
};
export default function WalletChainPortfolio({
  code,
  active,
  icon,
  color,
  iconColor,
  onOpenAddress,
}: {
  code: string;
  active: boolean;
  icon: ReactNode;
  color: string;
  iconColor: string;
  onOpenAddress: (entry: WalletAddressSelection) => void;
}) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null),
    [error, setError] = useState("");
  const live = useLiveWallet();
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const result = await walletRequest<Portfolio>(
          "custody-asset",
          { asset: code },
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setPortfolio(result);
          window.dispatchEvent(new Event("wpay:custody-created"));
          setError(
            result.complete
              ? ""
              : "Не удалось прочитать часть сетей. Нулевой баланс не подставляется.",
          );
        }
      } catch (reason) {
        if (!abort.signal.aborted) {
          setPortfolio(null);
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось получить кошелёк",
          );
        }
      } finally {
        running = false;
      }
    };
    void refresh();
    // Later refreshes read balances only: they must not restore a wallet the user hid.
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || running) return;
      running = true;
      void walletRequest<Portfolio>(
        `custody-asset-balances?asset=${encodeURIComponent(code)}`,
        undefined,
        abort.signal,
      )
        .then((result) => {
          if (!abort.signal.aborted) {
            setPortfolio(result);
            setError(result.complete ? "" : "Не удалось прочитать часть сетей");
          }
        })
        .catch((reason) => {
          if (!abort.signal.aborted) {
            setPortfolio(null);
            setError(
              reason instanceof Error
                ? reason.message
                : "Не удалось обновить баланс",
            );
          }
        })
        .finally(() => {
          running = false;
        });
    }, 30000);
    const hidden = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      setPortfolio((previous) =>
        previous
          ? {
              ...previous,
              items: previous.items.filter((row) => row.id !== id),
            }
          : previous,
      );
    };
    window.addEventListener("wpay:custody-hidden", hidden);
    return () => {
      abort.abort();
      window.clearInterval(timer);
      window.removeEventListener("wpay:custody-hidden", hidden);
    };
  }, [active, code]);
  const rate = live.rate(code);
  const amount = portfolio?.asset === code ? portfolio.amount : null;
  return (
    <section className="px-4 pb-3 pt-6" aria-label="Портфель из блокчейна">
      <h3 className="mb-3 px-2 text-[16px] font-semibold text-black/50 dark:text-white/50">
        Ваш портфель
      </h3>
      <Card className="!m-0 !rounded-[30px]" contentWrapPadding="px-4 py-0">
        <div
          className="min-h-[80px] border-b border-black/[.06] py-4 dark:border-white/[.08]"
          aria-label="Фактический баланс актива"
        >
          <p className="text-[20px] font-semibold tabular-nums text-black dark:text-white">
            {amount !== null ? chainAmount(amount) : "—"} {code}
          </p>
          <p className="mt-1 text-[13px] text-black/45 dark:text-white/45">
            {amount !== null && rate !== null
              ? usd(Number(amount) * rate)
              : "— USD"}
          </p>
        </div>
        {portfolio?.asset === code &&
          portfolio.items.map((row) => (
            <button
              key={row.id}
              type="button"
              aria-label={`Открыть адрес ${row.network}`}
              onClick={() =>
                onOpenAddress({
                  network: row.network,
                  address: row.address,
                  custody_id: row.id,
                  demo: false,
                  amount: row.balance.amount,
                  observed_at: row.balance.checked_at,
                  rate,
                })
              }
              className="flex h-16 w-full items-center justify-between gap-3 border-b border-black/[.06] py-2 text-left last:border-0 active:bg-black/10 dark:border-white/[.08] dark:active:bg-white/10"
            >
              <span className="flex min-w-0 items-center gap-3">
                <WalletAssetAvatar
                  icon={icon}
                  color={color}
                  iconColor={iconColor}
                  network={row.network}
                />
                <span>
                  <span className="block text-[15px] font-medium text-black dark:text-white">
                    {code} · {networkStandards[row.network]}
                  </span>
                  <span className="block text-[13px] text-black/45 dark:text-white/45">
                    {networkNames[row.network]}
                  </span>
                </span>
              </span>
              <span className="text-right">
                <span className="block text-[16px] font-medium text-black dark:text-white">
                  {row.balance.amount !== null
                    ? chainAmount(row.balance.amount)
                    : "—"}
                </span>
                <span className="block text-[12px] text-black/45 dark:text-white/45">
                  {row.address.slice(0, 7)}…{row.address.slice(-5)}
                </span>
              </span>
            </button>
          ))}
        {!portfolio && !error && (
          <p
            role="status"
            className="py-4 text-[14px] text-black/45 dark:text-white/45"
          >
            Создаём кошелёк и читаем баланс…
          </p>
        )}
      </Card>
      {error && (
        <p
          role="alert"
          className="mt-3 px-2 text-[13px] text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
      <p className="mt-3 px-2 text-[12px] text-black/45 dark:text-white/45">
        Баланс из сети, обновление каждые 30 секунд. Это не доступный для вывода
        баланс WPay.
      </p>
    </section>
  );
}
