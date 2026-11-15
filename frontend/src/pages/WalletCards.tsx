import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from "react";
import { Button, Card } from "konsta/react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  Ellipsis,
  Globe2,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Smartphone,
} from "lucide-react";
import LogoApple from "framework7-icons/react/esm/LogoApple.js";
import LogoGoogle from "framework7-icons/react/esm/LogoGoogle.js";
import BankCardArtwork, { type BankCard } from "./WalletCardArtwork";
import { getOwnCards, type AuraCard } from "../lib/cards-api";
import { WalletApiError } from "../lib/wallet-api";
import { haptic } from "../lib/telegram";
import "./WalletCards.css";

type Design = BankCard & { caption: string; tone: string };
const designs: Design[] = [
  {
    id: "rub",
    name: "Everyday",
    currency: "$",
    balance: "— USD",
    last4: "••••",
    network: "Visa",
    caption: "На каждый день",
    tone: "#3275e9",
  },
  {
    id: "usd",
    name: "Travel",
    currency: "$",
    balance: "— USD",
    last4: "••••",
    network: "Visa",
    caption: "Для новых впечатлений",
    tone: "#8055d6",
  },
  {
    id: "amex",
    name: "Green",
    currency: "$",
    balance: "Образец",
    last4: "••••",
    network: "American Express",
    caption: "Классическое оформление",
    tone: "#42765b",
  },
];
const statusLabel = (card: AuraCard) =>
  card.frozen
    ? "Заморожена"
    : ({
        active: "Активна",
        processing: "Выпускается",
        failed_to_open: "Не выпущена",
        cancelled: "Закрыта",
        blocked: "Заблокирована",
      }[card.status] ?? "Статус уточняется");
