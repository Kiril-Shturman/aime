import { useRef, useState } from "react";
import { ArrowUpRight, Heart, Sparkles } from "lucide-react";
import cardArtwork from "../assets/verification/wpay-card.webp";
import { haptic } from "../lib/telegram";
import "./WalletPromos.css";

export default function WalletPromos({
  onInvite,
  onDeposit,
  onCards,
}: {
  onInvite: () => void;
  onDeposit: () => void;
  onCards?: () => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const slides = [
    {
      id: "friends",
      title: "С друзьями лучше",
      text: "Приглашайте друзей в wPay",
      action: "Пригласить друзей",
      click: onInvite,
    },
    {
      id: "deposit",
      title: "Пополняйте как удобно",
      text: "Выберите доступный способ",
      action: "Пополнить кошелёк",
      click: onDeposit,
    },
    ...(onCards
      ? [
          {
            id: "cards",
            title: "Ваша карта — всегда рядом",
            text: "Управляйте картами в wPay",
            action: "Перейти к картам",
            click: onCards,
          },
        ]
      : []),
  ];
  return (
    <section
      className="wpay-promos"
      aria-label="Возможности wPay"
      aria-roledescription="карусель"
    >
      <div
        ref={rail}
        className="wpay-promos-rail"
        onScroll={() => {
          const el = rail.current;
          if (el) setActive(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {slides.map((slide, index) => (
          <div
            key={slide.id}
            className={`wpay-promo wpay-promo--${slide.id}`}
            role="group"
            aria-roledescription="слайд"
            aria-label={`${index + 1} из ${slides.length}`}
          >
            <button
              type="button"
              className="wpay-promo-link"
              onClick={() => {
                haptic("light");
                slide.click();
              }}
            >
              <span className="wpay-promo-copy">
                <strong>{slide.title}</strong>
                <span>{slide.text}</span>
                <span className="wpay-promo-action">
                  {slide.action}
                  <ArrowUpRight size={15} />
                </span>
              </span>
              <span className="wpay-promo-art" aria-hidden="true">
                {slide.id === "friends" ? (
                  <>
                    <span className="wpay-promo-letter">wPay</span>
                    <span className="wpay-promo-envelope" />
                    <Heart className="wpay-promo-heart" fill="currentColor" />
                    <Sparkles className="wpay-promo-spark" />
                  </>
                ) : slide.id === "deposit" ? (
                  <>
                    <span className="wpay-promo-coin wpay-promo-coin--back">
                      ₽
                    </span>
                    <span className="wpay-promo-coin">₮</span>
                    <Sparkles className="wpay-promo-spark" />
                  </>
                ) : (
                  <img
                    className="wpay-promo-card"
                    src={cardArtwork}
                    alt=""
                    loading="lazy"
                  />
                )}
              </span>
            </button>
          </div>
        ))}
      </div>
      <div className="wpay-promo-dots" aria-label="Выбрать баннер">
        {slides.map((slide, index) => (
          <button
            type="button"
            key={slide.id}
            aria-label={`Баннер ${index + 1}: ${slide.title}`}
            aria-current={active === index ? "true" : undefined}
            onClick={() =>
              rail.current?.scrollTo({
                left: index * rail.current.clientWidth,
                behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "instant"
                  : "smooth",
              })
            }
          >
            <span />
          </button>
        ))}
      </div>
    </section>
  );
}
