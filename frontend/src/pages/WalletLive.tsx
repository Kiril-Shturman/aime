import { Search } from "lucide-react";
import WalletOperations from "./WalletOperations";
import {
  TransactionDetails,
  TransactionDetailContent,
  TransactionExamples,
  transactionFromApi,
  transactionListPresentation,
  type TransactionView,
} from "./WalletTransaction";
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
  walletIdempotentRequest,
  WalletApiError,
  type QrQuote,
  type WalletCapabilities,
  type WalletOverview,
  type WalletStatus,
} from "../lib/wallet-api";
import {
  assetNetworks,
  depositNetworks,
  availableDepositRoutes,
} from "../wallet/catalog";

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
const operationKey = () =>
  globalThis.crypto?.randomUUID?.() ??
  `wpay-${Date.now()}-${Math.random().toString(16).slice(2)}`;
interface WalletContextValue {
  demo: boolean;
  data: WalletOverview;
  ready: boolean;
  configured: boolean;
  capabilities: WalletCapabilities;
  qrProvider: "aura" | "goswap" | null;
  assetRoutes: Record<string, string[]>;
  depositRoutes: Record<string, string[]>;
  depositProviders: NonNullable<WalletStatus["deposit_providers"]>;
  depositModes: Record<
    string,
    Record<string, "address" | "exact" | "disabled">
  >;
  loading: boolean;
  error: string;
  refresh: (sync?: boolean) => Promise<void>;
  balance: (asset: string) => string;
  rate: (asset: string) => number | null;
  total: number;
}
const WalletContext = createContext<WalletContextValue | null>(null);
const noCapabilities: WalletCapabilities = {
  cards: false,
  sbp_buy: false,
  crypto_processing: false,
  qr_pay: false,
};
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
    [capabilities, setCapabilities] = useState<WalletCapabilities>(
      demo
        ? { cards: true, sbp_buy: true, crypto_processing: true, qr_pay: true }
        : noCapabilities,
    ),
    [qrProvider, setQrProvider] = useState<"aura" | "goswap" | null>(
      demo ? "goswap" : null,
    ),
    [assetRoutes, setAssetRoutes] = useState<Record<string, string[]>>(
      demo ? assetNetworks : {},
    ),
    [depositRoutes, setDepositRoutes] = useState<Record<string, string[]>>(
      demo ? depositNetworks : {},
    ),
    [depositProviders, setDepositProviders] = useState<NonNullable<WalletStatus["deposit_providers"]>>({}),
    [depositModes, setDepositModes] = useState<
      Record<string, Record<string, "address" | "exact" | "disabled">>
    >({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
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
        const status = await walletRequest<WalletStatus>(
          "status",
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setConfigured(status.configured);
        setCapabilities(status.capabilities ?? noCapabilities);
        setQrProvider(status.routes?.qr_pay ?? null);
        setAssetRoutes(status.asset_routes ?? {});
        setDepositRoutes(availableDepositRoutes(status));
        setDepositModes(status.deposit_modes ?? {});
        setDepositProviders(status.deposit_providers ?? {});
        if (!status.configured) {
          setData(empty);
          setReady(false);
          setError("Кошелёк ещё не подключён. Ожидается настройка провайдера.");
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
    const refreshOnReturn = () => {
      if (!demo && document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      document.removeEventListener("visibilitychange", refreshOnReturn);
      walletRequestController.current?.abort();
    };
  }, [demo, refresh]);
  const balance = useCallback(
    (asset: string) =>
      data.balances.find((x) => x.asset === asset)?.available ?? "0",
    [data],
  );
  const rate = useCallback(
    (asset: string) => {
      if (marketRates[asset] !== undefined) return marketRates[asset];
      if (asset === "USDT" || asset === "USDC") return 1;
      const entry = data.rates.find(
        (x) => x.source === asset && x.target === "USD" && x.is_valid,
      );
      return entry ? Number(entry.rate) : null;
    },
    [data, marketRates],
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
        data,
        ready,
        configured,
        capabilities,
        qrProvider,
        assetRoutes,
        depositRoutes,
        depositModes,
        depositProviders,
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
      {wallet.error ||
        "Баланс и операции обновляются через платёжного провайдера."}
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
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 1100px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1100px)");
    const update = () => setDesktop(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  const items = wallet.data.transactions.filter(
    (x) =>
      (filter === "all" ||
        (filter === "income"
          ? Number(x.amount) > 0
          : Number(x.amount) < 0 || x.type === "qr_failed")) &&
      `${x.asset} ${x.type} ${x.detail.merchant_name ?? ""} ${transactionListPresentation(x).title} ${transactionListPresentation(x).network} ${x.detail.plan ?? ""}`
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
    <>
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
                  const failed = ["qr_failed", "withdrawal_failed"].includes(item.type);
                  const cardIssue = ["card_issue", "card_topup", "card_issue_refund"].includes(item.type);
                  const { title, icon: Icon, network } = transactionListPresentation(item);
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
                              · {item.asset}{network && ` · ${network}`}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span
                              className={`block text-[16px] font-medium leading-6 tabular-nums ${income ? "text-green-600 dark:text-green-400" : "text-black dark:text-white"}`}
                            >
                              {cardIssue
                                ? `${income ? "+" : ""}${usd(Number(item.amount))}`
                                : `${income ? "+" : ""}${cryptoAmount(item.amount)}`}
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
    {desktop ? (
      <aside className="wpay-desktop-card wpay-history-details" aria-label="Детали операции">
        <div className="wpay-desktop-section-head"><h2>Детали операции</h2></div>
        {selectedTransaction ? (
          <TransactionDetailContent key={selectedTransaction.id} model={selectedTransaction} />
        ) : (
          <p className="wpay-desktop-fx-status">Выберите операцию из списка.</p>
        )}
      </aside>
    ) : (
      <TransactionDetails item={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
    )}
    </>
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
    [quote, setQuote] = useState<(QrQuote & { quoteToken?: string }) | null>(
      null,
    ),
    [paymentId, setPaymentId] = useState(""),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const idempotencyKey = useRef(operationKey());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (status !== "processing" && status !== "reserved") return;
    if (wallet.qrProvider === "aura" && paymentId) {
      let stopped = false;
      const poll = async () => {
        try {
          const item = await walletRequest<{ status: string }>(
            `aura-qr-payment?payment_id=${encodeURIComponent(paymentId)}`,
          );
          if (stopped) return;
          setStatus(item.status);
          if (["completed", "failed", "refunded"].includes(item.status))
            await wallet.refresh();
        } catch {
          /* Keep the reserved state until the authenticated read succeeds. */
        }
      };
      void poll();
      const timer = window.setInterval(poll, 5000);
      return () => {
        stopped = true;
        window.clearInterval(timer);
      };
    }
    const timer = window.setInterval(() => void wallet.refresh(), 5000);
    return () => clearInterval(timer);
  }, [paymentId, status, wallet.qrProvider, wallet.refresh]);
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
      if (wallet.qrProvider === "aura") {
        const item = await walletRequest<{
          quote_token: string;
          amount_rub: string;
          merchant_name: string | null;
          total_usdt: string;
          rate: string;
          expires_at: string;
        }>("aura-qr-quote", { qr_payload: qr });
        setQuote({
          quote_id: "",
          spend_id: "",
          quoteToken: item.quote_token,
          amount_rub: item.amount_rub,
          merchant_name: item.merchant_name,
          amount: item.total_usdt,
          asset: "USDT",
          rate: item.rate,
          expires_at: item.expires_at,
        });
      } else {
        setQuote(await walletRequest<QrQuote>("quote", { qr }));
      }
      idempotencyKey.current = operationKey();
      setPaymentId("");
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
      const payment =
        wallet.qrProvider === "aura"
          ? await walletIdempotentRequest<{ id: string; status: string }>(
              "aura-qr-payment",
              { quote_token: quote.quoteToken, qr_payload: qr },
              idempotencyKey.current,
            )
          : await walletRequest<{ payment_id?: string; status: string }>(
              "pay",
              {
                quote_id: quote.quote_id,
              },
            );
      setPaymentId("id" in payment ? payment.id : payment.payment_id || "");
      setStatus(payment.status);
      await wallet.refresh();
    } catch (e) {
      if (
        !(e instanceof WalletApiError) ||
        ![
          "INSUFFICIENT_FUNDS",
          "insufficient_funds",
          "QUOTE_EXPIRED",
          "quote_expired",
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
            setPaymentId("");
            idempotencyKey.current = operationKey();
          }}
          placeholder="https://qr.nspk.ru/… или ST00012|…"
          className="min-h-28 w-full rounded-2xl bg-white p-4 text-[15px] text-black dark:bg-white/10 dark:text-white"
        />
        <Button
          data-wpay-primary=""
          rounded
          large
          disabled={
            !wallet.configured ||
            !wallet.capabilities.qr_pay ||
            busy ||
            !qr ||
            !!status
          }
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
        {(error || !wallet.configured || !wallet.capabilities.qr_pay) && (
          <p role="alert" className="text-[14px] leading-relaxed text-red-500">
            {error || wallet.error || "Оплата QR сейчас не подключена"}
          </p>
        )}
      </main>
    </section>,
    document.querySelector(".k-app") ?? document.body,
  );
}
export { usd };