type PopupProps = { open: boolean; onClose: () => void; children: ReactNode };
type View = "details" | "topup" | "issue" | "wallet" | "limits";
export default function WalletCards({
  showNotice,
  renderPopup,
}: {
  showNotice: (text: string) => void;
  renderPopup: (props: PopupProps) => ReactNode;
}) {
  const [cards, setCards] = useState<AuraCard[] | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [unavailable, setUnavailable] = useState(false),
    [retry, setRetry] = useState(0);
  const [active, setActive] = useState(0),
    [view, setView] = useState<View | null>(null),
    [selected, setSelected] = useState<AuraCard | null>(null),
    [kind, setKind] = useState<"virtual" | "physical">("virtual"),
    [amount, setAmount] = useState("");
  const carousel = useRef<HTMLDivElement>(null),
    drag = useRef({ active: false, start: 0, scroll: 0, moved: false }),
    suppress = useRef(false);
  const design = designs[Math.min(active, designs.length - 1)] ?? designs[0];
  useEffect(() => {
    const controller = new AbortController();
    void getOwnCards(controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) {
          setCards(rows);
          setLoading(false);
          setError("");
          setUnavailable(false);
        }
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setCards(null);
        const missing =
          reason instanceof WalletApiError &&
          ["NOT_FOUND", "NOT_CONFIGURED"].includes(reason.code);
        setUnavailable(missing);
        setError(
          missing
            ? ""
            : reason instanceof Error
              ? reason.message
              : "Не удалось загрузить карты",
        );
      });
    return () => controller.abort();
  }, [retry]);
  function open(next: View, card: AuraCard | null = null) {
    haptic("light");
    setSelected(card);
    setAmount("");
    setView(next);
  }
  function choose(index: number) {
    haptic("light");
    setActive(index);
    const el = carousel.current;
    if (el) {
      const tile = el.firstElementChild as HTMLElement;
      el.scrollTo({
        left: index * (tile.offsetWidth + 12),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current.active) return;
    drag.current.active = false;
    if (drag.current.moved) {
      const el = event.currentTarget;
      el.style.scrollSnapType = "";
      const tile = el.firstElementChild as HTMLElement;
      const index = Math.round(el.scrollLeft / (tile.offsetWidth + 12));
      choose(Math.min(designs.length - 1, Math.max(0, index)));
      if (el.hasPointerCapture(event.pointerId))
        el.releasePointerCapture(event.pointerId);
      setTimeout(() => {
        suppress.current = false;
      }, 0);
    }
  }
  function row(
    title: string,
    subtitle: string,
    Icon: typeof CreditCard,
    action: () => void,
    tone = "#3275e9",
    after?: string,
    id?: string,
  ) {
    return (
      <button
        key={id ?? title}
        type="button"
        className="wpay-cards-row"
        onClick={action}
      >
        <span
          className="wpay-cards-row-icon"
          style={{
            background: `linear-gradient(155deg,color-mix(in srgb,${tone} 72%,white),${tone})`,
          }}
        >
          <Icon size={23} />
        </span>
        <span className="wpay-cards-row-copy">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        {after && <span className="wpay-cards-row-after">{after}</span>}
        <ChevronRight className="wpay-cards-chevron" size={19} />
      </button>
    );
  }
  function liveArtwork(card: AuraCard) {
    return (
      <div className={`wpay-cards-live-art ${card.frozen ? "is-frozen" : ""}`}>
        <span className="wpay-cards-live-top">
          <b>
            WPay<span>●</span>
          </b>
          <span>{statusLabel(card)}</span>
        </span>
        <div>
          <small>
            {card.kind === "physical"
              ? "Физическая карта"
              : "Виртуальная карта"}
          </small>
          <strong>—</strong>
          <span className="wpay-cards-no-balance">
            Баланс карты ещё не подключён
          </span>
        </div>
        <span className="wpay-cards-live-bottom">
          <span>{card.masked_pan ?? "Номер появится после выпуска"}</span>
          <CreditCard size={29} />
        </span>
      </div>
    );
  }
  const actions = [
    {
      label: "Пополнить",
      Icon: Plus,
      onClick: () => open("topup", cards?.[0] ?? null),
    },
    {
      label: "Реквизиты",
      Icon: CreditCard,
      onClick: () => open("details", cards?.[0] ?? null),
    },
    {
      label: "Лимиты",
      Icon: ShieldCheck,
      onClick: () => open("limits", cards?.[0] ?? null),
    },
    {
      label: "Ещё",
      Icon: Ellipsis,
      onClick: () => open("details", cards?.[0] ?? null),
    },
  ];
  return (
    <>
      <main className="wpay-cards-page" aria-label="Карты WPay">
        <div className="wpay-cards-layout">
          <section className="wpay-cards-showcase" aria-label="Оформление карт">
            <div
              ref={carousel}
              role="group"
              aria-label="Выберите оформление карты"
              className="wpay-cards-carousel"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  choose(
                    Math.max(
                      0,
                      Math.min(
                        designs.length - 1,
                        active + (e.key === "ArrowRight" ? 1 : -1),
                      ),
                    ),
                  );
                }
              }}
              onDragStart={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                if (e.pointerType === "mouse" && e.button === 0) {
                  e.stopPropagation();
                  drag.current = {
                    active: true,
                    start: e.clientX,
                    scroll: e.currentTarget.scrollLeft,
                    moved: false,
                  };
                }
              }}
              onPointerMove={(e) => {
                if (!drag.current.active || e.pointerType !== "mouse") return;
                const delta = e.clientX - drag.current.start;
                if (!drag.current.moved && Math.abs(delta) < 7) return;
                drag.current.moved = true;
                suppress.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                e.currentTarget.style.scrollSnapType = "none";
                e.currentTarget.scrollLeft = drag.current.scroll - delta;
                e.preventDefault();
                e.stopPropagation();
              }}
              onPointerUp={finish}
              onPointerCancel={finish}
              onLostPointerCapture={finish}
              onClickCapture={(e) => {
                if (suppress.current) {
                  e.preventDefault();
                  e.stopPropagation();
                  suppress.current = false;
                }
              }}
              onScroll={(e) => {
                const el = e.currentTarget,
                  tile = el.firstElementChild as HTMLElement;
                if (tile)
                  setActive(
                    Math.max(
                      0,
                      Math.min(
                        designs.length - 1,
                        Math.round(el.scrollLeft / (tile.offsetWidth + 12)),
                      ),
                    ),
                  );
              }}
            >
              {designs.map((card, index) => (
                <button
                  key={card.id}
                  type="button"
                  className="wpay-cards-design"
                  aria-label={`Посмотреть оформление ${card.name}`}
                  aria-pressed={active === index}
                  onClick={() => {
                    setActive(index);
                    open("details");
                  }}
                >
                  <BankCardArtwork card={card} />
                </button>
              ))}
            </div>
            <div className="wpay-cards-design-info">
              <span>
                <strong>{design.name}</strong>
                <small>{design.caption}</small>
              </span>
              <div className="wpay-cards-dots">
                {designs.map((card, index) => (
                  <button
                    key={card.id}
                    type="button"
                    aria-label={`Оформление ${card.name}`}
                    aria-pressed={active === index}
                    onClick={() => choose(index)}
                    className={active === index ? "active" : ""}
                  />
                ))}
              </div>
            </div>
            <p className="wpay-cards-caption">
              Варианты оформления. Это образцы, не выпущенные карты.
            </p>
            <section
              className="wpay-cards-actions"
              aria-label="Действия с картами"
            >
              {actions.map(({ label, Icon, onClick }) => (
                <button key={label} type="button" onClick={onClick}>
                  <Icon size={23} strokeWidth={2} />
                  <span>{label}</span>
                </button>
              ))}
            </section>
          </section>
          <div className="wpay-cards-management">
            <section aria-label="Мои карты">
              <div className="wpay-cards-section-head">
                <h2>Мои карты</h2>
                <button
                  type="button"
                  aria-label="Выпустить новую карту"
                  className="wpay-cards-round-add"
                  onClick={() => open("issue")}
                >
                  <Plus size={23} />
                </button>
              </div>
              {loading ? (
                <div className="wpay-cards-loading" aria-label="Загрузка карт">
                  <span />
                  <span />
                </div>
              ) : cards?.length ? (
                <Card
                  className="!m-0 !rounded-[28px]"
                  contentWrapPadding="px-4 py-0"
                >
                  {cards.map((card) =>
                    row(
                      card.kind === "physical"
                        ? "Физическая карта"
                        : "Виртуальная карта",
                      card.masked_pan ?? "Номер ещё не присвоен",
                      CreditCard,
                      () => open("details", card),
                      card.frozen ? "#8e8e93" : "#3275e9",
                      statusLabel(card),
                      card.card_id,
                    ),
                  )}
                </Card>
              ) : (
                <div className="wpay-cards-empty">
                  <span className="wpay-cards-empty-icon">
                    <CreditCard size={28} strokeWidth={1.6} />
                  </span>
                  <div>
                    <h3>
                      {error
                        ? "Карты не загрузились"
                        : "Ваша первая карта — впереди"}
                    </h3>
                    <p>
                      {error ||
                        "Для покупок, подписок и поездок. Выберите формат, который подходит вам."}
                    </p>
                  </div>
                </div>
              )}
              {error ? (
                <Button
                  rounded
                  clear
                  className="!mt-3 !w-full"
                  onClick={() => {
                    setLoading(true);
                    setRetry((v) => v + 1);
                  }}
                >
                  <RefreshCw size={17} className="mr-2" />
                  Повторить загрузку
                </Button>
              ) : (
                <Button
                  data-wpay-primary=""
                  rounded
                  className="!mt-4 !h-14 !w-full"
                  onClick={() => open("issue")}
                >
                  <Plus size={20} className="mr-1.5" />
                  Выпустить карту
                </Button>
              )}
            </section>
            <section>
              <div className="wpay-cards-section-head">
                <h2>Возможности</h2>
              </div>
              <Card
                className="!m-0 !rounded-[28px]"
                contentWrapPadding="px-4 py-0"
              >
                {row(
                  "Оплата телефоном",
                  "Apple Pay и Google Pay",
                  Smartphone,
                  () => open("wallet"),
                  "#8b5cf6",
                )}
                {row(
                  "Контроль расходов",
                  "Лимиты и безопасность",
                  ShieldCheck,
                  () => open("limits"),
                  "#30b977",
                )}
                {row(
                  "Покупки по всему миру",
                  "Онлайн и в поездках",
                  Globe2,
                  () =>
                    showNotice("Доступность оплаты зависит от карты и страны"),
                  "#ff9500",
                )}
              </Card>
            </section>
            <section>
              <div className="wpay-cards-section-head">
                <h2>Платежи по карте</h2>
                <Clock3
                  size={18}
                  className="text-black/30 dark:text-white/30"
                />
              </div>
              <div className="wpay-cards-history-empty">
                <Clock3 size={29} strokeWidth={1.4} />
                <h3>Здесь будут ваши платежи</h3>
                <p>Покупки, пополнения и возвраты — в одной истории.</p>
              </div>
            </section>
          </div>
        </div>
        {unavailable && (
          <p className="wpay-cards-footnote">
            Выпуск и управление станут доступны после подключения карт. Сейчас
            можно посмотреть оформление.
          </p>
        )}
      </main>
      {renderPopup({
        open: view !== null,
        onClose: () => setView(null),
        children: (
          <main className="wpay-cards-modal" aria-label="Управление картой">
            <div className="wpay-cards-modal-art">
              {selected ? (
                liveArtwork(selected)
              ) : (
                <BankCardArtwork card={design} />
              )}
            </div>
            {view === "topup" ? (
              <section>
                <div className="wpay-cards-section-head">
                  <h2>Пополнить карту</h2>
                </div>
                <Card className="!m-0 !rounded-[26px]" contentWrapPadding="p-4">
                  <label className="wpay-cards-amount">
                    <span>Сумма в долларах</span>
                    <span>
                      <b>$</b>
                      <input
                        aria-label="Сумма пополнения карты"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) =>
                          setAmount(e.target.value.replace(",", "."))
                        }
                      />
                    </span>
                  </label>
                </Card>
                <p className="wpay-cards-form-note">
                  Сумма списания и комиссия будут показаны перед подтверждением.
                </p>
                <Button
                  data-wpay-primary=""
                  rounded
                  className="!mt-5 !w-full"
                  disabled={
                    !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0
                  }
                  onClick={() =>
                    showNotice(
                      "Пополнение станет доступно после подключения карт",
                    )
                  }
                >
                  Продолжить
                </Button>
              </section>
            ) : view === "issue" ? (
              <section>
                <div className="wpay-cards-section-head">
                  <h2>Какую карту хотите?</h2>
                </div>
                <div className="wpay-cards-kind">
                  {(["virtual", "physical"] as const).map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={kind === value}
                      onClick={() => setKind(value)}
                    >
                      <span className="wpay-cards-kind-icon">
                        {value === "virtual" ? (
                          <Smartphone size={26} />
                        ) : (
                          <CreditCard size={26} />
                        )}
                      </span>
                      <strong>
                        {value === "virtual" ? "Виртуальную" : "Физическую"}
                      </strong>
                      <small>
                        {value === "virtual"
                          ? "Для онлайн-покупок"
                          : "Для покупок и поездок"}
                      </small>
                      <span className="wpay-cards-kind-check">
                        {kind === value && <Check size={15} />}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="wpay-cards-form-note">
                  Стоимость выпуска, доступные страны и требования будут
                  показаны перед оформлением. Образец дизайна не определяет
                  платёжную систему выпускаемой карты.
                </p>
                <Button
                  data-wpay-primary=""
                  rounded
                  className="!mt-5 !w-full"
                  onClick={() =>
                    showNotice(
                      "Оформление станет доступно после подключения карт",
                    )
                  }
                >
                  Продолжить
                </Button>
              </section>
            ) : view === "wallet" ? (
              <section>
                <div className="wpay-cards-section-head">
                  <h2>Карта в вашем телефоне</h2>
                </div>
                <div className="wpay-cards-wallets">
                  <span>
                    <LogoApple />
                    Apple Pay
                  </span>
                  <span>
                    <LogoGoogle />
                    Google Pay
                  </span>
                </div>
                <p className="wpay-cards-form-note">
                  Возможность добавления зависит от программы карты, устройства
                  и региона. Проверим доступность после выпуска.
                </p>
              </section>
            ) : view === "limits" ? (
              <section>
                <div className="wpay-cards-section-head">
                  <h2>Всё под вашим контролем</h2>
                </div>
                <Card
                  className="!m-0 !rounded-[28px]"
                  contentWrapPadding="px-4 py-0"
                >
                  {row(
                    "Лимиты карты",
                    "На покупки и операции",
                    ShieldCheck,
                    () => showNotice("Лимиты появятся после подключения карты"),
                    "#30b977",
                  )}
                  {row(
                    "Безопасность",
                    "Подтверждение платежей",
                    LockKeyhole,
                    () =>
                      showNotice(
                        "Настройки безопасности появятся после подключения карты",
                      ),
                    "#8b5cf6",
                  )}
                  {row(
                    "Заморозить карту",
                    "Временно остановить оплату",
                    Snowflake,
                    () =>
                      showNotice("Управление заморозкой подключим к API карт"),
                    "#32ade6",
                  )}
                </Card>
              </section>
            ) : (
              <section>
                <div className="wpay-cards-section-head">
                  <h2>
                    {selected ? "Ваша карта" : "Оформление " + design.name}
                  </h2>
                  <span className="wpay-cards-sample">
                    {selected ? statusLabel(selected) : "Образец"}
                  </span>
                </div>
                <Card
                  className="!m-0 !rounded-[28px]"
                  contentWrapPadding="px-4 py-0"
                >
                  {row(
                    "Реквизиты карты",
                    selected?.masked_pan ?? "Появятся после выпуска",
                    CreditCard,
                    () =>
                      showNotice(
                        "Полные реквизиты доступны только после выпуска и подтверждения доступа",
                      ),
                  )}
                  {row(
                    "Пополнить",
                    "С баланса WPay",
                    ArrowDownToLine,
                    () => setView("topup"),
                    "#30b977",
                  )}
                  {row(
                    "Лимиты и безопасность",
                    "Управление платежами",
                    ShieldCheck,
                    () => setView("limits"),
                    "#8b5cf6",
                  )}
                  {row(
                    "Добавить в телефон",
                    "Проверить доступность",
                    Smartphone,
                    () => setView("wallet"),
                    "#ff9500",
                  )}
                </Card>
                {!selected && (
                  <Button
                    data-wpay-primary=""
                    rounded
                    className="!mt-5 !w-full"
                    onClick={() => setView("issue")}
                  >
                    <ArrowUpRight size={20} className="mr-2" />
                    Выбрать это оформление
                  </Button>
                )}
              </section>
            )}
          </main>
        ),
      })}
    </>
  );
}
