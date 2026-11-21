import { useState } from "react";
import {
  Activity, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CreditCard,
  QrCode, ReceiptText, Search, TrendingUp,
} from "lucide-react";
import "./WalletAdminOperations.css";

type Row = Record<string, unknown>;
type Daily = { day: string; asset: string; volume: string; revenue: string; count: number };
const sources = {
  events: "Журнал операций", quotes: "Котировки", invoices: "Счета",
  transfers: "Переводы", withdrawals: "Заявки на вывод",
} as const;
export type AdminOperationsData = Record<keyof typeof sources, Row[]> & { daily?: Daily[] };

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
const dateFor = (offset: number) => isoDay(new Date(Date.now() + offset * 86400000));
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
  const icon = type.startsWith("card") ? CreditCard : type.startsWith("qr_") ? QrCode
    : type.startsWith("withdrawal") ? ArrowUpRight : type.startsWith("deposit") ? ArrowDownLeft
    : type.startsWith("exchange") || type.startsWith("transfer") ? ArrowLeftRight : ReceiptText;
  const rawDate = row.created_at ?? row.updated_at;
  const stamp = typeof rawDate === "number" ? rawDate * 1000 : Date.parse(s(rawDate));
  const asset = s(row.asset || detail.asset);
  const rawAmount = type === "exchange_internal" ? detail.amount ?? row.amount : row.amount;
  const amount = rawAmount == null || rawAmount === "" ? null : Number(rawAmount);
  return {
    id: s(row.event_id || row.operation_id || row.spend_id || row.quote_id || row.invoice_id || row.id || row.rowid),
    user: s(row.user_id), type, title, status, icon, asset, amount, stamp,
    day: Number.isFinite(stamp) ? isoDay(new Date(stamp)) : "",
    reference: [detail.merchant_name, detail.network, detail.operation_id, detail.payment_id, detail.order_id, detail.tx_hash, detail.transaction_hash, row.withdrawal_id].map(s).filter(Boolean).join(" · "),
  };
}

function OperationsChart({ daily }: { daily: Daily[] }) {
  const [days, setDays] = useState(7);
  const [selected, setSelected] = useState("");
  const [metric, setMetric] = useState<"volume" | "revenue">("volume");
  const assets = [...new Set(daily.map(row => row.asset))].sort();
  const asset = selected || (assets.includes("USDT") ? "USDT" : assets[0] || "USDT");
  const byDay = new Map(daily.filter(row => row.asset === asset).map(row => [row.day, row]));
  const series = Array.from({ length: days }, (_, index) => {
    const day = dateFor(index - days + 1);
    const row = byDay.get(day);
    return { day, volume: Number(row?.volume ?? 0), revenue: Number(row?.revenue ?? 0), count: row?.count ?? 0 };
  });
  const total = series.reduce((sum, row) => ({ volume: sum.volume + row.volume,
    revenue: sum.revenue + row.revenue, count: sum.count + row.count }), { volume: 0, revenue: 0, count: 0 });
  const values = series.map(row => row[metric]);
  const ceiling = Math.max(0, ...values);
  const floor = Math.min(0, ...values);
  const range = ceiling - floor || 1;
  const chartLabel = metric === "volume" ? "Оборот" : "Доход от комиссий карт";
  const x = (index: number) => 62 + index * (808 / (series.length - 1));
  const y = (value: number) => 175 - (value - floor) / range * 150;
  const line = series.map((row, index) => `${x(index)},${y(row[metric])}`).join(" ");
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
        <div><span><TrendingUp size={15} /> Доход от комиссий карт</span><strong>{fmt.format(total.revenue)} <small>{asset}</small></strong></div>
        <div><span><ReceiptText size={15} /> Выполнено операций</span><strong>{fmt.format(total.count)}</strong></div>
      </div>
      {total.count === 0 && values.every(value => value === 0) ? <p className="admin-ops-empty">За этот период завершённых операций нет.</p> : (
        <svg className="admin-ops-chart" viewBox="0 0 900 205" role="img" aria-label={`${chartLabel} по дням, ${asset}`}>
          <defs><linearGradient id="admin-ops-volume" x2="0" y2="1"><stop stopColor="#208675" stopOpacity=".27" /><stop offset="1" stopColor="#208675" stopOpacity="0" /></linearGradient></defs>
          {[0, 1, 2, 3, 4].map(step => {
            const value = floor + range * step / 4;
            return <g key={step}><line x1="62" x2="870" y1={y(value)} y2={y(value)} /><text x="55" y={y(value) + 4} textAnchor="end">{Intl.NumberFormat("ru", { notation: "compact", maximumFractionDigits: 2 }).format(value)}</text></g>;
          })}
          <polygon points={`62,${y(0)} ${line} 870,${y(0)}`} fill="url(#admin-ops-volume)" />
          <polyline points={line} fill="none" stroke="#208675" strokeWidth="2.5" strokeLinejoin="round" />
          {series.map((row, index) => (index % Math.ceil(days / 7) === 0 || index === series.length - 1) && (
            <g key={row.day}><circle cx={x(index)} cy={y(row[metric])} r="4" fill="var(--admin-surface)" stroke="#208675" strokeWidth="2"><title>{row.day} · оборот {fmt.format(row.volume)} {asset} · комиссии {fmt.format(row.revenue)} {asset}</title></circle><text x={x(index)} y="197" textAnchor="middle">{dayFmt.format(new Date(row.day))}</text></g>
          ))}
        </svg>
      )}
      <p className="admin-ops-note">Оборот — сумма абсолютных значений операций. Доход — комиссии wPay за выпуск и пополнение карт за вычетом возвратов выпуска, без учёта прочих доходов и расходов.</p>
    </section>
  );
}

