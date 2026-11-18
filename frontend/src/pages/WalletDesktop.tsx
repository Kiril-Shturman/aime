import { Clock3, Sun, Moon, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, Bell, Headphones } from 'lucide-react'
import { useEffect, useState } from 'react'
import desktopWalletIcon from '../assets/desktop-wallet-icon.svg?raw'
import desktopCardsIcon from '../assets/desktop-cards-icon.svg?raw'
import desktopHistoryIcon from '../assets/desktop-history-icon.svg?raw'
import desktopProfileIcon from '../assets/desktop-profile-icon.svg?raw'
import desktopReferralIcon from '../assets/desktop-referral-icon.svg?raw'
import desktopSupportIcon from '../assets/desktop-support-icon.svg?raw'
import { walletRequest } from '../lib/wallet-api'
import { useLiveWallet, cryptoAmount, usd, usdPrice } from './WalletLive'

type Tab = "wallet" | "cards" | "history" | "profile";
type SidebarPage = "referral" | "support";

const desktopLinks = [
  { id: "wallet", label: "Кошелёк", icon: desktopWalletIcon },
  { id: "cards", label: "Карты", icon: desktopCardsIcon },
  { id: "history", label: "История", icon: desktopHistoryIcon },
  { id: "profile", label: "Профиль", icon: desktopProfileIcon },
  { id: "referral", label: "Реферальная программа", icon: desktopReferralIcon },
  { id: "support", label: "Поддержка", icon: desktopSupportIcon },
] as const;

