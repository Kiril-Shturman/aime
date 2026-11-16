import taxiArtwork from "../assets/card-benefits/taxi.webp";
import travelArtwork from "../assets/card-benefits/travel.webp";
import { Snowflake } from "lucide-react";
import topupArtwork from "../assets/card-benefits/topup.webp";
import aiArtwork from "../assets/card-benefits/ai.webp";
import subscriptionArtwork from "../assets/card-benefits/subscriptions.webp";
import shoppingArtwork from "../assets/card-benefits/shopping.webp";
import securityArtwork from "../assets/card-benefits/security.webp";
import cardArtwork from "../assets/verification/wpay-card.webp";
import "./WalletSubscriptionFeatures.css";

export default function WalletSubscriptionFeatures({
  variant = "subscriptions",
}: {
  variant?: "subscriptions" | "travel" | "premium";
}) {
  const tiles = [
    {
      key: "topup",
      title: "СБП и криптовалюта",
      description: "Пополняйте кошелёк рублями, затем переводите на карту.",
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
  const travelTiles = [
    tiles[0],
    {
      ...tiles[3],
      title: "Карта в путешествии",
      description: "Реквизиты и управление всегда в приложении.",
    },
    {
      ...tiles[2],
      title: "Сервисы в поездке",
      description: "Для онлайн-оплат во время путешествий.",
    },
    {
      key: "taxi",
      title: "Такси и доставка",
      description: "Для оплаты поездок и заказов в приложениях.",
      image: taxiArtwork,
    },
    {
      key: "travel",
      title: "Отели и авиабилеты",
      description: "Бронируйте проживание и билеты онлайн.",
      image: travelArtwork,
    },
    tiles[5],
  ];
  const premiumTiles = [
    tiles[0],
    {
      ...tiles[3],
      title: "Оплата картой офлайн",
      description: "Физическая карта для покупок в магазинах.",
    },
    travelTiles[3],
    tiles[4],
    travelTiles[4],
    tiles[5],
  ];
  return (
    <section
      className="wpay-card-benefits"
      aria-label={
        variant === "premium"
          ? "Возможности премиальной карты"
          : variant === "travel"
            ? "Возможности карты для путешествий"
            : "Возможности карты для подписок"
      }
    >
      {(variant === "premium"
        ? premiumTiles
        : variant === "travel"
          ? travelTiles
          : tiles
      ).map((tile) => (
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
            {tile.key === "topup" && (
              <span className="wpay-card-benefit-sbp">
                <img src="/brands/sbp-symbol.svg" alt="" />
              </span>
            )}
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
