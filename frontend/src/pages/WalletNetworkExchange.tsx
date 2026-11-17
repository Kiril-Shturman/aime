import { useEffect, useRef, useState } from "react";
import { Preloader } from "framework7-react";
import { Button, Card } from "konsta/react";
import { SiTether } from "@icons-pack/react-simple-icons";
import { ArrowDownUp } from "lucide-react";
import { walletRequest } from "../lib/wallet-api";

type Network = {
  network: string;
  name: string;
  standard: string;
  can_send: boolean;
  can_receive: boolean;
};
type Status = { configured: boolean; networks: Network[] };
type Quote = {
  available: boolean;
  to_amount: string | null;
  difference: string | null;
  reasons: string[];
  refresh_after_seconds: number;
  quoted_at: number;
  execution_enabled: boolean;
};
const reasons: Record<string, string> = {
  NETWORK_UNAVAILABLE: "Выбранная сеть временно недоступна",
  MAINTENANCE_FROM: "Сеть отправления на обслуживании",
  MAINTENANCE_TO: "Сеть получения на обслуживании",
  OFFLINE_FROM: "Сеть отправления недоступна",
  OFFLINE_TO: "Сеть получения недоступна",
  RESERVE_FROM: "Недостаточно ликвидности для этого направления",
  RESERVE_TO: "Недостаточно ликвидности для выплаты",
  LIMIT_MIN: "Сумма меньше минимальной для этого направления",
  LIMIT_MAX: "Сумма превышает лимит этого направления",
  PROVIDER_UNAVAILABLE: "Направление временно недоступно",
};
const selectClass =
  "min-h-12 w-full bg-transparent text-[17px] font-medium text-black outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-white";
const format = (value: string) =>
  Number(value).toLocaleString("en-US", { maximumFractionDigits: 6 });

