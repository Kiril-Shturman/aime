import { useId } from "react";
export type BankCard = {
  id: string;
  name: string;
  currency: string;
  balance: string;
  last4: string;
  network: string;
};
export default function BankCardArtwork({ card }: { card: BankCard }) {
  const chipId = useId();
  if (card.id === "amex")
    return (
      <span
        role="img"
        aria-label={`${card.name}, ${card.network}, образец, ${card.balance}, номер заканчивается на ${card.last4}`}
        className="wpay-classic-card"
      >
        <img
          src="/cards/amex-green-classic.png"
          width="315"
          height="199"
          alt=""
          draggable={false}
          className="wpay-classic-card-image"
        />
        <span className="wpay-classic-card-status">Образец оформления</span>
      </span>
    );
  return (
    <span
      role="img"
      aria-label={`${card.name}, ${card.network}, образец, ${card.balance}, номер заканчивается на ${card.last4}`}
      className={`wpay-bank-card wpay-bank-card--${card.id}`}
    >
      <span className="wpay-bank-card-orbit" aria-hidden="true" />
      <span className="wpay-bank-card-head">
        <span className="wpay-bank-card-brand">
          WPay
          <span className="wpay-bank-card-brand-dot" />
        </span>
        <span className="wpay-bank-card-tag">
          {card.currency === "₽" ? "RUB" : "USD"}
          <span>·</span>Образец
        </span>
      </span>
      <span className="wpay-bank-card-middle">
        <span>
          <span className="wpay-bank-card-name">{card.name}</span>
          <span className="wpay-bank-card-balance">{card.balance}</span>
        </span>
        <span className="wpay-bank-card-chip-group" aria-hidden="true">
          <svg width="36" height="28" viewBox="0 0 36 28" fill="none">
            <rect
              x=".5"
              y=".5"
              width="35"
              height="27"
              rx="7"
              fill={`url(#${chipId})`}
              stroke="#fff"
              strokeOpacity=".4"
            />
            <path
              d="M12 0v8L8 11H0m36 0h-8l-4-3V0M0 17h8l4 3v8m12 0v-8l4-3h8M12 8h12v12H12z"
              stroke="#836b40"
              strokeOpacity=".55"
              strokeWidth=".75"
            />
            <defs>
              <linearGradient
                id={chipId}
                x1="0"
                y1="0"
                x2="36"
                y2="28"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#f4e8c7" />
                <stop offset=".5" stopColor="#c9ad71" />
                <stop offset="1" stopColor="#efddaf" />
              </linearGradient>
            </defs>
          </svg>
          <svg width="17" height="24" viewBox="0 0 17 24" fill="none">
            <path
              d="M3 8a7 7 0 0 1 0 8m4-11a12 12 0 0 1 0 14m4-17a17 17 0 0 1 0 20"
              stroke="currentColor"
              strokeOpacity=".75"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </span>
      <span className="wpay-bank-card-bottom">
        <span>
          <span className="wpay-bank-card-number">
            ••••<span>{card.last4}</span>
          </span>
          <span className="wpay-bank-card-kind">VIRTUAL DEBIT</span>
        </span>
        <span className="wpay-bank-card-visa">VISA</span>
      </span>
    </span>
  );
}
