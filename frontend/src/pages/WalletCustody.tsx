import { useEffect, useRef, useState } from "react";
import { Button, Card } from "konsta/react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  Trash2,
  Copy,
  Wallet,
} from "lucide-react";
import { f7 } from "framework7-react";
import "framework7/components/dialog/css";
import QRCode from "react-qr-code";
import { PushViewShell } from "./WalletNavigation";
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
  const [selected, setSelected] = useState<OwnWallet | null>(null);
  const [showQr, setShowQr] = useState(false);
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
  async function hideWallet() {
    if (!selected || busy) return;
    const scope = lifecycle.current;
    if (!scope || scope.aborted) return;
    setBusy(selected.network);
    try {
      await walletRequest(
        "custody-wallet-hide",
        { wallet_id: selected.id },
        scope,
      );
      if (!scope.aborted) {
        setWallets((rows) => rows.filter((row) => row.id !== selected.id));
        setSelected(null);
        showNotice("Кошелёк удалён из списка");
      }
    } catch (reason) {
      if (!scope.aborted)
        showNotice(
          reason instanceof Error
            ? reason.message
            : "Не удалось удалить кошелёк",
        );
    } finally {
      if (!scope.aborted) setBusy(null);
    }
  }
  function confirmHide() {
    f7.dialog
      .create({
        title: "Удалить кошелёк?",
        text: "Кошелёк будет скрыт из приложения. Адрес и ключ сохранятся; при повторном создании вернётся тот же адрес.",
        destroyOnClose: true,
        buttons: [
          { text: "Отмена" },
          {
            text: "Удалить",
            strong: true,
            onClick: () => {
              void hideWallet();
            },
          },
        ],
      })
      .open();
  }
  const selectedNetwork = status?.networks?.find(
    (network) => network.network === selected?.network,
  );
  const walletActions = [
    {
      title: "Пополнить",
      icon: <ArrowDownToLine size={22} />,
      onClick: () => setShowQr(true),
    },
    {
      title: "Вывести",
      icon: <ArrowUpFromLine size={22} />,
      onClick: () =>
        showNotice("Вывод для собственных кошельков ещё не подключён"),
    },
    {
      title: "Обменять",
      icon: <ArrowLeftRight size={22} />,
      onClick: () =>
        showNotice("Обмен для собственных кошельков ещё не подключён"),
    },
  ];
  return (
    <>
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
                  <button
                    type="button"
                    className="mt-3 flex min-h-11 w-full items-center justify-between rounded-2xl bg-black/[.035] px-3 text-[15px] font-medium text-primary active:bg-black/10 dark:bg-white/[.06] dark:active:bg-white/10"
                    aria-label={`Открыть кошелёк ${network.name}`}
                    onClick={() => {
                      setSelected(row);
                      setShowQr(false);
                    }}
                  >
                    Открыть кошелёк <span aria-hidden="true">›</span>
                  </button>
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
      <PushViewShell
        open={!!selected}
        title={selected?.asset ?? "Кошелёк"}
        subtitle={selectedNetwork?.name}
        onClose={() => {
          setSelected(null);
          setShowQr(false);
        }}
        menuItems={[
          ...walletActions,
          {
            title: "Удалить кошелёк",
            icon: <Trash2 size={22} />,
            destructive: true,
            onClick: confirmHide,
          },
        ]}
      >
        {selected && (
          <main
            className="mx-auto flex w-full max-w-[560px] flex-col gap-5 px-4 pb-8 pt-6"
            aria-label="Собственный кошелёк"
          >
            <section className="flex flex-col items-center gap-3 py-5 text-center">
              <span className="flex h-20 w-20 items-center justify-center [&_.wpay-network-icon]:!h-16 [&_.wpay-network-icon]:!w-16 [&_svg]:!h-10 [&_svg]:!w-10">
                <WalletNetworkIcon network={selected.network} />
              </span>
              <h2 className="text-[30px] font-semibold text-black dark:text-white">
                {selectedNetwork?.name}
              </h2>
              <p className="text-[15px] text-black/45 dark:text-white/45">
                {selected.chain_env === "mainnet"
                  ? "Основная сеть"
                  : "Тестовая сеть"}
              </p>
              <p className="text-[36px] font-semibold text-black dark:text-white">
                —{" "}
                <span className="text-black/40 dark:text-white/40">
                  {selected.asset}
                </span>
              </p>
              <p className="text-[14px] text-black/45 dark:text-white/45">
                Баланс сети ещё не подключён
              </p>
            </section>
            <section
              className="grid grid-cols-3 gap-2"
              aria-label="Действия с собственным кошельком"
            >
              {walletActions.map((action) => (
                <button
                  key={action.title}
                  type="button"
                  onClick={action.onClick}
                  className="flex h-[62px] flex-col items-center justify-center gap-1 rounded-[22px] bg-black/[.055] text-primary active:bg-black/10 dark:bg-white/10 dark:active:bg-white/15"
                >
                  {action.icon}
                  <span className="text-[12px] font-medium">
                    {action.title}
                  </span>
                </button>
              ))}
            </section>
            {showQr && (
              <section
                className="flex flex-col items-center gap-4"
                aria-label="QR-код собственного кошелька"
              >
                <div className="rounded-[24px] bg-white p-5">
                  <QRCode value={selected.address} size={200} />
                </div>
                <p className="rounded-[20px] bg-amber-500/10 p-4 text-[14px] text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
                  Зачисление в WPay ещё не подключено. Не отправляйте средства.
                </p>
              </section>
            )}
            <Card className="!m-0 !rounded-[26px]" contentWrapPadding="p-4">
              <h3 className="text-[17px] font-semibold text-black dark:text-white">
                Реквизиты кошелька
              </h3>
              <p className="mt-3 text-[14px] text-black/45 dark:text-white/45">
                Сеть: {selectedNetwork?.name}
              </p>
              <p className="mt-3 break-all font-mono text-[14px] text-black dark:text-white">
                {selected.address}
              </p>
              <button
                type="button"
                className="mt-3 flex min-h-11 items-center gap-2 text-primary"
                onClick={() => void copy(selected.address)}
              >
                <Copy size={18} />
                Скопировать адрес
              </button>
            </Card>
            <h3 className="text-[17px] font-semibold text-black dark:text-white">
              История транзакций
            </h3>
            <p className="text-[14px] text-black/45 dark:text-white/45">
              История сети ещё не подключена
            </p>
          </main>
        )}
      </PushViewShell>
    </>
  );
}