export function AdminOperations({ data }: { data: AdminOperationsData }) {
  const [source, setSource] = useState<keyof typeof sources>("events");
  const [filters, setFilters] = useState(emptyFilters);
  const [limit, setLimit] = useState(25);
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
      <OperationsChart daily={data.daily ?? []} />
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
        <div className="admin-ops-filters">
          <label className="admin-ops-search"><span>Поиск</span><div><Search size={17} /><input placeholder="ID, пользователь, получатель или хеш" value={filters.query} onChange={e => update("query", e.target.value)} /></div></label>
          <label>Тип<select value={filters.type} onChange={e => update("type", e.target.value)}><option value="">Все типы</option>{[...types].map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
          <label>Статус<select value={filters.status} onChange={e => update("status", e.target.value)}><option value="">Все статусы</option>{states.map(state => <option key={state} value={state}>{statuses[state] ?? state}</option>)}</select></label>
          <label>Валюта<select value={filters.asset} onChange={e => update("asset", e.target.value)}><option value="">Все валюты</option>{assets.map(code => <option key={code}>{code}</option>)}</select></label>
          <label>Дата с<input type="date" value={filters.from} onChange={e => update("from", e.target.value)} /></label>
          <label>Дата по<input type="date" value={filters.to} onChange={e => update("to", e.target.value)} /></label>
          <label>Сумма от<input type="number" min="0" step="any" value={filters.min} onChange={e => update("min", e.target.value)} /></label>
          <label>Сумма до<input type="number" min="0" step="any" value={filters.max} onChange={e => update("max", e.target.value)} /></label>
          <button type="button" className="admin-ops-reset" onClick={reset}>Сбросить</button>
        </div>
        {filtered.length ? (
          <div className="admin-ops-table">
            <table><thead><tr><th>Операция</th><th>Пользователь / ID</th><th>Статус</th><th>Сумма</th></tr></thead>
              <tbody>{filtered.slice(0, limit).map(row => (
                <tr key={row.id}>
                  <td><div className="admin-ops-operation"><span className="admin-ops-icon" data-income={(row.amount ?? 0) > 0}><row.icon size={19} /></span><div><strong>{row.title}</strong><small title={row.reference || undefined}>{row.day ? new Date(row.stamp).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }) : "—"}{row.reference && ` · ${row.reference}`}</small></div></div></td>
                  <td><strong>{row.user || "—"}</strong><small title={row.id}>{row.id || "—"}</small></td>
                  <td>{row.status ? <span className="admin-ops-status" data-state={row.status}>{statuses[row.status] ?? row.status}</span> : "—"}</td>
                  <td className="admin-ops-amount">{row.amount !== null && Number.isFinite(row.amount) ? `${row.amount > 0 ? "+" : ""}${fmt.format(row.amount)} ${row.asset}` : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="admin-ops-empty">По этим условиям операций нет.</p>}
        {filtered.length > limit && <button className="admin-ops-reset" type="button" onClick={() => setLimit(limit + 25)}>Показать ещё</button>}
      </section>
    </div>
  );
}
