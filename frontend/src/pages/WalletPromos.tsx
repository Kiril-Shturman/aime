import { useEffect, useRef, useState } from "react";
import { Heart } from "lucide-react";
import qrArtwork from "../assets/verification/qr-promo.png";
import sbpArtwork from "../assets/verification/sbp-promo.png";
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
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const slides = [
    {
      id: "friends",
      title: "Приглашайте друзей\nв wPay и пользуйтесь\nкошельком вместе",

      action: "Пригласить друзей",
      click: onInvite,
    },
    {
      id: "qr",
      title: "Оплачивайте покупки\nпо QR-коду СБП\nпрямо из кошелька",

      action: "Сканировать QR-код",
      click: onQr,
    },
    ...(onSbp
      ? [
          {
            id: "sbp",
            title: "Пополняйте кошелёк\nрублями через СБП\nза несколько шагов",

            action: "Пополнить рублями",
            click: onSbp,
          },
        ]
      : []),
  ];
  const selected = Math.min(active, slides.length - 1);
  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setActive((value) => (value + 1) % slides.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [paused, selected, slides.length]);
  return (
    <section
      className="wpay-promos"
      aria-label="Возможности wPay"
      aria-roledescription="карусель"
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setPaused(true); }}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}
    >
      <div
        className="wpay-promos-rail"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          gesture.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerCancel={() => { gesture.current = null; }}
        onPointerUp={(event) => {
          const start = gesture.current;
          gesture.current = null;
          if (!start) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
          suppressClickUntil.current = performance.now() + 400;
          setActive((value) => (value + (dx < 0 ? 1 : -1) + slides.length) % slides.length);
        }}
        onClickCapture={(event) => {
          if (performance.now() < suppressClickUntil.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {slides.map((slide, index) => (
          <div
            key={slide.id}
            className={`wpay-promo wpay-promo--${slide.id} ${selected === index ? "is-active" : ""}`}
            aria-hidden={selected !== index}
            inert={selected !== index}
            role="group"
            aria-roledescription="слайд"
            aria-label={`${index + 1} из ${slides.length}`}
          >
            <button
              type="button"
              className="wpay-promo-link"
              aria-label={slide.action}
              onClick={() => {
                haptic("light");
                slide.click();
              }}
            >
              <span className="wpay-promo-details" aria-hidden="true" />
              <span className="wpay-promo-copy">
                <strong>{slide.title}</strong>

              </span>
              <span className="wpay-promo-art" aria-hidden="true">
                {slide.id === "friends" ? (
                  <>
                    <span className="wpay-promo-letter">wPay</span>
                    <span className="wpay-promo-envelope" />
                    <Heart className="wpay-promo-heart" fill="currentColor" />
                  </>
                ) : slide.id === "qr" ? (
                  <img className="wpay-promo-qr" src={qrArtwork} alt="" loading="lazy" />
                ) : (
                  <>
                    <img className="wpay-promo-card" src={cardArtwork} alt="" loading="lazy" />
                    <img className="wpay-promo-sbp-logo" src={sbpArtwork} alt="" loading="lazy" />
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
            aria-current={selected === index ? "true" : undefined}
            onClick={() => setActive(index)}
          >
            <span />
          </button>
        ))}
      </div>
    </section>
  );
}
