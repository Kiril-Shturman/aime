import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import {
  Activity, ChevronRight, ReceiptText, Search, SlidersHorizontal, TrendingUp, X,
} from "lucide-react";
import { TransactionAvatar, transactionFromApi } from "./WalletTransaction";
import { RecordMenu, RecordValue } from "./WalletAdminRecord";
import { walletRequest } from "../lib/wallet-api";
import "./WalletAdminOperations.css";

type Row = Record<string, unknown>;
type Daily = { day: string; asset: string; volume: string; revenue: string; count: number };
const sources = {
  events: "Журнал операций", quotes: "Котировки", invoices: "Счета",
  transfers: "Переводы", withdrawals: "Заявки на вывод",
} as const;
export type AdminOperationsData = Record<keyof typeof sources, Row[]> & { daily?: Daily[]; as_of?: string };

const labels: Record<string, string> = {
  deposit: "Пополнение криптовалютой", ruble_deposit: "Пополнение рублями",
  sbp_completed: "Пополнение через СБП", card_issue_refund: "Возврат стоимости выпуска карты",
  card_topup: "Пополнение карты", card_issue: "Выпуск карты", card_payment: "Покупка картой",
  qr_completed: "Оплата по QR", qr_failed: "Ошибка оплаты по QR", qr_processing: "Оплата по QR",
  qr_refunded: "Возврат оплаты по QR", deposit_return: "Возврат пополнения",
  admin_adjustment: "Корректировка баланса", exchange_internal: "Обмен валют",
};
const statuses: Record<string, string> = {
  completed: "Выполнено", confirmed: "Подтверждено", opened: "Выпущена",
  failed: "Ошибка", rejected: "Отклонено", cancelled: "Отменено",
  pending: "Ожидает", processing: "В обработке", broadcast: "Отправлено",
  refunded: "Возвращено", prepared: "Подготовлено", active: "Активен",
};
const fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 8 });
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
const s = (value: unknown) => String(value ?? "");
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const dateFor = (anchor: number, offset: number) => isoDay(new Date(anchor + offset * 86400000));
const emptyFilters = { query: "", type: "", status: "", asset: "", from: "", to: "", min: "", max: "" };

function normalize(row: Row, source: keyof typeof sources) {
  const detail = row.detail && typeof row.detail === "object" ? row.detail as Row : {};
  const type = s(row.type || source);
  const suffix = type.split("_").at(-1) ?? "";
  const status = s(detail.status || row.status || row.state || (suffix in statuses ? suffix :
    ["deposit", "ruble_deposit", "exchange_internal", "admin_adjustment"].includes(type) ? "completed" : ""));
  const title = labels[type] || (type.startsWith("withdrawal") ? "Вывод криптовалюты"
    : type.startsWith("transfer") ? "Перевод" : type.startsWith("exchange") ? "Обмен валют"
    : type === source ? sources[source] : type.replaceAll("_", " "));
  const rawDate = row.created_at ?? row.updated_at;
  const stamp = typeof rawDate === "number" ? rawDate * 1000 : Date.parse(s(rawDate));
  const asset = s(row.asset || detail.asset);
  const rawAmount = type === "exchange_internal" ? detail.amount ?? row.amount : row.amount;
  const amount = rawAmount == null || rawAmount === "" ? null : Number(rawAmount);
  const id = s(row.event_id || row.operation_id || row.spend_id || row.quote_id || row.invoice_id || row.id || row.rowid);
  const createdAt = Number.isFinite(stamp) ? new Date(stamp).toISOString() : "";
  const user = s(row.user_id);
  const model = transactionFromApi({
    event_id: id, type, asset, amount: s(rawAmount ?? "0"), created_at: createdAt, detail,
  });
  model.title = title;
  const revenue = row.revenue == null ? null : Number(row.revenue);
  if (source === "events") {
    model.rows.push(["Доход wPay", revenue == null ? "Нет данных о комиссии" : `${fmt.format(revenue)} ${asset}`]);
  }
  if (user) model.rows.unshift(["Пользователь", user]);
  if (status) {
    model.rows.unshift(["Статус в журнале", statuses[status] ?? status]);
    if (["failed", "rejected", "cancelled"].includes(status)) model.status = "failed";
    else if (["pending", "prepared", "processing", "broadcast", "active"].includes(status)) model.status = "processing";
    else if (status === "refunded") model.status = "refunded";
  }
  return {
    id, user, type, title, status, model, asset, amount, stamp, revenue, source,
    operationKey: [detail.withdrawal_id, detail.payment_id, detail.deposit_id, detail.transfer_id, detail.invoice_id, detail.order_id, detail.operation_id, detail.spend_id].map(s).find(Boolean),
    day: createdAt.slice(0, 10),
    reference: [detail.merchant_name, detail.network, detail.operation_id, detail.payment_id, detail.order_id, detail.tx_hash, detail.transaction_hash, row.withdrawal_id].map(s).filter(Boolean).join(" · "),
  };
}

