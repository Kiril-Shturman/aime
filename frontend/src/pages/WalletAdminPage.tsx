import Aurora from "../components/reactbits/Aurora";
import { WalletFinanceReport } from "./WalletUserFinance";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  Coins,
  CreditCard,
  Database,
  LayoutDashboard,
  Menu,
  Play,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Users,
  X,
  ArrowUpRight,
  Sun,
  Moon,
} from "lucide-react";
import Framework7 from "framework7/lite-bundle";
import Framework7React, {
  App as F7App,
  Button as F7Button,
  Preloader as F7Preloader,
} from "framework7-react";
import { walletIdempotentRequest, walletRequest } from "../lib/wallet-api";
import { useTheme } from "../store/ThemeStore";
import "./WalletFramework7.css";
import "./WalletAdmin.css";

// oxlint-disable-next-line react-hooks/rules-of-hooks -- Framework7 plugin registration is not a React Hook.
Framework7.use(Framework7React);

type Json = Record<string, unknown>;
type Tab =
  | "overview"
  | "data"
  | "payments"
  | "crypto"
  | "aura"
  | "goswap"
  | "notifications"
  | "audit"
  | "cards"
  | "tariffs";
type AdminOverview = {
  users: number;
  events: number;
  liabilities: Json[];
  states: Record<string, Record<string, number>>;
  recent: Json[];
  problems: {
    total: number;
    items: { kind: string; label: string; count: number }[];
  };
  provider: { balance: Json[] };
};
type UsersData = { items: Json[]; total: number };
type AdminUserDetail = {
  account: Json;
  contacts: { email: string | null; phone: string | null; updated_at: unknown };
  aura: { customer: Json | null; kyc: Json | null; cards: Json[] };
  balances: Json[];
  addresses: Json[];
  events: Json[];
  notifications: Json[];
  audit: Json[];
  referrals: { invited: Json[]; referred_by: Json | null };
};
type AuditData = { items: Json[]; total: number };
type CardsData = { items: Json[]; operations: Json[]; total: number };
type TariffsData = {
  items: (Json & { product: string; label: string; enforced: boolean; enabled: boolean })[];
  history: Json[];
  provider: Json;
};
type DatabaseData = {
  tables: Record<string, number>;
  table: string;
  columns: string[];
  items: Json[];
  offset: number;
  count: number;
};
type PaymentsData = Record<
  "events" | "quotes" | "invoices" | "transfers" | "withdrawals",
  Json[]
>;
type CryptoData = {
  addresses: Json[];
  deposits: Json[];
  balances: Json[];
  asset_routes: {
    asset: string;
    network: string;
    enabled: number;
    updated_at: string;
    updated_by: string;
  }[];
};
type GoSwapStatus = {
  ok: boolean;
  result?: unknown;
  error?: string;
  detail?: string;
};
type GoSwapMethod = {
  method: string;
  title: string;
  post: boolean;
  dangerous?: boolean;
  params: string[];
  required: string[];
  example: Json;
};
type GoSwapData = {
  snapshot: Record<string, GoSwapStatus>;
  methods: GoSwapMethod[];
};
type AuraMethod = {
  method: string;
  title: string;
  verb: "GET" | "POST";
  path: string;
  params: string[];
  required: string[];
  example: Json;
  dangerous: boolean;
  idempotent: boolean;
  blocked_reason: string | null;
};
type AuraConsoleData = {
  environment: string;
  configured: boolean;
  methods: AuraMethod[];
};
type BroadcastData = { items: Json[] };
type NotificationData = {
  settings: { event_type: string; label: string; enabled: number }[];
  counts: Record<string, number>;
  recent: Json[];
  eligible_users: number;
  broadcasts: Json[];
};
type AuraData = {
  provider: {
    enabled: boolean;
    configured: boolean;
    environment: string;
    health: {
      available: boolean;
      error: string | null;
      request_id: string | null;
    };
    capabilities?: Json;
    routes: Json[];
    reconciliation: Json[];
  };
  events: { data: Json[]; next_cursor: string | null };
  qrPayments: { data: Json[] };
  withdrawals: { data: Json[] };
  console: AuraConsoleData;
};
type AdminColumn = {
  key: string;
  label: string;
  render?: (value: unknown, row: Json) => string;
};

const card = "wpay-admin-card";
const input = "wpay-admin-input";

function text(value: unknown) {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}
function amount(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-US", { maximumFractionDigits: 8 })
    : text(value);
}
function date(value: unknown) {
  if (!value) return "—";
  const numeric = Number(value);
  const parsed =
    Number.isFinite(numeric) && String(value).trim() !== ""
      ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
      : new Date(String(value));
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleString("ru-RU");
}
function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}
function details(value: unknown, label = "Все данные") {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-blue-500">
        {label}
      </summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/[.04] p-3 text-[11px] dark:bg-black/30">
        {json(value)}
      </pre>
    </details>
  );
}
function stateTotal(value: Record<string, number> | undefined) {
  return Object.values(value || {}).reduce((sum, item) => sum + item, 0);
}

const tabs: { id: Tab; label: string; icon: typeof Database }[] = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "data", label: "Пользователи", icon: Database },
  { id: "payments", label: "Операции", icon: Activity },
  { id: "crypto", label: "Криптовалюты", icon: Coins },
  { id: "cards", label: "Карты", icon: CreditCard },
  { id: "tariffs", label: "Тарифы", icon: Settings },
  { id: "aura", label: "Aura API", icon: ShieldCheck },
  { id: "goswap", label: "GoSwap API", icon: Server },
  { id: "notifications", label: "Уведомления", icon: Bell },
  { id: "audit", label: "Аудит", icon: Users },
];

