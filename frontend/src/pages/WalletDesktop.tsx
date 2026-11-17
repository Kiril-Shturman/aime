import { Wallet, CreditCard, Clock3, UserRound, Sun, Moon, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, ShieldCheck, MessageCircle } from 'lucide-react'
import { useLiveWallet, cryptoAmount, usdPrice } from './WalletLive'

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
  onVerification,
  onSupport,
}: {
  onVerification: () => void;
  onSupport: () => void;
}) {
  return (
    <aside className="wpay-desktop-profile-aside" aria-label="Быстрые действия профиля">
      <section className="wpay-desktop-card wpay-desktop-profile-verification">
        <span className="wpay-desktop-quick-icon"><ShieldCheck size={23} aria-hidden="true" /></span>
        <h2>Подтверждение личности</h2>
        <p>Проверьте статус верификации или заполните данные, чтобы получить доступ к услугам, требующим подтверждения личности.</p>
        <button type="button" onClick={onVerification}>
          Открыть верификацию <ArrowUpRight size={17} aria-hidden="true" />
        </button>
      </section>
      <section className="wpay-desktop-card">
        <span className="wpay-desktop-quick-icon"><MessageCircle size={23} aria-hidden="true" /></span>
        <h2>Нужна помощь?</h2>
        <p>Напишите нам, если возник вопрос по кошельку или аккаунту.</p>
        <button type="button" onClick={onSupport}>
          Связаться с поддержкой <ArrowUpRight size={17} aria-hidden="true" />
        </button>
      </section>
    </aside>
  );
}