function OperationsChart({ daily, asOf }: { daily: Daily[]; asOf?: string }) {
  const [period, setPeriod] = useState({ from: "", to: "" });
  const [selected, setSelected] = useState("");
  const gradient = useId();
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [metric, setMetric] = useState<"volume" | "revenue" | "count">("volume");
  const assets = [...new Set(daily.map(row => row.asset))].sort();
  const asset = selected || (assets.includes("USDT") ? "USDT" : assets[0] || "USDT");
  const today = isoDay(new Date(Date.parse(asOf ?? daily.at(-1)?.day ?? "") || Date.now()));
  const earliest = dateFor(Date.parse(today), -89);
  const to = period.to || today;
  const from = period.from || dateFor(Date.parse(to), Math.max(-6, (Date.parse(earliest) - Date.parse(to)) / 86400000));
  const days = 1 + Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  const changeDate = (edge: "from" | "to", date: string) => {
    if (!date || date < earliest || date > today) return;
    setHighlight(null);
    setPeriod(edge === "from" ? { from: date, to: date > to ? date : to }
      : { from: date < from ? date : from, to: date });
  };
  const byDay = new Map(daily.filter(row => row.asset === asset).map(row => [row.day, row]));
  const series = Array.from({ length: days }, (_, index) => {
    const day = dateFor(Date.parse(from), index);
    const row = byDay.get(day);
    return { day, volume: Number(row?.volume ?? 0), revenue: Number(row?.revenue ?? 0), count: row?.count ?? 0 };
  });
  const total = series.reduce((sum, row) => ({ volume: sum.volume + row.volume,
    revenue: sum.revenue + row.revenue, count: sum.count + row.count }), { volume: 0, revenue: 0, count: 0 });
  const values = series.map(row => row[metric]);
  const ceiling = Math.max(0, ...values);
  const floor = Math.min(0, ...values);
  const range = ceiling - floor || 1;
  const cards = [
    { key: "volume", label: "Оборот по журналу", icon: Activity },
    { key: "revenue", label: "Доход от комиссий", icon: TrendingUp },
    { key: "count", label: "Выполнено операций", icon: ReceiptText },
  ] as const;
  const chartLabel = cards.find(card => card.key === metric)?.label;
  const unit = metric === "count" ? "" : asset;
  const hasData = total.count !== 0 || values.some(value => value !== 0);
  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(150, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasData]);
  const axis = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 2 });
  const right = width - 52;
  const x = (index: number) => series.length === 1 ? (8 + right) / 2 : 8 + index * (right - 8) / (series.length - 1);
  const y = (value: number) => 152 - (value - floor) / range * 134;
  const line = series.map((row, index) => {
    if (!index) return `M ${x(0)} ${y(row[metric])}`;
    const midpoint = (x(index - 1) + x(index)) / 2;
    return `C ${midpoint} ${y(series[index - 1][metric])}, ${midpoint} ${y(row[metric])}, ${x(index)} ${y(row[metric])}`;
  }).join(" ");
  const index = highlight === null ? null : Math.min(highlight, series.length - 1);
  const point = index === null ? null : series[index];
  const selectPoint = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = (event.clientX - bounds.left) / bounds.width * width;
    const day = Math.round((position - 8) / (right - 8) * (series.length - 1));
    setHighlight(Math.min(series.length - 1, Math.max(0, day)));
  };
  return (
    <section className="admin-ops-panel" aria-labelledby="ops-chart-title">
      <header className="admin-ops-header">
        <div><h2 id="ops-chart-title">Оборот и доход</h2><p>Завершённые операции журнала wPay · UTC</p></div>
        <div className="admin-ops-controls">
          <label>От<input type="date" aria-label="Начало периода графика" min={earliest} max={today} value={from} onChange={event => changeDate("from", event.target.value)} /></label>
          <label>До<input type="date" aria-label="Конец периода графика" min={earliest} max={today} value={to} onChange={event => changeDate("to", event.target.value)} /></label>
          <select aria-label="Валюта графика" value={asset} onChange={e => setSelected(e.target.value)}>
            {(assets.length ? assets : [asset]).map(code => <option key={code}>{code}</option>)}
          </select>
        </div>
      </header>
      <div className="admin-ops-metrics" aria-label="Показатели за период">
        {cards.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" aria-pressed={metric === key} onClick={() => { setMetric(key); setHighlight(null); }}>
            <span><Icon size={15} /> {label}</span>
            <strong>{fmt.format(total[key])} {key !== "count" && <small>{asset}</small>}</strong>
          </button>
        ))}
      </div>
      {!hasData ? <p className="admin-ops-empty">За этот период завершённых операций нет.</p> : (
        <div className="admin-ops-plot" ref={plot}>
          <div className="admin-ops-chart-caption" aria-live="polite">
            <strong>{chartLabel}{unit && ` · ${unit}`}</strong>
          </div>
          <svg className="admin-ops-chart" viewBox={`0 0 ${width} 180`} role="img" tabIndex={0}
            aria-label={`${chartLabel} по дням, ${asset}. Используйте стрелки для выбора дня`}
            onKeyDown={event => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const direction = event.key === "ArrowLeft" ? -1 : 1;
              setHighlight(Math.max(0, Math.min(series.length - 1, (index ?? series.length - 1) + direction)));
            }}
            onPointerDown={event => {
              selectPoint(event);
              if (event.pointerType === "touch") event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              if (event.pointerType === "touch" && !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              selectPoint(event);
            }}>
            <defs><linearGradient id={gradient} x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".22" /><stop offset="1" stopColor="currentColor" stopOpacity=".02" /></linearGradient></defs>
            {[0, 1, 2, 3].map(step => {
              const value = floor + range * step / 3;
              return <g key={step}><line x1="8" x2={right} y1={y(value)} y2={y(value)} /><text x={width - 4} y={y(value) + 4} textAnchor="end">{axis.format(value)}</text></g>;
            })}
            {[0, 1, 2, 3].map(step => {
              const tick = 8 + (right - 8) * step / 3;
              return <line key={step} x1={tick} x2={tick} y1="18" y2="152" />;
            })}
            <path d={`${line} L ${right} ${y(0)} L 8 ${y(0)} Z`} fill={`url(#${gradient})`} />
            <path d={line} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            {series.length <= 14 && series.map((row, day) =>
              <circle key={row.day} cx={x(day)} cy={y(row[metric])} r="3" fill="var(--admin-surface)" stroke="currentColor" strokeWidth="2" />
            )}
            {point && index !== null && <g><line className="admin-ops-cursor" x1={x(index)} x2={x(index)} y1="14" y2="152" /><circle cx={x(index)} cy={y(point[metric])} r="5" fill="currentColor" stroke="var(--admin-surface)" strokeWidth="2" /></g>}
            <text x="8" y="174">{dayFmt.format(new Date(series[0].day))}</text>
            {series.length > 1 && <text x={right} y="174" textAnchor="end">{dayFmt.format(new Date(series[series.length - 1].day))}</text>}
          </svg>
          {point && index !== null && (
            <div className="admin-ops-tooltip" role="status"
              style={{ left: `clamp(76px, ${x(index) / width * 100}%, calc(100% - 76px))` }}>
              <strong>{fmt.format(point[metric])} {unit}</strong>
              <span>{dayFmt.format(new Date(point.day))}</span>
            </div>
          )}
        </div>
      )}
      <p className="admin-ops-note">Оборот — сумма абсолютных значений операций. Доход — комиссии wPay, записанные в журнале, за вычетом возвратов. Данные по прочим расходам сюда не входят.</p>
    </section>
  );
}

