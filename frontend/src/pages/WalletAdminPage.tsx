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
  Coins,
  Database,
  LayoutDashboard,
  Megaphone,
  Menu,
  Play,
  RefreshCw,
  Search,
  Send,
  Server,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import Framework7 from "framework7/lite-bundle";
import Framework7React, {
  App as F7App,
  Button as F7Button,
  Preloader as F7Preloader,
} from "framework7-react";
import { walletRequest } from "../lib/wallet-api";
import { useTheme } from "../store/ThemeStore";
import "./WalletFramework7.css";
import "./WalletAdmin.css";

// oxlint-disable-next-line react-hooks/rules-of-hooks -- Framework7 plugin registration is not a React Hook.
Framework7.use(Framework7React);

type Json = Record<string, unknown>;
type Tab =
  "overview" | "data" | "payments" | "crypto" | "goswap" | "broadcasts";
type AdminOverview = {
  users: number;
  events: number;
  liabilities: Json[];
  states: Record<string, Record<string, number>>;
  recent: Json[];
  provider: { balance: Json[] };
};
type UsersData = { items: Json[]; total: number };
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
type CryptoData = { addresses: Json[]; deposits: Json[]; balances: Json[] };
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
type BroadcastData = { items: Json[] };
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
    ? number.toLocaleString("ru-RU", { maximumFractionDigits: 8 })
    : text(value);
}
function date(value: unknown) {
  if (!value) return "—";
  const parsed = new Date(String(value));
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
  { id: "overview", label: "Главная", icon: LayoutDashboard },
  { id: "data", label: "БД", icon: Database },
  { id: "payments", label: "Оплаты", icon: Activity },
  { id: "crypto", label: "Крипта", icon: Coins },
  { id: "goswap", label: "GoSwap", icon: Server },
  { id: "broadcasts", label: "Рассылки", icon: Megaphone },
];

export default function WalletAdminPage() {
  const { theme } = useTheme();
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
      if (tab === "broadcasts") {
        setPayload(await walletRequest<BroadcastData>("admin-broadcasts"));
        setPayloadTab(tab);
      }
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
            <span className="wpay-admin-brandmark">W</span>
            <span>
              <b>WPay</b>
              <small>Admin Console</small>
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
          <nav className="wpay-admin-nav">
            {tabs.map((item) => (
              <F7Button
                large
                fill={tab === item.id}
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
              <b>Защищённый вход</b>
              <small>Telegram Admin ID</small>
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
                <div className="wpay-admin-kicker">
                  WPay / Панель управления
                </div>
                <h1>{tabs.find((item) => item.id === tab)?.label}</h1>
              </div>
            </div>
            <div className="wpay-admin-topactions">
              <span className="wpay-admin-online">
                <i /> Система работает
              </span>
              <F7Button
                round
                className="wpay-admin-refresh"
                onClick={() => void load()}
                disabled={loading}
              >
                {loading ? <F7Preloader size={18} /> : <RefreshCw size={18} />}
              </F7Button>
            </div>
          </header>
          <div className="wpay-admin-content">
            {error && <div className="wpay-admin-error">{error}</div>}
            {!ready ? (
              <div className="wpay-admin-loading">
                <F7Preloader size={30} />
                <span>Загружаю данные…</span>
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
              />
            )}
          </div>
        </section>
      </div>
    </F7App>
  );
}

function TabContent({
  tab,
  payload,
  table,
  query,
  setTable,
  setQuery,
  reload,
}: {
  tab: Tab;
  payload: unknown;
  table: string;
  query: string;
  setTable: (v: string) => void;
  setQuery: (v: string) => void;
  reload: () => Promise<void>;
}) {
  if (!payload) return null;
  if (tab === "overview") return <Overview data={payload as AdminOverview} />;
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
  if (tab === "crypto") return <Crypto data={payload as CryptoData} />;
  if (tab === "goswap") return <GoSwap data={payload as GoSwapData} />;
  return <Broadcasts data={payload as BroadcastData} reload={reload} />;
}

function Overview({ data }: { data: AdminOverview }) {
  const metrics = [
    ["Пользователи", data.users, Users],
    ["Операции", data.events, Activity],
    ["Котировки", stateTotal(data.states.quotes), Database],
    ["Активы", data.liabilities.length, Coins],
  ] as const;
  return (
    <div className="wpay-admin-dashboard">
      <section className="wpay-admin-metrics">
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
      <div className="wpay-admin-dashboard-grid">
        <section className={card}>
          <div className="wpay-admin-section-title">
            <div>
              <span>Ликвидность</span>
              <h2>Баланс GoSwap</h2>
            </div>
            <i className="is-online">Online</i>
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
    { key: "role", label: "Роль" },
    {
      key: "event_count",
      label: "Активность",
      render: (_, row) =>
        `${text(row.event_count)} оп. · ${text(row.address_count)} адр.`,
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
            <AdminTable rows={data.users.items} columns={userColumns} />
          </div>
          <div className="wpay-admin-mobile-only wpay-admin-mobile-list">
            {data.users.items.map((user, index) => (
              <article key={index} className="wpay-admin-mobile-item">
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
                    <small>Активность</small>
                    <b>
                      {text(user.event_count)} оп. · {text(user.address_count)}{" "}
                      адр.
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

function Crypto({ data }: { data: CryptoData }) {
  const [kind, setKind] = useState<"addresses" | "deposits" | "balances">(
    "addresses",
  );
  const rows = data[kind];
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

function Broadcasts({
  data,
  reload,
}: {
  data: BroadcastData;
  reload: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState<"self" | "all">("self");
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
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
  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className="font-semibold">Новая рассылка</h2>
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
        {data.items.length ? (
          data.items.map((row, index) => (
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
}: {
  rows: Json[];
  columns: AdminColumn[];
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
            <tr key={String(row.rowid || row.event_id || row.user_id || index)}>
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
                <details>
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
    <div className="flex items-start justify-between gap-3 border-b border-black/[.05] py-3 last:border-0 dark:border-white/[.07]">
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
    <div className="py-5 text-center text-sm opacity-40">Данных пока нет</div>
  );
}
