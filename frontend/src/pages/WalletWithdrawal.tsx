import { WalletTransfer } from "./WalletUserFinance";
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
import { walletRequest, WalletApiError } from "../lib/wallet-api";
import {
  assetNetworks,
  networkNames,
  networkStandards,
  isRecipientAddress,
} from "../wallet/catalog";
import { useLiveWallet, cryptoAmount } from "./WalletLive";
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
    title: "По Telegram ID",
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
interface Estimate {
  intent_id: string;
  fee: string;
  total: string;
  expires_at: number;
}
interface Outcome {
  status: string;
  spend_id?: string;
  tx_hash?: string;
}

function CoreWithdrawalForm({ method }: { method: WithdrawalMethod }) {
  const wallet = useLiveWallet();
  const [network, setNetwork] = useState("");
  const [recipient, setRecipient] = useState(""),
    [amount, setAmount] = useState(""),
    [memo, setMemo] = useState("");
  const [estimate, setEstimate] = useState<Estimate | null>(null),
    [outcome, setOutcome] = useState<Outcome | null>(null);
  const [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const available = wallet.demo
    ? 1234.56
    : wallet.ready
      ? Number(wallet.balance("USDT"))
      : null;
  const normalized = amount.replace(",", "."),
    value = Number(normalized);
  const validAmount = /^\d+(\.\d{1,6})?$/.test(normalized) && value > 0;
  const validRecipient =
    method === "check" ||
    (method === "username"
      ? /^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(recipient.trim())
      : isRecipientAddress(network, recipient));
  const insufficient = validAmount && available !== null && value > available;
  const debt = wallet.data.debts?.find(
    (row) => row.asset === "USDT" && Number(row.amount) > 0,
  );
  function invalidate() {
    setEstimate(null);
    setOutcome(null);
    setReview(false);
    setError("");
  }
  async function calculate() {
    if (busy) return;
    if (method !== "usdt" || wallet.demo) {
      setReview(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await walletRequest<Estimate>("withdrawal-estimate", {
        asset: "USDT",
        network,
        address: recipient.trim(),
        amount: normalized,
        ...(memo ? { memo } : {}),
      });
      if (
        !result.intent_id ||
        result.fee === undefined ||
        result.total === undefined
      )
        throw Error("Некорректный расчёт провайдера");
      setEstimate(result);
      setReview(true);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Не удалось рассчитать вывод",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!estimate || busy) return;
    setBusy(true);
    setError("");
    try {
      setOutcome(
        await walletRequest<Outcome>("withdrawal-create", {
          intent_id: estimate.intent_id,
        }),
      );
      void wallet.refresh();
    } catch (error) {
      if (
        error instanceof WalletApiError &&
        ["QUOTE_EXPIRED", "REESTIMATE_REQUIRED"].includes(error.code)
      ) {
        setEstimate(null);
        setReview(false);
      }
      setError(
        error instanceof Error
          ? error.message
          : "Ответ не получен. Повторите запрос с тем же номером операции.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function refreshOutcome() {
    if (!outcome || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await walletRequest<{ items: Outcome[] }>(
        "withdrawal-history",
      );
      const current = result.items.find(
        (item) => item.spend_id === outcome.spend_id,
      );
      if (current) setOutcome(current);
      void wallet.refresh();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Не удалось обновить статус",
      );
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || outcome !== null;
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-4">
      <p className="px-2 text-[14px] text-black/45 dark:text-white/45">
        {available === null
          ? "Баланс недоступен"
          : `Доступно: ${cryptoAmount(available)} USDT`}
      </p>
      {debt && (
        <p
          role="alert"
          className="px-2 text-[14px] text-orange-600 dark:text-orange-400"
        >
          Задолженность по уточнённому выводу: {debt.amount} USDT. Следующее
          пополнение погасит её.
        </p>
      )}
      {method === "usdt" && (
        <Card className={surface} contentWrapPadding="p-5">
          <label
            htmlFor="withdraw-network"
            className="text-[14px] text-black/45 dark:text-white/45"
          >
            Сеть вывода
          </label>
          <select
            id="withdraw-network"
            aria-label="Сеть вывода"
            disabled={locked}
            value={network}
            onChange={(event) => {
              setNetwork(event.target.value);
              setRecipient("");
              setMemo("");
              invalidate();
            }}
            className="mt-2 w-full bg-transparent py-2 text-[17px] font-medium text-black outline-none dark:text-white"
          >
            <option value="" disabled>
              Выберите сеть
            </option>
            {(wallet.assetRoutes.USDT ?? []).filter((code) =>
              assetNetworks.USDT.includes(code),
            ).map((code) => (
              <option key={code} value={code}>
                {networkNames[code]} · {networkStandards[code]}
              </option>
            ))}
          </select>
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
            disabled={locked || (method === "usdt" && !network)}
            value={recipient}
            onChange={(event) => {
              setRecipient(event.target.value);
              invalidate();
            }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={
              method === "username" ? "@username" : "Вставьте адрес получателя"
            }
            className="mt-3 w-full bg-transparent text-[17px] text-black outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/30"
          />
          {recipient && !validRecipient && (
            <p className="mt-3 text-[13px] text-orange-600 dark:text-orange-400">
              Проверьте реквизиты получателя и выбранную сеть.
            </p>
          )}
        </Card>
      )}
      {method === "usdt" && ["TON", "SOL"].includes(network) && (
        <Card className={surface} contentWrapPadding="p-5">
          <label
            htmlFor="withdraw-memo"
            className="text-[14px] text-black/45 dark:text-white/45"
          >
            Комментарий / memo (если нужен получателю)
          </label>
          <input
            id="withdraw-memo"
            disabled={locked}
            value={memo}
            onChange={(event) => {
              setMemo(event.target.value);
              invalidate();
            }}
            className="mt-3 w-full bg-transparent text-[17px] text-black outline-none dark:text-white"
          />
        </Card>
      )}
      <Card className={surface} contentWrapPadding="p-5">
        <label
          htmlFor="withdraw-amount"
          className="text-[14px] text-black/45 dark:text-white/45"
        >
          Сумма отправки
        </label>
        <div className="mt-4 flex items-center gap-3">
          <input
            id="withdraw-amount"
            aria-label="Сумма вывода USDT"
            inputMode="decimal"
            autoComplete="off"
            disabled={locked}
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value.replace(/[^\d.,]/g, ""));
              invalidate();
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
            className="mt-3 text-[13px] text-orange-600 dark:text-orange-400"
          >
            Недостаточно средств
          </p>
        )}
      </Card>
      {review && (
        <Card className={surface} contentWrapPadding="p-5">
          <h2 className="text-[20px] font-semibold text-black dark:text-white">
            Проверьте перевод
          </h2>
          <dl className="mt-4 space-y-3 text-[15px] text-black dark:text-white">
            <div className="flex justify-between gap-4">
              <dt className="text-black/45 dark:text-white/45">
                Получатель получит
              </dt>
              <dd>{normalized} USDT</dd>
            </div>
            {method === "usdt" && (
              <div className="flex justify-between gap-4">
                <dt className="text-black/45 dark:text-white/45">Сеть</dt>
                <dd>
                  {networkNames[network]} · {networkStandards[network]}
                </dd>
              </div>
            )}
            {recipient && (
              <div>
                <dt className="text-black/45 dark:text-white/45">Получатель</dt>
                <dd className="mt-1 break-all">{recipient}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-black/45 dark:text-white/45">Комиссия</dt>
              <dd>{estimate ? estimate.fee + " USDT" : "Пока недоступна"}</dd>
            </div>
            {estimate && (
              <div className="flex justify-between gap-4">
                <dt className="text-black/45 dark:text-white/45">
                  Всего к списанию
                </dt>
                <dd className="font-semibold">{estimate.total} USDT</dd>
              </div>
            )}
          </dl>
          <p
            role="status"
            className="mt-4 text-[14px] text-black/50 dark:text-white/50"
          >
            {outcome
              ? outcome.status === "completed"
                ? "Отправлено"
                : outcome.status === "failed"
                  ? "Вывод не состоялся. Средства возвращены."
                  : "Вывод принят. Ожидаем отправку в сеть."
              : estimate
                ? "Комиссия списывается сверху. После подтверждения отменить вывод нельзя."
                : wallet.demo
                  ? "Демонстрационный режим. Средства не списываются."
                  : "Этот способ пока не подключён. Средства не списаны."}
          </p>
        </Card>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-2xl bg-red-500/10 p-4 text-[14px] text-red-600 dark:bg-red-400/10 dark:text-red-400"
        >
          {error}
        </p>
      )}
      {!review && (
        <Button
          data-wpay-primary=""
          rounded
          large
          disabled={
            busy ||
            !validAmount ||
            !validRecipient ||
            insufficient ||
            !!debt ||
            (method === "usdt" && !network)
          }
          onClick={() => void calculate()}
        >
          {busy ? "Рассчитываем…" : "Проверить реквизиты"}
        </Button>
      )}
      {estimate && !outcome && (
        <Button
          data-wpay-primary=""
          rounded
          large
          disabled={
            busy || (available !== null && Number(estimate.total) > available)
          }
          onClick={() => void submit()}
        >
          {busy ? "Отправляем…" : "Подтвердить вывод"}
        </Button>
      )}
      {outcome && (
        <Button
          data-wpay-primary=""
          rounded
          tonal
          disabled={busy}
          onClick={() => void refreshOutcome()}
        >
          Обновить статус
        </Button>
      )}
    </main>
  );
}

export function WithdrawalForm({ method }: { method: WithdrawalMethod }) {
  const wallet = useLiveWallet();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    if (method !== "usdt") return;
    walletRequest<{ can_withdraw: boolean }>("financial-capabilities")
      .then((value) => {
        if (active) setAllowed(value.can_withdraw === true);
      })
      .catch(() => {
        if (active) setAllowed(false);
      });
    return () => {
      active = false;
    };
  }, [method]);
  if (method === "usdt" && !wallet.demo && allowed !== true)
    return (
      <p
        role="status"
        className="p-5 text-center text-black/50 dark:text-white/50"
      >
        {allowed === null
          ? "Проверяем доступность…"
          : "Вывод в сеть недоступен"}
      </p>
    );
  return method === "username" ? (
    <WalletTransfer />
  ) : (
    <CoreWithdrawalForm method={method} />
  );
}