const recordTabs = [["details", "Детали"], ["history", "История"], ["logs", "Логи события"]] as const;

function OperationRecord({ record, related }: {
  record: ReturnType<typeof normalize>; related: ReturnType<typeof normalize>[];
}) {
  const [tab, setTab] = useState<(typeof recordTabs)[number][0]>("details");
  const [logs, setLogs] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (tab !== "logs" || record.source !== "events") return;
    const controller = new AbortController();
    walletRequest<{ items: Row[] }>(`admin-operation-logs?${new URLSearchParams({ event_id: record.id })}`, undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setLogs(data.items); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [tab, record.id, record.source]);
  const dateTime = (stamp: number) => Number.isFinite(stamp)
    ? new Date(stamp).toLocaleString("ru-RU", { timeZone: "UTC" }) + " UTC" : "—";
  return <div className="admin-ops-record">
    <RecordMenu label="Разделы операции" tabs={recordTabs} active={tab} onSelect={setTab} />
    {tab === "details" && <>
      <dl className="admin-record-fields">
        <RecordValue label="Операция" value={record.title} />
        <RecordValue label="Сумма" value={record.amount === null ? undefined : `${fmt.format(record.amount)} ${record.asset}`} copyable />
        <RecordValue label="ID операции" value={record.id} copyable />
        <RecordValue label="Дата и время" value={dateTime(record.stamp)} />
        {record.model.rows.map(([label, value], index) => (
          <RecordValue key={`${label}-${index}`} label={label} value={value} copyable={/id|номер|хеш|адрес|пользователь/i.test(label)} />
        ))}
      </dl>
      {record.source === "events" && <button className="admin-record-link" type="button" onClick={() => setTab("logs")}>Перейти в логи</button>}
    </>}
    {tab === "history" && <dl className="admin-record-fields">
      {related.map(row => <RecordValue key={row.id} label={dateTime(row.stamp)} value={`${row.title} · ${statuses[row.status] ?? (row.status || "Записано")}`} />)}
    </dl>}
    {tab === "logs" && (record.source !== "events" || logs?.length === 0
      ? <p className="admin-record-empty">Связанных событий провайдера нет.</p>
      : error ? <p role="alert">Не удалось загрузить логи.</p>
      : logs ? <dl className="admin-record-fields">{logs.map(log => (
        <RecordValue key={s(log.id)} label={`${s(log.provider)} · ${s(log.update_type)}`}
          value={`${dateTime(Number(log.received_at) * 1000)} · ${log.has_error ? "Ошибка обработки" : log.processed_at ? "Обработано" : "Ожидает обработки"}`} />
      ))}</dl> : <p role="status">Загружаем логи…</p>)}
  </div>;
}

