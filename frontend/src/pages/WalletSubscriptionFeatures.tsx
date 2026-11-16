import { Snowflake } from "lucide-react";
import topupArtwork from "../assets/card-benefits/topup.webp";
import aiArtwork from "../assets/card-benefits/ai.webp";
import subscriptionArtwork from "../assets/card-benefits/subscriptions.webp";
import shoppingArtwork from "../assets/card-benefits/shopping.webp";
import securityArtwork from "../assets/card-benefits/security.webp";
import cardArtwork from "../assets/verification/wpay-card.webp";
import "./WalletSubscriptionFeatures.css";

export default function WalletSubscriptionFeatures({
  minimum,
  rechargeFee,
}: {
  minimum?: string;
  rechargeFee?: string;
}) {
  const tiles = [
    {
      key: "topup",
      title: "Пополнение в USDT",
      description:
        minimum && rechargeFee
          ? `От ${minimum} USDT. Комиссия ${rechargeFee}%.`
          : "С баланса вашего кошелька.",
      image: topupArtwork,
    },
    {
      key: "ai",
      title: "Нейросети и сервисы",
      description: "Для оплаты цифровых инструментов.",
      image: aiArtwork,
    },
    {
      key: "subscriptions",
      title: "Оплата подписок",
      description: "Реквизиты для регулярных онлайн-платежей.",
      image: subscriptionArtwork,
    },
    {
      key: "control",
      title: "Карта под контролем",
      description: "Реквизиты и заморозка в приложении.",
      image: cardArtwork,
    },
    {
      key: "shopping",
      title: "Покупки в интернете",
      description: "Для товаров и цифровых покупок.",
      image: shoppingArtwork,
    },
    {
      key: "security",
      title: "Поддержка 3D Secure",
      description: "Коды подтверждения платежей в кошельке.",
      image: securityArtwork,
    },
  ];
  return (
    <section
      className="wpay-card-benefits"
      aria-label="Возможности карты для подписок"
    >
      {tiles.map((tile) => (
        <article
          key={tile.key}
          className={`wpay-card-benefit wpay-card-benefit--${tile.key}`}
          aria-label={tile.title}
        >
          <h3>{tile.title}</h3>
          <p>{tile.description}</p>
          <span className="wpay-card-benefit-art" aria-hidden="true">
            <img
              src={tile.image}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
            />
            {tile.key === "control" && (
              <span className="wpay-card-benefit-freeze">
                <Snowflake size={23} />
              </span>
            )}
          </span>
        </article>
      ))}
    </section>
  );
}