export default function WalletNetworkExchange({
  active,
  initialNetwork,
}: {
  active: boolean;
  initialNetwork?: string;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [from, setFrom] = useState("TRON"),
    [to, setTo] = useState("BSC"),
    [amount, setAmount] = useState("100");
  const [mode, setMode] = useState("float"),
    [quote, setQuote] = useState<Quote | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false);
  const requestId = useRef(0),
    controller = useRef<AbortController | null>(null);
  const lifecycle = useRef<AbortSignal | null>(null);
  function invalidate() {
    requestId.current++;
    controller.current?.abort();
    setQuote(null);
    setBusy(false);
    setError("");
    setStale(false);
  }
  useEffect(() => {
    if (!active) return;
    const initial = ["TRON", "BSC", "ETH", "SOL", "TON"].includes(
      initialNetwork ?? "",
    )
      ? initialNetwork!
      : "TRON";
    setFrom(initial);
    setTo(initial === "BSC" ? "TRON" : "BSC");
    const abort = new AbortController();
    lifecycle.current = abort.signal;
    let current = true;
    walletRequest<Status>("exchange-status", undefined, abort.signal)
      .then((value) => {
        if (current) {
          setStatus(value);
          setQuote(null);
          setBusy(false);
          setError("");
        }
      })
      .catch((reason) => {
        if (current && !abort.signal.aborted) {
          setStatus(null);
          setQuote(null);
          setBusy(false);
          setError(
            reason instanceof Error ? reason.message : "Сервис недоступен",
          );
        }
      });
    return () => {
      current = false;
      abort.abort();
    };
  }, [active, initialNetwork]);
  useEffect(() => {
    if (!quote?.available) return;
    const delay = Math.max(
      0,
      quote.quoted_at * 1000 + quote.refresh_after_seconds * 1000 - Date.now(),
    );
    const timer = window.setTimeout(() => setStale(true), delay);
    return () => window.clearTimeout(timer);
  }, [quote]);
  const fromAvailable = status?.networks.find(
    (row) => row.network === from,
  )?.can_send;
  const toAvailable = status?.networks.find(
    (row) => row.network === to,
  )?.can_receive;
  const valid =
    /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(amount) &&
    Number(amount) > 0 &&
    from !== to;
  async function calculate() {
    if (!valid || !status?.configured || !fromAvailable || !toAvailable || busy)
      return;
    invalidate();
    const id = ++requestId.current,
      abort = new AbortController();
    controller.current = abort;
    const scope = lifecycle.current;
    const cancel = () => abort.abort();
    scope?.addEventListener("abort", cancel, { once: true });
    setBusy(true);
    try {
      const result = await walletRequest<Quote>(
        "exchange-quote",
        { from_network: from, to_network: to, amount, rate_type: mode },
        abort.signal,
      );
      if (requestId.current === id && !abort.signal.aborted) setQuote(result);
    } catch (reason) {
      if (requestId.current === id && !abort.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось рассчитать обмен",
        );
    } finally {
      scope?.removeEventListener("abort", cancel);
      if (requestId.current === id && !abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <main
      className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 pb-6 pt-3"
      aria-label="Межсетевой обмен USDT"
    >
      <div className="flex items-center gap-3 px-2 py-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-b from-[#6ac6aa] to-[#26a17b] text-white">
          <SiTether size={25} />
        </span>
        <div>
          <h2 className="text-[19px] font-semibold text-black dark:text-white">
            Tether USDT
          </h2>
          <p className="text-[14px] text-black/45 dark:text-white/45">
            Перевод между сетями
          </p>
        </div>
      </div>
      {status?.configured === false && (
        <p role="status" className="px-2 text-black/50 dark:text-white/50">
          Расчёт обмена пока недоступен
        </p>
      )}
      <Card className="!m-0 !rounded-[28px]" contentWrapPadding="px-5 py-3">
        {(["from", "to"] as const).map((side) => (
          <label
            key={side}
            className={`block ${side === "from" ? "border-b border-black/[.06] pb-2 dark:border-white/[.08]" : "pt-3"}`}
          >
            <span className="text-[13px] text-black/45 dark:text-white/45">
              {side === "from" ? "Откуда" : "Куда"}
            </span>
            <select
              aria-label={
                side === "from"
                  ? "Сеть отправления USDT"
                  : "Сеть получения USDT"
              }
              className={selectClass}
              value={side === "from" ? from : to}
              disabled={!status?.configured}
              onChange={(event) => {
                invalidate();
                (side === "from" ? setFrom : setTo)(event.target.value);
              }}
            >
              {(
                status?.networks ?? [
                  {
                    network: "TRON",
                    name: "Tron",
                    standard: "TRC20",
                    can_send: true,
                    can_receive: true,
                  },
                  {
                    network: "BSC",
                    name: "BNB Smart Chain",
                    standard: "BEP20",
                    can_send: true,
                    can_receive: true,
                  },
                ]
              ).map((network) => {
                const available =
                  side === "from" ? network.can_send : network.can_receive;
                return (
                  <option
                    key={network.network}
                    value={network.network}
                    disabled={!available}
                  >
                    {network.name} · {network.standard}
                    {available ? "" : " · Недоступно"}
                  </option>
                );
              })}
            </select>
          </label>
        ))}
        <button
          type="button"
          aria-label="Поменять сети местами"
          className="mx-auto mt-2 flex min-h-11 min-w-11 items-center justify-center rounded-full text-primary active:bg-black/5 dark:active:bg-white/10"
          disabled={!status?.configured}
          onClick={() => {
            invalidate();
            setFrom(to);
            setTo(from);
          }}
        >
          <ArrowDownUp size={22} />
        </button>
      </Card>
      <Card className="!m-0 !rounded-[28px]" contentWrapPadding="px-5 py-4">
        <label>
          <span className="text-[13px] text-black/45 dark:text-white/45">
            Отправляете, USDT
          </span>
          <input
            aria-label="Сумма межсетевого обмена USDT"
            inputMode="decimal"
            className="mt-2 min-h-12 w-full bg-transparent text-[30px] font-semibold tabular-nums text-black outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-white"
            value={amount}
            onChange={(event) => {
              invalidate();
              setAmount(event.target.value.replace(",", "."));
            }}
          />
        </label>
      </Card>
      <label className="px-2">
        <span className="text-[13px] text-black/45 dark:text-white/45">
          Тип курса
        </span>
        <select
          aria-label="Тип курса обмена"
          className={selectClass}
          value={mode}
          onChange={(event) => {
            invalidate();
            setMode(event.target.value);
          }}
        >
          <option value="float">Плавающий</option>
          <option value="fixed">Фиксированный</option>
        </select>
      </label>
      {from === to && (
        <p role="status" className="px-2 text-black/50 dark:text-white/50">
          Выберите разные сети
        </p>
      )}
      {status?.configured && (!fromAvailable || !toAvailable) && (
        <p role="status" className="px-2 text-black/50 dark:text-white/50">
          Выбранная сеть временно недоступна
        </p>
      )}
      {quote?.available && !stale && (
        <Card className="!m-0 !rounded-[28px]" contentWrapPadding="p-5">
          <p className="text-[13px] text-black/45 dark:text-white/45">
            Получите ориентировочно
          </p>
          <p
            role="status"
            aria-label="Сумма получения USDT"
            className="mt-2 text-[30px] font-semibold tabular-nums text-black dark:text-white"
          >
            {format(quote.to_amount!)}{" "}
            <span className="text-[17px] text-black/45 dark:text-white/45">
              USDT
            </span>
          </p>
          <p className="mt-3 text-[14px] text-black/50 dark:text-white/50">
            Разница: {format(quote.difference!)} USDT
          </p>
        </Card>
      )}
      {quote && !quote.available && (
        <p role="status" className="px-2 text-black/50 dark:text-white/50">
          {Array.from(
            new Set(
              quote.reasons.map(
                (reason) =>
                  reasons[reason] ?? "Направление временно недоступно",
              ),
            ),
          ).join(". ")}
        </p>
      )}
      {stale && (
        <p role="status" className="px-2 text-black/50 dark:text-white/50">
          Расчёт устарел. Получите новую котировку.
        </p>
      )}
      {error && (
        <p role="alert" className="px-2 text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <Button
        data-wpay-primary=""
        rounded
        large
        className="!m-0 !h-14 !rounded-[22px] !text-[17px]"
        disabled={
          busy ||
          !valid ||
          !status?.configured ||
          !fromAvailable ||
          !toAvailable
        }
        onClick={() => void calculate()}
      >
        {busy ? (
          <span className="flex items-center justify-center gap-2">
            <Preloader size={20} color="white" />
            Рассчитываем…
          </span>
        ) : quote || stale ? (
          "Обновить расчёт"
        ) : (
          "Рассчитать"
        )}
      </Button>
      <p className="px-2 text-center text-[12px] leading-5 text-black/45 dark:text-white/45">
        Сумма включает расходы обменника и выплату в выбранной сети. Отправка
        USDT с вашего кошелька оплачивается отдельно.
      </p>
      <p className="px-2 text-center text-[12px] leading-5 text-black/45 dark:text-white/45">
        Доступен предварительный расчёт FixedFloat. Обмен и списание средств
        пока недоступны.
      </p>
    </main>
  );
}