export function DesktopSidebar({
  tab, onSelect, onOpenPage, dark, onTheme, name, username, photoUrl, cardsEnabled,
}: {
  tab: Tab;
  onSelect: (tab: Tab) => void;
  onOpenPage: (page: SidebarPage) => void;
  dark: boolean;
  onTheme: () => void;
  name: string;
  username?: string;
  photoUrl?: string;
  cardsEnabled: boolean;
}) {
  const [animation, setAnimation] = useState<{ tab: Tab | SidebarPage; count: number } | null>(null);
  const ThemeIcon = dark ? Sun : Moon;
  const items = desktopLinks.filter(({ id }) => id !== "cards" || cardsEnabled);

  return (
    <aside className="wpay-desktop-sidebar">
      <button type="button" className="wpay-desktop-brand" onClick={() => onSelect("wallet")}>
        <img src={dark ? "/brands/wpay-wordmark-light.svg" : "/brands/wpay-wordmark.svg"} alt="wPay" width={104} height={43} />
      </button>
      <nav aria-labelledby="wpay-desktop-nav-heading">
        <h2 id="wpay-desktop-nav-heading" className="wpay-desktop-nav-heading">Основное</h2>
        {items.map(({ id, label, icon }) => (
          <button type="button" key={id} aria-current={tab === id ? "page" : undefined} onClick={() => {
            setAnimation((previous) => ({ tab: id, count: (previous?.count ?? 0) + 1 }));
            if (id === "referral" || id === "support") onOpenPage(id);
            else onSelect(id);
          }}>
            <span
              key={animation?.tab === id ? animation.count : 0}
              aria-hidden="true"
              className="wpay-desktop-nav-icon"
              data-playing={animation?.tab === id ? "" : undefined}
              dangerouslySetInnerHTML={{ __html: icon }}
            />
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
          <span className="wpay-desktop-user-initial" aria-hidden="true">
            {name.trim().slice(0, 1).toUpperCase() || "W"}
            {photoUrl && (
              <img key={photoUrl} src={photoUrl} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
            )}
          </span>
          <span className="wpay-desktop-user-details">
            <strong>{name}</strong>
            {username && <small>@{username}</small>}
          </span>
        </button>
      </div>
    </aside>
  );
}

export function DesktopOverview({onHistory,onDeposit,onExchange}:{onHistory:()=>void;onDeposit:()=>void;onExchange:()=>void}){
 const wallet=useLiveWallet()
 const transactions=wallet.data.transactions.slice(0,4)
 return <aside className="wpay-desktop-overview-side"><section className="wpay-desktop-card"><div className="wpay-desktop-section-head"><h2>Последние операции</h2><button type="button" onClick={onHistory}>Все <ArrowUpRight size={15}/></button></div>{transactions.length?transactions.map(item=><button type="button" className="wpay-desktop-transaction" key={item.event_id} onClick={onHistory}><span className={Number(item.amount)>0?'income':''}>{Number(item.amount)>0?<ArrowDownLeft size={19}/>:<ArrowUpRight size={19}/>}</span><span><strong>{item.type==='deposit'?'Пополнение':String(item.detail.merchant_name??'Платёж')}</strong><small>{new Date(item.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</small></span><b>{Number(item.amount)>0?'+':''}{cryptoAmount(item.amount)}<small>{item.asset}</small></b></button>):<div className="wpay-desktop-empty"><Clock3 size={30} strokeWidth={1.5}/><strong>Пока без операций</strong><p>Пополнения и платежи появятся здесь.</p></div>}</section><section className="wpay-desktop-card"><div className="wpay-desktop-section-head"><h2>На рынке</h2><span>USD</span></div>{['BTC','ETH','SOL'].map(code=><div className="wpay-desktop-rate" key={code}><span>{code}</span><strong>{wallet.rate(code)!==null?usdPrice(wallet.rate(code)!):'—'}</strong></div>)}</section><CbrRate /><section className="wpay-desktop-quick"><span className="wpay-desktop-quick-icon"><ArrowLeftRight size={24}/></span><h2>Ваши активы.<br/>Ваши возможности.</h2><p>Пополняйте кошелёк и управляйте валютами в одном месте.</p><button type="button" onClick={onDeposit}>Пополнить кошелёк <ArrowUpRight size={17}/></button><button type="button" onClick={onExchange}>Перейти к обмену <ArrowUpRight size={17}/></button></section></aside>
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
      <RapiraDepth />
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


type OrderLevel = { price: string; amount: string };
type OrderBook = { ask: OrderLevel[]; bid: OrderLevel[] };
type OfficialRate = { rate: string; date: string };

const formatRubles = (rate: string) =>
  Number(rate).toLocaleString("ru-RU", { style: "currency", currency: "RUB" });

function useDesktopMarket<T>(endpoint: string, interval: number) {
  const [result, setResult] = useState<T | null>();
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1100px)");
    let request: AbortController | undefined;
    const update = () => {
      request?.abort();
      if (!desktop.matches || document.hidden) return;
      const controller = new AbortController();
      request = controller;
      void walletRequest<T>(endpoint, undefined, controller.signal)
        .then((value) => { if (!controller.signal.aborted) setResult(value); })
        .catch(() => { if (!controller.signal.aborted) setResult(null); });
    };
    update();
    const timer = window.setInterval(update, interval);
    desktop.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      request?.abort();
      desktop.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [endpoint, interval]);
  return result;
}

type RubleRate = { date: string; rate: number };

const formatRateDate = (date: string) =>
  new Date(date + "T00:00:00Z").toLocaleDateString("ru-RU", {
    day: "numeric", month: "short", timeZone: "UTC",
  });

function CbrHistory() {
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

  if (!points || !first || !last) {
    return <p className="wpay-desktop-fx-status" role="status">
      {rates === null ? "Загружаем график…" : "История курса недоступна"}
    </p>;
  }

  return (
    <figure className="wpay-cbr-history">
      <svg viewBox="0 0 260 88" role="img" aria-label="Курс ЦБ за 30 дней">
        <path d="M0 24H260 M0 52H260 M0 80H260" className="wpay-cbr-history-grid" />
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption><span>{formatRateDate(first.date)}</span><span>{formatRateDate(last.date)}</span></figcaption>
    </figure>
  );
}

function CbrRate() {
  const rate = useDesktopMarket<OfficialRate>("cbr-usd", 300_000);
  return (
    <section className="wpay-desktop-card wpay-desktop-fx" aria-label="Официальный курс ЦБ">
      <div className="wpay-desktop-section-head"><h2>Курс ЦБ</h2><span>USD/RUB</span></div>
      {rate ? (
        <>
          <div className="wpay-desktop-fx-value">{formatRubles(rate.rate)}</div>
          <CbrHistory />
          <a href="https://www.cbr.ru/currency_base/daily/" target="_blank" rel="noreferrer">Банк России · {rate.date}</a>
        </>
      ) : (
        <p className="wpay-desktop-fx-status" role="status">{rate === undefined ? "Загружаем курс…" : "Курс ЦБ недоступен"}</p>
      )}
    </section>
  );
}

function RapiraDepth() {
  const book = useDesktopMarket<OrderBook>("rapira-depth", 10_000);
  const maxAmount = book ? Math.max(1, ...[...book.ask, ...book.bid].map(({ amount }) => Number(amount))) : 1;
  return (
    <section className="wpay-desktop-card wpay-desktop-fx" aria-label="Стакан Rapira">
      <div className="wpay-desktop-section-head"><h2>Стакан Rapira</h2><span>USDT/RUB</span></div>
      {book ? ([
        { label: "Продажа", levels: book.ask, tone: "ask" },
        { label: "Покупка", levels: book.bid, tone: "bid" },
      ].map(({ label, levels, tone }) => (
        <div className={`wpay-depth-side wpay-depth-${tone}`} key={tone}>
          <div className="wpay-depth-line"><strong>{label}</strong><span>Объём, USDT</span></div>
          {levels.length ? levels.map((level) => (
            <div className="wpay-depth-line wpay-depth-level" key={level.price}>
              <span>{formatRubles(level.price)}</span>
              <span>{Number(level.amount).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}</span>
              <span
                className="wpay-depth-volume"
                aria-hidden="true"
                style={{ width: `${100 * Number(level.amount) / maxAmount}%` }}
              />
            </div>
          )) : <p className="wpay-desktop-fx-status">Нет заявок</p>}
        </div>
      ))) : (
        <p className="wpay-desktop-fx-status" role="status">{book === undefined ? "Загружаем стакан…" : "Стакан Rapira недоступен"}</p>
      )}
    </section>
  );
}
