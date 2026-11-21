import taxiArtwork from "../assets/card-benefits/taxi.webp";
import travelArtwork from "../assets/card-benefits/travel.webp";
import { CreditCard, Snowflake, Truck } from "lucide-react";
import WalletCardFace, { type CardSkin } from "./WalletCardFace";
import topupArtwork from "../assets/card-benefits/topup.webp";
import aiArtwork from "../assets/card-benefits/ai.webp";
import subscriptionArtwork from "../assets/card-benefits/subscriptions.webp";
import shoppingArtwork from "../assets/card-benefits/shopping.webp";
import securityArtwork from "../assets/card-benefits/security.webp";
import "./WalletSubscriptionFeatures.css";

export default function WalletSubscriptionFeatures({
  variant = "subscriptions",
  skin = "silver",
  goswap,
}: {
  variant?: "subscriptions" | "travel" | "premium";
  skin?: CardSkin;
  goswap?: { issue?: string | null; topup?: string; conditions?: string[] };
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
      image: "",
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
    {
      key: "delivery",
      title: "Физическая карта с доставкой",
      description:
        skin === "ice"
          ? "Доставим бесплатно. Адрес получателя укажите при оформлении."
          : "Укажите адрес получателя при оформлении — доставим карту вам.",
      image: "",
    },
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
  const visibleTiles = goswap ? [
    { ...tiles[4], title: "Виртуальная карта", description: "Долларовая карта GoSwap для онлайн-покупок." },
    ...(goswap.issue ? [{ ...tiles[2], title: "Выпуск карты", description: `${goswap.issue} USDT по тарифу GoSwap.` }] : []),
    ...(goswap.topup ? [{ ...tiles[0], title: "Пополнение карты", description: `Комиссия GoSwap — ${goswap.topup}% сверху.` }] : []),
    ...(goswap.conditions?.length ? [{ ...tiles[5], title: goswap.conditions.join(" и "), description: "Поддержка оплаты телефоном." }] : []),
  ] : variant === "premium" ? premiumTiles : variant === "travel" ? travelTiles : tiles;
  return (
    <section
      className={`wpay-card-benefits wpay-card-benefits--${variant === "premium" ? "physical" : "virtual"}`}
      aria-label={
        variant === "premium"
          ? "Возможности премиальной карты"
          : variant === "travel"
            ? "Возможности карты для путешествий"
            : "Возможности карты для подписок"
      }
    >
      {visibleTiles.map((tile) => (
        <article
          key={tile.key}
          className={`wpay-card-benefit wpay-card-benefit--${tile.key}`}
          aria-label={tile.title}
        >
          <h3>{tile.title}</h3>
          <p>{tile.description}</p>
          <span className="wpay-card-benefit-art" aria-hidden="true">
            {tile.key === "control" || tile.key === "delivery" ? (
              <span className="wpay-feature-card">
                <WalletCardFace
                  skin={skin}
                  kind={variant === "premium" ? "physical" : "virtual"}
                  status="wPay"
                  offer
                />
              </span>
            ) : (
              <img
                src={tile.image}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            )}
            {tile.key === "delivery" && (
              <span className="wpay-feature-delivery-icon">
                <Truck size={28} />
              </span>
            )}
            {tile.key === "topup" && !goswap && (
              <span className="wpay-card-benefit-sbp">
                <img src="/brands/sbp-symbol.svg" alt="" />
              </span>
            )}
            {tile.key === "control" && (
              <span className="wpay-card-benefit-freeze">
                {variant === "premium" ? (
                  <CreditCard size={23} />
                ) : (
                  <Snowflake size={23} />
                )}
              </span>
            )}
          </span>
        </article>
      ))}
    </section>
  );
}
