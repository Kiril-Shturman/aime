import { networkNames as names } from "../wallet/catalog";
import type { WalletAddressSelection } from "./WalletAddressDetails";
import { useEffect, useState, type ReactNode } from "react";
import { Preloader } from "framework7-react";
import { walletRequest } from "../lib/wallet-api";
import WalletAssetAvatar from "./WalletAssetAvatar";
import { cryptoAmount, useLiveWallet } from "./WalletLive";

const networks: Record<string, string[]> = {
  BTC: ["BTC"],
  ETH: ["ETH"],
  BNB: ["BSC"],
  TON: ["TON"],
  GRAM: ["TON"],
  SOL: ["SOL"],
  TRX: ["TRON"],
  USDT: ["BSC", "ETH", "TON", "SOL", "TRON"],
  XAUT: ["ETH"],
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
  ownedNetworkKey,
  onAvailability,
  onOpenAddress,
}: {
  ownedNetworkKey?: string;
  onAvailability: (available: boolean) => void;
  onOpenAddress: (entry: WalletAddressSelection) => void;
  code: string;
  active: boolean;
  icon: ReactNode;
  color: string;
  iconColor: string;
}) {
  const wallet = useLiveWallet();
  const [rows, setRows] = useState<Owned[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    onAvailability(false);
    const selectedNetworks = ownedNetworkKey?.split(",").filter(Boolean) ?? networks[code];
    if (!selectedNetworks?.length) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const signal = controller.signal;
    setRows([]);
    setError("");
    setLoading(true);
    async function balances() {
      try {
        const result = await walletRequest<{ items: Owned[] }>(
          `custody-asset-balances?asset=${encodeURIComponent(code)}`,
          undefined,
          signal,
        );
        if (!signal.aborted) setRows(result.items.filter((row) => selectedNetworks.includes(row.network)));
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
        if (!capability.configured) return;
        onAvailability(true);
        if (ownedNetworkKey !== undefined ? capability.chain_env !== "mainnet" : !["mainnet", "testnet"].includes(capability.chain_env))
          throw new Error("Сеть кошелька не определена");
        // Server controls ownership, environment and derivation. Repeat returns the same wallet.
        const created: Owned[] = [];
        for (const network of selectedNetworks) {
          const row = await walletRequest<Owned>(
            ownedNetworkKey === undefined ? "custody-wallet" : "deposit",
            ownedNetworkKey === undefined ? { network } : { asset: code, network },
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
  }, [active, code, retry, onAvailability, ownedNetworkKey]);
  if (!networks[code]) return null;

  return (
    <section aria-label="Собственные кошельки">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          onClick={() =>
            onOpenAddress({
              network: row.network,
              address: row.address,
              demo: false,
              amount:
                row.balance?.status === "ok" && row.balance.amount !== null
                  ? Number(row.balance.amount)
                  : null,
              rate: wallet.rate(code),
              custody: { id: row.id, chain_env: row.chain_env },
            })
          }
          aria-label={`Открыть собственный адрес ${row.network}`}
          className="wpay-address-row flex h-16 w-full items-center justify-between gap-3 border-b border-black/[.06] py-2 text-left dark:border-white/[.08]"
        >
          <span className="flex min-w-0 items-center gap-3">
            <WalletAssetAvatar
              {...{ icon, color, iconColor }}
              network={row.network}
            />
            <span className="min-w-0">
              <span className="block text-[15px] font-medium">
                {code}
                {["BTC", "TRX"].includes(code)
                  ? ""
                  : " · " +
                    ({
                      BSC: "BEP20",
                      ETH: "ERC20",
                      TRON: "TRC20",
                      SOL: "SPL",
                      TON: "TON",
                    }[row.network] ?? row.network)}
              </span>
              <span className="block truncate text-xs text-black/45 dark:text-white/45">
                {names[row.network]}
              </span>
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="text-right text-sm tabular-nums">
              {row.balance?.status === "ok" && row.balance.amount !== null
                ? cryptoAmount(row.balance.amount)
                : "—"}
            </span>
            <span className="mt-0.5 block text-[12px] leading-5 text-black/45 dark:text-white/45">
              {row.address.slice(0, 9)}…{row.address.slice(-7)}
            </span>
          </span>
        </button>
      ))}
      {loading && (
        <div className="flex items-center gap-3 py-4 text-sm">
          <Preloader size={20} />
          Создаём адреса…
        </div>
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
    </section>
  );
}
