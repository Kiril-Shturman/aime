import { cryptoAssetsByTicker } from "../wallet/cryptoAssets";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "konsta/react";
import { Check, Clock3, ShieldCheck } from "lucide-react";
import QRCode from "react-qr-code";
import {
  walletRequest,
  walletIdempotentRequest,
  WalletApiError,
} from "../lib/wallet-api";
import { tg } from "../lib/telegram";
import { useLiveWallet } from "./WalletLive";
import { PushViewShell } from "./WalletNavigation";
import WalletVerification from "./WalletVerification";
import { useAuraProfile } from "../wallet/useAuraProfile";

type Rate = { rate: string; min_fiat_amount: string; max_fiat_amount: string };
type Quote = {
  quote_token: string;
  fiat_amount: string;
  provider_fee: string;
  fiat_net: string;
  crypto_amount: string;
  rate: string;
  expires_at: string;
};
type Order = Omit<Quote, "quote_token"> & {
  id: string;
  status: string;
  qr_url: string | null;
  payer_phone_masked: string | null;
};
const format = (value: string, digits = 2) =>
  Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
function describe(error: unknown) {
  return error instanceof WalletApiError
    ? error.message
    : "Нет связи с сервисом. Попробуйте ещё раз.";
}
function paymentUrl(value: string | null) {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export default function WalletSbpDeposit() {
  const wallet = useLiveWallet();
  const [rate, setRate] = useState<Rate | null>(null),
    [verified, setVerified] = useState(false),
    [kycStatus, setKycStatus] = useState("");
  const [amount, setAmount] = useState(""),
    [quote, setQuote] = useState<Quote | null>(null),
    [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [unknown, setUnknown] = useState(false),
    [pendingCreation, setPendingCreation] = useState(false),
    [clock, setClock] = useState(() => Date.now());
  const [recovered, setRecovered] = useState(false);
  const [verification, setVerification] = useState(false),
    [contacts, setContacts] = useState(false);
  const aura = useAuraProfile(verification ? "verification" : null);
  const key = useRef(""),
    working = useRef(false),
    alive = useRef(true);
  const ready = wallet.capabilities.sbp_buy && wallet.configured;
  const orderId = order?.id,
    orderStatus = order?.status,
    refreshWallet = wallet.refresh;
  const recover = useCallback(async (signal?: AbortSignal) => {
    const list = await walletRequest<{
      data: { order_id: string; status: string }[];
      pending_creation?: boolean;
    }>("aura-sbp-orders", undefined, signal);
    if (signal?.aborted || !alive.current) return;
    setPendingCreation(Boolean(list.pending_creation));
    const active = list.data.find((item) => item.status === "awaiting_payment");
    if (active) {
      const current = await walletRequest<Order>(
        "aura-sbp-order?order_id=" + encodeURIComponent(active.order_id),
        undefined,
        signal,
      );
      if (!signal?.aborted && alive.current) {
        setOrder(current);
        setUnknown(false);
      }
    }
  }, []);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setRecovered(false);
      setError("");
      try {
        const results = await Promise.allSettled([
          walletRequest<Rate>("aura-sbp-rate", undefined, signal),
          walletRequest<{ verified: boolean; status: string }>(
            "aura-kyc",
            undefined,
            signal,
          ),
          recover(signal),
        ]);
        if (signal?.aborted || !alive.current) return;
        if (results[0].status === "fulfilled") setRate(results[0].value);
        else setError(describe(results[0].reason));
        if (results[1].status === "fulfilled") {
          setVerified(results[1].value.verified);
          setKycStatus(results[1].value.status);
        } else setError(describe(results[1].reason));
        if (results[2].status === "rejected")
          setError(describe(results[2].reason));
        else setRecovered(true);
      } finally {
        if (!signal?.aborted && alive.current) setLoading(false);
      }
    },
    [recover],
  );
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    if (ready) void load(controller.signal);

    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [ready, load]);
  useEffect(() => {
    if (!quote && !order) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [quote, order]);
  useEffect(() => {
    if (!orderId || orderStatus !== "awaiting_payment") return;
    const controller = new AbortController();
    let polling = false;
    const timer = window.setInterval(async () => {
      if (polling || document.hidden || working.current) return;
      polling = true;
      try {
        const current = await walletRequest<Order>(
          "aura-sbp-order?order_id=" + encodeURIComponent(orderId),
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setOrder(current);
          if (current.status === "completed") void refreshWallet(true);
        }
      } catch {
        /* Keep the last confirmed status. */
      } finally {
        polling = false;
      }
    }, 7000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [orderId, orderStatus, refreshWallet]);
  useEffect(() => {
    if (!pendingCreation || order) return;
    const controller = new AbortController();
    let polling = false;
    const timer = window.setInterval(async () => {
      if (polling || document.hidden) return;
      polling = true;
      try {
        await recover(controller.signal);
      } catch {
        /* Retry reconciliation later. */
      } finally {
        polling = false;
      }
    }, 10000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [pendingCreation, order, recover]);
  async function calculate() {
    if (
      working.current ||
      blocked ||
      !rate ||
      !verified ||
      !recovered ||
      pendingCreation
    )
      return;
    const value = amount.replace(",", ".").trim();
    if (
      !/^\d+(\.\d{1,2})?$/.test(value) ||
      Number(value) < Number(rate.min_fiat_amount) ||
      Number(value) > Number(rate.max_fiat_amount)
    ) {
      setError(
        `Укажите сумму от ${format(rate.min_fiat_amount)} до ${format(rate.max_fiat_amount)} ₽.`,
      );
      return;
    }
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await walletRequest<Quote>("aura-sbp-quote", {
        fiat_amount: value,
      });
      if (alive.current) {
        key.current = crypto.randomUUID();
        setQuote(result);
        setClock(Date.now());
      }
    } catch (e) {
      if (alive.current) {
        setError(describe(e));
        if (e instanceof WalletApiError && e.recovery === "support")
          setBlocked(true);
      }
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function confirm() {
    if (
      working.current ||
      blocked ||
      !quote ||
      !key.current ||
      (!unknown && Date.parse(quote.expires_at) <= Date.now())
    )
      return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await walletIdempotentRequest<Order>(
        "aura-sbp-order",
        { quote_token: quote.quote_token },
        key.current,
      );
      if (alive.current) {
        setOrder(result);
        setUnknown(false);
        if (result.status === "completed") void wallet.refresh(true);
      }
    } catch (e) {
      if (alive.current) {
        const ambiguous =
          !(e instanceof WalletApiError) ||
          e.httpStatus >= 500 ||
          e.httpStatus === 0;
        setUnknown(ambiguous);
        setError(
          e instanceof WalletApiError
            ? describe(e)
            : "Ответ не получен. Проверьте заявку повторно — новая создана не будет.",
        );
        if (e instanceof WalletApiError && e.recovery === "support")
          setBlocked(true);
        const retrySame =
          e instanceof WalletApiError &&
          ["delay", "wait", "later", "same_request"].includes(e.recovery || "");
        if (!ambiguous && !retrySame) {
          setQuote(null);
          key.current = "";
        }
      }
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function cancel() {
    if (working.current || !order || order.status !== "awaiting_payment")
      return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await walletRequest<Order>("aura-sbp-order-cancel", {
        order_id: order.id,
      });
      if (alive.current) setOrder(result);
    } catch (e) {
      if (alive.current) setError(describe(e));
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const qr = paymentUrl(order?.qr_url ?? null);
  const expired = quote && Date.parse(quote.expires_at) <= clock;
  const seconds =
    Math.max(
      0,
      Math.ceil(
        (Date.parse((order ?? quote)?.expires_at || "") - clock) / 1000,
      ),
    ) || 0;
  const values = order ?? quote;
  return (
    <main
      className="mx-auto flex min-h-[calc(100svh-190px)] w-full max-w-[560px] flex-col px-4 pb-5 pt-5 text-black dark:text-white"
      aria-label="Пополнение через СБП"
    >
      <header className="mb-7 text-center">
        <img
          src="/brands/sbp-symbol.svg"
          alt="СБП"
          className="mx-auto h-14 w-14 rounded-full bg-white p-2.5"
        />
        <h1 className="mt-4 text-[26px] font-semibold tracking-tight">
          Пополнение через СБП
        </h1>
        <p className="mx-auto mt-2 max-w-[290px] text-[14px] leading-5 text-black/45 dark:text-white/45">
          Оплатите рублями — получите USDT на баланс кошелька.
        </p>
      </header>
      {loading && ready ? (
        <div
          role="status"
          className="animate-pulse rounded-[28px] bg-white p-6 text-center text-black/45 dark:bg-[#252b36] dark:text-white/45"
        >
          Загружаем курс и условия…
        </div>
      ) : !ready ? (
        <p className="p-6 text-center">
          Пополнение через СБП сейчас выключено.
        </p>
      ) : (
        <>
          {order ? (
            <section
              className="rounded-[28px] bg-white p-5 dark:bg-[#252b36]"
              aria-label="Заявка на пополнение"
            >
              <h2 className="text-center text-xl font-semibold">
                {order.status === "completed"
                  ? "Пополнение зачислено"
                  : order.status === "awaiting_payment"
                    ? "Оплатите по QR-коду"
                    : order.status === "cancelled"
                      ? "Заявка отменена"
                      : order.status === "expired"
                        ? "Срок оплаты истёк"
                        : "Платёж не завершён"}
              </h2>
              {order.status === "completed" ? (
                <Check className="mx-auto my-6 text-green-500" size={48} />
              ) : order.status === "awaiting_payment" && qr ? (
                <>
                  <div className="mx-auto my-6 w-fit rounded-[20px] bg-white p-4">
                    <QRCode value={qr} size={190} />
                  </div>
                  <p className="mb-4 text-center text-[13px] text-black/45 dark:text-white/45">
                    {seconds
                      ? `На оплату ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                      : "Проверяем срок оплаты…"}
                    {order.payer_phone_masked && (
                      <>
                        <br />
                        Оплачивайте с номера {order.payer_phone_masked}
                      </>
                    )}
                  </p>
                  <Button
                    data-wpay-primary=""
                    rounded
                    onClick={() =>
                      tg()?.openLink
                        ? tg()?.openLink?.(qr)
                        : window.open(qr, "_blank", "noopener,noreferrer")
                    }
                  >
                    Открыть оплату
                  </Button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void cancel()}
                    className="mt-3 w-full py-3 text-sm text-black/45 dark:text-white/45"
                  >
                    Отменить заявку
                  </button>
                </>
              ) : null}
            </section>
          ) : (
            <>
              <section className="rounded-[28px] bg-white p-5 dark:bg-[#252b36]">
                <label
                  htmlFor="sbp-amount"
                  className="text-[13px] text-black/45 dark:text-white/45"
                >
                  Сумма в рублях
                </label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    id="sbp-amount"
                    inputMode="decimal"
                    placeholder="0"
                    value={amount}
                    disabled={busy || Boolean(quote) || pendingCreation}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setError("");
                    }}
                    className="w-full min-w-0 bg-transparent text-[36px] font-semibold outline-none"
                  />
                  <span className="text-3xl text-black/30 dark:text-white/30">
                    ₽
                  </span>
                </div>
                {rate && (
                  <p className="mt-3 text-[12px] text-black/45 dark:text-white/45">
                    От {format(rate.min_fiat_amount)} до{" "}
                    {format(rate.max_fiat_amount)} ₽ · 1 USDT ={" "}
                    {format(rate.rate)} ₽
                  </p>
                )}
              </section>
              {!quote && (
                <div className="mt-4 flex items-center gap-3 rounded-[24px] bg-white px-5 py-4 dark:bg-[#252b36]">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-emerald-400 to-[#26a17b] text-white">
                    {cryptoAssetsByTicker.USDT.icon}
                  </span>
                  <span>
                    <span className="block text-[13px] text-black/45 dark:text-white/45">
                      На баланс кошелька
                    </span>
                    <span className="block text-[16px] font-semibold">
                      Tether · USDT
                    </span>
                  </span>
                </div>
              )}
              {!verified && (
                <section className="mt-4 rounded-[28px] bg-white p-5 text-center dark:bg-[#252b36]">
                  <ShieldCheck className="mx-auto text-primary" size={32} />
                  <h2 className="mt-3 text-lg font-semibold">
                    {["pending", "in_review"].includes(kycStatus)
                      ? "Документы на проверке"
                      : "Подтвердите личность"}
                  </h2>
                  <p className="my-3 text-[14px] leading-5 text-black/45 dark:text-white/45">
                    Для пополнения рублями нужны контакты и подтверждённая
                    личность.
                  </p>
                  <Button
                    data-wpay-primary=""
                    rounded
                    onClick={() => setVerification(true)}
                  >
                    Открыть верификацию
                  </Button>
                </section>
              )}
              {pendingCreation && (
                <p role="status" className="mt-4 text-center text-sm">
                  Проверяем ранее созданную заявку. Новая заявка пока
                  недоступна.
                </p>
              )}
            </>
          )}
          {values && (
            <section
              className="mt-4 rounded-[28px] bg-white px-5 py-2 dark:bg-[#252b36]"
              aria-label="Расчёт пополнения"
            >
              {[
                ["К оплате", `${format(values.fiat_amount)} ₽`],
                ["Комиссия", `${format(values.provider_fee)} ₽`],
                ["Курс", `${format(values.rate)} ₽`],
                ["На баланс", `${format(values.crypto_amount, 6)} USDT`],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-3 border-b border-black/[.05] py-3.5 last:border-0 dark:border-white/[.07]"
                >
                  <span className="text-[14px] text-black/45 dark:text-white/45">
                    {label}
                  </span>
                  <span className="text-[16px] font-semibold tabular-nums">
                    {value}
                  </span>
                </div>
              ))}
            </section>
          )}
          {error && (
            <p
              role="alert"
              className="mt-4 px-2 text-center text-sm text-red-600 dark:text-red-400"
            >
              {error}
            </p>
          )}
          {!order && verified && !pendingCreation && (
            <div className="mt-auto pt-6">
              {quote ? (
                <>
                  <Button
                    data-wpay-primary=""
                    rounded
                    disabled={blocked || busy || (Boolean(expired) && !unknown)}
                    onClick={() => void confirm()}
                  >
                    {busy
                      ? "Создаём заявку…"
                      : unknown
                        ? "Проверить заявку"
                        : expired
                          ? "Курс истёк"
                          : "Подтвердить и получить QR"}
                  </Button>
                  {!unknown && (
                    <button
                      type="button"
                      disabled={busy}
                      className="mt-3 w-full py-3 text-sm text-primary"
                      onClick={() => {
                        setQuote(null);
                        key.current = "";
                        setError("");
                      }}
                    >
                      Изменить сумму
                    </button>
                  )}
                </>
              ) : (
                <Button
                  data-wpay-primary=""
                  rounded
                  disabled={blocked || busy || !rate || !amount || !recovered}
                  onClick={() => void calculate()}
                >
                  {busy ? "Рассчитываем…" : "Рассчитать пополнение"}
                </Button>
              )}
            </div>
          )}
          {error && !quote && !order && (
            <button
              type="button"
              className="mt-3 w-full py-3 text-sm text-primary"
              onClick={() => void load()}
            >
              Обновить условия
            </button>
          )}
        </>
      )}
      <p className="mt-5 flex items-center justify-center gap-2 text-center text-[12px] text-black/35 dark:text-white/35">
        <Clock3 size={14} /> Зачисление после подтверждения оплаты
      </p>
      <PushViewShell
        open={verification}
        title="Верификация"
        hideNavbar
        nativeBack
        scrollContent={false}
        zClass="z-[80]"
        onClose={() => {
          if (aura.sessionOpen) aura.closeSession();
          else if (contacts) setContacts(false);
          else {
            setVerification(false);
            void load();
          }
        }}
      >
        <div className="wpay-f7-profile ios mx-auto flex min-h-0 w-full max-w-[560px] flex-1">
          <WalletVerification
            aura={aura}
            contacts={contacts}
            onContacts={() => setContacts(true)}
            onPersonal={() => setContacts(true)}
          />
        </div>
      </PushViewShell>
    </main>
  );
}
