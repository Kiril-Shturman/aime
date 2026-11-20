import WalletOwnedWallets from "./WalletOwnedWallets";
import WalletAssetAvatar from "./WalletAssetAvatar";
import {
  permanentAddressNetworks as addressNetworks,
  addressesForAsset,
  type WalletAddress,
} from "../wallet/catalog";
import { previewBalances, portfolioExamples } from "../wallet/demo";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Card } from "konsta/react";
import { createPortal } from "react-dom";
import { Sheet } from "framework7-react";
import QRCode from "react-qr-code";
import WalletSheetClose from "./WalletSheetClose";
import ArrowRightArrowLeft from "framework7-icons/react/esm/ArrowRightArrowLeft.js";
import PlusCircleFill from "framework7-icons/react/esm/PlusCircleFill.js";
import ArrowUpCircleFill from "framework7-icons/react/esm/ArrowUpCircleFill.js";
import WalletMarketChart, { chartPeriods } from "./WalletMarketChart";
import { cryptoAmount, usd, useLiveWallet } from "./WalletLive";
import { walletRequest } from "../lib/wallet-api";
import WalletCreateAddress from "./WalletCreateAddress";
import "./WalletAssetPanel.css";
import type { WalletAddressSelection } from "./WalletAddressDetails";
import { Plus, Copy, Check } from "lucide-react";

const networkLabels: Record<string, string> = {
  ETH: "Ethereum · ERC-20",
  BSC: "BNB Smart Chain · BEP-20",
  TON: "TON",
  SOL: "Solana · SPL",
};
const networkNames: Record<string, string> = {
  ETH: "Ethereum",
  BSC: "BNB Smart Chain",
  TON: "TON",
  SOL: "Solana",
  TRON: "Tron",
  BTC: "Bitcoin",
};
const networkStandards: Record<string, string> = {
  ETH: "ERC20",
  BSC: "BEP20",
  TON: "TON",
  SOL: "SPL",
  TRON: "TRC20",
  BTC: "BTC",
};

const descriptions: Record<string, { title: string; text: string }> = {
  USDT: {
    title: "Что такое Tether?",
    text: "USDT (Tether) — цифровой токен, ориентированный на стоимость доллара США. Баланс хранится в USDT; при пополнении важно выбрать правильную сеть.",
  },
  TRX: {
    title: "Что такое TRON?",
    text: "TRX — основная криптовалюта сети TRON. Она используется для переводов и операций в этой сети. Реквизиты и доступность пополнения зависят от подключённого провайдера.",
  },
  BNB: {
    title: "Что такое BNB?",
    text: "BNB — криптовалюта экосистемы BNB Chain. Используется для переводов и оплаты сетевых комиссий. При отправке нужно сверить сеть с реквизитами получателя.",
  },
  ETH: {
    title: "Что такое Ethereum?",
    text: "ETH — основная криптовалюта Ethereum, сети для переводов и приложений на смарт-контрактах. Для пополнения используйте сеть, указанную в реквизитах.",
  },
  GRAM: {
    title: "Что такое Gram?",
    text: "GRAM — цифровой актив в вашем кошельке. Доступные сети, способы пополнения и условия операций показываются при подключении провайдера. Перед переводом сверяйте тикер актива и сеть.",
  },
  SOL: {
    title: "Что такое Solana?",
    text: "SOL — основная криптовалюта сети Solana. Используется для переводов и оплаты операций в сети. Пополняйте баланс только по реквизитам выбранной сети.",
  },
  BTC: {
    title: "Что такое Bitcoin?",
    text: "BTC — криптовалюта сети Bitcoin. Переводы записываются в блокчейн и подтверждаются участниками сети. Перед отправкой проверяйте адрес и выбранную сеть.",
  },
  XAUT: {
    title: "Что такое GOLD (XAUT)?",
    text: "XAUT (Tether Gold) — цифровой токен, связанный с золотом. Его стоимость выражается отдельно от долларового баланса. Сети и доступные операции зависят от программы провайдера.",
  },
};

