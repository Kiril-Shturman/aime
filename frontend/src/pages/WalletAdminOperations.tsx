import { useEffect, useId, useRef, useState } from "react";
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
  const [days, setDays] = useState(7);
  const [selected, setSelected] = useState("");
  const gradient = useId();
  const [highlight, setHighlight] = useState<number | null>(null);
  const [metric, setMetric] = useState<"volume" | "revenue">("volume");
  const assets = [...new Set(daily.map(row => row.asset))].sort();
  const asset = selected || (assets.includes("USDT") ? "USDT" : assets[0] || "USDT");
  const anchor = Date.parse(asOf ?? daily.at(-1)?.day ?? "") || Date.now();
  const byDay = new Map(daily.filter(row => row.asset === asset).map(row => [row.day, row]));
  const series = Array.from({ length: days }, (_, index) => {
    const day = dateFor(anchor, index - days + 1);
    const row = byDay.get(day);
    return { day, volume: Number(row?.volume ?? 0), revenue: Number(row?.revenue ?? 0), count: row?.count ?? 0 };
  });
  const total = series.reduce((sum, row) => ({ volume: sum.volume + row.volume,
    revenue: sum.revenue + row.revenue, count: sum.count + row.count }), { volume: 0, revenue: 0, count: 0 });
  const values = series.map(row => row[metric]);
  const ceiling = Math.max(0, ...values);
  const floor = Math.min(0, ...values);
  const range = ceiling - floor || 1;
  const chartLabel = metric === "volume" ? "Оборот" : "Доход от комиссий";
  const x = (index: number) => 4 + index * (892 / (series.length - 1));
  const y = (value: number) => 175 - (value - floor) / range * 147;
  const line = series.map((row, index) => `${x(index)},${y(row[metric])}`).join(" ");
  const point = highlight === null ? null : series[highlight];
  return (
    <section className="admin-ops-panel" aria-labelledby="ops-chart-title">
      <header className="admin-ops-header">
        <div><h2 id="ops-chart-title">Оборот и доход</h2><p>Завершённые операции журнала wPay · UTC</p></div>
        <div className="admin-ops-controls">
          <select aria-label="Показатель графика" value={metric} onChange={e => setMetric(e.target.value === "revenue" ? "revenue" : "volume")}>
            <option value="volume">Оборот</option><option value="revenue">Доход</option>
          </select>
          <select aria-label="Период графика" value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value="7">7 дней</option><option value="30">30 дней</option><option value="90">90 дней</option>
          </select>
          <select aria-label="Валюта графика" value={asset} onChange={e => setSelected(e.target.value)}>
            {(assets.length ? assets : [asset]).map(code => <option key={code}>{code}</option>)}
          </select>
        </div>
      </header>
      <div className="admin-ops-metrics">
        <div><span><Activity size={15} /> Оборот по журналу</span><strong>{fmt.format(total.volume)} <small>{asset}</small></strong></div>
        <div><span><TrendingUp size={15} /> Доход от комиссий</span><strong>{fmt.format(total.revenue)} <small>{asset}</small></strong></div>
        <div><span><ReceiptText size={15} /> Выполнено операций</span><strong>{fmt.format(total.count)}</strong></div>
      </div>
      {total.count === 0 && values.every(value => value === 0) ? <p className="admin-ops-empty">За этот период завершённых операций нет.</p> : (
        <div className="admin-ops-plot">
          <div className="admin-ops-chart-caption">
            {point ? `${dayFmt.format(new Date(point.day))} · ${fmt.format(point[metric])} ${asset}` : `${chartLabel} по дням`}
          </div>
          <svg className="admin-ops-chart" preserveAspectRatio="none" viewBox="0 0 900 205" role="img" aria-label={`${chartLabel} по дням, ${asset}`}
            onPointerMove={event => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const index = Math.round((event.clientX - bounds.left) / bounds.width * (series.length - 1));
              setHighlight(Math.min(series.length - 1, Math.max(0, index)));
            }} onPointerLeave={() => setHighlight(null)}>
            <defs><linearGradient id={gradient} x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".16" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
            {[0, 1, 2, 3].map(step => {
              const value = floor + range * step / 3;
              return <g key={step}><line x1="4" x2="896" y1={y(value)} y2={y(value)} /><text x="895" y={y(value) - 5} textAnchor="end">{fmt.format(value)}</text></g>;
            })}
            <polygon points={`4,${y(0)} ${line} 896,${y(0)}`} fill={`url(#${gradient})`} />
            <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            {point && highlight !== null && <g><line x1={x(highlight)} x2={x(highlight)} y1="25" y2="175" /><circle cx={x(highlight)} cy={y(point[metric])} r="4" fill="currentColor" /></g>}
            <text x="4" y="198">{dayFmt.format(new Date(series[0].day))}</text>
            <text x="896" y="198" textAnchor="end">{dayFmt.format(new Date(series[series.length - 1].day))}</text>
          </svg>
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
  const [selected, setSelected] = useState<ReturnType<typeof normalize> | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selected && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [selected]);
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
        {filtered.length ? (
          <div className="admin-ops-table">
            <table><thead><tr><th>Операция</th><th>Пользователь / ID</th><th>Статус</th><th>Сумма</th>{source === "events" && <th>Доход wPay</th>}</tr></thead>
              <tbody>{filtered.slice(0, limit).map(row => (
                <tr key={row.id} onClick={() => setSelected(row)}>
                  <td><div className="admin-ops-operation"><TransactionAvatar kind={row.model.kind} positive={(row.amount ?? 0) > 0} compact /><div><button type="button" className="admin-ops-open" onClick={event => { event.stopPropagation(); setSelected(row); }}><strong>{row.title}</strong><ChevronRight size={14} /></button><small title={row.reference || undefined}>{row.day ? new Date(row.stamp).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }) : "—"}{row.reference && ` · ${row.reference}`}</small></div></div></td>
                  <td><strong>{row.user || "—"}</strong><small title={row.id}>{row.id || "—"}</small></td>
                  <td>{row.status ? <span className="admin-ops-status" data-state={row.status}>{statuses[row.status] ?? row.status}</span> : "—"}</td>
                  <td className="admin-ops-amount">{row.amount !== null && Number.isFinite(row.amount) ? `${row.amount > 0 ? "+" : ""}${fmt.format(row.amount)} ${row.asset}` : "—"}</td>
                  {source === "events" && <td className="admin-ops-amount">{row.revenue == null ? "—" : `${fmt.format(row.revenue)} ${row.asset}`}</td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="admin-ops-empty">По этим условиям операций нет.</p>}
        {filtered.length > limit && <button className="admin-ops-reset" type="button" onClick={() => setLimit(limit + 25)}>Показать ещё</button>}
      </section>
      <dialog className="admin-ops-dialog" ref={dialogRef} onClose={() => setSelected(null)} aria-labelledby="admin-ops-dialog-title">
        <header>
          <h2 id="admin-ops-dialog-title">Подробности операции</h2>
          <button type="button" className="admin-ops-reset" aria-label="Закрыть детали операции" onClick={() => dialogRef.current?.close()}><X size={18} /></button>
        </header>
        {selected && <OperationRecord key={selected.id} record={selected} related={rows.filter(row => (
          row.id === selected.id || selected.operationKey && row.operationKey === selected.operationKey && row.user === selected.user
        ))} />}
      </dialog>
    </div>
  );
}
