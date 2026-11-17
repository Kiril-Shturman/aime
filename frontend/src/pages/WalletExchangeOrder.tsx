import { useEffect, useRef, useState } from "react";
import { Button, Card } from "konsta/react";
import { Preloader } from "framework7-react";
import QRCode from "react-qr-code";
import { Check, Copy } from "lucide-react";
import { walletRequest } from "../lib/wallet-api";
import WalletNetworkIcon from "./WalletNetworkIcon";
import { networkNames, networkStandards } from "../wallet/catalog";

export type ExchangeIntent = {
  intent_id: string;
  state: "prepared" | "unknown" | "ready" | "rejected";
  from_network: string;
  to_network: string;
  amount: string;
  rate_type: string;
  to_address: string;
  to_tag: string | null;
  quote_expires_at: number;
  quote: { to_amount: string | null };
  error: string | null;
  next_check_at: number;
  order: null | {
    provider_id: string;
    status: string;
    from_amount: string;
    to_amount: string;
    pay_address: string;
    pay_tag: string | null;
    to_address: string;
    expires_at: number;
    pay_tx_hash: string | null;
    payout_tx_hash: string | null;
    refund_tx_hash?: string | null;
  };
};
const statuses: Record<string, string> = {
  NEW: "Ожидаем оплату",
  PENDING: "Подтверждаем перевод",
  EXCHANGE: "Обмениваем",
  WITHDRAW: "Отправляем USDT",
  DONE: "Обмен завершён",
  EXPIRED: "Время оплаты истекло",
  EMERGENCY: "Нужна помощь с обменом",
  REFUNDED: "Средства возвращены",
};
const amount = (value: string) =>
  Number(value).toLocaleString("en-US", { maximumFractionDigits: 8 });

