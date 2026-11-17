import { useEffect, useRef, useState } from "react";
import { Button } from "konsta/react";
import { Preloader } from "framework7-react";
import { walletRequest } from "../lib/wallet-api";

type Job = {
  job_id: string;
  state: string;
  tx_hash: string | null;
  error: string | null;
  detail: string | null;
  quote: null | {
    approval_id: string;
    amount: string;
    max_fee: string;
    fee_currency: string;
    source_address: string;
    expires_at: number;
  };
};
type Funding = {
  enabled: boolean;
  signer_online: boolean;
  native_asset: string;
  job: Job | null;
};
const lockedStates = new Set([
  "estimating",
  "quoted",
  "confirmed",
  "signing",
  "signed",
  "broadcast",
  "unknown",
  "done",
]);
const labels: Record<string, string> = {
  estimating: "Проверяем баланс и комиссию",
  confirmed: "Платёж подтверждён",
  signing: "Подписываем перевод",
  signed: "Перевод подготовлен",
  broadcast: "Ждём подтверждения сети",
  unknown: "Уточняем исход отправки",
  done: "Оплата подтверждена сетью",
};

export default function WalletExchangeFunding({
  intentId,
  canPay,
  onLock,
}: {
  intentId: string;
  canPay: boolean;
  onLock: (locked: boolean) => void;
}) {
  const [status, setStatus] = useState<Funding | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const inFlight = useRef(false);
  const life = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    life.current = abort;
    setStatus(null);
    setError("");
    setBusy(false);
    inFlight.current = false;
    onLock(true);
    const refresh = async () => {
      try {
        const value = await walletRequest<Funding>(
          `exchange-funding?intent_id=${encodeURIComponent(intentId)}`,
          undefined,
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setStatus(value);
          onLock(Boolean(value.job && lockedStates.has(value.job.state)));
          setError("");
        }
      } catch {
        if (!abort.signal.aborted) {
          onLock(true);
          setError(
            "Не удалось проверить оплату с кошелька. Дождитесь обновления, не оплачивайте повторно.",
          );
        }
      }
    };
    void refresh();
    const poll = setInterval(() => void refresh(), 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      abort.abort();
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [intentId, onLock]);
  async function action(route: string, body: object) {
    if (inFlight.current) return;
    const signal = life.current?.signal;
    inFlight.current = true;
    setBusy(true);
    setError("");
    // A lost confirmation response can still mean accepted: hide manual payment immediately.
    if (route !== "exchange-funding-cancel") onLock(true);
    try {
      const job = await walletRequest<Job>(route, body, signal);
      if (!signal?.aborted) {
        setStatus((value) => (value ? { ...value, job } : value));
        onLock(lockedStates.has(job.state));
      }
    } catch (e) {
      if (!signal?.aborted)
        setError(
          e instanceof Error ? e.message : "Не удалось выполнить действие",
        );
    } finally {
      if (!signal?.aborted) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  const job = status?.job;
  const quote = job?.quote;
  if (status && !status.enabled && !job) return null;
  return (
    <div
      className="mt-4 rounded-[22px] bg-black/[.045] p-4 dark:bg-white/[.07]"
      aria-label="Оплата с собственного кошелька"
    >
      <h4 className="font-semibold">Оплатить с кошелька wPay</h4>
      {!status ? (
        <div className="mt-3 flex items-center gap-2">
          <Preloader size={18} />
          Проверяем оплату
        </div>
      ) : (
        <>
          <p className="mt-2 text-xs leading-5 opacity-60">
            Используются реальные USDT на собственном адресе исходной сети.
            Тестовый баланс приложения недоступен для этой оплаты.
          </p>
          {job && labels[job.state] && (
            <p className="mt-3 flex items-center gap-2 text-sm">
              {["estimating", "signing", "confirmed"].includes(job.state) && (
                <Preloader size={18} />
              )}
              {labels[job.state]}
            </p>
          )}
          {job?.detail && (
            <p className="mt-3 text-sm leading-5" role="status">
              {job.detail}
            </p>
          )}
          {job?.state === "estimating" && (
            <button
              className="mt-3 py-2 text-primary"
              disabled={busy}
              onClick={() =>
                void action("exchange-funding-cancel", { job_id: job.job_id })
              }
            >
              Отменить расчёт
            </button>
          )}
          {quote && job?.state === "quoted" && (
            <div className="mt-3 space-y-2 text-sm">
              <p>
                Отправить: <strong>{quote.amount} USDT</strong>
              </p>
              <p>
                Комиссия сети — не более {quote.max_fee} {quote.fee_currency}
              </p>
              <p className="break-all text-xs opacity-50">
                С адреса: {quote.source_address}
              </p>
              <Button
                large
                rounded
                data-wpay-primary=""
                disabled={
                  busy ||
                  !canPay ||
                  quote.expires_at * 1000 <= now ||
                  !status.signer_online
                }
                onClick={() =>
                  void action("exchange-funding-confirm", {
                    job_id: job.job_id,
                    approval_id: quote.approval_id,
                  })
                }
              >
                {busy ? (
                  <Preloader size={20} color="white" />
                ) : (
                  "Подтвердить и отправить"
                )}
              </Button>
              {quote.expires_at * 1000 <= now && (
                <p>Расчёт комиссии устарел. Получите новый.</p>
              )}
              <button
                className="py-2 text-primary"
                disabled={busy}
                onClick={() =>
                  void action("exchange-funding-cancel", { job_id: job.job_id })
                }
              >
                Отменить расчёт
              </button>
            </div>
          )}
          {job?.tx_hash && (
            <p className="mt-3 break-all text-xs opacity-60">
              Хеш оплаты: {job.tx_hash}
            </p>
          )}
          {(!job || ["failed", "expired", "cancelled"].includes(job.state)) &&
            canPay && (
              <Button
                large
                rounded
                data-wpay-primary=""
                className="!mt-3"
                disabled={busy || !status.enabled || !status.signer_online}
                onClick={() =>
                  void action("exchange-funding-prepare", {
                    intent_id: intentId,
                  })
                }
              >
                {busy ? (
                  <Preloader size={20} color="white" />
                ) : (
                  "Проверить баланс и комиссию"
                )}
              </Button>
            )}
          {!status.signer_online && canPay && (
            <p className="mt-3 text-xs opacity-60">
              Процесс подписи временно недоступен.
            </p>
          )}
        </>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
