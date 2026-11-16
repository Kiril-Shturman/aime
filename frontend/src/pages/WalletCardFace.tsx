import { useId } from "react";
import "./WalletCardFace.css";

export const cardSkins = [
  { value: "silver", label: "Белая" },
  { value: "navy", label: "Тёмно-синяя" },
  { value: "ice", label: "Голубая" },
  { value: "graphite", label: "Графитовая" },
] as const;
export type CardSkin = (typeof cardSkins)[number]["value"];

export default function WalletCardFace({
  skin,
  kind,
  status,
  maskedPan,
  offer = false,
}: {
  skin: CardSkin;
  kind: "physical" | "virtual";
  status: string;
  maskedPan?: string | null;
  offer?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const dark = skin === "navy" || skin === "graphite";
  return (
    <span
      className={`wpay-bank-card wpay-aura-artwork wpay-card-scene wpay-card-skin--${skin}`}
    >
      <span className="wpay-card-face">
        <svg
          className="wpay-card-face-waves"
          viewBox="0 0 500 315"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${id}-wave`} x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="currentColor" stopOpacity=".28" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M-25 310C100 185 245 154 525 237L525 330H-25Z"
            fill={`url(#${id}-wave)`}
          />
          <path
            d="M-30 315C160 196 350 243 525 153L525 330Z"
            fill={`url(#${id}-wave)`}
            opacity=".65"
          />
          {skin === "ice" ? (
            [0, 9, 18, 27].map((offset) => (
              <path
                key={offset}
                d={`M-15 ${302 + offset}C180 ${274 + offset} 295 ${200 + offset} 520 ${176 + offset}`}
                fill="none"
                stroke="currentColor"
                strokeOpacity=".28"
                strokeWidth="1.5"
              />
            ))
          ) : (
            <path
              d="M8 308C185 192 320 202 496 232"
              fill="none"
              stroke="currentColor"
              strokeOpacity=".16"
              strokeWidth="1"
            />
          )}
        </svg>
        <span className="wpay-card-face-status">{status}</span>
        <img
          className="wpay-card-face-logo"
          src={
            dark
              ? "/brands/wpay-wordmark-light.svg"
              : "/brands/wpay-wordmark.svg"
          }
          alt="wPay"
          draggable={false}
        />
        <svg
          className="wpay-card-face-chip"
          viewBox="0 0 56 44"
          fill="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id={`${id}-metal`}
              x1="0"
              y1="0"
              x2="56"
              y2="44"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#f4f5f6" />
              <stop offset=".35" stopColor="#bec1c4" />
              <stop offset=".65" stopColor="#eeeeed" />
              <stop offset="1" stopColor="#989da3" />
            </linearGradient>
          </defs>
          <rect
            x="1"
            y="1"
            width="54"
            height="42"
            rx="9"
            fill={`url(#${id}-metal)`}
            stroke="#6e7479"
            strokeWidth="1"
          />
          <path
            d="M19 1v11l-6 6H1m54 0H43l-6-6V1M1 27h12l6 6v10m18 0V33l6-6h12M19 12h18v21H19z"
            stroke="#7d8288"
            strokeWidth="1"
          />
          <path
            d="M3 21.5h16m18 0h16M28 1v11m0 21v10"
            stroke="#ffffff"
            strokeOpacity=".35"
            strokeWidth=".8"
          />
        </svg>
        <svg
          className="wpay-card-face-contactless"
          viewBox="0 0 25 34"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 12a9 9 0 0 1 0 10M10 7a17 17 0 0 1 0 20M16 2a26 26 0 0 1 0 30"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        <span className="wpay-card-face-bottom">
          <span>
            <span className="wpay-card-face-number">
              {offer
                ? kind === "physical"
                  ? "Карта с доставкой"
                  : "Виртуальная карта"
                : (maskedPan ?? "Номер появится после выпуска")}
            </span>
            <span className="wpay-card-face-kind">
              {kind === "physical" ? "PHYSICAL" : "VIRTUAL"}
            </span>
          </span>
          {offer && <span className="wpay-card-face-plus">+</span>}
        </span>
      </span>
    </span>
  );
}
