import { useEffect, useRef, useState } from "react";
import { Button, Card } from "konsta/react";
import { Copy, Wallet } from "lucide-react";
import WalletNetworkIcon from "./WalletNetworkIcon";
import { walletRequest } from "../lib/wallet-api";

type Network = { network: string; name: string; asset: string };
type Status = {
  configured: boolean;
  generation_enabled: boolean;
  chain_env: "testnet" | "mainnet" | null;
  creation_fee: string;
  networks: Network[];
};
type OwnWallet = {
  id: string;
  network: string;
  chain_env: "testnet" | "mainnet";
  asset: string;
  address: string;
  provider: "wpay";
  deposit_enabled: false;
  withdraw_enabled: false;
};

export default function WalletCustody({
  active,
  showNotice,
}: {
  active: boolean;
  showNotice: (message: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [wallets, setWallets] = useState<OwnWallet[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  const lifecycle = useRef<AbortSignal | null>(null);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    lifecycle.current = abort.signal;
    // Async callbacks own state updates; closing the view cancels stale responses.
    void Promise.all([
      walletRequest<Status>("custody-status", undefined, abort.signal),
      walletRequest<{ items: OwnWallet[] }>(
        "custody-wallets",
        undefined,
        abort.signal,
      ),
    ])
      .then(([value, rows]) => {
        if (!abort.signal.aborted) {
          setStatus(value);
          setWallets(rows.items);
          setError("");
          setBusy(null);
        }
      })
      .catch((reason) => {
        if (!abort.signal.aborted) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось загрузить кошельки",
          );
          setBusy(null);
        }
      });
    return () => abort.abort();
  }, [active]);
  async function create(network: string) {
    if (busy || !status?.generation_enabled || !active) return;
    const scope = lifecycle.current;
    if (!scope || scope.aborted) return;
    setBusy(network);
    setError("");
    try {
      const row = await walletRequest<OwnWallet>(
        "custody-wallet",
        { network },
        scope,
      );
      if (!scope.aborted) {
        setWallets((previous) => [
          ...previous.filter(
            (item) =>
              item.id !== row.id &&
              !(
                item.network === row.network && item.chain_env === row.chain_env
              ),
          ),
          row,
        ]);
        showNotice("Кошелёк создан бесплатно");
      }
    } catch (reason) {
      if (!scope.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось создать кошелёк",
        );
    } finally {
      if (!scope.aborted) setBusy(null);
    }
  }
  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      showNotice("Адрес скопирован");
    } catch {
      setError("Не удалось скопировать адрес");
    }
  }
  return (
    <section
      className="flex flex-col gap-4 px-4 py-2"
      aria-label="Собственные кошельки WPay"
    >
      <div className="px-1">
        <Wallet className="mb-3 text-primary" size={30} />
        <h2 className="text-[23px] font-semibold text-black dark:text-white">
          Мои кошельки
        </h2>
        <p className="mt-2 text-[15px] leading-6 text-black/50 dark:text-white/50">
          Создание бесплатно. В каждой сети — свой постоянный адрес.
        </p>
      </div>
      <p
        role="status"
        className="rounded-[22px] bg-amber-500/10 px-4 py-3 text-[14px] leading-6 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200"
      >
        {status?.chain_env === "testnet"
          ? "Тестовые сети. Не отправляйте реальные средства."
          : "Приём и зачисление ещё не включены. Не отправляйте средства."}
      </p>
      {!status && !error && (
        <p role="status" className="px-2 text-black/50 dark:text-white/50">
          Загружаем кошельки…
        </p>
      )}
      {status && !status.generation_enabled && (
        <p role="status" className="px-2 text-black/50 dark:text-white/50">
          Создание кошельков пока недоступно
        </p>
      )}
      {status?.networks?.map((network) => {
        const row = wallets.find(
          (item) =>
            item.network === network.network &&
            item.chain_env === status.chain_env,
        );
        return (
          <Card
            key={network.network}
            className="!m-0 !rounded-[28px]"
            contentWrapPadding="p-4"
          >
            <div className="flex min-h-12 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center">
                <WalletNetworkIcon network={network.network} />
              </span>
              <div>
                <h3 className="text-[17px] font-semibold text-black dark:text-white">
                  {network.name}
                </h3>
                <p className="text-[13px] text-black/45 dark:text-white/45">
                  {network.asset} ·{" "}
                  {status.chain_env === "testnet"
                    ? "Тестовая сеть"
                    : "Основная сеть"}
                </p>
              </div>
            </div>
            {row ? (
              <>
                <p
                  aria-label={`Адрес ${network.name}`}
                  className="mt-3 select-all break-all rounded-2xl bg-black/[.035] px-3 py-3 font-mono text-[13px] leading-5 text-black dark:bg-white/[.06] dark:text-white"
                >
                  {row.address}
                </p>
                <button
                  type="button"
                  aria-label={`Скопировать адрес ${network.name}`}
                  className="mt-2 flex min-h-11 items-center gap-2 rounded-xl px-2 text-[15px] font-medium text-primary active:bg-black/5 dark:active:bg-white/10"
                  onClick={() => void copy(row.address)}
                >
                  <Copy size={18} />
                  Скопировать адрес
                </button>
              </>
            ) : (
              <Button
                data-wpay-primary=""
                rounded
                className="!mb-0 !mt-3 !h-12 !rounded-[22px]"
                aria-label={`Создать кошелёк ${network.name}`}
                disabled={!status.generation_enabled || !!busy}
                onClick={() => void create(network.network)}
              >
                {busy === network.network ? "Создаём…" : "Создать бесплатно"}
              </Button>
            )}
          </Card>
        );
      })}
      {error && (
        <p
          role="alert"
          className="px-2 text-[14px] text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
      <p className="px-2 text-[12px] leading-5 text-black/45 dark:text-white/45">
        Создание адреса не активирует его в блокчейне. Комиссии сети
        оплачиваются отдельно при использовании.
      </p>
    </section>
  );
}