export default function WalletAssetPanel({
  code,
  name,
  icon,
  color,
  iconColor,
  onDeposit,
  onWithdraw,
  onExchange,
  onOpenAddress,
  historyRequest = 0,
  active = true,
}: {
  historyRequest?: number;
  code: string;
  name: string;
  icon: ReactNode;
  color: string;
  iconColor: string;
  active?: boolean;
  onOpenAddress: (entry: WalletAddressSelection) => void;
  onDeposit: (network?: string) => void;
  onWithdraw: () => void;
  onExchange: () => void;
}) {
  const wallet = useLiveWallet();
  const assetRoutes = wallet.assetRoutes[code] ?? [];
  const providerRoutes = wallet.depositProviders[code];
  const ownedNetworkKey = providerRoutes
    ? (wallet.depositRoutes[code] ?? [])
        .filter((network) => providerRoutes[network] === "wpay")
        .join(",")
    : undefined;
  const [ownedAvailable, setOwnedAvailable] = useState(false);
  const [allHistory, setAllHistory] = useState(false);
  const historySection = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!historyRequest) return;
    setAllHistory(true);
    historySection.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [historyRequest]);
  const transactions = wallet.data.transactions.filter(
    (item) => item.asset === code,
  );
  const about = descriptions[code] ?? {
    title: `Что такое ${name}?`,
    text: "Цифровой актив в вашем кошельке.",
  };
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [addresses, setAddresses] = useState<WalletAddress[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<{
      address: string;
      network: string;
    } | null>(null),
    [creatingAddress, setCreatingAddress] = useState(false),
    [addressBusy, setAddressBusy] = useState(false);
  const demoPortfolio =
    Boolean(previewBalances[code]) && wallet.demo && !wallet.loading;
  const preview = previewBalances[code];
  const [addressError, setAddressError] = useState(""),
    [copiedAddress, setCopiedAddress] = useState("");
  useEffect(() => {
    let current = true;
    setAddresses([]);
    setAddressError("");
    setLoadingAddresses(false);
    function loadAddresses() {
      if (active && wallet.configured) {
        setLoadingAddresses(true);
        void (async () => {
          try {
            const result = await walletRequest<{ items?: WalletAddress[] }>(
              "addresses",
            );
            const saved = addressesForAsset(result.items ?? [], code).filter(
              (item) => item.address,
            );
            if (!current) return;
            setAddresses(saved);
          } catch {
            if (current)
              setAddressError(
                "Не удалось загрузить адреса. Нажмите на сеть, чтобы повторить.",
              );
          } finally {
            if (current) setLoadingAddresses(false);
          }
        })();
      }
    }
    loadAddresses();
    window.addEventListener("wpay:deposit-address", loadAddresses);
    return () => {
      window.removeEventListener("wpay:deposit-address", loadAddresses);
      current = false;
    };
  }, [active, code, wallet.configured, wallet.data]);
  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
    } catch {
      setAddressError("Не удалось скопировать адрес");
    }
  }
  async function createAddress(network: string) {
    if (addressBusy || !wallet.configured) return;
    setAddressBusy(true);
    setAddressError("");
    try {
      const item = await walletRequest<Partial<WalletAddress>>("address", {
        network,
        asset: code,
      });
      if (!item.address) throw Error("Сервис не вернул адрес");
      const entry = {
        address: item.address,
        min_deposit: item.min_deposit,
        network: item.network ?? network,
      };
      setAddresses((previous) => [
        ...previous.filter((row) => row.network !== entry.network),
        entry,
      ]);
      setCreatingAddress(false);
      setSelectedAddress(entry);
    } catch (error) {
      setAddressError(
        error instanceof Error ? error.message : "Не удалось создать адрес",
      );
    } finally {
      setAddressBusy(false);
    }
  }
  const displayName = code === "USDT" ? "Tether" : name;
  const [period, setPeriod] = useState(3);
  const [marketChange, setMarketChange] = useState<number | null>(null);
  const rate = wallet.rate(code),
    balance = wallet.balance(code);
  const portfolioChange = marketChange;
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
  const rubRate = demoPortfolio
    ? 92.5
    : rubQuote
      ? Number(rubQuote.rate)
      : inverseRubQuote && Number(inverseRubQuote.rate) > 0
        ? 1 / Number(inverseRubQuote.rate)
        : null;
  const portfolioUsd = demoPortfolio
    ? preview.amount * preview.rate
    : wallet.ready && rate !== null
      ? Number(balance) * rate
      : null;
  const reserved =
    wallet.data.balances.find((item) => item.asset === code)?.reserved ?? "0";
  return (
    <main className="wpay-asset-layout mx-auto w-full max-w-[560px] bg-[#efeff4] pb-0 dark:bg-black">
      <Card
        className="wpay-asset-chart-card !mx-0 !mb-0 !mt-0 !rounded-none !shadow-none !bg-white dark:!bg-[#1c1c1e]"
        contentWrapPadding="px-5 pb-5 pt-4"
      >
        <div className="flex min-h-[33px] items-end justify-between gap-4 pt-0">
          <h2 className="min-w-0 text-[17px] font-semibold text-black dark:text-white">
            {displayName}
          </h2>
        </div>
        <WalletMarketChart
          code={code}
          period={period}
          onPeriodChange={setMarketChange}
          active={active}
          icon={
            <span
              aria-label={`Иконка ${code}`}
              className="wpay-currency-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-full [&>svg]:!h-7 [&>svg]:!w-7"
              style={{
                color: iconColor,
                backgroundColor: color,
                backgroundImage: `linear-gradient(180deg,color-mix(in srgb, ${color} 62%, white),${color} 70%,color-mix(in srgb, ${color} 88%,black))`,
              }}
            >
              {icon}
            </span>
          }
        />
        <div
          role="group"
          aria-label="Период графика"
          className="mt-4 grid grid-cols-5 gap-1 rounded-full bg-black/[.035] p-1 dark:bg-white/[.06]"
        >
          {chartPeriods.map(({ label }, i) => (
            <Button
              key={label}
              inline
              clear
              rounded
              aria-pressed={period === i}
              onClick={() => setPeriod(i)}
              className={`!m-0 !h-8 !w-full !px-1 !text-[13px] !font-medium ${period === i ? "!bg-white !text-black !shadow-sm dark:!bg-white/15 dark:!text-white" : "!text-black/65 dark:!text-white/65"}`}
            >
              {label}
            </Button>
          ))}
        </div>
      </Card>
      <div className="wpay-asset-sidebar">
        <section className="wpay-asset-balance px-4 pb-3 pt-6">
          <h3 className="mb-3 px-2 text-[16px] font-semibold text-black/50 dark:text-white/50">
            Баланс приложения
          </h3>
          <Card className="!m-0 !rounded-[30px]" contentWrapPadding="px-4 py-0">
            <div
              className="wpay-portfolio-row flex min-h-[80px] items-center py-4"
              aria-label="Общий баланс актива"
            >
              <div className="min-w-0 text-left">
                <span className="block text-[20px] leading-6 font-semibold tabular-nums text-black dark:text-white">
                  {demoPortfolio
                    ? cryptoAmount(preview.amount)
                    : wallet.ready
                      ? cryptoAmount(balance)
                      : "—"}{" "}
                  {code}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-[13px] leading-5 tabular-nums text-black/45 dark:text-white/45">
                  <span>{portfolioUsd !== null ? usd(portfolioUsd) : "$ —"}</span>
                  <span
                    aria-label="Изменение за период графика"
                    className={`shrink-0 rounded-md px-1.5 py-0.5 font-medium tabular-nums ${portfolioChange === null ? "bg-black/5 text-black/40 dark:bg-white/5 dark:text-white/40" : portfolioChange >= 0 ? "bg-green-500/10 text-green-600 dark:bg-green-400/10 dark:text-green-400" : "bg-red-500/10 text-red-600 dark:bg-red-400/10 dark:text-red-400"}`}
                  >
                    {portfolioChange !== null
                      ? (portfolioChange >= 0 ? "+" : "") +
                        portfolioChange.toFixed(2) +
                        "%"
                      : "—%"}
                  </span>
                  <span aria-label="Стоимость в рублях">
                    {portfolioUsd !== null && rubRate !== null
                      ? (portfolioUsd * rubRate).toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }) + " ₽"
                      : "— ₽"}
                  </span>
                </span>
              </div>
            </div>
            {Number(reserved) > 0 && (
              <p className="mt-3 text-right text-[12px] text-black/40 dark:text-white/40">
                В резерве {cryptoAmount(reserved)} {code}
              </p>
            )}
            <div className="wpay-portfolio-networks">
              {ownedNetworkKey !== "" && (
                <WalletOwnedWallets
                  {...{ code, active, icon, color, iconColor, ownedNetworkKey }}
                  onAvailability={setOwnedAvailable}
                  onOpenAddress={onOpenAddress}
                />
              )}
              {assetRoutes.filter((network) =>
                !ownedAvailable || (providerRoutes && providerRoutes[network] !== "wpay"),
              ).map(
                (network) => {
                  const provider = wallet.depositProviders[code]?.[network];
                  const item = demoPortfolio
                    ? portfolioExamples[network]
                    : addresses.find((row) => row.network === network &&
                        (provider ? row.provider === provider : !row.provider || row.provider === "goswap"));
                  const providerBalance =
                    item && "provider_available" in item &&
                    (!item.balance_asset || item.balance_asset === code)
                      ? item.provider_available : undefined;
                  return (
                    <button
                      key={network}
                      type="button"
                      aria-label={`Открыть адрес ${network}`}
                      disabled={
                        provider ? !wallet.depositRoutes[code]?.includes(network) : !demoPortfolio &&
                        !(code === "USDT" && network === "TRON") &&
                        !item &&
                        (!(addressNetworks[code] ?? []).includes(network) ||
                          !wallet.configured ||
                          loadingAddresses ||
                          addressBusy)
                      }
                      onClick={() => {
                        setAddressError("");
                        setCopiedAddress("");
                        if (item)
                          onOpenAddress({
                            network,
                            address: item.address,
                            provider: "provider" in item ? item.provider : undefined,
                            chain: "chain" in item ? item.chain : undefined,
                            min_deposit:
                              "min_deposit" in item
                                ? item.min_deposit
                                : undefined,
                            demo: demoPortfolio,
                            amount: demoPortfolio
                              ? code === "USDT"
                                ? portfolioExamples[network].amount
                                : preview.amount
                              : providerBalance !== undefined ? Number(providerBalance) : null,
                            rate: demoPortfolio ? preview.rate : rate,
                          });
                        else if (provider) onDeposit(network);
                        else if (network === "TRON" && code === "USDT")
                          onDeposit("TRON");
                        else if ((addressNetworks[code] ?? []).includes(network))
                          void createAddress(network);
                      }}
                      className="wpay-address-row flex h-16 w-full items-center justify-between gap-3 border-b border-black/[.06] py-2 text-left dark:border-white/[.08]"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <WalletAssetAvatar
                          icon={icon}
                          color={color}
                          iconColor={iconColor}
                          network={network}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-medium text-black dark:text-white">
                            {code}
                            {["BTC", "TRX"].includes(code)
                              ? ""
                              : " · " + (networkStandards[network] ?? network)}
                          </span>
                          <span className="mt-0.5 block text-[13px] text-black/45 dark:text-white/45">
                            {networkNames[network] ?? network}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span
                          className="block text-[16px] leading-6 font-medium tabular-nums text-black dark:text-white"
                          aria-label={
                            demoPortfolio
                              ? "Пример баланса сети"
                              : providerBalance !== undefined ? provider === "goswap" ? "Учётный остаток GoSwap" : "Доступно в Aura" : "Баланс сети пока недоступен"
                          }
                        >
                          {demoPortfolio
                            ? code === "USDT"
                              ? "$" +
                                cryptoAmount(portfolioExamples[network].amount)
                              : cryptoAmount(preview.amount)
                            : providerBalance !== undefined ? `${cryptoAmount(providerBalance)} ${code}` : "—"}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-5 text-black/45 dark:text-white/45">
                          {wallet.depositModes[code]?.[network] === "exact"
                            ? "По точной сумме"
                            : item
                              ? item.address.slice(0, 7) +
                                "…" +
                                item.address.slice(-5)
                              : loadingAddresses
                                ? "Получаем адрес…"
                                : wallet.configured
                                  ? "Получить адрес"
                                  : "Нет адреса"}
                        </span>
                      </span>
                    </button>
                  );
                },
              )}

              {addressError && (
                <p
                  role="status"
                  className="pt-3 text-[13px] text-black/45 dark:text-white/45"
                >
                  {addressError}
                </p>
              )}
              {wallet.demo && (
                <button
                  type="button"
                  onClick={() => {
                    setAddressError("");
                    setCreatingAddress(true);
                  }}
                  className="flex min-h-12 w-full items-center gap-3 py-2 text-left text-[16px] font-medium text-primary"
                >
                  <span className="flex h-8 w-9 shrink-0 items-center justify-center">
                    <Plus size={23} />
                  </span>
                  Создать ещё адрес
                </button>
              )}
            </div>
          </Card>
        </section>
        <section ref={historySection} className="wpay-asset-history scroll-mt-24 px-4 pb-3 pt-4">
          <h3 className="mb-3 px-2 text-[16px] font-semibold text-black/50 dark:text-white/50">
            История транзакций
          </h3>
          <Card className="!m-0 !rounded-[30px]" contentWrapPadding="p-5">
            {!transactions.length && (
              <p className="py-3 text-center text-[14px] text-black/45 dark:text-white/45">
                Операций в {code} пока нет
              </p>
            )}
            {(allHistory ? transactions : transactions.slice(0, 3)).map(
              (item) => (
                <div
                  key={item.event_id}
                  className="flex items-center justify-between gap-3 border-b border-black/[.06] py-3 first:pt-0 last:border-0 last:pb-0 dark:border-white/[.08]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-black dark:text-white">
                      {item.type === "deposit"
                        ? "Пополнение"
                        : item.type === "qr_refunded"
                          ? "Возврат"
                          : item.type === "qr_failed"
                            ? "Платёж не прошёл"
                            : String(item.detail.merchant_name || "QR-оплата")}
                    </span>
                    <span className="mt-1 block text-[12px] text-black/40 dark:text-white/40">
                      {new Date(item.created_at).toLocaleDateString("ru-RU")}
                    </span>
                  </span>
                  <span className="shrink-0 text-[14px] font-medium tabular-nums text-black dark:text-white">
                    {Number(item.amount) > 0 ? "+" : ""}
                    {cryptoAmount(item.amount)} {code}
                  </span>
                </div>
              ),
            )}
            {transactions.length > 3 && (
              <Button
                clear
                rounded
                className="!mt-3 !w-full"
                onClick={() => setAllHistory((value) => !value)}
              >
                {allHistory ? "Свернуть" : "Все транзакции"}
              </Button>
            )}
          </Card>
        </section>
        <section className="wpay-asset-about px-4 pb-5 pt-4">
          <h3 className="mb-3 px-2 text-[16px] font-semibold text-black/50 dark:text-white/50">
            {about.title}
          </h3>
          <Card className="!m-0 !rounded-[30px]" contentWrapPadding="p-5">
            <p className="text-[15px] leading-relaxed text-black/65 dark:text-white/65">
              {about.text}
            </p>
          </Card>
        </section>
      </div>
      {createPortal(
        <Sheet
          opened={selectedAddress !== null || creatingAddress}
          backdrop
          closeByBackdropClick
          closeOnEscape
          swipeToClose
          swipeHandler=".wpay-address-header"
          className={`wpay-exchange-sheet ${creatingAddress ? "wpay-create-address-sheet" : ""}`}
          onSheetClosed={() => {
            setSelectedAddress(null);
            setCreatingAddress(false);
            setAddressError("");
          }}
        >
          <header className="wpay-address-header shrink-0 px-5 pb-4 pt-3">
            <div
              aria-hidden="true"
              className="mx-auto mb-4 h-1 w-9 rounded-full bg-black/15 dark:bg-white/20"
            />
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[22px] font-semibold text-black dark:text-white">
                  {selectedAddress ? "Адрес " + code : "Создать ещё адрес"}
                </h2>
                <p className="mt-1 text-[14px] text-black/45 dark:text-white/45">
                  {selectedAddress
                    ? networkLabels[selectedAddress.network]
                    : "Выберите сети · $2 за адрес"}
                </p>
              </div>
              <WalletSheetClose
                label="Закрыть адреса"
                onClick={() => {
                  setSelectedAddress(null);
                  setCreatingAddress(false);
                }}
              />
            </div>
          </header>
          <div
            className={
              selectedAddress
                ? "min-h-0 overflow-y-auto px-5 pb-[max(16px,env(safe-area-inset-bottom))]"
                : "flex min-h-0 flex-1 flex-col"
            }
          >
            {selectedAddress ? (
              <>
                <div className="mx-auto w-fit rounded-[24px] bg-white p-4">
                  <QRCode value={selectedAddress.address} size={180} />
                </div>
                <p className="mt-5 select-text break-all rounded-2xl bg-black/5 p-4 font-mono text-[14px] leading-6 text-black dark:bg-white/5 dark:text-white">
                  {selectedAddress.address}
                </p>
                <p className="my-4 text-[13px] leading-5 text-black/45 dark:text-white/45">
                  Отправляйте только {code} в сети{" "}
                  {networkLabels[selectedAddress.network]}. Другая сеть может
                  привести к потере средств.
                </p>
                <Button
                  data-wpay-primary=""
                  rounded
                  onClick={() => void copyAddress(selectedAddress.address)}
                >
                  <span className="flex items-center gap-2">
                    {copiedAddress === selectedAddress.address ? (
                      <Check size={18} />
                    ) : (
                      <Copy size={18} />
                    )}{" "}
                    {copiedAddress === selectedAddress.address
                      ? "Скопировано"
                      : "Скопировать адрес"}
                  </span>
                </Button>
              </>
            ) : (
              <WalletCreateAddress
                key={creatingAddress ? "open-" + code : "closed-" + code}
                code={code}
                networks={(addressNetworks[code] ?? [])
                  .filter((network) =>
                    (wallet.assetRoutes[code] ?? []).includes(network),
                  )
                  .filter((network) => network !== "TRON")}
                icon={icon}
                color={color}
                iconColor={iconColor}
              />
            )}
            {addressError && (
              <p
                role="alert"
                className="mt-4 text-[13px] text-red-500 dark:text-red-400"
              >
                {addressError}
              </p>
            )}
          </div>
        </Sheet>,
        document.querySelector(".wpay-f7-root") ?? document.body,
      )}
      <div
        className={`wpay-asset-actions ${code === "USDT" ? "wpay-asset-actions--two" : "wpay-asset-actions--pair"} pointer-events-none sticky bottom-0 z-10 grid grid-cols-[1fr_1fr_48px] gap-2 bg-transparent px-4 pt-3 dark:bg-transparent [&>button]:pointer-events-auto [&>span]:pointer-events-auto`}
      >
        {code === "USDT" ? (
          <>
            <Button
              data-wpay-primary=""
              rounded
              large
              onClick={() => onDeposit()}
              className="!px-2"
            >
              <span className="flex items-center justify-center gap-1">
                <PlusCircleFill className="text-[18px] text-white" />
                Пополнить
              </span>
            </Button>
            <Button
              data-wpay-primary=""
              rounded
              large
              onClick={onWithdraw}
              className="!px-2"
            >
              <span className="flex items-center justify-center gap-1">
                <ArrowUpCircleFill className="text-[18px] text-white" />
                Вывести
              </span>
            </Button>
            <Button
              data-wpay-primary=""
              rounded
              large
              aria-label="Обменять"
              onClick={onExchange}
              className="wpay-exchange-circle !w-14 !px-0"
            >
              <ArrowRightArrowLeft className="text-[24px] text-white" />
            </Button>
          </>
        ) : (
          <>
            <Button
              data-wpay-primary=""
              rounded
              large
              onClick={() => onDeposit()}
              className="!px-2"
            >
              <span className="flex items-center justify-center gap-1">
                <PlusCircleFill className="text-[18px] text-white" />
                Пополнить
              </span>
            </Button>
            <Button
              data-wpay-primary=""
              rounded
              large
              onClick={onExchange}
              className="!px-2"
            >
              <span className="flex items-center justify-center gap-1">
                <ArrowRightArrowLeft className="text-[18px] text-white" />
                Обменять
              </span>
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