export default function WalletExchangeOrder({
  active,
  from,
  to,
  value,
  mode,
  quoteValid,
  enabled,
  onIntentChange,
}: {
  active: boolean;
  from: string;
  to: string;
  value: string;
  mode: string;
  quoteValid: boolean;
  enabled: boolean;
  onIntentChange: (open: boolean) => void;
}) {
  const [destination, setDestination] = useState("");
  const [memo, setMemo] = useState("");
  const [ownAddress, setOwnAddress] = useState(false);
  const [intent, setIntent] = useState<ExchangeIntent | null>(null);
  const [history, setHistory] = useState<ExchangeIntent[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const scope = useRef(0),
    busyRef = useRef(false),
    life = useRef<AbortController | null>(null);
  const snapshot = intent?.order;
  useEffect(() => {
    onIntentChange(Boolean(intent));
    return () => onIntentChange(false);
  }, [intent?.intent_id, onIntentChange]);
  useEffect(() => {
    scope.current++;
    life.current?.abort();
    life.current = new AbortController();
    setIntent(null);
    setError("");
    setBusy("");
    busyRef.current = false;
    return () => {
      scope.current++;
      life.current?.abort();
    };
  }, [from, to, value, mode, active]);
  useEffect(() => {
    setDestination("");
    setMemo("");
    setOwnAddress(false);
  }, [to]);
  useEffect(() => {
    if (!active || !enabled) return;
    const abort = new AbortController();
    void walletRequest<{ items: ExchangeIntent[] }>(
      "exchange-orders",
      undefined,
      abort.signal,
    )
      .then((result) => {
        if (!abort.signal.aborted) setHistory(result.items);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [active, enabled, intent?.state, intent?.order?.status]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (
      !active ||
      !intent ||
      intent.state === "prepared" ||
      intent.state === "rejected" ||
      ["DONE", "REFUNDED"].includes(intent.order?.status ?? "")
    )
      return;
    const abort = new AbortController();
    const id = intent.intent_id;
    const refresh = () =>
      void walletRequest<ExchangeIntent>(
        `exchange-order?intent_id=${encodeURIComponent(id)}`,
        undefined,
        abort.signal,
      )
        .then((result) => {
          if (!abort.signal.aborted) {
            setIntent(result);
            setError("");
          }
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setError(
              "Не удалось обновить статус. Не отправляйте перевод повторно.",
            );
        });
    const timer = setInterval(refresh, 15_000);
    refresh();
    return () => {
      clearInterval(timer);
      abort.abort();
    };
  }, [active, intent?.intent_id, intent?.state, intent?.order?.status]);
  async function action(name: string, task: () => Promise<void>) {
    if (busyRef.current) return;
    const currentScope = scope.current;
    busyRef.current = true;
    setBusy(name);
    setError("");
    try {
      await task();
    } catch (error) {
      if (currentScope === scope.current && !life.current?.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "Не удалось выполнить действие",
        );
    } finally {
      if (currentScope === scope.current) {
        busyRef.current = false;
        setBusy("");
      }
    }
  }
  async function prepare() {
    const current = scope.current;
    const signal = life.current?.signal;
    const result = await walletRequest<ExchangeIntent>(
      "exchange-prepare",
      {
        from_network: from,
        to_network: to,
        amount: value,
        rate_type: mode,
        to_address: destination.trim(),
        ...(memo.trim() ? { to_tag: memo.trim() } : {}),
      },
      signal,
    );
    if (current === scope.current) {
      setIntent(result);
    }
  }
  async function create() {
    if (!intent) return;
    const id = intent.intent_id,
      current = scope.current;
    try {
      const result = await walletRequest<ExchangeIntent>(
        "exchange-create",
        { intent_id: id },
        life.current?.signal,
      );
      if (current === scope.current) setIntent(result);
    } catch (error) {
      // Our endpoint can reconcile its durable intent; never retry the provider POST here.
      if (current === scope.current) {
        try {
          const recovered = await walletRequest<ExchangeIntent>(
            `exchange-order?intent_id=${id}`,
            undefined,
            life.current?.signal,
          );
          setIntent(recovered);
          if (recovered.state === "ready") return;
        } catch {
          setError(
            "Исход создания уточняется. Откройте историю обменов; не создавайте повторную заявку.",
          );
        }
      }
      throw error;
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError("Не удалось скопировать. Скопируйте адрес вручную.");
    }
  }
  const statusUnavailable =
    intent?.error === "STATUS_UNAVAILABLE" ||
    error.startsWith("Не удалось обновить статус");
  const canPay =
    snapshot?.status === "NEW" &&
    snapshot.expires_at * 1000 > now &&
    !statusUnavailable;
  const remaining = snapshot
    ? Math.max(0, Math.ceil(snapshot.expires_at - now / 1000))
    : 0;
  if (!enabled) return null;
  return (
    <section
      className="flex flex-col gap-4"
      aria-label="Заявка обмена FixedFloat"
    >
      {!intent && (
        <>
          <Card className="!m-0 !rounded-[28px]" contentWrapPadding="p-5">
            <label className="block text-sm text-black/45 dark:text-white/45">
              Адрес получения · {networkNames[to] ?? to}
              <input
                aria-label="Адрес получения обмена"
                value={destination}
                onChange={(e) => {
                  setOwnAddress(false);
                  setDestination(e.target.value);
                }}
                placeholder="Вставьте адрес кошелька"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="mt-2 min-h-12 w-full bg-transparent text-base text-black outline-none dark:text-white"
                disabled={Boolean(busy)}
              />
            </label>
            {(to === "TON" || to === "SOL") && (
              <label className="mt-3 block text-sm text-black/45 dark:text-white/45">
                Memo, если требуется
                <input
                  aria-label="Комментарий получения обмена"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className="mt-1 min-h-11 w-full bg-transparent text-base text-black outline-none dark:text-white"
                  disabled={Boolean(busy)}
                />
              </label>
            )}
            <button
              type="button"
              className="mt-2 text-sm font-medium text-primary"
              disabled={Boolean(busy)}
              onClick={() =>
                void action("address", async () => {
                  const current = scope.current;
                  const result = await walletRequest<{ address: string }>(
                    "exchange-own-address",
                    { network: to },
                    life.current?.signal,
                  );
                  if (current === scope.current) {
                    setDestination(result.address);
                    setMemo("");
                    setOwnAddress(true);
                  }
                })
              }
            >
              {busy === "address" ? <Preloader size={18} /> : "Мой адрес wPay"}
            </button>
            {ownAddress && (
              <p className="mt-3 text-xs leading-5 text-black/50 dark:text-white/50">
                Это собственный mainnet-адрес. Автоматическое зачисление на
                баланс приложения и вывод с него ещё не подключены.
              </p>
            )}
          </Card>
          <p className="px-2 text-sm leading-5 text-black/50 dark:text-white/50">
            Обмен оплачивается переводом USDT на адрес заявки. С баланса
            приложения ничего не списывается.
          </p>
          <Button
            large
            rounded
            data-wpay-primary=""
            disabled={!quoteValid || !destination.trim() || Boolean(busy)}
            onClick={() => void action("prepare", prepare)}
          >
            {busy === "prepare" ? (
              <Preloader size={20} color="white" />
            ) : (
              "Продолжить обмен"
            )}
          </Button>
        </>
      )}
      {intent?.state === "prepared" && (
        <Card className="!m-0 !rounded-[28px]" contentWrapPadding="p-5">
          <h3 className="text-lg font-semibold">Проверьте обмен</h3>
          <p className="mt-3 text-sm leading-5 opacity-60">
            После создания появятся реквизиты для самостоятельной оплаты.
            Автоматического списания нет.
          </p>
          <p className="mt-3">
            Отправите {amount(intent.amount)} USDT ·{" "}
            {networkStandards[intent.from_network] ?? intent.from_network}
          </p>
          <p className="mt-2">
            Получите ориентировочно{" "}
            {intent.quote.to_amount ? amount(intent.quote.to_amount) : "—"} USDT
            · {networkStandards[intent.to_network] ?? intent.to_network}
          </p>
          <p className="mt-3 break-all text-sm text-black/50 dark:text-white/50">
            Адрес получения: {intent.to_address}
            {intent.to_tag ? ` · Memo: ${intent.to_tag}` : ""}
          </p>
          {ownAddress && (
            <p className="mt-2 text-xs leading-5 opacity-60">
              Средства придут на собственный адрес wPay, отдельно от баланса
              приложения.
            </p>
          )}
          {intent.error === "RATE_LIMITED" && (
            <p className="mt-3 text-sm">
              Обменник ограничил запросы. Повторите после указанного времени.
            </p>
          )}
          <Button
            large
            rounded
            data-wpay-primary=""
            className="!mt-5"
            disabled={
              Boolean(busy) ||
              intent.quote_expires_at * 1000 <= now ||
              intent.next_check_at * 1000 > now
            }
            onClick={() => void action("create", create)}
          >
            {busy === "create" ? (
              <Preloader size={20} color="white" />
            ) : (
              "Создать обмен"
            )}
          </Button>
          {intent.quote_expires_at * 1000 <= now && (
            <p className="mt-3 text-sm">
              Расчёт устарел. Пересчитайте обмен перед созданием.
            </p>
          )}
        </Card>
      )}
      {intent?.state === "unknown" && (
        <Card className="!m-0 !rounded-[28px]" contentWrapPadding="p-5">
          <h3 className="text-lg font-semibold">Уточняем создание заявки</h3>
          <p className="mt-3 text-sm leading-6">
            Ответ обменника не получен. Мы не создаём повторную заявку
            автоматически. Средства с кошелька не отправлялись. Если статус не
            обновится, обратитесь в поддержку.
          </p>
          <p className="mt-3 break-all text-xs opacity-50">
            Номер обращения: {intent.intent_id}
          </p>
        </Card>
      )}
      {intent?.state === "rejected" && (
        <p role="alert" className="px-2 text-sm text-red-500">
          Обменник отклонил заявку. Проверьте сумму, сеть и адрес и создайте
          новый расчёт.
        </p>
      )}
      {snapshot && (
        <>
          <Card className="!m-0 !rounded-[28px]" contentWrapPadding="p-5">
            <h3 className="text-xl font-semibold" aria-live="polite">
              {statuses[snapshot.status] ?? snapshot.status}
            </h3>
            <p className="mt-1 text-sm opacity-50">
              Обмен № {snapshot.provider_id}
            </p>
            {canPay ? (
              <>
                <p className="mt-4 text-sm">
                  Отправьте ровно{" "}
                  <strong>{amount(snapshot.from_amount)} USDT</strong> в сети{" "}
                  {networkNames[intent!.from_network] ?? intent!.from_network} (
                  {networkStandards[intent!.from_network]}).
                </p>
                <div className="mx-auto my-5 w-fit rounded-2xl bg-white p-4">
                  <QRCode value={snapshot.pay_address} size={200} />
                </div>
                <p className="break-all text-center text-sm">
                  {snapshot.pay_address}
                </p>
                <Button
                  large
                  rounded
                  data-wpay-primary=""
                  className="!mt-4"
                  onClick={() => void copy(snapshot.pay_address)}
                >
                  <span className="flex items-center gap-2">
                    <Copy size={18} />
                    Скопировать адрес оплаты
                  </span>
                </Button>
                {snapshot.pay_tag && (
                  <div className="mt-4 rounded-2xl bg-black/5 p-3 dark:bg-white/10">
                    <p className="text-sm font-semibold">Обязательный Memo</p>
                    <p className="mt-1 break-all">{snapshot.pay_tag}</p>
                    <button
                      className="mt-2 text-primary"
                      onClick={() => void copy(snapshot.pay_tag!)}
                    >
                      Скопировать Memo
                    </button>
                  </div>
                )}
                <p className="mt-4 text-center text-sm tabular-nums">
                  До окончания оплаты: {Math.floor(remaining / 60)}:
                  {String(remaining % 60).padStart(2, "0")}
                </p>
                <p className="mt-2 text-xs leading-5 opacity-60">
                  Отправляйте только USDT в указанной сети. Сетевая комиссия
                  оплачивается отдельно. При переводе другой суммы или после
                  срока может потребоваться помощь поддержки.
                </p>
              </>
            ) : (
              <p className="mt-4 text-sm leading-6">
                {statusUnavailable
                  ? "Статус временно недоступен. Не отправляйте перевод повторно; дождитесь обновления."
                  : snapshot.status === "NEW" || snapshot.status === "EXPIRED"
                    ? "Срок оплаты истёк. Не отправляйте средства по этим реквизитам."
                    : snapshot.status === "EMERGENCY"
                      ? "Не отправляйте перевод повторно. Для продолжения обмена или возврата обратитесь в поддержку с номером заявки и хешем транзакции."
                      : "Повторный перевод не требуется. Статус обновляется автоматически."}
              </p>
            )}
            <div className="mt-4 border-t border-black/10 pt-4 text-sm dark:border-white/10">
              <p>Получение: {amount(snapshot.to_amount)} USDT</p>
              <p className="mt-2 break-all opacity-60">{snapshot.to_address}</p>
            </div>
            {snapshot.pay_tx_hash && (
              <p className="mt-3 break-all text-xs opacity-60">
                Транзакция отправления: {snapshot.pay_tx_hash}
              </p>
            )}
            {snapshot.payout_tx_hash && (
              <p className="mt-3 break-all text-xs opacity-60">
                Транзакция получения: {snapshot.payout_tx_hash}
              </p>
            )}
            {snapshot.refund_tx_hash && (
              <p className="mt-3 break-all text-xs opacity-60">
                Транзакция возврата: {snapshot.refund_tx_hash}
              </p>
            )}
            {intent?.error === "STATUS_UNAVAILABLE" && (
              <p className="mt-3 text-sm text-orange-500">
                Статус временно недоступен. Показано последнее подтверждённое
                состояние.
              </p>
            )}
          </Card>
        </>
      )}
      {intent && (
        <button
          type="button"
          disabled={Boolean(busy)}
          className="py-2 text-primary"
          onClick={() => {
            setIntent(null);
            setError("");
          }}
        >
          {intent.state === "prepared"
            ? "Изменить реквизиты"
            : "Вернуться к расчёту"}
        </button>
      )}
      {error && (
        <p role="alert" className="px-2 text-sm text-red-500">
          {error}
        </p>
      )}
      {history.length > 0 && (
        <div>
          <h3 className="mb-3 px-2 text-base font-semibold opacity-50">
            Мои обмены
          </h3>
          <Card className="!m-0 !rounded-[28px]" contentWrapPadding="px-4 py-0">
            {history.map((item) => (
              <button
                type="button"
                key={item.intent_id}
                className="flex min-h-16 w-full items-center gap-3 border-b border-black/[.06] py-3 text-left last:border-0 dark:border-white/[.08]"
                onClick={() => {
                  setIntent(item);
                  setError("");
                }}
              >
                <WalletNetworkIcon network={item.to_network} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {amount(item.amount)} USDT ·{" "}
                    {networkStandards[item.from_network]} →{" "}
                    {networkStandards[item.to_network]}
                  </span>
                  <span className="mt-1 block text-xs opacity-50">
                    {item.order
                      ? statuses[item.order.status]
                      : item.state === "unknown"
                        ? "Исход уточняется"
                        : item.state === "prepared"
                          ? "Расчёт подготовлен"
                          : "Заявка отклонена"}
                  </span>
                </span>
              </button>
            ))}
          </Card>
        </div>
      )}
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-8 left-1/2 z-[120] flex -translate-x-1/2 items-center gap-2 rounded-full bg-black px-5 py-3 text-sm text-white transition-opacity dark:bg-white dark:text-black ${copied ? "opacity-100" : "opacity-0"}`}
      >
        <Check size={18} />
        Скопировано
      </div>
    </section>
  );
}