export function AdminOperations({ data }: { data: AdminOperationsData }) {
  const [source, setSource] = useState<keyof typeof sources>("events");
  const [filters, setFilters] = useState(emptyFilters);
  const [limit, setLimit] = useState(25);
  const [advanced, setAdvanced] = useState(false);
  const rows = (data[source] ?? []).map(row => normalize(row, source));
  const query = filters.query.trim().toLowerCase();
  const filtered = rows.filter(row => (
    (!query || [row.id, row.user, row.title, row.reference, row.asset].join(" ").toLowerCase().includes(query))
    && (!filters.type || row.type === filters.type)
    && (!filters.status || row.status === filters.status)
    && (!filters.asset || row.asset === filters.asset)
    && (!filters.from || !!row.day && row.day >= filters.from)
    && (!filters.to || !!row.day && row.day <= filters.to)
    && (!filters.min || row.amount !== null && Math.abs(row.amount) >= Number(filters.min))
    && (!filters.max || row.amount !== null && Math.abs(row.amount) <= Number(filters.max))
  ));
  const types = new Map(rows.map(row => [row.type, row.title]));
  const states = [...new Set(rows.map(row => row.status).filter(Boolean))].sort();
  const assets = [...new Set(rows.map(row => row.asset).filter(Boolean))].sort();
  const update = (key: keyof typeof emptyFilters, value: string) => {
    setFilters(previous => ({ ...previous, [key]: value }));
    setLimit(25);
  };
  const reset = () => { setFilters(emptyFilters); setLimit(25); };
  return (
    <div className="admin-ops">
      <OperationsChart daily={data.daily ?? []} asOf={data.as_of} />
      <section className="admin-ops-panel" aria-labelledby="ops-history-title">
        <header className="admin-ops-header">
          <div><h2 id="ops-history-title">История операций</h2><p>Последние {rows.length} записей раздела · UTC</p></div>
          <span className="admin-ops-count">{filtered.length} найдено</span>
        </header>
        <div className="admin-ops-tabs" aria-label="Разделы операций">
          {(Object.keys(sources) as (keyof typeof sources)[]).map(key => (
            <button type="button" aria-pressed={source === key} key={key} onClick={() => { setSource(key); reset(); }}>{sources[key]}</button>
          ))}
        </div>
        <div className="admin-ops-searchbar">
          <label className="admin-ops-search"><Search size={17} aria-hidden="true" /><input aria-label="Поиск" placeholder="ID операции, пользователь, получатель или хеш" value={filters.query} onChange={e => update("query", e.target.value)} /></label>
          <button type="button" className="admin-ops-reset" aria-expanded={advanced} aria-controls="admin-ops-filters" onClick={() => setAdvanced(!advanced)}><SlidersHorizontal size={16} /> Фильтры</button>
          <button type="button" className="admin-ops-reset" onClick={reset}>Сбросить</button>
        </div>
        <div className="admin-ops-filters" id="admin-ops-filters" hidden={!advanced}>
          <div className="admin-ops-filter-group"><label>Тип<select value={filters.type} onChange={e => update("type", e.target.value)}><option value="">Все типы</option>{[...types].map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
          <label>Статус<select aria-label="Статус" value={filters.status} onChange={e => update("status", e.target.value)}><option value="">Все статусы</option>{states.map(state => <option key={state} value={state}>{statuses[state] ?? state}</option>)}</select></label>
          <label>Валюта<select value={filters.asset} onChange={e => update("asset", e.target.value)}><option value="">Все валюты</option>{assets.map(code => <option key={code}>{code}</option>)}</select></label>
          </div><div className="admin-ops-filter-group admin-ops-filter-range"><label>Дата с<input type="date" value={filters.from} onChange={e => update("from", e.target.value)} /></label>
          <label>Дата по<input type="date" value={filters.to} onChange={e => update("to", e.target.value)} /></label>
          <label>Сумма от<input type="number" min="0" step="any" value={filters.min} onChange={e => update("min", e.target.value)} /></label>
          <label>Сумма до<input type="number" min="0" step="any" value={filters.max} onChange={e => update("max", e.target.value)} /></label>
        </div>
        </div>
        <AdminOperationList visible={filtered.slice(0, limit)} relatedRows={rows} showRevenue={source === "events"} />
        {filtered.length > limit && <button className="admin-ops-reset" type="button" onClick={() => setLimit(limit + 25)}>Показать ещё</button>}
      </section>
    </div>
  );
}


type AdminOperation = ReturnType<typeof normalize>;

function AdminOperationList({ visible, relatedRows, showRevenue, compact = false }: {
  visible: AdminOperation[];
  relatedRows: AdminOperation[];
  showRevenue: boolean;
  compact?: boolean;
}) {
  const titleId = useId();
  const [selected, setSelected] = useState<AdminOperation | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (selected && dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector("h2")?.focus({ preventScroll: true });
    }
  }, [selected]);
  return (
    <div className="admin-ops-list">
      {visible.length && compact ? (
        <ul className="admin-ops-compact-list">
          {visible.map(row => (
            <li key={row.id}>
              <button type="button" className="admin-ops-open admin-ops-compact-row admin-ops-operation"
                onClick={() => setSelected(row)} title={row.title}>
                <TransactionAvatar kind={row.model.kind} positive={(row.amount ?? 0) > 0} compact />
                <span className="admin-ops-compact-title">
                  <strong>{row.title}</strong>
                  <small>{row.day ? new Date(row.stamp).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }) : "—"}{row.status && ` · ${statuses[row.status] ?? row.status}`}</small>
                </span>
                <span className="admin-ops-compact-amount">
                  {row.amount === null ? "—" : `${row.amount > 0 ? "+" : ""}${fmt.format(row.amount)} ${row.asset}`}
                </span>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : visible.length ? (
        <div className="admin-ops-table">
          <table><thead><tr><th>Операция</th><th>Пользователь / ID</th><th>Статус</th><th>Сумма</th>{showRevenue && <th>Доход wPay</th>}</tr></thead>
            <tbody>{visible.map(row => (
              <tr key={row.id} onClick={() => setSelected(row)}>
                <td><div className="admin-ops-operation"><TransactionAvatar kind={row.model.kind} positive={(row.amount ?? 0) > 0} compact /><div><button type="button" className="admin-ops-open" onClick={event => { event.stopPropagation(); setSelected(row); }}><strong>{row.title}</strong><ChevronRight size={14} /></button><small title={row.reference || undefined}>{row.day ? new Date(row.stamp).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }) : "—"}{row.reference && ` · ${row.reference}`}</small></div></div></td>
                <td><strong>{row.user || "—"}</strong><small title={row.id}>{row.id || "—"}</small></td>
                <td>{row.status ? <span className="admin-ops-status" data-state={row.status}>{statuses[row.status] ?? row.status}</span> : "—"}</td>
                <td className="admin-ops-amount">{row.amount !== null && Number.isFinite(row.amount) ? `${row.amount > 0 ? "+" : ""}${fmt.format(row.amount)} ${row.asset}` : "—"}</td>
                {showRevenue && <td className="admin-ops-amount">{row.revenue == null ? "—" : `${fmt.format(row.revenue)} ${row.asset}`}</td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="admin-ops-empty">По этим условиям операций нет.</p>}
      <dialog className="admin-ops-dialog" ref={dialogRef} onClose={() => setSelected(null)} aria-labelledby={titleId}>
        <header>
          <h2 id={titleId} tabIndex={-1}>Подробности операции</h2>
          <button type="button" className="admin-ops-close" aria-label="Закрыть детали операции" onClick={() => dialogRef.current?.close()}><X size={18} /></button>
        </header>
        {selected && <OperationRecord key={selected.id} record={selected} related={relatedRows.filter(row => (
          row.id === selected.id || selected.operationKey && row.operationKey === selected.operationKey && row.user === selected.user
        ))} />}
      </dialog>
    </div>
  );
}

export function AdminUserOperationHistory({ events }: { events: Row[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const rows = events.map(row => normalize(row, "events"));
  const kinds = new Map(rows.map(row => [row.model.kind, row.title]));
  const states = [...new Set(rows.map(row => row.status).filter(Boolean))];
  const needle = query.trim().toLowerCase();
  const visible = rows.filter(row =>
    (!kind || row.model.kind === kind) &&
    (!status || row.status === status) &&
    (!needle || [row.title, row.id, row.reference, row.asset, row.amount].join(" ").toLowerCase().includes(needle)),
  );
  return <>
    <div className="admin-ops-compact-tools">
      <label className="admin-ops-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" aria-label="Поиск операций пользователя" placeholder="Название, ID или хеш" value={query} onChange={e => setQuery(e.target.value)} />
      </label>
      <select aria-label="Тип операции" value={kind} onChange={e => setKind(e.target.value)}>
        <option value="">Все типы</option>
        {[...kinds].map(([code, title]) => <option key={code} value={code}>{title}</option>)}
      </select>
      <select aria-label="Статус операции" value={status} onChange={e => setStatus(e.target.value)}>
        <option value="">Все статусы</option>
        {states.map(code => <option key={code} value={code}>{statuses[code] ?? code}</option>)}
      </select>
    </div>
    <AdminOperationList visible={visible} relatedRows={rows} showRevenue compact />
  </>;
}
