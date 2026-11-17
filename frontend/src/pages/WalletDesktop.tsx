import { Wallet, CreditCard, Clock3, UserRound, Sun, Moon, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, Bell, Headphones } from 'lucide-react'
import { useEffect, useState } from 'react'
import { walletRequest } from '../lib/wallet-api'
import { useLiveWallet, cryptoAmount, usd, usdPrice } from './WalletLive'

type Tab = "wallet" | "cards" | "history" | "profile";

const desktopLinks = [
  { id: "wallet", label: "Кошелёк", Icon: Wallet },
  { id: "cards", label: "Карты", Icon: CreditCard },
  { id: "history", label: "История", Icon: Clock3 },
  { id: "profile", label: "Профиль", Icon: UserRound },
] as const;

export function DesktopSidebar({
  tab, onSelect, dark, onTheme, name, cardsEnabled,
}: {
  tab: Tab;
  onSelect: (tab: Tab) => void;
  dark: boolean;
  onTheme: () => void;
  name: string;
  cardsEnabled: boolean;
}) {
  const ThemeIcon = dark ? Sun : Moon;
  const items = desktopLinks.filter(({ id }) => id !== "cards" || cardsEnabled);

  return (
    <aside className="wpay-desktop-sidebar">
      <button type="button" className="wpay-desktop-brand" onClick={() => onSelect("wallet")}>
        <img src={dark ? "/brands/wpay-wordmark-light.svg" : "/brands/wpay-wordmark.svg"} alt="wPay" width={104} height={43} />
      </button>
      <nav aria-label="Основное меню">
        {items.map(({ id, label, Icon }) => (
          <button type="button" key={id} aria-current={tab === id ? "page" : undefined} onClick={() => onSelect(id)}>
            <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="wpay-desktop-sidebar-footer">
        <button type="button" className="wpay-desktop-theme" onClick={onTheme}>
          <ThemeIcon size={18} aria-hidden="true" />
          {dark ? "Светлая тема" : "Тёмная тема"}
        </button>
        <button type="button" className="wpay-desktop-user" onClick={() => onSelect("profile")}>
          <span className="wpay-desktop-user-initial" aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || "W"}</span>
          <strong>{name}</strong>
        </button>
      </div>
    </aside>
  );
}

export function DesktopOverview({onHistory,onDeposit,onExchange}:{onHistory:()=>void;onDeposit:()=>void;onExchange:()=>void}){
 const wallet=useLiveWallet()
 const transactions=wallet.data.transactions.slice(0,4)
 return <aside className="wpay-desktop-overview-side"><section className="wpay-desktop-card"><div className="wpay-desktop-section-head"><h2>Последние операции</h2><button type="button" onClick={onHistory}>Все <ArrowUpRight size={15}/></button></div>{transactions.length?transactions.map(item=><button type="button" className="wpay-desktop-transaction" key={item.event_id} onClick={onHistory}><span className={Number(item.amount)>0?'income':''}>{Number(item.amount)>0?<ArrowDownLeft size={19}/>:<ArrowUpRight size={19}/>}</span><span><strong>{item.type==='deposit'?'Пополнение':String(item.detail.merchant_name??'Платёж')}</strong><small>{new Date(item.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</small></span><b>{Number(item.amount)>0?'+':''}{cryptoAmount(item.amount)}<small>{item.asset}</small></b></button>):<div className="wpay-desktop-empty"><Clock3 size={30} strokeWidth={1.5}/><strong>Пока без операций</strong><p>Пополнения и платежи появятся здесь.</p></div>}</section><section className="wpay-desktop-card"><div className="wpay-desktop-section-head"><h2>На рынке</h2><span>USD</span></div>{['BTC','ETH','SOL'].map(code=><div className="wpay-desktop-rate" key={code}><span>{code}</span><strong>{wallet.rate(code)!==null?usdPrice(wallet.rate(code)!):'—'}</strong></div>)}</section><section className="wpay-desktop-quick"><span className="wpay-desktop-quick-icon"><ArrowLeftRight size={24}/></span><h2>Ваши активы.<br/>Ваши возможности.</h2><p>Пополняйте кошелёк и управляйте валютами в одном месте.</p><button type="button" onClick={onDeposit}>Пополнить кошелёк <ArrowUpRight size={17}/></button><button type="button" onClick={onExchange}>Перейти к обмену <ArrowUpRight size={17}/></button></section></aside>
}


export function DesktopProfileAside({
  walletBalance, balanceHidden, cardsEnabled, onWallet, onCards, onSupport, onNotifications,
}: {
  walletBalance: number | null;
  balanceHidden: boolean;
  cardsEnabled: boolean;
  onWallet: () => void;
  onCards: () => void;
  onSupport: () => void;
  onNotifications: () => void;
}) {
  const [cardBalance, setCardBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!cardsEnabled || balanceHidden) return;
    const desktop = window.matchMedia("(min-width: 1100px)");
    let request: AbortController | undefined;
    const update = () => {
      request?.abort();
      setCardBalance(null);
      if (!desktop.matches) return;
      const controller = new AbortController();
      request = controller;
      void walletRequest<{ data: { status: string; balance?: string | null; currency?: string }[] }>(
        "aura-cards", undefined, controller.signal,
      ).then(({ data }) => {
        if (controller.signal.aborted) return;
        const cards = data.filter((card) => card.status === "opened");
        if (cards.length === 0) {
          setCardBalance("Нет активных карт");
          return;
        }
        let total = 0;
        for (const card of cards) {
          if (!card.balance?.trim() || !Number.isFinite(Number(card.balance))) return;
          if (card.currency && !["USD", "USDT"].includes(card.currency)) return;
          total += Number(card.balance);
        }
        setCardBalance(usd(total));
      }).catch(() => {
        // Leave the amount unavailable if the card service cannot report it.
      });
    };
    update();
    desktop.addEventListener("change", update);
    return () => {
      request?.abort();
      desktop.removeEventListener("change", update);
    };
  }, [cardsEnabled, balanceHidden]);

  return (
    <aside className="wpay-desktop-profile-aside" aria-label="Сводка по балансам">
      <section className="wpay-desktop-card">
        <div className="wpay-desktop-section-head"><h2>Мои балансы</h2></div>
        <button type="button" className="wpay-desktop-rate wpay-profile-balance-row" onClick={onWallet}>
          <span>Кошелёк</span>
          <strong>{balanceHidden ? "••••••" : walletBalance === null ? "—" : usd(walletBalance)}</strong>
        </button>
        {cardsEnabled && (
          <button type="button" className="wpay-desktop-rate wpay-profile-balance-row" onClick={onCards}>
            <span>На картах</span>
            <strong>{balanceHidden ? "••••••" : cardBalance ?? "—"}</strong>
          </button>
        )}
      </section>
      <UsdRubChart />
      <section className="wpay-desktop-card wpay-desktop-profile-balances">
        <div className="wpay-desktop-section-head"><h2>Помощь и настройки</h2></div>
        <button type="button" onClick={onSupport}>
          <span className="wpay-profile-shortcut-icon is-support"><Headphones aria-hidden="true" /></span>
          <span>Поддержка</span>
          <ArrowUpRight size={16} aria-hidden="true" />
        </button>
        <button type="button" onClick={onNotifications}>
          <span className="wpay-profile-shortcut-icon is-notifications"><Bell aria-hidden="true" /></span>
          <span>Уведомления</span>
          <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      </section>
    </aside>
  );
}


type RubleRate = { date: string; rate: number };

const formatRubles = (rate: number) =>
  rate.toLocaleString("ru-RU", { style: "currency", currency: "RUB" });
const formatRateDate = (date: string) =>
  new Date(date + "T00:00:00Z").toLocaleDateString("ru-RU", {
    day: "numeric", month: "short", timeZone: "UTC",
  });

function UsdRubChart() {
  const [rates, setRates] = useState<RubleRate[] | null>(null);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1100px)");
    let request: AbortController | undefined;
    const update = () => {
      request?.abort();
      if (!desktop.matches) return;
      const controller = new AbortController();
      request = controller;
      const now = Date.now();
      const day = (offset: number) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
      const query = new URLSearchParams({ base: "USD", quotes: "RUB", from: day(-30), to: day(0) });
      void fetch("https://api.frankfurter.dev/v2/providers/cbr/rates?" + query, {
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) throw new Error("Rate history unavailable");
        return response.json();
      }).then((history) => {
        if (!Array.isArray(history)) throw new Error("Unexpected rate history");
        const entries = history.filter((point): point is RubleRate =>
          point && typeof point.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(point.date) &&
          Number.isFinite(Date.parse(point.date)) && Number.isFinite(point.rate) && point.rate > 0,
        ).sort((left, right) => left.date.localeCompare(right.date));
        if (!controller.signal.aborted) setRates(entries);
      }).catch(() => {
        if (!controller.signal.aborted) setRates([]);
      });
    };
    update();
    desktop.addEventListener("change", update);
    return () => {
      request?.abort();
      desktop.removeEventListener("change", update);
    };
  }, []);

  const first = rates?.[0];
  const last = rates?.at(-1);
  let points = "";
  if (rates && first && last && last.date > first.date) {
    const start = Date.parse(first.date);
    const duration = Date.parse(last.date) - start;
    const values = rates.map(({ rate }) => rate);
    const min = Math.min(...values);
    const max = Math.max(...values);
    points = rates.map(({ date, rate }) => {
      const x = 2 + 256 * (Date.parse(date) - start) / duration;
      const y = max === min ? 44 : 8 + 72 * (max - rate) / (max - min);
      return `${x},${y}`;
    }).join(" ");
  }

  return (
    <section className="wpay-desktop-card wpay-desktop-fx" aria-label="Курс доллара к рублю">
      <div className="wpay-desktop-section-head"><h2>Доллар к рублю</h2><span>USD/RUB</span></div>
      {last ? (
        <>
          <div className="wpay-desktop-fx-value">{formatRubles(last.rate)}</div>
          {points && (
            <>
              <svg viewBox="0 0 260 88" role="img" aria-label="Динамика официального курса за месяц">
                <path d="M0 24H260 M0 52H260 M0 80H260" className="wpay-desktop-fx-grid" />
                <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              {first && <div className="wpay-desktop-fx-dates"><span>{formatRateDate(first.date)}</span><span>{formatRateDate(last.date)}</span></div>}
            </>
          )}
          <a href="https://frankfurter.dev/providers/cbr/" target="_blank" rel="noreferrer">
            Официальный курс ЦБ РФ · {formatRateDate(last.date)}
          </a>
        </>
      ) : (
        <p className="wpay-desktop-fx-status" role="status">{rates === null ? "Загружаем курс…" : "История курса недоступна"}</p>
      )}
    </section>
  );
}
