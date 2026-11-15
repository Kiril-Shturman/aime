import { Search } from "lucide-react";
import WalletOperations from "./WalletOperations";
import {
  TransactionDetails,
  TransactionExamples,
  transactionFromApi,
  type TransactionView,
} from "./WalletTransaction";
import ArrowDownCircleFill from "framework7-icons/react/esm/ArrowDownCircleFill.js";
import Qrcode from "framework7-icons/react/esm/Qrcode.js";
import Clock from "framework7-icons/react/esm/Clock.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Card,
  Navbar,
  Link as KLink,
  Preloader,
  List,
  ListItem,
} from "konsta/react";
import { getMarketUsdRates } from "../lib/market-data";
import {
  walletRequest,
  WalletApiError,
  type QrQuote,
  type WalletOverview,
} from "../lib/wallet-api";

const empty: WalletOverview = { balances: [], rates: [], transactions: [] };
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const usdPrice = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: n < 1 ? 6 : n < 10 ? 4 : 2,
  });
export const cryptoAmount = (n: string | number) =>
  Number(n).toLocaleString("en-US", { maximumFractionDigits: 8 });
interface WalletContextValue {
  demo: boolean;
  custody: boolean;
  known: (asset: string) => boolean;
  totalKnown: boolean;
  data: WalletOverview;
  ready: boolean;
  configured: boolean;
  loading: boolean;
  error: string;
  refresh: (sync?: boolean) => Promise<void>;
  balance: (asset: string) => string;
  rate: (asset: string) => number | null;
  total: number;
}
const WalletContext = createContext<WalletContextValue | null>(null);
export function useLiveWallet() {
  const value = useContext(WalletContext);
  if (!value) throw Error("Wallet provider missing");
  return value;
}
export function WalletLiveProvider({ children }: { children: ReactNode }) {
  const demo = import.meta.env.VITE_WALLET_DEMO === "true";
  const walletRequestController = useRef<AbortController | null>(null);
  const [data, setData] = useState(empty),
    [ready, setReady] = useState(false),
    [configured, setConfigured] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [custody, setCustody] = useState(false);
  const [marketRates, setMarketRates] = useState<Record<string, number>>({});
  const marketRequest = useRef<AbortController | null>(null);
  const refreshMarket = useCallback(async () => {
    if (marketRequest.current) return;
    const controller = new AbortController();
    marketRequest.current = controller;
    try {
      const rates = await getMarketUsdRates(controller.signal);
      if (!controller.signal.aborted)
        setMarketRates((previous) => ({ ...previous, ...rates }));
    } catch {
      /* Keep the last quote on a temporary market-data failure. */
    } finally {
      if (marketRequest.current === controller) marketRequest.current = null;
    }
  }, []);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible") void refreshMarket();
    };
    const timer = window.setInterval(update, 60000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      marketRequest.current?.abort();
      marketRequest.current = null;
    };
  }, [refreshMarket]);
  const refresh = useCallback(
    async (sync = false) => {
      void refreshMarket();
      walletRequestController.current?.abort();
      const controller = new AbortController();
      walletRequestController.current = controller;
      if (demo) {
        setLoading(false);
        setReady(false);
        setError("Демонстрационный режим");
        return;
      }
      setLoading(true);
      try {
        const status = await walletRequest<{
          configured: boolean;
          custody_configured?: boolean;
        }>("status", undefined, controller.signal);
        if (controller.signal.aborted) return;
        setConfigured(status.configured);
        setCustody(Boolean(status.custody_configured));
        if (status.custody_configured) {
          const overview = await walletRequest<WalletOverview>(
            "custody-overview",
            undefined,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          setData(overview);
          setReady(true);
          setError(
            overview.unavailable_assets?.length
              ? "Часть сетей временно недоступна. Балансы не заменяются нулями."
              : "Балансы прочитаны из сетей. Вывод пока не подключён.",
          );
          return;
        }
        if (!status.configured) {
          setData(empty);
          setReady(false);
          setError("Пополнения ещё не подключены. Ожидается настройка GoSwap.");
          return;
        }
        if (sync) await walletRequest("sync", {}, controller.signal);
        const overview = await walletRequest<WalletOverview>(
          "overview",
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setData(overview);
        setReady(true);
        setError("");
      } catch (error) {
        if (controller.signal.aborted) return;
        setReady(false);
        setError(
          error instanceof Error
            ? error.message
            : "Не удалось обновить кошелёк",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [refreshMarket, demo],
  );
  useEffect(() => {
    void refresh();
    const changed = () => {
      void refresh();
    };
    window.addEventListener("wpay:custody-created", changed);
    return () => {
      window.removeEventListener("wpay:custody-created", changed);
      walletRequestController.current?.abort();
    };
  }, [refresh]);
  const balance = useCallback(
    (asset: string) =>
      data.balances.find((x) => x.asset === asset)?.available ?? "0",
    [data],
  );
  const rate = useCallback(
    (asset: string) => {
      if (marketRates[asset] !== undefined) return marketRates[asset];
      if (!custody && (asset === "USDT" || asset === "USDC")) return 1;
      const entry = data.rates.find(
        (x) => x.source === asset && x.target === "USD" && x.is_valid,
      );
      return entry ? Number(entry.rate) : null;
    },
    [data, marketRates, custody],
  );
  const total = useMemo(
    () =>
      data.balances.reduce(
        (sum, x) => sum + Number(x.available) * (rate(x.asset) ?? 0),
        0,
      ),
    [data, rate],
  );
  return (
    <WalletContext.Provider
      value={{
        demo,
        custody,
        known: (asset) =>
          !custody || data.balances.some((row) => row.asset === asset),
        totalKnown:
          !custody ||
          (!data.unavailable_assets?.length &&
            data.balances.every(
              (row) => Number(row.available) === 0 || rate(row.asset) !== null,
            )),
        data,
        ready,
        configured,
        loading,
        error,
        refresh,
        balance,
        rate,
        total,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
export function WalletConnectionNote() {
  const wallet = useLiveWallet();
  return (
    <p
      role="status"
      className="mx-auto my-5 max-w-[420px] px-5 text-center text-[13px] leading-relaxed text-black/45 dark:text-white/45"
    >
      {wallet.error || "Баланс и операции обновляются через GoSwap."}
    </p>
  );
}

export { default as LiveDepositPanel } from "./WalletDeposit";

export function LiveHistory() {
  const wallet = useLiveWallet(),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const [selectedTransaction, setSelectedTransaction] =
    useState<TransactionView | null>(null);
  const items = wallet.data.transactions.filter(
    (x) =>
      (filter === "all" ||
        (filter === "income"
          ? Number(x.amount) > 0
          : x.type.startsWith("qr_"))) &&
      `${x.asset} ${x.type} ${x.detail.merchant_name ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const groups = new Map<string, typeof items>();
  for (const item of [...items].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )) {
    const date = new Date(item.created_at).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    groups.set(date, [...(groups.get(date) ?? []), item]);
  }

  return (
    <main className="mx-auto w-full max-w-[560px] pb-6 pt-5">
      <div className="px-4">
        {(filter === "all" || filter === "expense") && (
          <label className="flex h-12 w-full items-center gap-2.5 rounded-[22px] bg-black/5 px-4 focus-within:ring-2 focus-within:ring-primary dark:bg-white/10">
            <Search
              size={20}
              strokeWidth={2}
              aria-hidden="true"
              className="shrink-0 text-black/40 dark:text-white/40"
            />
            <input
              aria-label="Поиск операций"
              placeholder="Поиск операций"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-black outline-none placeholder:text-black/40 dark:text-white dark:placeholder:text-white/40"
            />
          </label>
        )}
        <div
          className="mt-4 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-[22px] bg-black/5 p-1 dark:bg-white/10"
          aria-label="Фильтр операций"
        >
          {[
            ["all", "Все"],
            ["expense", "Платежи"],
            ["invoices", "Счета"],
            ["transfers", "Переводы"],
            ["withdrawals", "Выводы"],
            ["deposits", "Пополнения"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`min-h-11 shrink-0 rounded-[18px] px-4 text-[15px] font-medium transition-colors ${filter === id ? "bg-white text-black shadow-sm dark:bg-[#2c2c2e] dark:text-white" : "text-black/50 dark:text-white/50"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {["invoices", "transfers", "withdrawals", "deposits"].includes(filter) ? (
        <WalletOperations
          key={filter}
          initialTab={
            filter as "invoices" | "transfers" | "withdrawals" | "deposits"
          }
        />
      ) : (
        <>
          {[...groups].map(([date, transactions]) => (
            <section key={date} aria-label={date}>
              <h2 className="mb-2 mt-7 px-4 text-[21px] font-semibold tracking-tight text-black dark:text-white">
                {date}
              </h2>
              <List
                strong
                inset
                dividers
                className="!mt-0 overflow-hidden !rounded-[32px] [&>ul]:!rounded-[32px]"
              >
                {transactions.map((item) => {
                  const income = Number(item.amount) > 0;
                  const failed = item.type === "qr_failed";
                  const Icon = income ? ArrowDownCircleFill : Qrcode;
                  const title =
                    item.type === "deposit"
                      ? "Пополнение"
                      : item.type === "qr_refunded"
                        ? "Возврат QR"
                        : failed
                          ? "Платёж не прошёл"
                          : String(item.detail.merchant_name || "Оплата QR");
                  return (
                    <ListItem
                      key={item.event_id}
                      link
                      onClick={() =>
                        setSelectedTransaction(transactionFromApi(item))
                      }
                      chevron={false}
                      contentClassName="!h-16"
                      innerClassName="!min-w-0 !h-16 !py-2 after:!opacity-30"
                      media={
                        <span
                          className={`wpay-currency-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${failed ? "bg-gradient-to-b from-orange-300 to-orange-500 dark:from-orange-400 dark:to-orange-600" : income ? "bg-gradient-to-b from-green-300 to-green-500 dark:from-green-400 dark:to-green-600" : "bg-gradient-to-b from-blue-300 to-blue-500 dark:from-blue-400 dark:to-blue-600"}`}
                        >
                          <Icon className="text-[23px]" />
                        </span>
                      }
                      innerChildren={
                        <span className="flex h-full min-w-0 items-center justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-[17px] font-semibold leading-6 text-black dark:text-white">
                              {title}
                            </span>
                            <span className="mt-0.5 block text-[14px] leading-5 text-black/45 dark:text-white/45">
                              {new Date(item.created_at).toLocaleTimeString(
                                "ru-RU",
                                { hour: "2-digit", minute: "2-digit" },
                              )}{" "}
                              · {item.asset}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span
                              className={`block text-[16px] font-medium leading-6 tabular-nums ${income ? "text-green-600 dark:text-green-400" : "text-black dark:text-white"}`}
                            >
                              {income ? "+" : ""}
                              {cryptoAmount(item.amount)}
                            </span>
                            <span className="block text-[12px] leading-5 text-black/40 dark:text-white/40">
                              {item.asset}
                            </span>
                          </span>
                        </span>
                      }
                    />
                  );
                })}
              </List>
            </section>
          ))}
          {!items.length && (
            <div className="mx-4 mt-7 px-6 py-10 text-center" role="status">
              <Clock
                aria-hidden="true"
                className="mx-auto text-[36px] text-black/30 dark:text-white/30"
              />
              <h2 className="mt-4 text-[21px] font-semibold text-black dark:text-white">
                {query || filter !== "all"
                  ? "Ничего не найдено"
                  : "Операций пока нет"}
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-black/45 dark:text-white/45">
                {query || filter !== "all"
                  ? "Попробуйте изменить поиск или фильтр."
                  : wallet.ready
                    ? "Здесь появятся ваши пополнения и платежи."
                    : wallet.loading
                      ? "Загружаем историю…"
                      : "Здесь появятся ваши пополнения и платежи."}
              </p>
            </div>
          )}
          <TransactionExamples onSelect={setSelectedTransaction} />
          <TransactionDetails
            item={selectedTransaction}
            onClose={() => setSelectedTransaction(null)}
          />
          <div className="mt-5 px-4">
            <Button
              data-wpay-primary=""
              rounded
              tonal
              disabled={wallet.loading}
              className="!m-0 !h-12 !w-full !rounded-[22px]"
              onClick={() => void wallet.refresh(true)}
            >
              {wallet.loading ? "Обновляем…" : "Обновить историю"}
            </Button>
          </div>
        </>
      )}
    </main>
  );
}

export function LiveQrPanel({
  initialQr,
  onClose,
}: {
  initialQr: string;
  onClose: () => void;
}) {
  const wallet = useLiveWallet(),
    [qr, setQr] = useState(initialQr),
    [quote, setQuote] = useState<QrQuote | null>(null),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (status !== "processing" && status !== "reserved") return;
    const timer = window.setInterval(() => void wallet.refresh(), 5000);
    return () => clearInterval(timer);
  }, [status, wallet.refresh]);
  useEffect(() => {
    const item = wallet.data.transactions.find(
      (x) => x.detail.spend_id === quote?.spend_id,
    );
    if (item) setStatus(item.type.replace("qr_", ""));
  }, [wallet.data, quote]);
  const expired = quote ? new Date(quote.expires_at).getTime() <= clock : false;
  async function getQuote() {
    setBusy(true);
    setError("");
    try {
      setQuote(await walletRequest<QrQuote>("quote", { qr }));
      setStatus("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка котировки");
    } finally {
      setBusy(false);
    }
  }
  async function pay() {
    if (!quote) return;
    setBusy(true);
    setError("");
    try {
      const payment = await walletRequest<{ status: string }>("pay", {
        quote_id: quote.quote_id,
      });
      setStatus(payment.status);
      await wallet.refresh();
    } catch (e) {
      if (
        !(e instanceof WalletApiError) ||
        ![
          "INSUFFICIENT_FUNDS",
          "QUOTE_EXPIRED",
          "QUOTE_NOT_FOUND",
          "AUTH_REQUIRED",
          "NOT_CONFIGURED",
          "INVALID_REQUEST",
        ].includes(e.code)
      )
        setStatus("reserved");
      setError(e instanceof Error ? e.message : "Проверьте статус платежа");
    } finally {
      setBusy(false);
    }
  }
  const statuses: Record<string, string> = {
    processing: "Платёж обрабатывается",
    reserved: "Проверяем статус платежа",
    completed: "Оплата выполнена",
    failed: "Платёж не прошёл, резерв возвращён",
    refunded: "Платёж отменён, средства возвращены",
  };
  return createPortal(
    <section className="wpay-viewport fixed inset-0 z-[90] flex flex-col bg-[#efeff4] dark:bg-black">
      <Navbar
        title="Оплата СБП QR"
        left={<KLink onClick={onClose}>Закрыть</KLink>}
      />
      <main className="mx-auto w-full max-w-[560px] flex-1 space-y-4 overflow-y-auto px-4 py-5">
        <p className="text-[14px] leading-relaxed text-black/50 dark:text-white/50">
          Оплата в рублях со списанием USDT. Сначала проверьте сумму и
          получателя.
        </p>
        <textarea
          aria-label="Строка платёжного QR"
          value={qr}
          disabled={!!status}
          onChange={(e) => {
            setQr(e.target.value);
            setQuote(null);
          }}
          placeholder="https://qr.nspk.ru/… или ST00012|…"
          className="min-h-28 w-full rounded-2xl bg-white p-4 text-[15px] text-black dark:bg-white/10 dark:text-white"
        />
        <Button
          data-wpay-primary=""
          rounded
          large
          disabled={!wallet.configured || busy || !qr || !!status}
          onClick={() => void getQuote()}
          className="!w-full"
        >
          {busy ? <Preloader /> : "Узнать сумму"}
        </Button>
        {quote && (
          <Card className="!m-0" contentWrapPadding="p-5">
            <p className="text-[14px] text-black/50 dark:text-white/50">
              Получатель
            </p>
            <b className="mt-1 block text-[20px] text-black dark:text-white">
              {quote.merchant_name || "Не указан"}
            </b>
            <p className="mt-5 text-[28px] text-black dark:text-white">
              {quote.amount_rub} ₽
            </p>
            <p className="text-[16px] text-black/60 dark:text-white/60">
              Спишется {quote.amount} {quote.asset}
            </p>
            <p className="mt-3 text-[13px] text-black/45 dark:text-white/45">
              {expired
                ? "Котировка истекла"
                : `Действует до ${new Date(quote.expires_at).toLocaleTimeString("ru-RU")}`}
            </p>
            {!status && (
              <Button
                data-wpay-primary=""
                rounded
                large
                disabled={busy || expired}
                onClick={() => void pay()}
                className="!mt-4 !w-full"
              >
                Подтвердить оплату
              </Button>
            )}
          </Card>
        )}
        {status && (
          <p
            role="status"
            className="text-center text-[18px] text-black dark:text-white"
          >
            {statuses[status] || status}
          </p>
        )}
        {status === "reserved" && (
          <Button
            data-wpay-primary=""
            rounded
            tonal
            disabled={busy}
            onClick={() => void pay()}
            className="!w-full"
          >
            Повторить запрос с тем же номером
          </Button>
        )}
        {(error || !wallet.configured) && (
          <p role="alert" className="text-[14px] leading-relaxed text-red-500">
            {error || wallet.error}
          </p>
        )}
      </main>
    </section>,
    document.querySelector(".k-app") ?? document.body,
  );
}
export { usd };
