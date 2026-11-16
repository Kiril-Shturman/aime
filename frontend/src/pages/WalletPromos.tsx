import { useRef, useState } from "react";
import { ArrowUpRight, Heart, Sparkles } from "lucide-react";
import qrArtwork from "../assets/verification/qr-promo.png";
import sbpArtwork from "../assets/verification/sbp-promo.jpg";
import cardArtwork from "../assets/verification/wpay-card.webp";
import { haptic } from "../lib/telegram";
import "./WalletPromos.css";

export default function WalletPromos({
  onInvite,
  onQr,
  onSbp,
}: {
  onInvite: () => void;
  onQr: () => void;
  onSbp?: () => void;
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
      id: "qr",
      title: "Платите по QR-коду",
      text: "Сканируйте QR СБП и оплачивайте покупки",
      action: "Сканировать QR-код",
      click: onQr,
    },
    ...(onSbp
      ? [
          {
            id: "sbp",
            title: "Пополняйте через СБП",
            text: "Рубли — в ваш кошелёк wPay",
            action: "Пополнить рублями",
            click: onSbp,
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
                ) : slide.id === "qr" ? (
                  <img className="wpay-promo-qr" src={qrArtwork} alt="" loading="lazy" />
                ) : (
                  <>
                    <img className="wpay-promo-card" src={cardArtwork} alt="" loading="lazy" />
                    <img className="wpay-promo-sbp-logo" src={sbpArtwork} alt="" loading="lazy" />
                    <Sparkles className="wpay-promo-spark" />
                  </>
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
