import WalletAssetAvatar from "./WalletAssetAvatar";
import { Check } from "lucide-react";
import { portfolioExamples } from "../wallet/demo";
import {
  assetNetworks as previewNetworks,
  addressesForAsset,
  isRecipientAddress,
  type WalletAddress,
} from "../wallet/catalog";
import {
  addressNetworkNames,
  addressNetworkStandards,
} from "./WalletAddressDetails";
import { walletRequest } from "../lib/wallet-api";
import { SiTether } from "@icons-pack/react-simple-icons";
import { useEffect, useState } from "react";
import {
  Button,
  Card,
  List as KList,
  ListItem as KListItem,
} from "konsta/react";
import { List, ListItem } from "framework7-react";
import ArrowUpCircleFill from "framework7-icons/react/esm/ArrowUpCircleFill.js";
import PersonCropCircleFill from "framework7-icons/react/esm/PersonCropCircleFill.js";
import DocTextFill from "framework7-icons/react/esm/DocTextFill.js";
import ChevronRight from "framework7-icons/react/esm/ChevronRight.js";
import { useLiveWallet, cryptoAmount, usd } from "./WalletLive";

const surface = "!m-0 !rounded-[28px]";
export type WithdrawalMethod = "usdt" | "check" | "username";
export const withdrawalTitles = {
  usdt: "Вывести USDT",
  check: "Создать чек",
  username: "Перевод",
};
const methods = [
  {
    id: "usdt" as const,
    title: "USDT",
    description: "На внешний криптокошелёк",
    Icon: ArrowUpCircleFill,
    color: "#26a17b",
  },
  {
    id: "check" as const,
    title: "Чек",
    description: "Передать USDT по ссылке",
    Icon: DocTextFill,
    color: "#5856d6",
  },
  {
    id: "username" as const,
    title: "По username",
    description: "Перевод пользователю Telegram",
    Icon: PersonCropCircleFill,
    color: "#007aff",
  },
];
export function WithdrawalMethods({
  onSelect,
}: {
  onSelect: (method: WithdrawalMethod) => void;
}) {
  const avatar = (Icon: typeof DocTextFill, color: string) => (
    <span
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white"
      style={{
        background: `linear-gradient(180deg,color-mix(in srgb,${color} 62%,white),${color})`,
      }}
    >
      <Icon className="text-[25px]" />
    </span>
  );
  return (
    <main className="wpay-f7-profile mx-auto w-full max-w-[560px] pt-1 pb-6">
      <p className="mb-4 mt-1 px-5 text-center text-[14px] leading-6 text-black/45 dark:text-white/45">
        Выберите удобный способ
      </p>
      <KList
        strong
        inset
        className="!mx-4 !my-0 overflow-hidden !rounded-full [&>ul]:!rounded-full"
      >
        <KListItem
          link
          chevron={false}
          contentClassName="!h-[64px]"
          innerClassName="!min-w-0 !h-[64px] !py-2 after:!opacity-30"
          onClick={() => onSelect("usdt")}
          media={
            <span
              className="wpay-currency-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white"
              style={{
                background:
                  "linear-gradient(180deg,color-mix(in srgb,#26a17b 62%,white),#26a17b)",
              }}
            >
              <SiTether size={25} />
            </span>
          }
          innerChildren={
            <span className="flex h-full w-full min-w-0 items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-[17px] font-semibold leading-6 text-black dark:text-white">
                  Tether
                </span>
                <span className="mt-0.5 block text-[14px] leading-5 text-black/45 dark:text-white/45">
                  USDT
                </span>
              </span>
              <ChevronRight className="shrink-0 text-[19px] text-black/25 dark:text-white/30" />
            </span>
          }
        />
      </KList>
      <h2 className="mb-2 mt-6 px-5 text-[17px] font-semibold text-black/50 dark:text-white/50">
        В Telegram
      </h2>
      <List
        strong
        inset
        dividers
        className="!my-0 overflow-hidden !rounded-[30px] [&>ul]:!rounded-[30px]"
      >
        {methods
          .filter((item) => item.id !== "usdt")
          .map(({ id, title, description, Icon, color }) => (
            <ListItem
              key={id}
              link="#"
              external
              title={title}
              mediaItem
              subtitle={description}
              onClick={(event) => {
                event.preventDefault();
                onSelect(id);
              }}
            >
              <span slot="media">{avatar(Icon, color)}</span>
            </ListItem>
          ))}
      </List>
    </main>
  );
}
export function WithdrawalForm({ method }: { method: WithdrawalMethod }) {
  const wallet = useLiveWallet();
  const [amount, setAmount] = useState(""),
    [recipient, setRecipient] = useState(""),
    [network, setNetwork] = useState("TRON"),
    [review, setReview] = useState(false);
  const [source, setSource] = useState<{
    network: string;
    address: string;
    amount: number | null;
  } | null>(null);
  const [sourceConfirmed, setSourceConfirmed] = useState(false);
  const [sources, setSources] = useState<
    { network: string; address: string; amount: number | null }[]
  >([]);
  const [sourceLoading, setSourceLoading] = useState(true),
    [sourceError, setSourceError] = useState("");
  useEffect(() => {
    let active = true;
    if (wallet.loading) return;
    if (wallet.demo) {
      setSources(
        previewNetworks.USDT.map((network) => ({
          network,
          ...portfolioExamples[network],
        })),
      );
      setSourceLoading(false);
      return;
    }
    if (!wallet.configured || !wallet.ready) {
      setSources([]);
      setSourceLoading(false);
      setSourceError(wallet.error || "Сервис недоступен");
      return;
    }
    setSourceLoading(true);
    setSourceError("");
    walletRequest<{ items?: WalletAddress[] }>("addresses")
      .then((result) => {
        if (active)
          setSources(
            addressesForAsset(result.items ?? [], "USDT").map((row) => ({
              ...row,
              amount: null,
            })),
          );
      })
      .catch(() => {
        if (active) setSourceError("Не удалось загрузить адреса");
      })
      .finally(() => {
        if (active) setSourceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    wallet.loading,
    wallet.configured,
    wallet.ready,
    wallet.demo,
    wallet.error,
  ]);
  const normalized = amount.replace(",", "."),
    value = Number(normalized);
  const validAmount = /^\d+(\.\d{1,6})?$/.test(normalized) && value > 0;
  const addressValid = isRecipientAddress(
    source?.network ?? network,
    recipient,
  );
  const validRecipient =
    method === "check" ||
    (method === "username"
      ? /^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(recipient.trim())
      : addressValid);
  const availableAmount =
    source?.amount ?? (wallet.ready ? Number(wallet.balance("USDT")) : null);
  const insufficient =
    validAmount && availableAmount !== null && value > availableAmount;
  const totalUsdt = wallet.demo
    ? 1234.56
    : wallet.ready
      ? Number(wallet.balance("USDT"))
      : null;
  const totalUsd =
    totalUsdt === null
      ? null
      : totalUsdt * (wallet.demo ? 1 : (wallet.rate("USDT") ?? 1));
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
  const rubRate = wallet.demo
    ? 92.5
    : rubQuote
      ? Number(rubQuote.rate)
      : inverseRubQuote && Number(inverseRubQuote.rate) > 0
        ? 1 / Number(inverseRubQuote.rate)
        : null;
  if (method === "usdt" && !sourceConfirmed)
    return (
      <main className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 pt-4 pb-[110px]">
        <h2 className="px-2 text-[17px] font-semibold text-black/50 dark:text-white/50">
          Ваш портфель
        </h2>
        <Card
          className="!m-0 !rounded-[30px] overflow-hidden !bg-white dark:!bg-[#1c1c1e]"
          contentWrapPadding="px-5 py-0"
        >
          <div className="-mx-5 border-b border-black/[.06] px-5 py-5 dark:border-white/[.08]">
            <span className="block text-[20px] font-semibold tabular-nums">
              {wallet.demo
                ? "1,234.56"
                : wallet.ready
                  ? cryptoAmount(wallet.balance("USDT"))
                  : "—"}{" "}
              USDT
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] tabular-nums text-black/45 dark:text-white/45">
              <span>{totalUsd === null ? "—" : usd(totalUsd)}</span>
              <span>
                {totalUsd !== null && rubRate !== null
                  ? (totalUsd * rubRate).toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }) + " ₽"
                  : "— ₽"}
              </span>
            </span>
          </div>
          <fieldset aria-label="Адрес списания">
            <legend className="sr-only">Выберите адрес для вывода</legend>
            {sourceLoading ? (
              <p
                role="status"
                className="py-5 text-black/45 dark:text-white/45"
              >
                Загружаем адреса…
              </p>
            ) : (
              sources.map((row) => (
                <label
                  key={row.network + row.address}
                  className="-mx-5 flex h-16 cursor-pointer items-center gap-3 px-5 border-b border-black/[.06] last:border-0 active:bg-black/5 dark:border-white/[.08] dark:active:bg-white/10"
                >
                  <WalletAssetAvatar
                    icon={<SiTether size={25} />}
                    color={"#26a17b"}
                    iconColor={"#fff"}
                    network={row.network}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium">
                      USDT · {addressNetworkStandards[row.network]}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-black/45 dark:text-white/45">
                      {addressNetworkNames[row.network]}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[16px] tabular-nums">
                      {row.amount === null
                        ? "—"
                        : "$" + cryptoAmount(row.amount)}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-black/45 dark:text-white/45">
                      {row.address.slice(0, 7)}…{row.address.slice(-5)}
                    </span>
                  </span>
                  <span className="relative ml-1 flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                    <input
                      type="radio"
                      name="withdraw-source"
                      aria-label={`USDT ${addressNetworkStandards[row.network]}`}
                      checked={
                        source?.address === row.address &&
                        source?.network === row.network
                      }
                      onChange={() => {
                        setSource(row);
                        setNetwork(row.network);
                      }}
                      className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                    />
                    <span
                      aria-hidden="true"
                      className="flex h-full w-full items-center justify-center rounded-full border border-[#c7c7cc] peer-checked:border-[#007aff] peer-checked:bg-[#007aff] peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400 peer-focus-visible:ring-offset-2 dark:border-white/30 dark:peer-checked:border-[#0a84ff] dark:peer-checked:bg-[#0a84ff]"
                    >
                      {source?.address === row.address &&
                        source?.network === row.network && (
                          <Check
                            className="h-[16px] w-[16px] text-white"
                            strokeWidth={2.5}
                          />
                        )}
                    </span>
                  </span>
                </label>
              ))
            )}
          </fieldset>
          {sourceError && (
            <p role="alert" className="py-4 text-red-600 dark:text-red-400">
              {sourceError}
            </p>
          )}
          {!sourceLoading && !sourceError && !sources.length && (
            <p className="py-5 text-black/45 dark:text-white/45">
              Адресов пока нет
            </p>
          )}
        </Card>
        <Card className={surface} contentWrapPadding="p-5">
          <div className="flex items-center justify-between text-[14px] text-black/45 dark:text-white/45">
            <label htmlFor="withdraw-amount">Сумма отправки</label>
            <span>
              {availableAmount !== null
                ? `${cryptoAmount(availableAmount)} USDT доступно`
                : "Выберите адрес"}
            </span>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <input
              id="withdraw-amount"
              aria-label="Сумма вывода USDT"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value.replace(/[^\d.,]/g, ""));
                setReview(false);
              }}
              placeholder="0.00"
              className="min-w-0 flex-1 bg-transparent text-[36px] font-semibold tracking-tight text-black outline-none placeholder:text-black/20 dark:text-white dark:placeholder:text-white/25"
            />
            <span className="text-[19px] font-semibold text-black/45 dark:text-white/45">
              USDT
            </span>
          </div>
          {insufficient && (
            <p
              role="alert"
              className="mt-3 text-[14px] text-red-500 dark:text-red-400"
            >
              Недостаточно средств
            </p>
          )}
        </Card>
        <Button
          data-wpay-primary=""
          rounded
          large
          className="wpay-bottom-action"
          disabled={!source || !validAmount || insufficient}
          onClick={() => setSourceConfirmed(true)}
        >
          Продолжить
        </Button>
      </main>
    );
  return (
    <main className="mx-auto w-full max-w-[560px] flex flex-col gap-4 px-4 py-4">
      <Card className={surface} contentWrapPadding="p-5">
        <div className="flex items-center justify-between text-[14px] text-black/45 dark:text-white/45">
          <label htmlFor="withdraw-amount">Сумма отправки</label>
          <span>
            {wallet.ready
              ? `${cryptoAmount(wallet.balance("USDT"))} USDT доступно`
              : "Баланс недоступен"}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <input
            id="withdraw-amount"
            aria-label="Сумма вывода USDT"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(/[^\d.,]/g, ""));
              setReview(false);
            }}
            placeholder="0.00"
            className="min-w-0 flex-1 bg-transparent text-[36px] font-semibold tracking-tight text-black outline-none placeholder:text-black/20 dark:text-white dark:placeholder:text-white/25"
          />
          <span className="text-[19px] font-semibold text-black/45 dark:text-white/45">
            USDT
          </span>
        </div>
        {insufficient && (
          <p
            role="alert"
            className="mt-3 text-[14px] text-red-500 dark:text-red-400"
          >
            Недостаточно средств
          </p>
        )}
      </Card>
      {method === "usdt" && (
        <Card className={surface} contentWrapPadding="p-5">
          <p className="text-[14px] text-black/45 dark:text-white/45">
            Сеть перевода
          </p>
          <p className="mt-2 text-[17px] font-medium text-black dark:text-white">
            {addressNetworkNames[source?.network ?? network]} ·{" "}
            {addressNetworkStandards[source?.network ?? network]}
          </p>
          <button
            type="button"
            className="mt-3 text-[14px] text-primary"
            onClick={() => {
              setSourceConfirmed(false);
              setRecipient("");
              setReview(false);
            }}
          >
            Изменить адрес списания
          </button>
        </Card>
      )}
      {method !== "check" && (
        <Card className={surface} contentWrapPadding="p-5">
          <label
            htmlFor="withdraw-recipient"
            className="text-[14px] text-black/45 dark:text-white/45"
          >
            {method === "username" ? "Username получателя" : "Адрес кошелька"}
          </label>
          <input
            id="withdraw-recipient"
            aria-label={
              method === "username" ? "Username получателя" : "Адрес кошелька"
            }
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value);
              setReview(false);
            }}
            placeholder={
              method === "username" ? "@username" : "Вставьте адрес получателя"
            }
            className="mt-3 w-full bg-transparent text-[17px] text-black outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/30"
          />
          {recipient && !validRecipient && (
            <p className="mt-3 text-[13px] text-orange-600 dark:text-orange-400">
              {method === "username"
                ? "Проверьте username: от 5 до 32 символов."
                : "Проверьте формат адреса и выбранную сеть."}
            </p>
          )}
        </Card>
      )}
      {method === "check" && (
        <Card className={surface} contentWrapPadding="p-5">
          <h2 className="text-[19px] font-semibold text-black dark:text-white">
            USDT по одной ссылке
          </h2>
          <p className="mt-2 text-[15px] leading-6 text-black/45 dark:text-white/45">
            После создания чека вы сможете передать ссылку получателю. Сейчас
            выпуск чеков ещё не подключён.
          </p>
        </Card>
      )}
      {review && (
        <Card className={surface} contentWrapPadding="p-5">
          <h2 className="text-[20px] font-semibold text-black dark:text-white">
            Проверьте перевод
          </h2>
          {source && (
            <p className="mt-3 break-all text-[13px] text-black/45 dark:text-white/45">
              С адреса: {source.address} · {addressNetworkNames[source.network]}
            </p>
          )}
          <dl className="mt-4 space-y-3 text-[15px] text-black dark:text-white">
            <div className="flex justify-between gap-4">
              <dt className="text-black/45 dark:text-white/45">Сумма</dt>
              <dd className="font-semibold">{normalized} USDT</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-black/45 dark:text-white/45">Способ</dt>
              <dd>{methods.find((item) => item.id === method)?.title}</dd>
            </div>
            {method !== "check" && (
              <div>
                <dt className="text-black/45 dark:text-white/45">
                  Получатель{method === "usdt" ? ` · ${network}` : ""}
                </dt>
                <dd className="mt-1 break-all">{recipient}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-black/45 dark:text-white/45">Комиссия</dt>
              <dd>Пока недоступна</dd>
            </div>
          </dl>
          <p
            role="status"
            className="mt-4 rounded-[18px] bg-black/5 p-4 text-[14px] leading-5 text-black/50 dark:bg-white/10 dark:text-white/50"
          >
            {method === "check"
              ? "Создание чеков"
              : method === "username"
                ? "Переводы по username"
                : "Вывод USDT"}{" "}
            пока не подключены. Средства не списаны.
          </p>
        </Card>
      )}
      <Button
        data-wpay-primary=""
        rounded
        large
        disabled={!validAmount || !validRecipient || insufficient || review}
        className="!m-0 !w-full !rounded-[22px]"
        onClick={() => setReview(true)}
      >
        {review ? "Операция пока недоступна" : "Проверить реквизиты"}
      </Button>
      <p className="px-2 text-center text-[13px] leading-5 text-black/40 dark:text-white/40">
        Вывод появится после подключения провайдера. Комиссия и лимиты будут
        показаны до подтверждения.
      </p>
    </main>
  );
}