export default function WalletAdminPage() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [payload, setPayload] = useState<unknown>(null);
  const [payloadTab, setPayloadTab] = useState<Tab | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [table, setTable] = useState("");
  const [query, setQuery] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (tab === "overview") {
        setPayload(await walletRequest<AdminOverview>("admin-overview"));
        setPayloadTab(tab);
      }
      if (tab === "data") {
        const suffix = `?${new URLSearchParams({ ...(table ? { table } : {}), ...(query ? { q: query } : {}) })}`;
        const [users, database] = await Promise.all([
          walletRequest<UsersData>("admin-users"),
          walletRequest<DatabaseData>(`admin-database${suffix}`),
        ]);
        setTable(database.table);
        setPayload({ users, database });
        setPayloadTab(tab);
      }
      if (tab === "payments") {
        setPayload(await walletRequest<PaymentsData>("admin-payments"));
        setPayloadTab(tab);
      }
      if (tab === "crypto") {
        setPayload(await walletRequest<CryptoData>("admin-crypto"));
        setPayloadTab(tab);
      }
      if (tab === "goswap") {
        setPayload(await walletRequest<GoSwapData>("admin-goswap"));
        setPayloadTab(tab);
      }
      if (tab === "aura") {
        const [providers, consoleData] = await Promise.all([
          walletRequest<{ aura: AuraData["provider"] }>("admin-providers"),
          walletRequest<AuraConsoleData>("admin-aura-console"),
        ]);
        const [events, qrPayments, withdrawals] = providers.aura.health
          .available
          ? await Promise.all([
              walletRequest<AuraData["events"]>("admin-aura-events?limit=50"),
              walletRequest<AuraData["qrPayments"]>("admin-aura-qr-payments"),
              walletRequest<AuraData["withdrawals"]>("admin-aura-withdrawals"),
            ])
          : [{ data: [], next_cursor: null }, { data: [] }, { data: [] }];
        setPayload({
          provider: providers.aura,
          events,
          qrPayments,
          withdrawals,
          console: consoleData,
        } satisfies AuraData);
        setPayloadTab(tab);
      }
      if (tab === "notifications") {
        const [notifications, broadcasts] = await Promise.all([
          walletRequest<Omit<NotificationData, "broadcasts">>(
            "admin-notifications",
          ),
          walletRequest<BroadcastData>("admin-broadcasts"),
        ]);
        setPayload({ ...notifications, broadcasts: broadcasts.items });
        setPayloadTab(tab);
      }
      if (tab === "audit") {
        setPayload(await walletRequest<AuditData>("admin-audit?count=250"));
        setPayloadTab(tab);
      }
      if (tab === "cards") {
        setPayload(await walletRequest<CardsData>("admin-cards"));
        setPayloadTab(tab);
      }
      if (tab === "tariffs") {
        setPayload(await walletRequest<TariffsData>("admin-tariffs"));
        setPayloadTab(tab);
      }
      setUpdatedAt(new Date());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить данные",
      );
    } finally {
      setLoading(false);
    }
  }, [tab, table, query]);

  useEffect(() => {
    void load();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab === "data" && payloadTab === "data") void load();
  }, [table, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = payloadTab === tab;
  return (
    <F7App
      name="WPay Admin"
      theme="ios"
      darkMode={theme === "dark"}
      className={`wpay-f7-root wpay-admin-f7 ios ${theme === "dark" ? "dark" : ""}`}
      style={{ height: "100%" } as CSSProperties}
    >
      <div className="wpay-admin-layout">
        <button
          aria-label="Закрыть меню"
          className={`wpay-admin-nav-backdrop ${mobileNavOpen ? "is-open" : ""}`}
          onClick={() => setMobileNavOpen(false)}
        />
        <aside
          className={`wpay-admin-sidebar ${mobileNavOpen ? "is-open" : ""}`}
        >
          <button
            aria-label="Закрыть меню"
            className="wpay-admin-nav-close"
            onClick={() => setMobileNavOpen(false)}
          >
            <X size={21} />
          </button>
          <div className="wpay-admin-brand">
            <img
              className="wpay-admin-wordmark"
              src={
                theme === "dark"
                  ? "/brands/wpay-wordmark-light.svg"
                  : "/brands/wpay-wordmark.svg"
              }
              alt="wPay"
            />
            <span className="wpay-admin-brand-label">
              Панель
              <br />
              управления
            </span>
          </div>
          <F7Button
            large
            className="wpay-admin-back"
            onClick={() => {
              window.location.href = "/wallet";
            }}
          >
            <ArrowLeft size={19} />
            <span>В кошелёк</span>
          </F7Button>
          <div className="wpay-admin-nav-caption">Рабочее пространство</div>
          <nav className="wpay-admin-nav" aria-label="Разделы админки">
            {tabs.map((item) => (
              <F7Button
                large
                fill={tab === item.id}
                aria-current={tab === item.id ? "page" : undefined}
                key={item.id}
                onClick={() => {
                  setTab(item.id);
                  setMobileNavOpen(false);
                }}
                className={`wpay-admin-navitem ${tab === item.id ? "is-active" : ""}`}
              >
                <item.icon size={20} />
                <span>{item.label}</span>
              </F7Button>
            ))}
          </nav>
          <div className="wpay-admin-secure">
            <ShieldCheck size={18} />
            <span>
              <b>Доступ администратора</b>
              <small>Права проверяются сервером</small>
            </span>
          </div>
        </aside>
        <section className="wpay-admin-workspace">
          <header className="wpay-admin-topbar">
            <div className="wpay-admin-heading">
              <F7Button
                round
                className="wpay-admin-menu"
                aria-label="Открыть меню"
                onClick={() => setMobileNavOpen(true)}
              >
                <Menu size={21} />
              </F7Button>
              <div>
                <div className="wpay-admin-kicker">wPay / Управление</div>
                <h1>{tabs.find((item) => item.id === tab)?.label}</h1>
              </div>
            </div>
            <div className="wpay-admin-topactions">
              <span className={`wpay-admin-online ${error ? "has-error" : ""}`}>
                <i />
                {loading
                  ? "Обновление"
                  : error
                    ? "Ошибка загрузки"
                    : updatedAt
                      ? `Обновлено ${updatedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
                      : "Нет данных"}
              </span>
              <F7Button
                round
                className="wpay-admin-refresh"
                aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
                onClick={toggleTheme}
              >
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </F7Button>
              <F7Button
                round
                className="wpay-admin-refresh"
                aria-label="Обновить данные"
                onClick={() => void load()}
                disabled={loading}
              >
                {loading ? <F7Preloader size={18} /> : <RefreshCw size={18} />}
              </F7Button>
            </div>
          </header>
          <div className="wpay-admin-content">
            <div className="wpay-admin-page-intro">
              <span>
                {
                  (
                    {
                      overview: "Полная картина работы кошелька",
                      data: "Клиенты, профили и записи базы данных",
                      payments: "История платежей, переводов и выводов",
                      crypto: "Адреса, поступления и доступные сети",
                      cards: "Карты клиентов, состояния и безопасное управление",
                      aura: "Подключение, методы и состояние Aura",
                      goswap: "Состояние интеграции и методы GoSwap",
                      notifications: "Системные события и рассылки",
                      audit: "Кто, когда и что менял в системе",
                    } as Record<Tab, string>
                  )[tab]
                }
              </span>
            </div>
            {error && (
              <div role="alert" className="wpay-admin-error">
                <AlertTriangle size={17} />
                <span>{error}</span>
              </div>
            )}
            {!ready ? (
              <div className="wpay-admin-loading" role="status">
                <span>Загружаем данные раздела…</span>
                <div className="wpay-admin-loading-metrics">
                  {[0, 1, 2, 3].map((key) => (
                    <i key={key} />
                  ))}
                </div>
                <div className="wpay-admin-loading-panel">
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            ) : (
              <TabContent
                tab={tab}
                payload={payload}
                table={table}
                query={query}
                setTable={setTable}
                setQuery={setQuery}
                reload={load}
                onNavigate={setTab}
              />
            )}
          </div>
        </section>
      </div>
    </F7App>
  );
}

function TabContent({
  onNavigate,
  tab,
  payload,
  table,
  query,
  setTable,
  setQuery,
  reload,
}: {
  onNavigate: (tab: Tab) => void;
  tab: Tab;
  payload: unknown;
  table: string;
  query: string;
  setTable: (v: string) => void;
  setQuery: (v: string) => void;
  reload: () => Promise<void>;
}) {
  if (!payload) return null;
  if (tab === "overview")
    return <Overview data={payload as AdminOverview} onNavigate={onNavigate} />;
  if (tab === "data")
    return (
      <DataView
        data={payload as { users: UsersData; database: DatabaseData }}
        table={table}
        query={query}
        setTable={setTable}
        setQuery={setQuery}
        reload={reload}
      />
    );
  if (tab === "payments") return <Payments data={payload as PaymentsData} />;
  if (tab === "crypto")
    return <Crypto data={payload as CryptoData} reload={reload} />;
  if (tab === "cards")
    return <Cards data={payload as CardsData} reload={reload} />;
  if (tab === "tariffs")
    return <Tariffs data={payload as TariffsData} reload={reload} />;
  if (tab === "goswap")
    return (
      <>
        <WalletFinanceReport />
        <GoSwap data={payload as GoSwapData} />
      </>
    );
  if (tab === "aura")
    return <Aura data={payload as AuraData} reload={reload} />;
  if (tab === "audit") return <Audit data={payload as AuditData} />;
  return <Notifications data={payload as NotificationData} reload={reload} />;
}

function Audit({ data }: { data: AuditData }) {
  const columns: AdminColumn[] = [
    { key: "created_at", label: "Когда", render: date },
    { key: "admin_id", label: "Администратор" },
    { key: "action", label: "Действие" },
    { key: "target_user_id", label: "Пользователь" },
    { key: "outcome", label: "Результат" },
    {
      key: "detail",
      label: "Детали",
      render: (value) =>
        value && typeof value === "object" ? JSON.stringify(value) : text(value),
    },
  ];
  return (
    <section className="space-y-3">
      <div className="wpay-admin-data-toolbar">
        <div>
          <strong>{data.total}</strong>
          <span>действий записано</span>
        </div>
        <p className="wpay-admin-audit-note">
          Тексты сообщений и чувствительные данные не журналируются.
        </p>
      </div>
      <div className="wpay-admin-desktop-only">
        <AdminTable rows={data.items} columns={columns} />
      </div>
      <div className="wpay-admin-mobile-only wpay-admin-mobile-list">
        {data.items.map((item, index) => (
          <article key={index} className={card}>
            <div className="flex items-center justify-between gap-3">
              <b>{text(item.action)}</b>
              <span className="wpay-admin-status">{text(item.outcome)}</span>
            </div>
            <p className="mt-2 text-xs opacity-50">
              {date(item.created_at)} · {text(item.admin_id)}
            </p>
            <p className="mt-2 text-xs">{text(item.target_user_id)}</p>
            {details(item.detail, "Безопасные детали")}
          </article>
        ))}
      </div>
    </section>
  );
}

function Tariffs({ data, reload }: { data: TariffsData; reload: () => Promise<void> }) {
  const [selected, setSelected] = useState(data.items[0]?.product || "");
  const current = data.items.find((item) => item.product === selected) || data.items[0];
  const [enabled, setEnabled] = useState(Boolean(current?.enabled));
  const [fixed, setFixed] = useState(text(current?.fixed_fee || "0"));
  const [percent, setPercent] = useState(text(current?.percent_fee || "0"));
  const [minimum, setMinimum] = useState(text(current?.minimum_fee || "0"));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  function choose(product: string) {
    const item = data.items.find((row) => row.product === product);
    if (!item) return;
    setSelected(product);
    setEnabled(Boolean(item.enabled));
    setFixed(text(item.fixed_fee || "0"));
    setPercent(text(item.percent_fee || "0"));
    setMinimum(text(item.minimum_fee || "0"));
    setNote("");
    setNotice("");
  }
  async function save() {
    if (!current || saving) return;
    if (window.prompt(`Введите TARIFF ${current.product}`) !== `TARIFF ${current.product}`) return;
    setSaving(true);
    setNotice("");
    try {
      await walletRequest("admin-tariffs", {
        product: current.product, enabled, fixed_fee: fixed,
        percent_fee: percent, minimum_fee: minimum, note,
        confirm: `TARIFF ${current.product}`,
      });
      setNotice("Новая версия тарифа сохранена");
      await reload();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Тариф не сохранён");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-4">
      <section className={card}>
        <div className="wpay-admin-section-title">
          <div><span>Ценообразование</span><h2>Тарифы WPay</h2></div>
          <i>Все суммы в USDT</i>
        </div>
        <p className="text-xs opacity-55">
          Комиссия WPay считается отдельно от цены Aura. Новая версия действует только на новые операции; повторы используют сохранённую версию.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((item) => (
            <button type="button" key={item.product} onClick={() => choose(item.product)}
              className={`rounded-2xl border p-4 text-left ${selected === item.product ? "border-blue-500 bg-blue-500/5" : "border-[var(--admin-border)]"}`}>
              <b className="block text-sm">{item.label}</b>
              <small className="mt-1 block opacity-50">
                {item.enforced ? (item.enabled ? "Включён" : "Выключен") : "Подключение расчёта готовится"}
              </small>
              {Boolean(item.card_plan) && (
                <small className="mt-2 block text-blue-500">
                  Aura: выпуск {amount(item.provider_issue_fee)} USDT · пополнение {amount(item.provider_recharge_fee)}%
                  {item.provider_minimum ? ` · от ${amount(item.provider_minimum)} USDT` : ""}
                </small>
              )}
              {Array.isArray(item.conditions) && (
                <small className="mt-2 block opacity-55">{item.conditions.join(" · ")}</small>
              )}
              <span className="mt-3 block text-xs">
                {amount(item.fixed_fee)} + {amount(item.percent_fee)}% · минимум {amount(item.minimum_fee)}
              </span>
            </button>
          ))}
        </div>
      </section>
      {current && (
        <section className={card}>
          <div className="wpay-admin-section-title"><div><span>{current.product}</span><h2>{current.label}</h2></div></div>
          {!current.enforced && <p className="mb-4 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-600">Параметры видны для планирования, но включение заблокировано до подключения безопасного расчёта к settlement.</p>}
          <div className="grid gap-3 md:grid-cols-3">
            <label><span className="text-xs font-semibold">{current.card_plan ? "Наценка за выпуск" : "Фиксированная комиссия"}</span><input className={`${input} mt-2`} value={fixed} onChange={(e) => setFixed(e.target.value)} /></label>
            <label><span className="text-xs font-semibold">{current.card_plan ? "Наша комиссия пополнения, %" : "Процент"}</span><input className={`${input} mt-2`} value={percent} onChange={(e) => setPercent(e.target.value)} /></label>
            <label><span className="text-xs font-semibold">{current.card_plan ? "Минимальная наша комиссия пополнения" : "Минимальная комиссия"}</span><input className={`${input} mt-2`} value={minimum} onChange={(e) => setMinimum(e.target.value)} /></label>
          </div>
          <label className="mt-3 block"><span className="text-xs font-semibold">Комментарий к версии</span><input className={`${input} mt-2`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Причина изменения" /></label>
          <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={!current.enforced} onChange={(e) => setEnabled(e.target.checked)} /> Применять к новым операциям</label>
          <button type="button" disabled={saving} onClick={() => void save()} className="mt-4 rounded-xl bg-blue-500 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">{saving ? "Сохраняю…" : "Сохранить новую версию"}</button>
          {notice && <p className="mt-3 text-xs">{notice}</p>}
        </section>
      )}
      <section className={card}>
        <div className="wpay-admin-section-title"><div><span>Аудит цен</span><h2>История версий</h2></div><b>{data.history.length}</b></div>
        <AdminTable rows={data.history} columns={[
          { key: "created_at", label: "Когда", render: date },
          { key: "product", label: "Продукт" }, { key: "enabled", label: "Статус", render: (v) => v ? "Включён" : "Выключен" },
          { key: "fixed_fee", label: "Фикс" }, { key: "percent_fee", label: "%" },
          { key: "minimum_fee", label: "Минимум" }, { key: "created_by", label: "Автор" },
        ]} />
      </section>
    </div>
  );
}

function Cards({
  data,
  reload,
}: {
  data: CardsData;
  reload: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<CardsData | null>(null);
  const [working, setWorking] = useState("");
  const [notice, setNotice] = useState("");
  const visible = data.items.filter((row) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [
      row.card_id,
      row.user_id,
      row.customer_id,
      row.masked_pan,
      row.telegram_username,
      row.first_name,
      row.last_name,
    ].some((value) => String(value || "").toLowerCase().includes(needle));
  });
  const current = detail?.items[0] || data.items.find((row) => row.card_id === selected);

  async function openCard(cardId: string) {
    setSelected(cardId);
    setNotice("");
    try {
      setDetail(
        await walletRequest<CardsData>(
          `admin-cards?${new URLSearchParams({ card_id: cardId })}`,
        ),
      );
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Не удалось загрузить карту");
    }
  }
  async function act(operation: "refresh" | "freeze" | "unfreeze" | "cancel") {
    if (!selected || working) return;
    if (operation === "cancel") {
      if (window.prompt("Для закрытия карты введите ЗАКРЫТЬ") !== "ЗАКРЫТЬ") return;
    } else if (
      operation !== "refresh" &&
      !window.confirm(
        `${operation === "freeze" ? "Заморозить" : "Разморозить"} карту ${text(current?.masked_pan)}?`,
      )
    ) {
      return;
    }
    setWorking(operation);
    setNotice("");
    try {
      await walletRequest("admin-card-action", {
        card_id: selected,
        operation,
        ...(operation === "refresh"
          ? {}
          : { confirm: `${operation}:${selected}` }),
      });
      setNotice(
        operation === "refresh"
          ? "Состояние обновлено из Aura"
          : operation === "cancel"
            ? "Карта закрыта"
            : operation === "freeze"
              ? "Карта заморожена"
              : "Карта разморожена",
      );
      await Promise.all([reload(), openCard(selected)]);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Действие не выполнено");
    } finally {
      setWorking("");
    }
  }

  const columns: AdminColumn[] = [
    { key: "masked_pan", label: "Карта" },
    {
      key: "user_id",
      label: "Пользователь",
      render: (value, row) =>
        row.telegram_username ? `@${text(row.telegram_username)}` : text(value),
    },
    { key: "kind", label: "Тип" },
    {
      key: "status",
      label: "Статус",
      render: (value, row) => `${text(value)}${row.frozen ? " · заморожена" : ""}`,
    },
    {
      key: "balance",
      label: "Баланс карты",
      render: (value) => (value === null ? "—" : `${amount(value)} USDT`),
    },
    { key: "operation_count", label: "Операции" },
    { key: "updated_at", label: "Обновлено", render: date },
  ];
  return (
    <div className="space-y-4">
      <section className={card}>
        <div className="wpay-admin-section-title">
          <div>
            <span>Aura</span>
            <h2>Карты клиентов</h2>
          </div>
          <b>{data.total}</b>
        </div>
        <div className="relative mt-3">
          <Search className="absolute left-3 top-3.5 opacity-35" size={17} />
          <input
            className={`${input} !pl-10`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Пользователь, customer ID, card ID или masked PAN"
          />
        </div>
        <div className="wpay-admin-desktop-only mt-3">
          <AdminTable rows={visible} columns={columns} onRowClick={(row) => void openCard(text(row.card_id))} />
        </div>
        <div className="wpay-admin-mobile-only wpay-admin-mobile-list mt-3">
          {visible.map((row) => (
            <button
              type="button"
              key={text(row.card_id)}
              className="wpay-admin-mobile-item is-clickable w-full text-left"
              onClick={() => void openCard(text(row.card_id))}
            >
              <b>{text(row.masked_pan || row.card_id)}</b>
              <p className="mt-1 text-xs opacity-50">
                {text(row.user_id)} · {text(row.kind)} · {text(row.status)}
              </p>
            </button>
          ))}
        </div>
      </section>
      {selected && current && (
        <section className={`${card} wpay-admin-card-control`}>
          <div className="wpay-admin-section-title">
            <div>
              <span>{text(current.user_id)}</span>
              <h2>{text(current.masked_pan || current.card_id)}</h2>
            </div>
            <button type="button" onClick={() => { setSelected(""); setDetail(null); }}>
              <X size={18} />
            </button>
          </div>
          <div className="wpay-admin-user-facts mt-3">
            <div><small>Статус</small><b>{text(current.status)}</b></div>
            <div><small>Баланс</small><b>{current.balance === null ? "—" : `${amount(current.balance)} USDT`}</b></div>
            <div><small>Тип</small><b>{text(current.kind)}</b></div>
            <div><small>Customer ID</small><b>{text(current.customer_id)}</b></div>
          </div>
          <div className="wpay-admin-card-actions">
            <button disabled={Boolean(working)} onClick={() => void act("refresh")}>
              <RefreshCw size={15} className={working === "refresh" ? "animate-spin" : ""} /> Обновить
            </button>
            {current.frozen ? (
              <button disabled={Boolean(working)} onClick={() => void act("unfreeze")}>
                Разморозить
              </button>
            ) : (
              <button disabled={Boolean(working)} onClick={() => void act("freeze")}>
                Заморозить
              </button>
            )}
            <button className="is-danger" disabled={Boolean(working) || ["cancelled", "closed"].includes(text(current.status))} onClick={() => void act("cancel")}>
              Закрыть карту
            </button>
          </div>
          {notice && <p className="wpay-admin-operator-notice">{notice}</p>}
          <h3 className="mt-5 text-sm font-semibold">Последние операции</h3>
          {detail?.operations.length ? detail.operations.map((operation) => (
            <Row
              key={text(operation.operation_id)}
              title={`${text(operation.operation_type)} · ${text(operation.merchant)}`}
              subtitle={`${date(operation.provider_created_at || operation.created_at)} · ${text(operation.status)}`}
              right={`${amount(operation.amount)} ${text(operation.asset)}`}
            />
          )) : <p className="wpay-admin-user-empty mt-3">Операций пока нет.</p>}
        </section>
      )}
    </div>
  );
}

function Aura({
  data,
  reload,
}: {
  data: AuraData;
  reload: () => Promise<void>;
}) {
  const [working, setWorking] = useState("");
  const [notice, setNotice] = useState("");
  const products = (data.provider.capabilities?.products || {}) as Json;
  const depositRoute = data.provider.routes.find(
    (route) =>
      route.product === "crypto_deposit" &&
      route.asset === "USDT" &&
      route.network === "TRON" &&
      route.environment === data.provider.environment &&
      route.provider === "aura",
  );
  async function run(name: string, task: () => Promise<unknown>, text: string) {
    if (working) return;
    setWorking(name);
    setNotice("");
    try {
      await task();
      setNotice(text);
      await reload();
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Операция не выполнена",
      );
    } finally {
      setWorking("");
    }
  }
  return (
    <div className="space-y-4">
      {notice && <div className="wpay-admin-error">{notice}</div>}
      <section className="wpay-admin-metrics">
        <article className="wpay-admin-metric">
          <span className="wpay-admin-metric-icon">
            <Server size={19} />
          </span>
          <div>
            <strong>
              {data.provider.health.available
                ? "Готов"
                : data.provider.configured
                  ? "Ошибка"
                  : "Нет ключа"}
            </strong>
            <small>Подключение Aura</small>
          </div>
        </article>
        <article className="wpay-admin-metric">
          <span className="wpay-admin-metric-icon">
            <ShieldCheck size={19} />
          </span>
          <div>
            <strong>{data.provider.environment}</strong>
            <small>Окружение</small>
          </div>
        </article>
        <article className="wpay-admin-metric">
          <span className="wpay-admin-metric-icon">
            <Activity size={19} />
          </span>
          <div>
            <strong>{data.events.data.length}</strong>
            <small>Последние события</small>
          </div>
        </article>
        <article className="wpay-admin-metric">
          <span className="wpay-admin-metric-icon">
            <Coins size={19} />
          </span>
          <div>
            <strong>{data.provider.reconciliation.length}</strong>
            <small>Сверяемые активы</small>
          </div>
        </article>
      </section>

      <AuraConsole data={data.console} />

      <div className="wpay-admin-dashboard-grid">
        <section className={card}>
          <div className="wpay-admin-section-title">
            <div>
              <span>GET /me</span>
              <h2>Продукты ключа</h2>
            </div>
            <i className={data.provider.health.available ? "is-online" : ""}>
              {data.provider.health.available ? "Online" : "Offline"}
            </i>
          </div>
          {!data.provider.health.available && data.provider.health.error && (
            <Row
              title={data.provider.health.error}
              subtitle={
                data.provider.health.request_id
                  ? `Request ID: ${data.provider.health.request_id}`
                  : "Aura API недоступен"
              }
              right="Ошибка"
            />
          )}
          {Object.keys(products).length ? (
            Object.entries(products).map(([key, value]) => (
              <Row
                key={key}
                title={key}
                right={value === true ? "Включён" : "Выключен"}
              />
            ))
          ) : (
            <Empty />
          )}
        </section>
        <section className={card}>
          <div className="wpay-admin-section-title">
            <div>
              <span>Маршрутизация</span>
              <h2>USDT / TRON deposits</h2>
            </div>
          </div>
          <Row
            title="Провайдер Aura"
            subtitle={`Среда: ${data.provider.environment}`}
            right={depositRoute?.enabled ? "Включён" : "Выключен"}
          />
          <button
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            disabled={Boolean(working) || !data.provider.configured}
            onClick={() =>
              void run(
                "route",
                () =>
                  walletRequest("admin-provider-route", {
                    product: "crypto_deposit",
                    asset: "USDT",
                    network: "TRON",
                    environment: data.provider.environment,
                    provider: "aura",
                    enabled: !Boolean(depositRoute?.enabled),
                  }),
                depositRoute?.enabled
                  ? "Маршрут Aura выключен"
                  : "Маршрут Aura включён",
              )
            }
          >
            {depositRoute?.enabled ? "Выключить маршрут" : "Включить маршрут"}
          </button>
        </section>
      </div>

      <section className={card}>
        <div className="wpay-admin-section-title">
          <div>
            <span>Ledger vs provider</span>
            <h2>Сверка Aura</h2>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            disabled={Boolean(working) || !data.provider.enabled}
            onClick={() =>
              void run(
                "process",
                () => walletRequest("admin-aura-process", {}),
                "Inbox обработан, сверка обновлена",
              )
            }
          >
            <RefreshCw
              size={14}
              className={working === "process" ? "animate-spin" : ""}
            />
            Обработать и сверить
          </button>
        </div>
        {data.provider.reconciliation.length ? (
          data.provider.reconciliation.map((row, index) => (
            <Row
              key={index}
              title={`${text(row.asset)} · ${text(row.status)}`}
              subtitle={`provider ${amount(row.provider_available)} · liabilities ${amount(row.liability_total)}`}
              right={amount(row.difference)}
            />
          ))
        ) : (
          <Empty />
        )}
      </section>

      <section className={card}>
        <div className="wpay-admin-section-title">
          <div>
            <span>Events API</span>
            <h2>Последние события Aura</h2>
          </div>
        </div>
        {data.events.data.length ? (
          data.events.data.map((event, index) => {
            const delivery = (event.delivery || {}) as Json;
            return (
              <div
                key={text(event.id || index)}
                className="border-b border-[var(--admin-border)] py-3 last:border-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <b className="text-sm">{text(event.type)}</b>
                    <div className="mt-1 text-xs text-[var(--admin-muted)]">
                      {date(event.created_at)} · {text(delivery.status)}
                    </div>
                  </div>
                  {delivery.status !== "delivered" && (
                    <button
                      className="rounded-lg border border-[var(--admin-border)] px-3 py-2 text-xs font-semibold disabled:opacity-50"
                      disabled={Boolean(working)}
                      onClick={() =>
                        void run(
                          `event-${text(event.id)}`,
                          () =>
                            walletIdempotentRequest(
                              "admin-aura-event-redeliver",
                              { event_id: event.id },
                              globalThis.crypto?.randomUUID?.() ||
                                `redeliver-${Date.now()}`,
                            ),
                          "Событие поставлено на повторную доставку",
                        )
                      }
                    >
                      Повторить
                    </button>
                  )}
                </div>
                {details(event, "Безопасные данные события")}
              </div>
            );
          })
        ) : (
          <Empty />
        )}
      </section>

      <div className="wpay-admin-dashboard-grid">
        <section className={card}>
          <div className="wpay-admin-section-title">
            <div>
              <span>Локальные состояния</span>
              <h2>QR-платежи</h2>
            </div>
          </div>
          {data.qrPayments.data.length ? (
            data.qrPayments.data
              .slice(0, 20)
              .map((row, index) => (
                <Row
                  key={index}
                  title={text(row.merchant || row.payment_id)}
                  subtitle={text(row.status)}
                  right={`${amount(row.total_usdt)} USDT`}
                />
              ))
          ) : (
            <Empty />
          )}
        </section>
        <section className={card}>
          <div className="wpay-admin-section-title">
            <div>
              <span>TRC-20</span>
              <h2>Выводы</h2>
            </div>
          </div>
          {data.withdrawals.data.length ? (
            data.withdrawals.data
              .slice(0, 20)
              .map((row, index) => (
                <Row
                  key={index}
                  title={text(row.status)}
                  subtitle={text(row.recipient)}
                  right={`${amount(row.amount)} USDT`}
                />
              ))
          ) : (
            <Empty />
          )}
        </section>
      </div>
    </div>
  );
}

function AuraConsole({ data }: { data: AuraConsoleData }) {
  const [selected, setSelected] = useState(data.methods[0]?.method ?? "");
  const [draft, setDraft] = useState(() =>
    json(data.methods[0]?.example ?? {}),
  );
  const [confirmation, setConfirmation] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string>(
    () => globalThis.crypto?.randomUUID?.() || "",
  );
  const [filter, setFilter] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [actionError, setActionError] = useState("");
  const method =
    data.methods.find((item) => item.method === selected) ?? data.methods[0];
  const visible = data.methods.filter((item) =>
    `${item.method} ${item.verb} ${item.path} ${item.title}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );

  function choose(item: AuraMethod) {
    setSelected(item.method);
    setDraft(json(item.example));
    setConfirmation("");
    setIdempotencyKey(globalThis.crypto?.randomUUID?.() || "");
    setResult(null);
    setActionError("");
  }

  async function run() {
    if (!method || running || method.blocked_reason) return;
    let params: unknown;
    try {
      params = JSON.parse(draft || "{}");
      if (!params || Array.isArray(params) || typeof params !== "object")
        throw Error();
    } catch {
      setActionError("Параметры должны быть корректным JSON-объектом");
      return;
    }
    if (method.dangerous && confirmation !== method.method) {
      setActionError(`Введите ${method.method} для подтверждения`);
      return;
    }
    setRunning(true);
    setActionError("");
    setResult(null);
    try {
      const response = await walletRequest("admin-aura-action", {
        method: method.method,
        params,
        confirm: method.dangerous ? method.method : undefined,
        idempotency_key: method.idempotent ? idempotencyKey : undefined,
      });
      setResult(response);
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : "Aura вернула ошибку",
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className={`${card} !p-0 overflow-hidden`}>
      <div className="border-b border-[var(--admin-border)] p-5">
        <div className="wpay-admin-section-title !mb-0">
          <div>
            <span>Partner API 3.17</span>
            <h2>Полная Aura API-консоль · {data.methods.length} методов</h2>
          </div>
          <i className={data.configured ? "is-online" : ""}>
            {data.environment}
          </i>
        </div>
      </div>
      <div className="grid min-h-[680px] lg:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="border-b border-[var(--admin-border)] p-4 lg:border-b-0 lg:border-r">
          <div className="relative">
            <Search className="absolute left-3 top-3 opacity-35" size={17} />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className={`${input} !pl-10`}
              placeholder="Метод или путь"
            />
          </div>
          <div className="mt-3 max-h-[600px] space-y-1 overflow-y-auto">
            {visible.map((item) => (
              <button
                key={item.method}
                onClick={() => choose(item)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left ${selected === item.method ? "bg-blue-500 text-white" : "hover:bg-black/[.04] dark:hover:bg-white/[.06]"}`}
              >
                <span className="min-w-0">
                  <b className="block truncate text-xs">{item.method}</b>
                  <small
                    className={`mt-0.5 block truncate text-[10px] ${selected === item.method ? "text-white/70" : "opacity-45"}`}
                  >
                    {item.path}
                  </small>
                </span>
                <span
                  className={`shrink-0 rounded-md px-1.5 py-1 text-[9px] font-bold ${selected === item.method ? "bg-white/15" : item.verb === "POST" ? "bg-orange-500/10 text-orange-600" : "bg-blue-500/10 text-blue-600"}`}
                >
                  {item.verb}
                </span>
              </button>
            ))}
          </div>
        </aside>
        {method ? (
          <div className="min-w-0 p-5 lg:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-md px-2 py-1 text-[10px] font-bold ${method.verb === "POST" ? "bg-orange-500/10 text-orange-600" : "bg-blue-500/10 text-blue-600"}`}
                  >
                    {method.verb}
                  </span>
                  <h2 className="!text-xl">{method.path}</h2>
                </div>
                <p className="mt-2 text-sm opacity-50">
                  {method.title} · {method.method}
                </p>
              </div>
              {method.dangerous && (
                <span className="flex items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-500">
                  <AlertTriangle size={16} />
                  Изменяет данные или деньги
                </span>
              )}
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-black/[.035] p-3 text-xs dark:bg-white/[.05]">
                <span className="opacity-45">Параметры</span>
                <b className="mt-1 block break-words">
                  {method.params.join(", ") || "нет"}
                </b>
              </div>
              <div className="rounded-xl bg-black/[.035] p-3 text-xs dark:bg-white/[.05]">
                <span className="opacity-45">Обязательные</span>
                <b className="mt-1 block break-words">
                  {method.required.join(", ") || "нет"}
                </b>
              </div>
            </div>
            {method.blocked_reason ? (
              <p className="mt-5 rounded-xl bg-amber-500/10 p-4 text-sm text-amber-600">
                {method.blocked_reason}. Метод показан для полноты контракта, но
                выполнение здесь заблокировано.
              </p>
            ) : (
              <>
                <label className="mt-5 block">
                  <span className="text-xs font-semibold">JSON-параметры</span>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    spellCheck={false}
                    className={`${input} mt-2 min-h-52 resize-y font-mono !text-xs`}
                  />
                </label>
                {method.idempotent && (
                  <label className="mt-4 block">
                    <span className="text-xs font-semibold">
                      Idempotency-Key
                    </span>
                    <input
                      value={idempotencyKey}
                      onChange={(event) =>
                        setIdempotencyKey(event.target.value)
                      }
                      className={`${input} mt-2 font-mono !text-xs`}
                    />
                  </label>
                )}
                {method.dangerous && (
                  <label className="mt-4 block">
                    <span className="text-xs font-semibold text-red-500">
                      Для выполнения введите {method.method}
                    </span>
                    <input
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      className={`${input} mt-2`}
                      placeholder={method.method}
                    />
                  </label>
                )}
                <button
                  onClick={() => void run()}
                  disabled={
                    running ||
                    Boolean(method.dangerous && confirmation !== method.method)
                  }
                  className={`mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 font-semibold text-white disabled:opacity-40 ${method.dangerous ? "bg-red-500" : "bg-blue-500"}`}
                >
                  <Play size={17} />
                  {running
                    ? "Выполняю…"
                    : `Выполнить ${method.verb} ${method.path}`}
                </button>
              </>
            )}
            {actionError && (
              <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-500">
                {actionError}
              </p>
            )}
            {result !== null && (
              <div className="mt-5">
                <div className="text-xs font-semibold text-emerald-600">
                  HTTP-запрос и полный безопасный ответ Aura
                </div>
                <pre className="mt-2 max-h-[480px] overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/[.04] p-4 text-xs dark:bg-black/30">
                  {json(result)}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <Empty />
        )}
      </div>
    </section>
  );
}

function Overview({
  data,
  onNavigate,
}: {
  data: AdminOverview;
  onNavigate: (tab: Tab) => void;
}) {
  const problems = data.problems ?? { total: 0, items: [] };
  const metrics = [
    ["Пользователи", data.users, Users],
    ["Операции", data.events, Activity],
    ["Котировки", stateTotal(data.states.quotes), Database],
    ["Активы", data.liabilities.length, Coins],
  ] as const;
  return (
    <div className="wpay-admin-dashboard">
      <section className="wpay-admin-hero">
        <div className="wpay-admin-hero-aurora" aria-hidden="true">
          <Aurora
            colorStops={["#4269ed", "#9a79ff", "#6bc6e9"]}
            amplitude={0.65}
            speed={0.25}
            mouseInteraction={false}
            dpr={1}
            opacity={0.65}
          />
        </div>
        <div className="wpay-admin-hero-copy">
          <span className="wpay-admin-hero-eyebrow">
            <Activity size={14} /> Центр управления
          </span>
          <h2>Всё под контролем.</h2>
          <p>
            Пользователи, операции и интеграции.
            <br />
            Все данные — в одном пространстве.
          </p>
          <div className="wpay-admin-hero-actions">
            <button type="button" onClick={() => onNavigate("data")}>
              Пользователи <ArrowUpRight size={16} />
            </button>
            <button type="button" onClick={() => onNavigate("payments")}>
              Все операции <ArrowUpRight size={16} />
            </button>
          </div>
        </div>
        <span className="wpay-admin-hero-monogram" aria-hidden="true">
          <img src="/brands/wpay-wordmark-light.svg" alt="" />
        </span>
      </section>
      <section className="wpay-admin-metrics" aria-label="Основные показатели">
        {metrics.map(([label, value, Icon]) => (
          <article key={label} className="wpay-admin-metric">
            <span className="wpay-admin-metric-icon">
              <Icon size={19} />
            </span>
            <div>
              <strong>{value}</strong>
              <small>{label}</small>
            </div>
          </article>
        ))}
      </section>
      <section
        className={`wpay-admin-problems ${problems.total ? "has-problems" : "is-clear"}`}
        aria-label="Контроль проблем"
      >
        <div className="wpay-admin-problems-heading">
          <span className="wpay-admin-problems-icon">
            {problems.total ? (
              <AlertTriangle size={20} />
            ) : (
              <ShieldCheck size={20} />
            )}
          </span>
          <div>
            <small>Операционный контроль</small>
            <h2>
              {problems.total
                ? `Требуют внимания: ${problems.total}`
                : "Критичных проблем нет"}
            </h2>
          </div>
        </div>
        <div className="wpay-admin-problems-list">
          {problems.items.map((issue) => (
            <button
              type="button"
              key={issue.kind}
              className={issue.count ? "is-active" : ""}
              onClick={() =>
                onNavigate(
                  issue.kind === "notifications"
                    ? "notifications"
                    : issue.kind === "debts"
                      ? "data"
                      : issue.kind === "webhooks" ||
                          issue.kind === "reconciliation" ||
                          issue.kind === "kyc" ||
                          issue.kind === "sbp" ||
                          issue.kind === "qr" ||
                          issue.kind === "withdrawals"
                        ? "aura"
                        : "payments",
                )
              }
            >
              <span>{issue.label}</span>
              <b>{issue.count}</b>
            </button>
          ))}
        </div>
      </section>
      <div className="wpay-admin-dashboard-grid">
        <section className={card}>
          <div className="wpay-admin-section-title">
            <div>
              <span>Ликвидность</span>
              <h2>Средства у провайдера</h2>
            </div>
            <i className="wpay-admin-snapshot">Снимок API</i>
          </div>
          {data.provider.balance.map((row, index) => (
            <Row
              key={index}
              title={text(row.currency_code || row.asset)}
              right={amount(row.available)}
            />
          ))}
        </section>
        <section className={card}>
          <div className="wpay-admin-section-title">
            <div>
              <span>Клиентские средства</span>
              <h2>Обязательства</h2>
            </div>
          </div>
          {data.liabilities.length ? (
            data.liabilities.map((row, index) => (
              <Row
                key={index}
                title={text(row.asset)}
                subtitle={`Доступно ${amount(row.available)} · резерв ${amount(row.reserved)}`}
                right={amount(row.total)}
              />
            ))
          ) : (
            <Empty />
          )}
        </section>
      </div>
      <section className={card}>
        <div className="wpay-admin-section-title">
          <div>
            <span>Последняя активность</span>
            <h2>Операции пользователей</h2>
          </div>
        </div>
        {data.recent.length ? (
          data.recent
            .slice(0, 20)
            .map((row, index) => (
              <Row
                key={index}
                title={text(row.type)}
                subtitle={`${text(row.user_id)} · ${date(row.created_at)}`}
                right={`${amount(row.amount)} ${text(row.asset)}`}
              />
            ))
        ) : (
          <Empty />
        )}
      </section>
    </div>
  );
}

function DataView({
  data,
  table,
  query,
  setTable,
  setQuery,
  reload,
}: {
  data: { users: UsersData; database: DatabaseData };
  table: string;
  query: string;
  setTable: (v: string) => void;
  setQuery: (v: string) => void;
  reload: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"users" | "tables">("users");
  const [draft, setDraft] = useState(query);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<AdminUserDetail | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState("");
  async function openUser(userId: string) {
    setSelectedUser(userId);
    setUserDetail(null);
    setUserError("");
    setUserLoading(true);
    try {
      setUserDetail(
        await walletRequest<AdminUserDetail>(
          `admin-user?${new URLSearchParams({ user_id: userId })}`,
        ),
      );
    } catch (reason) {
      setUserError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить пользователя",
      );
    } finally {
      setUserLoading(false);
    }
  }
  async function syncUsers() {
    setSyncing(true);
    setSyncNotice("");
    try {
      const result = await walletRequest<{
        total: number;
        synced: number;
        failed: number;
      }>("admin-sync-users", {});
      setSyncNotice(
        `Обновлено ${result.synced} из ${result.total}${result.failed ? ` · ошибок ${result.failed}` : ""}`,
      );
      await reload();
    } catch (reason) {
      setSyncNotice(
        reason instanceof Error
          ? reason.message
          : "Не удалось обновить профили",
      );
    } finally {
      setSyncing(false);
    }
  }
  const userColumns: AdminColumn[] = [
    { key: "telegram_id", label: "Telegram ID" },
    {
      key: "first_name",
      label: "Пользователь",
      render: (_, row) =>
        [row.first_name, row.last_name].filter(Boolean).join(" ") ||
        text(row.user_id),
    },
    {
      key: "telegram_username",
      label: "Username",
      render: (value) => (value ? `@${value}` : "—"),
    },
    {
      key: "aura_customer_id",
      label: "Aura",
      render: (value) => (value ? "Подключён" : "Нет клиента"),
    },
    {
      key: "kyc_status",
      label: "KYC",
      render: (value, row) =>
        row.kyc_verified ? "Подтверждён" : text(value || "Не начат"),
    },
    { key: "card_count", label: "Карты" },
    {
      key: "balances",
      label: "Баланс",
      render: (value) =>
        Array.isArray(value) && value.length
          ? value
              .map(
                (balance) =>
                  `${amount((balance as Json).available)} ${text((balance as Json).asset)}`,
              )
              .join(" · ")
          : "0",
    },
    {
      key: "event_count",
      label: "Активность",
      render: (_, row) =>
        `${text(row.event_count)} оп. · ${text(row.address_count)} адр. · ${text(row.referral_count)} реф.`,
    },
    {
      key: "last_miniapp_at",
      label: "Последний вход",
      render: (value, row) => date(value || row.last_seen),
    },
    { key: "status", label: "Статус" },
  ];
  const dbColumns = data.database.columns
    .filter((key) => key !== "detail" && key !== "body")
    .slice(0, 8)
    .map((key) => ({ key, label: key }));
  return (
    <div className="space-y-4">
      <div className="inline-grid grid-cols-2 gap-1 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-muted)] p-1">
        {(["users", "tables"] as const).map((value) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={`rounded-lg px-5 py-2 text-xs font-semibold ${mode === value ? "bg-blue-500 text-white shadow-sm" : "text-[var(--admin-muted)]"}`}
          >
            {value === "users" ? "Пользователи" : "Таблицы БД"}
          </button>
        ))}
      </div>
      {mode === "users" ? (
        <section className="space-y-3">
          <div className="wpay-admin-data-toolbar">
            <div>
              <strong>{data.users.total}</strong>
              <span>пользователей в Telegram</span>
            </div>
            <div className="wpay-admin-sync">
              <span>{syncNotice}</span>
              <button onClick={() => void syncUsers()} disabled={syncing}>
                <RefreshCw
                  size={15}
                  className={syncing ? "animate-spin" : ""}
                />
                {syncing ? "Синхронизация…" : "Обновить профили"}
              </button>
            </div>
          </div>
          <div className="wpay-admin-desktop-only">
            <AdminTable
              rows={data.users.items}
              columns={userColumns}
              onRowClick={(row) => void openUser(text(row.user_id))}
            />
          </div>
          <div className="wpay-admin-mobile-only wpay-admin-mobile-list">
            {data.users.items.map((user, index) => (
              <article
                key={index}
                className="wpay-admin-mobile-item is-clickable"
                role="button"
                tabIndex={0}
                onClick={() => void openUser(text(user.user_id))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ")
                    void openUser(text(user.user_id));
                }}
              >
                <div className="wpay-admin-user-main">
                  <span className="wpay-admin-avatar">
                    {user.photo_url ? (
                      <img
                        src={String(user.photo_url)}
                        alt=""
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      text(
                        user.first_name ||
                          user.telegram_username ||
                          user.user_id,
                      )
                        .slice(0, 1)
                        .toUpperCase()
                    )}
                  </span>
                  <div className="min-w-0">
                    <b className="block truncate">
                      {[user.first_name, user.last_name]
                        .filter(Boolean)
                        .join(" ") || text(user.user_id)}
                    </b>
                    <div className="truncate text-xs opacity-45">
                      {user.telegram_username
                        ? `@${text(user.telegram_username)} · `
                        : ""}
                      {text(user.user_id)}
                    </div>
                  </div>
                  <span className="wpay-admin-status">
                    {text(user.role || user.status)}
                  </span>
                </div>
                <div className="wpay-admin-user-stats">
                  <span>
                    <small>Последний вход</small>
                    <b>{date(user.last_miniapp_at || user.last_seen)}</b>
                  </span>
                  <span>
                    <small>Aura / KYC</small>
                    <b>
                      {user.aura_customer_id ? "Подключён" : "Нет клиента"} ·{" "}
                      {user.kyc_verified
                        ? "verified"
                        : text(user.kyc_status || "не начат")}
                    </b>
                  </span>
                </div>
                {details(user)}
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[280px_minmax(260px,1fr)_100px]">
            <select
              value={table}
              onChange={(event) => setTable(event.target.value)}
              className={input}
            >
              {Object.entries(data.database.tables).map(([name, count]) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
            </select>
            <div className="relative">
              <Search
                className="absolute left-3 top-3.5 opacity-35"
                size={17}
              />
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className={`${input} !pl-10`}
                placeholder="Поиск по всей таблице"
              />
            </div>
            <button
              onClick={() => setQuery(draft)}
              className="rounded-xl bg-blue-500 px-5 py-3 text-xs font-semibold text-white"
            >
              Найти
            </button>
          </div>
          <div className="wpay-admin-desktop-only">
            <AdminTable rows={data.database.items} columns={dbColumns} />
          </div>
          <div className="wpay-admin-mobile-only space-y-3">
            {data.database.items.map((row, index) => (
              <article key={index} className={card}>
                <b className="text-xs text-blue-500">rowid {text(row.rowid)}</b>
                {Object.entries(row)
                  .filter(([key]) => key !== "rowid")
                  .slice(0, 5)
                  .map(([key, value]) => (
                    <div
                      key={key}
                      className="mt-2 grid grid-cols-[90px_1fr] gap-2 text-xs"
                    >
                      <span className="truncate opacity-45">{key}</span>
                      <span className="break-all">
                        {typeof value === "object" ? json(value) : text(value)}
                      </span>
                    </div>
                  ))}
                {details(row)}
              </article>
            ))}
          </div>
        </section>
      )}
      {selectedUser && (
        <AdminUserDrawer
          userId={selectedUser}
          detail={userDetail}
          loading={userLoading}
          error={userError}
          onClose={() => setSelectedUser(null)}
          onRetry={() => void openUser(selectedUser)}
        />
      )}
    </div>
  );
}

function AdminUserDrawer({
  userId,
  detail,
  loading,
  error,
  onClose,
  onRetry,
}: {
  userId: string;
  detail: AdminUserDetail | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [actionWorking, setActionWorking] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [messageText, setMessageText] = useState("");
  const [balanceAsset, setBalanceAsset] = useState("USDT");
  const [balanceAmount, setBalanceAmount] = useState("");
  const [balanceReason, setBalanceReason] = useState("");
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const account = detail?.account;
  const customer = detail?.aura.customer;
  const kyc = detail?.aura.kyc;
  const name = account
    ? [account.first_name, account.last_name].filter(Boolean).join(" ") ||
      userId
    : userId;
  const copy = (value: unknown) => {
    if (value) void navigator.clipboard?.writeText(String(value));
  };
  async function runUserAction(operation: string) {
    if (actionWorking) return;
    if (
      operation === "send_message" &&
      !window.confirm("Отправить это сообщение пользователю в Telegram?")
    )
      return;
    setActionWorking(operation);
    setActionNotice("");
    try {
      const result = await walletRequest<{
        queued?: number;
        sent?: boolean;
        result?: Json;
      }>("admin-user-action", {
        user_id: userId,
        operation,
        ...(operation === "send_message"
          ? { text: messageText, confirm: "send_message" }
          : {}),
      });
      if (operation === "refresh_kyc")
        setActionNotice(
          `KYC обновлён: ${text(result.result?.status || "готово")}`,
        );
      if (operation === "retry_notifications")
        setActionNotice(`В очередь возвращено: ${result.queued || 0}`);
      if (operation === "send_message") {
        setActionNotice("Сообщение отправлено");
        setMessageText("");
      }
      onRetry();
    } catch (reason) {
      setActionNotice(
        reason instanceof Error ? reason.message : "Команда не выполнена",
      );
    } finally {
      setActionWorking("");
    }
  }
  async function adjustBalance() {
    const normalizedAmount = balanceAmount.trim().replace(",", ".");
    if (!normalizedAmount || !balanceReason.trim() || actionWorking) return;
    if (
      !window.confirm(
        `Изменить баланс ${userId} на ${normalizedAmount} ${balanceAsset}?\n\nОперация попадёт в финансовый журнал и аудит.`,
      )
    )
      return;
    setActionWorking("adjust_balance");
    setActionNotice("");
    try {
      const result = await walletRequest<{ before: string; after: string }>(
        "finance-adjustment",
        {
          account_id: userId,
          asset: balanceAsset,
          amount: normalizedAmount,
          reason: balanceReason.trim(),
          bucket: "available",
          confirm: `ADJUST ${userId} ${balanceAsset} ${normalizedAmount}`,
        },
      );
      setActionNotice(
        `Баланс изменён: ${amount(result.before)} → ${amount(result.after)} ${balanceAsset}`,
      );
      setBalanceAmount("");
      setBalanceReason("");
      onRetry();
    } catch (reason) {
      setActionNotice(
        reason instanceof Error ? reason.message : "Баланс не изменён",
      );
    } finally {
      setActionWorking("");
    }
  }
  return (
    <div className="wpay-admin-drawer-root" role="presentation">
      <button
        type="button"
        className="wpay-admin-drawer-backdrop"
        aria-label="Закрыть карточку пользователя"
        onClick={onClose}
      />
      <aside
        className="wpay-admin-user-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Карточка пользователя ${name}`}
      >
        <header className="wpay-admin-drawer-header">
          <div>
            <small>Карточка пользователя</small>
            <h2>{name}</h2>
            <span>
              {account?.telegram_username
                ? `@${text(account.telegram_username)} · `
                : ""}
              {userId}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </header>
        <div className="wpay-admin-drawer-scroll">
          {loading ? (
            <div className="wpay-admin-drawer-state">Загружаем профиль…</div>
          ) : error ? (
            <div className="wpay-admin-drawer-state is-error">
              <AlertTriangle size={20} />
              <span>{error}</span>
              <button type="button" onClick={onRetry}>
                Повторить
              </button>
            </div>
          ) : detail ? (
            <>
              <div className="wpay-admin-user-badges">
                <span className={customer ? "is-good" : ""}>
                  Aura: {customer ? "подключён" : "нет клиента"}
                </span>
                <span className={kyc?.verified ? "is-good" : ""}>
                  KYC:{" "}
                  {kyc?.verified ? "verified" : text(kyc?.status || "не начат")}
                </span>
                <span>Карты: {detail.aura.cards.length}</span>
              </div>

              <section className="wpay-admin-user-section wpay-admin-operator-actions">
                <div className="wpay-admin-section-title">
                  <div>
                    <span>Оператор</span>
                    <h3>Безопасные действия</h3>
                  </div>
                </div>
                <div className="wpay-admin-operator-buttons">
                  <button
                    type="button"
                    disabled={!customer || Boolean(actionWorking)}
                    onClick={() => void runUserAction("refresh_kyc")}
                  >
                    <RefreshCw
                      size={15}
                      className={
                        actionWorking === "refresh_kyc" ? "animate-spin" : ""
                      }
                    />
                    Обновить KYC из Aura
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(actionWorking)}
                    onClick={() => void runUserAction("retry_notifications")}
                  >
                    <Bell size={15} />
                    Повторить уведомления
                  </button>
                </div>
                <textarea
                  className="wpay-admin-operator-message"
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  maxLength={4096}
                  placeholder="Личное сообщение пользователю в Telegram"
                />
                <button
                  type="button"
                  className="wpay-admin-operator-send"
                  disabled={!messageText.trim() || Boolean(actionWorking)}
                  onClick={() => void runUserAction("send_message")}
                >
                  <Send size={15} />
                  {actionWorking === "send_message"
                    ? "Отправляем…"
                    : "Отправить сообщение"}
                </button>
                {actionNotice && (
                  <p className="wpay-admin-operator-notice">{actionNotice}</p>
                )}
              </section>

              <section className="wpay-admin-user-section">
                <h3>Профиль и контакты</h3>
                <div className="wpay-admin-user-facts">
                  <div>
                    <small>Telegram ID</small>
                    <b>{text(account?.telegram_id)}</b>
                  </div>
                  <div>
                    <small>Роль</small>
                    <b>{text(account?.role)}</b>
                  </div>
                  <div>
                    <small>Email</small>
                    <b>{text(detail.contacts.email)}</b>
                  </div>
                  <div>
                    <small>Телефон</small>
                    <b>{text(detail.contacts.phone)}</b>
                  </div>
                  <div>
                    <small>Последний вход</small>
                    <b>
                      {date(account?.last_miniapp_at || account?.last_seen)}
                    </b>
                  </div>
                  <div>
                    <small>Бот запущен</small>
                    <b>{date(account?.bot_started_at)}</b>
                  </div>
                </div>
              </section>

              <section className="wpay-admin-user-section">
                <div className="wpay-admin-section-title">
                  <div>
                    <span>Aura</span>
                    <h3>Клиент и KYC</h3>
                  </div>
                </div>
                {customer ? (
                  <div className="wpay-admin-user-facts">
                    <button
                      type="button"
                      onClick={() => copy(customer.customer_id)}
                    >
                      <small>Customer ID · нажмите для копирования</small>
                      <b>{text(customer.customer_id)}</b>
                    </button>
                    <div>
                      <small>Среда</small>
                      <b>{text(customer.environment)}</b>
                    </div>
                    <div>
                      <small>Состояние клиента</small>
                      <b>{text(customer.state)}</b>
                    </div>
                    <div>
                      <small>Статус KYC</small>
                      <b>{text(kyc?.status || "not_started")}</b>
                    </div>
                    <div>
                      <small>Обновлено Aura</small>
                      <b>
                        {date(
                          kyc?.provider_updated_at ||
                            customer.provider_updated_at,
                        )}
                      </b>
                    </div>
                    <div>
                      <small>Причина</small>
                      <b>{text(kyc?.reason)}</b>
                    </div>
                  </div>
                ) : (
                  <p className="wpay-admin-user-empty">
                    Пользователь ещё не создавал профиль в Aura.
                  </p>
                )}
              </section>

              <section className="wpay-admin-user-section">
                <h3>Балансы</h3>
                {detail.balances.length ? (
                  detail.balances.map((balance, index) => (
                    <Row
                      key={index}
                      title={text(balance.asset)}
                      subtitle={`Резерв: ${amount(balance.reserved)}`}
                      right={amount(balance.available)}
                    />
                  ))
                ) : (
                  <p className="wpay-admin-user-empty">Балансов пока нет.</p>
                )}
                <div className="wpay-admin-balance-adjustment">
                  <div className="wpay-admin-balance-fields">
                    <select
                      value={balanceAsset}
                      onChange={(event) => setBalanceAsset(event.target.value)}
                      aria-label="Актив корректировки"
                    >
                      {Array.from(
                        new Set([
                          "USDT",
                          ...detail.balances.map((item) => text(item.asset)),
                        ]),
                      ).map((asset) => <option key={asset}>{asset}</option>)}
                    </select>
                    <input
                      value={balanceAmount}
                      onChange={(event) => setBalanceAmount(event.target.value.replace(/[^\d.,+-]/g, ""))}
                      inputMode="decimal"
                      placeholder="Сумма: 10 или -10"
                    />
                  </div>
                  <textarea
                    value={balanceReason}
                    onChange={(event) => setBalanceReason(event.target.value)}
                    maxLength={1000}
                    placeholder="Обязательная причина корректировки"
                  />
                  <button
                    type="button"
                    disabled={!balanceAmount.trim() || !balanceReason.trim() || Boolean(actionWorking)}
                    onClick={() => void adjustBalance()}
                  >
                    {actionWorking === "adjust_balance" ? "Проводим…" : "Провести корректировку"}
                  </button>
                  <small>
                    Это бухгалтерская корректировка, а не пополнение провайдера. При отсутствии обеспечения сверка покажет дефицит.
                  </small>
                </div>
              </section>

              <section className="wpay-admin-user-section">
                <h3>Карты Aura</h3>
                {detail.aura.cards.length ? (
                  detail.aura.cards.map((item, index) => (
                    <Row
                      key={index}
                      title={`${text(item.kind)} · ${text(item.masked_pan)}`}
                      subtitle={`${text(item.status)}${item.frozen ? " · заморожена" : ""}`}
                      right={text(item.delivery_status)}
                    />
                  ))
                ) : (
                  <p className="wpay-admin-user-empty">Карт пока нет.</p>
                )}
              </section>

              <section className="wpay-admin-user-section">
                <h3>Последние операции</h3>
                {detail.events.length ? (
                  detail.events
                    .slice(0, 12)
                    .map((item, index) => (
                      <Row
                        key={index}
                        title={text(item.type)}
                        subtitle={date(item.created_at)}
                        right={`${amount(item.amount)} ${text(item.asset)}`}
                      />
                    ))
                ) : (
                  <p className="wpay-admin-user-empty">Операций пока нет.</p>
                )}
              </section>

              <section className="wpay-admin-user-section">
                <h3>Уведомления и рефералы</h3>
                <div className="wpay-admin-user-facts">
                  <div>
                    <small>Уведомлений</small>
                    <b>{detail.notifications.length}</b>
                  </div>
                  <div>
                    <small>Приглашено</small>
                    <b>{detail.referrals.invited.length}</b>
                  </div>
                  <div>
                    <small>Пригласил</small>
                    <b>
                      {text(detail.referrals.referred_by?.referrer_user_id)}
                    </b>
                  </div>
                  <div>
                    <small>Адресов</small>
                    <b>{detail.addresses.length}</b>
                  </div>
                </div>
              </section>

              <section className="wpay-admin-user-section">
                <h3>Последние действия операторов</h3>
                {detail.audit.length ? (
                  detail.audit.slice(0, 12).map((item, index) => (
                    <Row
                      key={index}
                      title={text(item.action)}
                      subtitle={`${date(item.created_at)} · ${text(item.admin_id)}`}
                      right={text(item.outcome)}
                    />
                  ))
                ) : (
                  <p className="wpay-admin-user-empty">Действий пока нет.</p>
                )}
              </section>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Payments({ data }: { data: PaymentsData }) {
  const [kind, setKind] = useState<keyof PaymentsData>("events");
  const rows = data[kind];
  const columns: AdminColumn[] = [
    { key: "rowid", label: "ID" },
    { key: "user_id", label: "Пользователь" },
    {
      key: "type",
      label: "Тип",
      render: (value, row) => text(value || row.status || row.state || kind),
    },
    { key: "asset", label: "Актив" },
    { key: "amount", label: "Сумма", render: amount },
    {
      key: "status",
      label: "Статус",
      render: (value, row) => text(value || row.state),
    },
    { key: "created_at", label: "Дата", render: date },
  ];
  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(Object.keys(data) as (keyof PaymentsData)[]).map((key) => (
          <button
            key={key}
            onClick={() => setKind(key)}
            className={`whitespace-nowrap rounded-lg border border-[var(--admin-border)] px-4 py-2 text-xs font-semibold ${kind === key ? "border-blue-500 bg-blue-500 text-white" : "bg-[var(--admin-surface)] text-[var(--admin-muted)]"}`}
          >
            {key} · {data[key].length}
          </button>
        ))}
      </div>
      {rows.length ? (
        <>
          <div className="wpay-admin-desktop-only">
            <AdminTable rows={rows} columns={columns} />
          </div>
          <div className="wpay-admin-mobile-only space-y-3">
            {rows.map((row, index) => (
              <article key={index} className={card}>
                <Row
                  title={text(row.type || row.status || row.state || kind)}
                  subtitle={`${text(row.user_id)} · ${date(row.created_at)}`}
                  right={`${amount(row.amount)} ${text(row.asset)}`}
                />
                {details(row)}
              </article>
            ))}
          </div>
        </>
      ) : (
        <section className={card}>
          <Empty />
        </section>
      )}
    </div>
  );
}

function Crypto({
  data,
  reload,
}: {
  data: CryptoData;
  reload: () => Promise<void>;
}) {
  const [kind, setKind] = useState<"addresses" | "deposits" | "balances">(
    "addresses",
  );
  const rows = data[kind];
  const [workingRoute, setWorkingRoute] = useState("");
  const [routeNotice, setRouteNotice] = useState("");
  async function updateAssets(body: Json, key: string) {
    if (workingRoute) return;
    setWorkingRoute(key);
    setRouteNotice("");
    try {
      await walletRequest("admin-assets", body);
      setRouteNotice("Настройки валют применены");
      await reload();
    } catch (reason) {
      setRouteNotice(
        reason instanceof Error ? reason.message : "Не удалось изменить валюты",
      );
    } finally {
      setWorkingRoute("");
    }
  }
  const columns: AdminColumn[] = [
    { key: "rowid", label: "ID" },
    { key: "user_id", label: "Пользователь" },
    { key: "network", label: "Сеть" },
    { key: "asset", label: "Актив" },
    { key: "available", label: "Доступно", render: amount },
    { key: "reserved", label: "Резерв", render: amount },
    { key: "amount", label: "Сумма", render: amount },
    { key: "created_at", label: "Дата", render: date },
  ];
  return (
    <div className="space-y-4">
      <section className={card}>
        <div className="wpay-admin-section-title">
          <div>
            <span>Доступность в кошельке</span>
            <h2>Криптовалюты и сети</h2>
          </div>
          <button
            disabled={Boolean(workingRoute)}
            onClick={() => {
              if (
                window.confirm(
                  "Отключить все валюты и сети, оставив только USDT TRC-20?",
                )
              )
                void updateAssets({ preset: "usdt_trc20_only" }, "preset");
            }}
            className="rounded-xl bg-red-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            Отключить всё, кроме USDT TRC-20
          </button>
        </div>
        {routeNotice && (
          <p className="mb-3 rounded-xl bg-blue-500/10 p-3 text-sm text-blue-600">
            {routeNotice}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(data.asset_routes ?? []).map((route) => {
            const key = `${route.asset}:${route.network}`;
            return (
              <button
                key={key}
                disabled={Boolean(workingRoute)}
                onClick={() =>
                  void updateAssets(
                    {
                      asset: route.asset,
                      network: route.network,
                      enabled: !Boolean(route.enabled),
                    },
                    key,
                  )
                }
                className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left disabled:opacity-40 ${route.enabled ? "border-emerald-500/40 bg-emerald-500/10" : "border-[var(--admin-border)] bg-[var(--admin-surface-muted)]"}`}
              >
                <span>
                  <b className="block text-sm">{route.asset}</b>
                  <small className="opacity-50">
                    {route.network === "TRON" ? "TRC-20" : route.network}
                  </small>
                </span>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-bold ${route.enabled ? "bg-emerald-500 text-white" : "bg-black/10 opacity-50 dark:bg-white/10"}`}
                >
                  {route.enabled ? "ON" : "OFF"}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs opacity-50">
          Отключение скрывает актив и запрещает новые депозиты, счета, переводы
          и выводы. Остатки и история не удаляются.
        </p>
      </section>
      <div className="inline-grid grid-cols-3 gap-1 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-muted)] p-1">
        {(["addresses", "deposits", "balances"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setKind(key)}
            className={`rounded-lg px-4 py-2 text-xs font-semibold ${kind === key ? "bg-blue-500 text-white" : "text-[var(--admin-muted)]"}`}
          >
            {key} · {data[key].length}
          </button>
        ))}
      </div>
      {rows.length ? (
        <>
          <div className="wpay-admin-desktop-only">
            <AdminTable rows={rows} columns={columns} />
          </div>
          <div className="wpay-admin-mobile-only space-y-3">
            {rows.map((row, index) => (
              <article key={index} className={card}>
                <Row
                  title={text(row.network || row.asset || row.type)}
                  subtitle={text(row.user_id)}
                  right={amount(row.available || row.amount || "")}
                />
                {details(row)}
              </article>
            ))}
          </div>
        </>
      ) : (
        <section className={card}>
          <Empty />
        </section>
      )}
    </div>
  );
}

function GoSwap({ data }: { data: GoSwapData }) {
  const [selected, setSelected] = useState(data.methods[0]?.method ?? "");
  const [draft, setDraft] = useState(() =>
    json(data.methods[0]?.example ?? {}),
  );
  const [confirmation, setConfirmation] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [actionError, setActionError] = useState("");
  const [filter, setFilter] = useState("");
  const method =
    data.methods.find((item) => item.method === selected) ?? data.methods[0];
  const visible = data.methods.filter((item) =>
    `${item.method} ${item.title}`.toLowerCase().includes(filter.toLowerCase()),
  );
  function choose(item: GoSwapMethod) {
    setSelected(item.method);
    setDraft(json(item.example));
    setConfirmation("");
    setResult(null);
    setActionError("");
  }
  async function run() {
    if (!method || running) return;
    let params: unknown;
    try {
      params = JSON.parse(draft || "{}");
      if (!params || Array.isArray(params) || typeof params !== "object")
        throw Error();
    } catch {
      setActionError("Параметры должны быть корректным JSON-объектом");
      return;
    }
    if (method.dangerous && confirmation !== method.method) {
      setActionError(`Введите ${method.method} для подтверждения`);
      return;
    }
    if (
      method.post &&
      !method.dangerous &&
      !window.confirm(`Выполнить POST ${method.method}?`)
    )
      return;
    setRunning(true);
    setActionError("");
    setResult(null);
    try {
      const response = await walletRequest<{ result: unknown }>(
        "admin-goswap-action",
        {
          method: method.method,
          params,
          confirm: method.post ? method.method : undefined,
        },
      );
      setResult(response.result);
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : "GoSwap вернул ошибку",
      );
    } finally {
      setRunning(false);
    }
  }
  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Object.entries(data.snapshot).map(([name, value]) => (
          <article key={name} className={card}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="capitalize">{name}</h2>
              <span
                className={`rounded-full px-2 py-1 text-[10px] font-bold ${value.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}
              >
                {value.ok ? "ONLINE" : "ERROR"}
              </span>
            </div>
            {value.ok ? (
              details(value.result, "Открыть ответ")
            ) : (
              <p className="mt-2 text-sm text-red-500">
                {value.detail || value.error}
              </p>
            )}
          </article>
        ))}
      </section>
      <section className={`${card} !p-0 overflow-hidden`}>
        <div className="grid min-h-[620px] lg:grid-cols-[310px_minmax(0,1fr)]">
          <aside className="border-b border-[var(--admin-border)] p-4 lg:border-b-0 lg:border-r">
            <div className="relative">
              <Search className="absolute left-3 top-3 opacity-35" size={17} />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className={`${input} !pl-10`}
                placeholder="Найти метод"
              />
            </div>
            <div className="mt-3 max-h-[540px] space-y-1 overflow-y-auto">
              {visible.map((item) => (
                <button
                  key={item.method}
                  onClick={() => choose(item)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left ${selected === item.method ? "bg-blue-500 text-white" : "hover:bg-black/[.04] dark:hover:bg-white/[.06]"}`}
                >
                  <span className="min-w-0">
                    <b className="block truncate text-xs">{item.method}</b>
                    <small
                      className={`mt-0.5 block truncate text-[10px] ${selected === item.method ? "text-white/70" : "opacity-45"}`}
                    >
                      {item.title}
                    </small>
                  </span>
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-1 text-[9px] font-bold ${selected === item.method ? "bg-white/15" : item.post ? "bg-orange-500/10 text-orange-600" : "bg-blue-500/10 text-blue-600"}`}
                  >
                    {item.post ? "POST" : "GET"}
                  </span>
                </button>
              ))}
            </div>
          </aside>
          {method ? (
            <div className="min-w-0 p-5 lg:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-1 text-[10px] font-bold ${method.post ? "bg-orange-500/10 text-orange-600" : "bg-blue-500/10 text-blue-600"}`}
                    >
                      {method.post ? "POST" : "GET"}
                    </span>
                    <h2 className="!text-xl">{method.method}</h2>
                  </div>
                  <p className="mt-2 text-sm opacity-50">{method.title}</p>
                </div>
                {method.dangerous && (
                  <span className="flex items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-500">
                    <AlertTriangle size={16} />
                    Денежная операция
                  </span>
                )}
              </div>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl bg-black/[.035] p-3 text-xs dark:bg-white/[.05]">
                  <span className="opacity-45">Параметры</span>
                  <b className="mt-1 block break-words">
                    {method.params.join(", ") || "нет"}
                  </b>
                </div>
                <div className="rounded-xl bg-black/[.035] p-3 text-xs dark:bg-white/[.05]">
                  <span className="opacity-45">Обязательные</span>
                  <b className="mt-1 block break-words">
                    {method.required.join(", ") || "нет"}
                  </b>
                </div>
              </div>
              <label className="mt-5 block">
                <span className="text-xs font-semibold">JSON-параметры</span>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  spellCheck={false}
                  className={`${input} mt-2 min-h-52 resize-y font-mono !text-xs`}
                />
              </label>
              {method.dangerous && (
                <label className="mt-4 block">
                  <span className="text-xs font-semibold text-red-500">
                    Для выполнения введите {method.method}
                  </span>
                  <input
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    className={`${input} mt-2`}
                    placeholder={method.method}
                  />
                </label>
              )}
              <button
                onClick={() => void run()}
                disabled={
                  running ||
                  Boolean(method.dangerous && confirmation !== method.method)
                }
                className={`mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 font-semibold text-white disabled:opacity-40 ${method.dangerous ? "bg-red-500" : "bg-blue-500"}`}
              >
                <Play size={17} />
                {running ? "Выполняю…" : `Выполнить ${method.method}`}
              </button>
              {actionError && (
                <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-500">
                  {actionError}
                </p>
              )}
              {result !== null && (
                <div className="mt-5">
                  <div className="text-xs font-semibold text-emerald-600">
                    Ответ GoSwap
                  </div>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/[.04] p-4 text-xs dark:bg-black/30">
                    {json(result)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <Empty />
          )}
        </div>
      </section>
    </div>
  );
}

function Notifications({
  data,
  reload,
}: {
  data: NotificationData;
  reload: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState<"self" | "all">("self");
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState("");
  const canSend = useMemo(
    () => message.trim().length > 0 && !sending,
    [message, sending],
  );
  async function send() {
    if (!canSend) return;
    if (
      target === "all" &&
      !window.confirm(
        "Отправить сообщение всем пользователям, запустившим бота?",
      )
    )
      return;
    setSending(true);
    setNotice("");
    try {
      const result = await walletRequest<{ total: number }>(
        "admin-broadcasts",
        {
          text: message,
          target,
          button_text: buttonText,
          button_url: buttonUrl,
        },
      );
      setNotice(`Рассылка запущена. Получателей: ${result.total}`);
      setMessage("");
      await reload();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Ошибка отправки");
    } finally {
      setSending(false);
    }
  }
  async function toggle(eventType: string, enabled: boolean) {
    setSaving(eventType);
    setNotice("");
    try {
      await walletRequest("admin-notifications", {
        operation: "settings",
        settings: { [eventType]: enabled },
      });
      await reload();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Ошибка сохранения");
    } finally {
      setSaving("");
    }
  }
  async function retry(notificationId?: string) {
    setSaving(notificationId || "all");
    try {
      await walletRequest("admin-notifications", {
        operation: notificationId ? "retry" : "retry_failed",
        ...(notificationId ? { notification_id: notificationId } : {}),
      });
      await reload();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Ошибка повтора");
    } finally {
      setSaving("");
    }
  }
  return (
    <div className="space-y-4">
      <section className="wpay-admin-metrics">
        {[
          ["Получателей", data.eligible_users],
          ["В очереди", (data.counts.queued || 0) + (data.counts.retry || 0)],
          ["Доставлено", data.counts.sent || 0],
          ["Ошибки", data.counts.failed || 0],
        ].map(([label, value]) => (
          <div className="wpay-admin-metric" key={String(label)}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>
      <section className={card}>
        <div className="wpay-admin-section-title">
          <div>
            <span>Автоматика</span>
            <h2>События для пользователей</h2>
          </div>
          <button
            className="rounded-xl bg-black/[.05] px-3 py-2 text-xs font-semibold dark:bg-white/[.08]"
            onClick={() => void retry()}
            disabled={saving === "all"}
          >
            Повторить ошибки
          </button>
        </div>
        <p className="mb-3 text-sm opacity-55">
          Сообщения создаются из подтверждённых событий Aura и GoSwap, защищены
          от дублей и повторяются при временной ошибке Telegram.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.settings.map((setting) => (
            <label
              key={setting.event_type}
              className="flex items-center justify-between rounded-2xl bg-black/[.035] p-3 dark:bg-white/[.06]"
            >
              <span className="text-sm font-medium">{setting.label}</span>
              <input
                type="checkbox"
                checked={Boolean(setting.enabled)}
                disabled={saving === setting.event_type}
                onChange={(event) =>
                  void toggle(setting.event_type, event.target.checked)
                }
                className="h-5 w-5 accent-blue-500"
              />
            </label>
          ))}
        </div>
      </section>
      <section className={card}>
        <div className="wpay-admin-section-title">
          <div>
            <span>Outbox</span>
            <h2>История доставки</h2>
          </div>
        </div>
        {data.recent.length ? (
          data.recent.map((row) => (
            <div
              key={text(row.notification_id)}
              className="border-b border-black/[.06] py-3 last:border-0 dark:border-white/[.08]"
            >
              <Row
                title={text(row.title)}
                subtitle={`${date(row.created_at)} · ${text(row.event_type)} · ${text(row.user_id)}`}
                right={text(row.status)}
              />
              <p className="mt-1 text-xs opacity-55">{text(row.message)}</p>
              {row.last_error ? (
                <p className="mt-1 text-xs text-red-500">
                  {text(row.last_error)}
                </p>
              ) : null}
              {["failed", "retry", "skipped"].includes(text(row.status)) ? (
                <button
                  className="mt-2 text-xs font-semibold text-blue-500"
                  onClick={() => void retry(text(row.notification_id))}
                >
                  Повторить доставку
                </button>
              ) : null}
            </div>
          ))
        ) : (
          <Empty />
        )}
      </section>
      <section className={card}>
        <div className="wpay-admin-section-title">
          <div>
            <span>Ручная отправка</span>
            <h2>Новая рассылка</h2>
          </div>
        </div>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className={`${input} mt-3 min-h-32 resize-y`}
          maxLength={4096}
          placeholder="Текст сообщения"
        />
        <div className="mt-2 text-right text-xs opacity-40">
          {message.length}/4096
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => setTarget("self")}
            className={`rounded-2xl py-3 text-sm font-semibold ${target === "self" ? "bg-blue-500 text-white" : "bg-black/[.04] dark:bg-white/[.07]"}`}
          >
            Тест себе
          </button>
          <button
            onClick={() => setTarget("all")}
            className={`rounded-2xl py-3 text-sm font-semibold ${target === "all" ? "bg-blue-500 text-white" : "bg-black/[.04] dark:bg-white/[.07]"}`}
          >
            Всем
          </button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input
            value={buttonText}
            onChange={(event) => setButtonText(event.target.value)}
            className={input}
            placeholder="Текст кнопки (необязательно)"
          />
          <input
            value={buttonUrl}
            onChange={(event) => setButtonUrl(event.target.value)}
            className={input}
            placeholder="https://…"
          />
        </div>
        <button
          onClick={() => void send()}
          disabled={!canSend}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-500 py-3.5 font-semibold text-white disabled:opacity-40"
        >
          <Send size={18} />
          {sending
            ? "Отправляю…"
            : target === "self"
              ? "Отправить себе"
              : "Запустить рассылку"}
        </button>
        {notice && <p className="mt-3 text-sm">{notice}</p>}
      </section>
      <section className={card}>
        <h2 className="font-semibold">История рассылок</h2>
        {data.broadcasts.length ? (
          data.broadcasts.map((row, index) => (
            <div
              key={index}
              className="border-b border-black/[.06] py-3 last:border-0 dark:border-white/[.08]"
            >
              <Row
                title={text(row.text)}
                subtitle={`${date(row.created_at)} · ${text(row.target)}`}
                right={`${text(row.sent)}/${text(row.total)}`}
              />
              <div className="mt-1 text-xs opacity-45">
                Статус: {text(row.status)} · ошибок {text(row.failed)}
              </div>
            </div>
          ))
        ) : (
          <Empty />
        )}
      </section>
    </div>
  );
}

function AdminTable({
  rows,
  columns,
  onRowClick,
}: {
  rows: Json[];
  columns: AdminColumn[];
  onRowClick?: (row: Json) => void;
}) {
  return (
    <div className="wpay-admin-table-wrap">
      <table className="wpay-admin-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
            <th>Данные</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={String(row.rowid || row.event_id || row.user_id || index)}
              className={onRowClick ? "is-clickable" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={() => onRowClick?.(row)}
              onKeyDown={(event) => {
                if (onRowClick && (event.key === "Enter" || event.key === " "))
                  onRowClick(row);
              }}
            >
              {columns.map((column) => {
                const value = column.render
                  ? column.render(row[column.key], row)
                  : text(row[column.key]);
                return (
                  <td key={column.key}>
                    <div className="wpay-admin-table-cell" title={value}>
                      {value}
                    </div>
                  </td>
                );
              })}
              <td>
                <details onClick={(event) => event.stopPropagation()}>
                  <summary>JSON</summary>
                  <pre>{json(row)}</pre>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: string;
}) {
  return (
    <div className="wpay-admin-data-row flex items-start justify-between gap-3 border-b border-black/[.05] py-3 last:border-0 dark:border-white/[.07]">
      <div className="min-w-0">
        <div className="break-words text-sm font-medium">{title}</div>
        {subtitle && (
          <div className="mt-1 break-all text-xs opacity-45">{subtitle}</div>
        )}
      </div>
      {right && (
        <div className="shrink-0 text-right text-sm font-semibold tabular-nums">
          {right}
        </div>
      )}
    </div>
  );
}
function Empty() {
  return (
    <div className="wpay-admin-empty">
      <Database size={23} />
      <strong>Записей пока нет</strong>
      <span>Данные появятся после первых операций</span>
    </div>
  );
}
