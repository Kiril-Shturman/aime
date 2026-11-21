import WalletCryptoDeposit from "./WalletCryptoDeposit";
import WalletSbpDeposit from "./WalletSbpDeposit";
import { networkNames, networkStandards } from "../wallet/catalog";
import WalletNetworkIcon from "./WalletNetworkIcon";
import WalletSheetClose from "./WalletSheetClose";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Sheet } from "framework7-react";
import { Button, List, ListItem } from "konsta/react";
import {
  ChevronDown,
  Check,
  Copy,
  ExternalLink,
  ShieldCheck,
  Wallet,
  Clock3,
} from "lucide-react";
import QRCode from "react-qr-code";
import { useLiveWallet } from "./WalletLive";
import { walletRequest, WalletApiError, type Deposit } from "../lib/wallet-api";
import { tg } from "../lib/telegram";
import "./WalletDeposit.css";

export interface DepositAsset {
  code: string;
  name: string;
  icon: ReactNode;
  style: CSSProperties;
}
export default function WalletDeposit({
  defaultAsset = "USDT",
  defaultNetwork,
  options = [],
  onAssetChange,
}: {
  defaultAsset?: string;
  defaultNetwork?: string;
  options?: DepositAsset[];
  onAssetChange?: (asset: string) => void;
}) {
  const wallet = useLiveWallet(),
    asset = defaultAsset;
  const meta = options.find((item) => item.code === asset);
  const supported = wallet.depositRoutes[asset] ?? [];
  const [retryAt, setRetryAt] = useState(0);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setTimeout(
      () => setRetryAt(0),
      Math.max(0, retryAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [retryAt]);
  const [network, setNetwork] = useState(supported[0] ?? ""),
    [picker, setPicker] = useState<"asset" | "network" | null>(null),
    [amount, setAmount] = useState(""),
    [deposit, setDeposit] = useState<Deposit | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false),
    [clock, setClock] = useState(Date.now());
  const generation = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    generation.current++;
    setNetwork(
      defaultNetwork && supported.includes(defaultNetwork)
        ? defaultNetwork
        : (supported[0] ?? ""),
    );
    setDeposit(null);
    setAmount("");
    setError("");
    setCopied(false);
    setBusy(false);
  }, [asset, defaultNetwork, supported.join(",")]);
  useEffect(() => {
    if (!deposit?.expires_at) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deposit?.expires_at]);
  const mode = wallet.depositModes[asset]?.[network];
  const provider = wallet.depositProviders[asset]?.[network];
  const available = supported.includes(network) && mode !== "disabled";
  const exact = mode === "exact" || (!provider && !mode && network === "TRON");
  const numeric = Number(amount.replace(",", "."));
  async function create() {
    if (busy || !available || !wallet.configured || Date.now() < retryAt)
      return;
    const version = ++generation.current;
    setBusy(true);
    setError("");
    setDeposit(null);
    try {
      const result = await walletRequest<Deposit>("deposit", {
        asset,
        network,
        ...(exact ? { amount: amount.replace(",", ".") } : {}),
      });
      if (mounted.current && version === generation.current) setDeposit(result);
    } catch (e) {
      if (e instanceof WalletApiError && e.retryAfter) {
        const seconds = Number(e.retryAfter);
        setRetryAt(
          Number.isFinite(seconds)
            ? Date.now() + seconds * 1000
            : Date.parse(e.retryAfter),
        );
      }
      if (mounted.current && version === generation.current)
        setError(
          e instanceof Error ? e.message : "Не удалось получить реквизиты",
        );
    } finally {
      if (mounted.current && version === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    setDeposit(null);
    if (mode !== "address" || !available || !wallet.configured || !wallet.ready)
      return;
    const controller = new AbortController();
    const version = ++generation.current;
    setBusy(true);
    setError("");
    void walletRequest<Deposit>(
      "deposit",
      { asset, network },
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted && version === generation.current)
          setDeposit(result);
      })
      .catch((reason) => {
        if (!controller.signal.aborted && version === generation.current)
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось получить адрес",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted && version === generation.current)
          setBusy(false);
      });
    return () => controller.abort();
  }, [asset, network, mode, provider, available, wallet.configured, wallet.ready]);
  function changeNetwork(code: string) {
    generation.current++;
    setNetwork(code);
    setDeposit(null);
    setError("");
    setCopied(false);
    setPicker(null);
  }
  async function copy() {
    if (!deposit?.address) return;
    try {
      await navigator.clipboard.writeText(deposit.address);
      setCopied(true);
    } catch {
      setError("Не удалось скопировать адрес. Выделите его вручную.");
    }
  }
  function openPayment() {
    try {
      const url = new URL(deposit?.mini_app_url ?? deposit?.url ?? "");
      if (
        url.protocol !== "https:" ||
        !["t.me", "goswap.site"].includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw Error();
      if (url.hostname === "t.me" && tg()?.openTelegramLink)
        tg()?.openTelegramLink?.(url.href);
      else if (tg()?.openLink) tg()?.openLink?.(url.href);
      else window.open(url.href, "_blank", "noopener,noreferrer");
    } catch {
      setError("Не удалось открыть окно пополнения");
    }
  }
  const expired = deposit?.expires_at
    ? Date.parse(deposit.expires_at) <= clock
    : false;
  if (asset === "RUB") return <WalletSbpDeposit />;
  if (mode === "address" && deposit?.address)
    return (
      <WalletCryptoDeposit
        code={asset}
        entry={{
          network,
          address: deposit.address,
          provider: deposit.provider,
          chain: deposit.chain,
          demo: false,
          amount: null,
          rate: null,
          min_deposit: deposit.min_deposit,
        }}
        icon={meta?.icon ?? <Wallet size={25} />}
        color={
          typeof meta?.style.backgroundColor === "string"
            ? meta.style.backgroundColor
            : "#26a17b"
        }
        iconColor={
          typeof meta?.style.color === "string" ? meta.style.color : "#fff"
        }
      />
    );

  if (mode === "address")
    return (
      <main className="mx-auto flex w-full max-w-[560px] flex-col gap-6 px-4 pb-28 pt-5 text-black dark:text-white">
        {error || !available || !wallet.configured ? (
          <section className="rounded-[28px] bg-white p-6 text-center dark:bg-[#252b36]">
            <p role="alert" className="text-[15px] leading-6">
              {error || "Адрес в этой сети сейчас недоступен."}
            </p>
            {available && wallet.configured && (
              <Button
                data-wpay-primary=""
                rounded
                disabled={busy}
                onClick={() => void create()}
                className="!mt-5"
              >
                Повторить загрузку адреса
              </Button>
            )}
          </section>
        ) : (
          <div
            role="status"
            aria-label="Загрузка реквизитов"
            aria-busy="true"
            className="animate-pulse motion-reduce:animate-none"
          >
            <div className="flex justify-center py-3">
              <div className="h-[242px] w-[242px] rounded-[28px] bg-black/[.05] dark:bg-white/[.08]" />
            </div>
            <div className="mt-6 h-5 w-44 rounded-md bg-black/[.05] dark:bg-white/[.08]" />
            <div className="mt-3 overflow-hidden rounded-[28px] bg-white px-5 dark:bg-[#252b36]">
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="flex h-16 items-center justify-between border-b border-black/[.04] last:border-0 dark:border-white/[.06]"
                >
                  <div className="h-4 w-16 rounded bg-black/[.05] dark:bg-white/[.08]" />
                  <div className="h-4 w-32 rounded bg-black/[.05] dark:bg-white/[.08]" />
                </div>
              ))}
            </div>
            <p className="mt-5 text-center text-[13px] text-black/40 dark:text-white/40">
              Получаем адрес кошелька…
            </p>
          </div>
        )}
      </main>
    );
  return (
    <main className="wpay-deposit-page mx-auto w-full max-w-[560px] px-4 pb-8 pt-5 text-black dark:text-white">
      <div className="mb-6 text-center">
        <span
          className="mx-auto flex h-[68px] w-[68px] items-center justify-center rounded-full shadow-sm [&>svg]:!h-9 [&>svg]:!w-9"
          style={meta?.style}
        >
          {meta?.icon ?? <Wallet size={32} />}
        </span>
        <h1 className="mt-4 text-[24px] font-semibold tracking-tight">
          {meta?.name ?? asset}
        </h1>
        <p className="mt-1 text-[14px] text-black/45 dark:text-white/45">
          {asset === "RUB"
            ? "Пополнение в рублях"
            : `Пополнение кошелька ${asset}`}
        </p>
      </div>
      <List
        strong
        inset
        dividers
        className="!mx-0 !my-0 overflow-hidden !rounded-[28px] [&>ul]:!rounded-[28px]"
      >
        <ListItem
          link
          chevron={false}
          onClick={() => !busy && setPicker("asset")}
          contentClassName="!h-[72px]"
          innerClassName="!h-[72px] !py-3 after:!opacity-30"
          innerChildren={
            <span className="flex w-full items-center justify-between gap-4">
              <span className="text-[16px] text-black/45 dark:text-white/45">
                Валюта
              </span>
              <span className="flex items-center gap-2 text-[17px] font-semibold">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full [&>svg]:!h-[18px] [&>svg]:!w-[18px]"
                  style={meta?.style}
                >
                  {meta?.icon}
                </span>
                {asset}
                <ChevronDown
                  size={17}
                  className="ml-1 text-black/30 dark:text-white/30"
                />
              </span>
            </span>
          }
        />
        <ListItem
          link={available}
          chevron={false}
          onClick={() => available && !busy && setPicker("network")}
          contentClassName="!h-[72px]"
          innerClassName="!h-[72px] !py-3 after:!opacity-30"
          innerChildren={
            <span className="flex w-full items-center justify-between gap-4">
              <span className="text-[16px] text-black/45 dark:text-white/45">
                {asset === "RUB" ? "Способ" : "Сеть"}
              </span>
              <span className="flex min-w-0 items-center gap-2 text-[16px] font-medium">
                <span className="truncate">
                  {asset === "RUB"
                    ? "СБП"
                    : available
                      ? (networkNames[network] ?? network)
                      : "Пока недоступна"}
                </span>
                {available && (
                  <ChevronDown
                    size={17}
                    className="shrink-0 text-black/30 dark:text-white/30"
                  />
                )}
              </span>
            </span>
          }
        />
      </List>
      {available && exact && (
        <label className="mt-4 block rounded-[28px] bg-white p-5 dark:bg-[#1c1c1e]">
          <span className="text-[14px] text-black/45 dark:text-white/45">
            Сколько хотите внести
          </span>
          <span className="mt-3 flex items-center gap-3">
            <input
              aria-label="Сумма пополнения USDT"
              inputMode="decimal"
              disabled={busy}
              value={amount}
              onChange={(e) => {
                generation.current++;
                setAmount(e.target.value.replace(/[^0-9.,]/g, ""));
                setDeposit(null);
                setError("");
              }}
              placeholder="100"
              className="min-w-0 flex-1 bg-transparent text-[30px] font-medium text-black outline-none placeholder:text-black/20 dark:text-white dark:placeholder:text-white/25"
            />
            <span className="text-[16px] text-black/40 dark:text-white/40">
              USDT
            </span>
          </span>
        </label>
      )}
      {available ? (
        <div className="mt-5 flex gap-3 px-1">
          <ShieldCheck
            size={20}
            className="mt-0.5 shrink-0 text-blue-500 dark:text-blue-400"
          />
          <p className="text-[14px] leading-6 text-black/50 dark:text-white/50">
            {exact
              ? "Для этой сети нужна точная сумма. После создания заявки отправьте сумму из реквизитов до окончания срока."
              : `Отправляйте только ${asset} в сети ${networkNames[network] ?? network}. Другая сеть или валюта не подойдёт для этих реквизитов.`}
          </p>
        </div>
      ) : (
        <div className="mt-6 px-3 text-center">
          <Clock3
            size={28}
            className="mx-auto text-black/25 dark:text-white/25"
          />
          <h2 className="mt-3 text-[18px] font-semibold">
            Пополнение пока недоступно
          </h2>
          <p className="mt-2 text-[14px] leading-6 text-black/45 dark:text-white/45">
            {asset === "RUB"
              ? "Пополнение рублями через СБП появится после подключения."
              : `Реквизиты для ${asset} ещё не подключены. Вы можете выбрать другую валюту.`}
          </p>
        </div>
      )}
      {available && !deposit && (
        <Button
          data-wpay-primary=""
          rounded
          large
          disabled={
            Date.now() < retryAt ||
            !wallet.configured ||
            busy ||
            (exact && (!Number.isFinite(numeric) || numeric <= 0))
          }
          onClick={() => void create()}
          className="!mx-0 !mb-0 !mt-6 !h-14 !w-full !rounded-[24px] !text-[17px] !font-semibold"
        >
          {busy ? "Получаем реквизиты…" : "Получить реквизиты"}
        </Button>
      )}
      {available && !wallet.configured && (
        <p
          role="status"
          className="mt-3 px-3 text-center text-[13px] leading-5 text-black/40 dark:text-white/40"
        >
          Пополнение временно недоступно. Попробуйте позже.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-2xl bg-red-500/10 p-4 text-[14px] text-red-600 dark:bg-red-400/10 dark:text-red-400"
        >
          {error}
        </p>
      )}
      {retryAt > Date.now() && (
        <p
          role="status"
          className="mt-3 text-center text-[14px] text-black/45 dark:text-white/45"
        >
          Сеть готовит адрес. Повторите после{" "}
          {new Date(retryAt).toLocaleTimeString("ru-RU")}.
        </p>
      )}
      {deposit && (
        <section
          aria-label="Реквизиты пополнения"
          className="mt-6 rounded-[32px] bg-white p-5 dark:bg-[#1c1c1e]"
        >
          {deposit.address && !expired ? (
            <>
              <div className="mx-auto w-fit rounded-[24px] bg-white p-4">
                <QRCode value={deposit.address} size={176} />
              </div>
              <p className="mt-4 text-center text-[13px] text-black/45 dark:text-white/45">
                {asset} · {networkNames[network] ?? network}
              </p>
              <p className="mt-4 text-[13px] text-black/40 dark:text-white/40">
                Адрес для пополнения
              </p>
              <button type="button" aria-label="Скопировать адрес пополнения" onClick={() => void copy()}
                className="mt-2 flex min-h-9 w-full items-center justify-between gap-3 text-left text-[14px] text-blue-600 dark:text-blue-400">
                <span className="min-w-0 break-all">{deposit.address}</span>
                {copied ? <Check size={19} className="shrink-0" /> : <Copy size={19} className="shrink-0" />}
              </button>
              <Button
                data-wpay-primary=""
                rounded
                tonal
                onClick={() => void copy()}
                className="!mx-0 !mb-0 !mt-4 !h-12 !w-full !rounded-[20px]"
              >
                <span className="flex items-center justify-center gap-2">
                  {copied ? <Check size={18} /> : <Copy size={18} />}{" "}
                  {copied ? "Адрес скопирован" : "Скопировать адрес"}
                </span>
              </Button>
            </>
          ) : (
            <p className="text-center text-[15px] leading-6 text-black/50 dark:text-white/50">
              {expired
                ? "Срок действия этих реквизитов истёк. Не отправляйте на них средства."
                : "Откройте платёжное окно, чтобы увидеть реквизиты выбранной сети."}
            </p>
          )}
          {deposit.min_deposit && asset === "USDT" && (
            <p className="mt-3 text-[14px] text-black/45 dark:text-white/45">
              Минимум пополнения: {deposit.min_deposit} USDT. Переводы меньше
              минимума не зачисляются.
            </p>
          )}
          {deposit.amount && (
            <div className="mt-5 border-t border-black/[.06] pt-4 dark:border-white/[.08]">
              <p className="text-[13px] text-black/45 dark:text-white/45">
                Отправьте ровно
              </p>
              <p className="mt-1 text-[27px] font-semibold tabular-nums">
                {deposit.amount} {asset}
              </p>
            </div>
          )}
          {deposit.expires_at && (
            <p className="mt-3 text-[13px] text-black/45 dark:text-white/45">
              {expired
                ? "Срок заявки истёк. Создайте новые реквизиты."
                : `Действует до ${new Date(deposit.expires_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
            </p>
          )}
          {(deposit.url || deposit.mini_app_url) && !expired && (
            <Button
              data-wpay-primary=""
              rounded
              onClick={openPayment}
              className="!mx-0 !mb-0 !mt-4 !h-12 !w-full !rounded-[20px]"
            >
              <span className="flex items-center gap-2">
                Открыть окно пополнения
                <ExternalLink size={16} />
              </span>
            </Button>
          )}
          <Button
            data-wpay-primary=""
            rounded
            tonal
            disabled={wallet.loading}
            onClick={() => void wallet.refresh(true)}
            className="!mx-0 !mb-0 !mt-3 !h-12 !w-full !rounded-[20px]"
          >
            {wallet.loading ? "Проверяем…" : "Проверить зачисление"}
          </Button>
          {expired && (
            <Button
              data-wpay-primary=""
              rounded
              onClick={() => setDeposit(null)}
              className="!mx-0 !mb-0 !mt-3 !w-full"
            >
              Создать новую заявку
            </Button>
          )}
        </section>
      )}
      {createPortal(
        <Sheet
          opened={picker !== null}
          backdrop
          closeByBackdropClick
          closeOnEscape
          swipeToClose
          swipeHandler=".wpay-deposit-picker-header"
          className="wpay-exchange-sheet"
          onSheetClosed={() => setPicker(null)}
        >
          <header className="wpay-deposit-picker-header shrink-0 px-5 pb-4 pt-3">
            <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-black/15 dark:bg-white/20" />
            <div className="flex items-center justify-between">
              <h2 className="text-[22px] font-semibold text-black dark:text-white">
                {picker === "asset" ? "Валюта пополнения" : "Выберите сеть"}
              </h2>
              <WalletSheetClose
                label="Закрыть выбор"
                onClick={() => setPicker(null)}
              />
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(20px,env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <List strong inset dividers className="!mx-0 !my-0 !bg-transparent">
              {picker === "asset"
                ? options
                    .filter((item) =>
                      item.code === "RUB"
                        ? wallet.capabilities.sbp_buy
                        : (wallet.depositRoutes[item.code]?.length ?? 0) > 0,
                    )
                    .map((item) => (
                      <ListItem
                        key={item.code}
                        link
                        chevron={false}
                        onClick={() => {
                          setPicker(null);
                          onAssetChange?.(item.code);
                        }}
                        contentClassName="!h-[68px]"
                        innerClassName="!h-[68px] !min-w-0 !py-2 after:!opacity-30"
                        media={
                          <span
                            className="flex h-11 w-11 items-center justify-center rounded-full [&>svg]:!h-6 [&>svg]:!w-6"
                            style={item.style}
                          >
                            {item.icon}
                          </span>
                        }
                        innerChildren={
                          <span className="flex h-full w-full min-w-0 items-center justify-between gap-4">
                            <span className="min-w-0">
                              <span className="block truncate text-[17px] font-semibold text-black dark:text-white">
                                {item.name}
                              </span>
                              <span className="mt-0.5 block text-[13px] text-black/45 dark:text-white/45">
                                {item.code}
                              </span>
                            </span>
                            <span className="flex h-full w-6 shrink-0 items-center justify-center text-primary">
                              {item.code === asset && <Check size={20} />}
                            </span>
                          </span>
                        }
                      />
                    ))
                : supported.map((code) => (
                    <ListItem
                      key={code}
                      link
                      chevron={false}
                      onClick={() => changeNetwork(code)}
                      contentClassName="!h-[68px]"
                      innerClassName="!h-[68px] !py-2 after:!opacity-30"
                      media={<WalletNetworkIcon network={code} />}
                      innerChildren={
                        <span className="flex h-full w-full min-w-0 items-center justify-between gap-4">
                          <span className="min-w-0">
                            <span className="block truncate text-[17px] font-semibold text-black dark:text-white">
                              {networkNames[code] ?? code}
                            </span>
                            <span className="mt-0.5 block text-[13px] text-black/45 dark:text-white/45">
                              {networkStandards[code] ?? code}
                              {wallet.depositModes[asset]?.[code] === "exact"
                                ? " · Точная сумма"
                                : ""}
                            </span>
                          </span>
                          <span className="flex h-full w-6 shrink-0 items-center justify-center text-primary">
                            {code === network && <Check size={20} />}
                          </span>
                        </span>
                      }
                    />
                  ))}
            </List>
          </div>
        </Sheet>,
        document.querySelector(".wpay-f7-root") ?? document.body,
      )}
    </main>
  );
}
