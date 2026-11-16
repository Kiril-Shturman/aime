import WalletSubscriptionFeatures from "./WalletSubscriptionFeatures";
import WalletCardFace, { type CardSkin } from "./WalletCardFace";
import PlusCircleFill from "framework7-icons/react/esm/PlusCircleFill.js";
import EyeFill from "framework7-icons/react/esm/EyeFill.js";
import Snow from "framework7-icons/react/esm/Snow.js";
import Ellipsis from "framework7-icons/react/esm/Ellipsis.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, List, ListItem } from "konsta/react";
import { Popup, Page, Navbar, NavRight, Link } from "framework7-react";
import {
  CreditCard,
  Truck,
  KeyRound,
  ShieldCheck,
  MessageSquareLock,
  ChevronRight,
  History,
  RefreshCw,
  Plus,
  Eye,
} from "lucide-react";
import { haptic } from "../lib/telegram";
import "./WalletAuraCards.css";
import {
  walletIdempotentRequest,
  walletNullableRequest,
  walletRequest,
  WalletApiError,
} from "../lib/wallet-api";
import { useLiveWallet } from "./WalletLive";

type AuraCard = {
  card_id: string;
  kind: "virtual" | "physical";
  status: "processing" | "opened" | "failed_to_open" | "cancelled";
  frozen: boolean;
  masked_pan: string | null;
  delivery_status: string | null;
  provider_updated_at: string | null;
};
type CardFees = {
  currency: "USDT";
  minimum_recharge_amount: string;
  open_virtual_card_fee: string;
  open_physical_card_fee: string;
  recharge_fee_pct: string;
  physical_recharge_fee_pct: string;
};
type CardCredentials = {
  card_id: string;
  number: string;
  expiry: string;
  cvv: string;
};
type CardOtp = {
  card_id: string;
  card_number_masked: string | null;
  code: string;
  consumed_at: string | null;
  expires_at: string;
  id: string;
  received_at: string;
  subject: string | null;
};
type CardOperation = {
  operation_id: string;
  operation_type: string;
  status: string;
  asset: string;
  amount: string;
  fee: string | null;
  merchant: string | null;
  decline_message: string | null;
  provider_created_at: string;
};
type ShippingAddress = {
  full_name: string;
  phone: string;
  country: string;
  city: string;
  address_line: string;
  postal_code: string;
};

const operationKey = () =>
  globalThis.crypto?.randomUUID?.() ??
  `card-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const errorText = (error: unknown) =>
  error instanceof WalletApiError ? error.message : "Операция не выполнена";
const statusText: Record<string, string> = {
  processing: "Выпускается",
  opened: "Активна",
  failed_to_open: "Не выпущена",
  cancelled: "Отменена",
};
const deliveryText: Record<string, string> = {
  issuing: "Выпускается",
  issued: "Выпущена",
  out_for_delivery: "В доставке",
  activated: "Активирована",
};
const emptyShipping: ShippingAddress = {
  full_name: "",
  phone: "",
  country: "",
  city: "",
  address_line: "",
  postal_code: "",
};

export default function WalletAuraCards({
  showNotice,
}: {
  showNotice: (text: string) => void;
}) {
  const wallet = useLiveWallet();
  const [cards, setCards] = useState<AuraCard[]>([]);
  const [fees, setFees] = useState<CardFees | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [operations, setOperations] = useState<CardOperation[]>([]);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [skin, setSkin] = useState<CardSkin>("silver");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [issueKind, setIssueKind] = useState<"virtual" | "physical">("virtual");
  const [shipping, setShipping] = useState(emptyShipping);
  const [recharge, setRecharge] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [pin, setPin] = useState("");
  const [credentials, setCredentials] = useState<CardCredentials | null>(null);
  const [otp, setOtp] = useState<CardOtp | null | undefined>(undefined);
  const [panel, setPanel] = useState<string | null>(null);
  const [displayPanel, setDisplayPanel] = useState("more");
  const [activeSlide, setActiveSlide] = useState(0);
  const carousel = useRef<HTMLDivElement>(null);
  const scrollTarget = useRef<number | null>(null);
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const revealRequest = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const issueKey = useRef("");
  const rechargeKey = useRef("");
  useEffect(() => () => revealRequest.current?.abort(), []);

  const loadCards = useCallback(async () => {
    setError("");
    try {
      const [cardResult, feeResult] = await Promise.all([
        walletRequest<{ data: AuraCard[] }>("aura-cards"),
        walletRequest<CardFees>("aura-card-fees"),
      ]);
      setCards(cardResult.data);
      setFees(feeResult);
      setSelectedId((current) =>
        current && cardResult.data.some((card) => card.card_id === current)
          ? current
          : (cardResult.data[0]?.card_id ?? null),
      );
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);
  useEffect(() => {
    if (!selectedId) {
      setOperations([]);
      setOperationsLoading(false);
      return;
    }
    const controller = new AbortController();
    setOperations([]);
    setOperationsLoading(true);
    void walletRequest<{ data: CardOperation[] }>(
      `aura-card-operations?card_id=${encodeURIComponent(selectedId)}`,
      undefined,
      controller.signal,
    )
      .then((result) => setOperations(result.data))
      .catch((requestError) => {
        if (!(requestError instanceof DOMException))
          setError(errorText(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setOperationsLoading(false);
      });
    return () => controller.abort();
  }, [selectedId]);
  useEffect(() => {
    if (!credentials) return;
    const timer = window.setTimeout(() => setCredentials(null), 60_000);
    return () => window.clearTimeout(timer);
  }, [credentials]);
  useEffect(() => {
    if (!otp) return;
    const delay = Math.max(0, Date.parse(otp.expires_at) - Date.now());
    const timer = window.setTimeout(() => setOtp(null), delay);
    return () => window.clearTimeout(timer);
  }, [otp]);

  const selected = useMemo(
    () => cards.find((card) => card.card_id === selectedId) ?? null,
    [cards, selectedId],
  );
  const mutate = async (
    name: string,
    task: () => Promise<unknown>,
    success: string,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(name);
    setError("");
    try {
      await task();
      await Promise.all([loadCards(), wallet.refresh()]);
      showNotice(success);
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  };
  const issue = () =>
    mutate(
      "issue",
      async () => {
        issueKey.current ||= operationKey();
        const result = await walletIdempotentRequest(
          "aura-cards",
          issueKind === "physical"
            ? { kind: issueKind, shipping_address: shipping }
            : { kind: issueKind },
          issueKey.current,
        );
        issueKey.current = "";
        setPanel(null);
        setSelectedId(null);
        setActiveSlide(0);
        carousel.current?.scrollTo({ left: 0 });
        return result;
      },
      "Заявка на карту отправлена",
    );
  const control = (
    action: string,
    body: Record<string, string>,
    success: string,
  ) => mutate(action, () => walletRequest(action, body), success);

  const openPanel = (name: string) => {
    haptic("light");
    setCredentials(null);
    setOtp(undefined);
    setError("");
    setDisplayPanel(name);
    setPanel(name);
  };
  const closePanel = () => {
    revealRequest.current?.abort();
    setPanel(null);
    setCredentials(null);
    setOtp(undefined);
    setPin("");
    setActivationCode("");
  };
  const selectCard = (id: string) => {
    revealRequest.current?.abort();
    setCredentials(null);
    setOtp(undefined);
    setPin("");
    setActivationCode("");
    setSelectedId(id);
  };
  const reveal = async (kind: "credentials" | "otp") => {
    if (!selected || busyRef.current) return;
    openPanel(kind);
    const request = new AbortController();
    revealRequest.current = request;
    busyRef.current = true;
    setBusy(kind);
    try {
      const query = `?card_id=${encodeURIComponent(selected.card_id)}`;
      if (kind === "credentials")
        setCredentials(
          await walletRequest<CardCredentials>(
            "aura-card-credentials" + query,
            undefined,
            request.signal,
          ),
        );
      else
        setOtp(
          await walletNullableRequest<CardOtp>(
            "aura-card-otp-latest" + query,
            request.signal,
          ),
        );
    } catch (requestError) {
      if (!request.signal.aborted) setError(errorText(requestError));
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  };
  const offers: { kind: "virtual" | "physical"; skin: CardSkin }[] = [
    { kind: "virtual", skin: "silver" },
    { kind: "virtual", skin: "navy" },
    ...(fees?.open_physical_card_fee
      ? [
          { kind: "physical" as const, skin: "ice" as const },
          { kind: "physical" as const, skin: "graphite" as const },
        ]
      : []),
  ];
  const activeOffer = offers[activeSlide - cards.length];
  const offerKind = activeOffer?.kind;
  const showOffer = !loading && Boolean(offerKind || !cards.length);
  const currentKind = offerKind ?? issueKind;
  const travelOffer = currentKind === "virtual" && activeOffer?.skin === "navy";
  const premiumOffer =
    currentKind === "physical" && activeOffer?.skin === "ice";
  const physical = selected?.kind === "physical";
  const canUse = selected?.status === "opened";
  const jumpTo = (index: number) => {
    const el = carousel.current;
    scrollTarget.current = index;
    if (el)
      el.scrollTo({ left: index * (el.clientWidth + 12), behavior: "smooth" });
    setActiveSlide(index);
    if (cards[index]) selectCard(cards[index].card_id);
  };
  const order = (
    kind: "virtual" | "physical",
    appearance: CardSkin = "silver",
  ) => {
    setSkin(appearance);
    if (kind !== issueKind) issueKey.current = "";
    setIssueKind(kind);
    openPanel("issue");
  };
  const panelTitles: Record<string, string> = {
    issue: "Новая карта",
    recharge: "Пополнить карту",
    credentials: "Реквизиты карты",
    otp: "Код подтверждения",
    more: "Управление картой",
    activation: "Активация карты",
    pin: "PIN держателя",
    delivery: "Доставка карты",
    details: "Карта",
    fees: "Тарифы",
  };
  const actionClass =
    "!m-0 !h-[62px] !min-w-0 !rounded-[22px] !bg-black/[.055] !px-1 !text-primary active:!bg-black/10 dark:!bg-white/[.10] dark:active:!bg-white/[.16]";
  const actions = [
    {
      label: "Пополнить",
      Icon: PlusCircleFill,
      disabled: !canUse,
      run: () => openPanel("recharge"),
    },
    {
      label: "Реквизиты",
      Icon: EyeFill,
      disabled: !canUse,
      run: () => void reveal("credentials"),
    },
    {
      label: selected?.frozen ? "Разморозить" : "Заморозить",
      Icon: Snow,
      disabled: !canUse,
      run: () =>
        control(
          selected?.frozen ? "aura-card-unfreeze" : "aura-card-freeze",
          { card_id: selected!.card_id },
          selected?.frozen ? "Карта разморожена" : "Карта заморожена",
        ),
    },
    {
      label: "Ещё",
      Icon: Ellipsis,
      disabled: false,
      run: () => openPanel("more"),
    },
  ];
  const infoRow = (title: string, value: string) => (
    <div className="wpay-aura-info-row">
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
  const operationTitle = (op: CardOperation) =>
    op.merchant ||
    ({
      refund: "Возврат",
      recharge: "Пополнение",
      purchase: "Покупка",
      payment: "Оплата",
    }[op.operation_type] ??
      "Операция по карте");
  return (
    <>
      <main
        className="wpay-aura-cards mx-auto w-full max-w-[560px] pb-6"
        aria-label="Мои карты"
      >
        {error && !panel && (
          <div role="alert" className="wpay-aura-error mx-4 mt-3">
            {error}
            <button type="button" onClick={() => void loadCards()}>
              Повторить
            </button>
          </div>
        )}
        <section className="px-safe-4 pb-2 pt-5" aria-label="Выбор карты">
          {loading ? (
            <div
              className="wpay-aura-card-skeleton animate-pulse"
              role="status"
              aria-label="Загружаем карты"
            />
          ) : (
            <>
              <div
                ref={carousel}
                className="wpay-aura-carousel"
                onPointerDown={(event) => {
                  scrollTarget.current = null;
                  if (event.pointerType !== "mouse" || event.button !== 0)
                    return;
                  drag.current = {
                    x: event.clientX,
                    scroll: event.currentTarget.scrollLeft,
                    moved: false,
                  };
                }}
                onPointerMove={(event) => {
                  const current = drag.current;
                  if (!current) return;
                  const delta = event.clientX - current.x;
                  if (!current.moved && Math.abs(delta) < 6) return;
                  current.moved = true;
                  suppressClick.current = true;
                  event.currentTarget.style.scrollSnapType = "none";
                  event.currentTarget.setPointerCapture(event.pointerId);
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.scrollLeft = current.scroll - delta;
                }}
                onPointerUp={(event) => {
                  drag.current = null;
                  event.currentTarget.style.scrollSnapType = "";
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  if (carousel.current)
                    carousel.current.style.scrollSnapType = "";
                }}
                onClickCapture={(event) => {
                  if (suppressClick.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    suppressClick.current = false;
                  }
                }}
                onScroll={(event) => {
                  if (event.target !== event.currentTarget) return;
                  const index = Math.round(
                    event.currentTarget.scrollLeft /
                      (event.currentTarget.clientWidth + 12),
                  );
                  if (scrollTarget.current !== null) {
                    const target = scrollTarget.current;
                    if (
                      Math.abs(
                        event.currentTarget.scrollLeft -
                          target * (event.currentTarget.clientWidth + 12),
                      ) > 2
                    )
                      return;
                    scrollTarget.current = null;
                  }
                  setActiveSlide(index);
                  const card = cards[index];
                  if (card && card.card_id !== selectedId)
                    selectCard(card.card_id);
                }}
              >
                {cards.map((card) => (
                  <button
                    key={card.card_id}
                    type="button"
                    className="wpay-aura-carousel-item"
                    aria-label={`Открыть ${card.kind === "physical" ? "физическую" : "виртуальную"} карту ${card.masked_pan ?? ""}`}
                    onClick={() => {
                      selectCard(card.card_id);
                      openPanel("details");
                    }}
                  >
                    <LiveCardArtwork card={card} skin="silver" />
                  </button>
                ))}
                {offers.map(({ kind, skin: appearance }) => (
                  <button
                    type="button"
                    className="wpay-aura-carousel-item"
                    key={appearance}
                    aria-label={`Заказать ${kind === "physical" ? "физическую" : "виртуальную"} карту`}
                    onClick={() => order(kind, appearance)}
                  >
                    <LiveCardArtwork kind={kind} skin={appearance} />
                  </button>
                ))}
              </div>
              <div
                className="wpay-aura-card-dots"
                aria-label="Переключить карту"
              >
                {Array.from(
                  { length: cards.length + offers.length },
                  (_, index) => (
                    <button
                      type="button"
                      key={index}
                      aria-label={`Карта ${index + 1}`}
                      aria-current={index === activeSlide ? "true" : undefined}
                      onClick={() => jumpTo(index)}
                    >
                      <span />
                    </button>
                  ),
                )}
              </div>
            </>
          )}
        </section>
        {showOffer ? (
          <section className="px-4 pt-2">
            <h2 className="text-[21px] font-semibold">
              {currentKind === "physical"
                ? premiumOffer
                  ? "Премиальная"
                  : "Платина"
                : travelOffer
                  ? "Для путешествий"
                  : "Для подписок"}
            </h2>
            {premiumOffer && (
              <div className="wpay-premium-delivery">
                <Truck size={18} aria-hidden="true" />
                <span>Физическая карта · Бесплатная доставка</span>
              </div>
            )}
            <p className="mt-2 text-[15px] leading-6 text-black/50 dark:text-white/50">
              {currentKind === "physical"
                ? premiumOffer
                  ? "Физическая карта для повседневных покупок и путешествий. Укажите адрес получателя — доставим бесплатно."
                  : "Выберите физическую карту и укажите адрес получателя при оформлении."
                : travelOffer
                  ? "Виртуальная карта для поездок: бронирования, билеты и онлайн-сервисы в путешествии."
                  : "Виртуальная карта для подписок, цифровых сервисов и регулярных онлайн-оплат."}
            </p>
            {(currentKind === "virtual" || currentKind === "physical") && (
              <WalletSubscriptionFeatures
                skin={activeOffer?.skin ?? "silver"}
                variant={
                  currentKind === "physical"
                    ? "premium"
                    : travelOffer
                      ? "travel"
                      : "subscriptions"
                }
              />
            )}
            <div className="wpay-aura-info mt-4">
              {currentKind === "virtual" &&
                fees &&
                infoRow(
                  "Пополнение карты",
                  `От ${fees.minimum_recharge_amount} USDT · комиссия ${fees.recharge_fee_pct}%`,
                )}
              {premiumOffer && infoRow("Доставка", "Бесплатно")}
              {infoRow(
                "Выпуск",
                fees
                  ? `${currentKind === "physical" ? fees.open_physical_card_fee : fees.open_virtual_card_fee} USDT`
                  : "Тариф загружается",
              )}
            </div>
            <Button
              rounded
              large
              data-wpay-primary=""
              className="wpay-aura-primary !mt-4 !w-full"
              disabled={!fees || Boolean(busy)}
              onClick={() => order(currentKind, activeOffer?.skin)}
            >
              Оформить карту
            </Button>
          </section>
        ) : (
          selected && (
            <>
              <section
                className="grid grid-cols-4 gap-2 px-safe-4 pt-2"
                aria-label="Действия с картой"
              >
                {actions.map(({ label, Icon, disabled, run }) => (
                  <Button
                    key={label}
                    rounded
                    clear
                    disabled={disabled || Boolean(busy)}
                    className={actionClass}
                    onClick={() => {
                      haptic("light");
                      run();
                    }}
                  >
                    <span className="flex min-w-0 flex-col items-center justify-center gap-1">
                      <Icon className="h-[22px] w-[22px]" />
                      <span className="w-full truncate text-[10px] font-medium leading-none">
                        {label}
                      </span>
                    </span>
                  </Button>
                ))}
              </section>
              <div className="wpay-aura-section-head">
                <h2>Мои карты</h2>
                <button
                  type="button"
                  aria-label="Обновить карты"
                  disabled={Boolean(busy)}
                  onClick={() => void loadCards()}
                >
                  <RefreshCw size={17} />
                </button>
              </div>
              <List strong inset dividers className="wpay-aura-list !my-0">
                {cards.map((card, index) => (
                  <ListItem
                    key={card.card_id}
                    link
                    chevron={false}
                    contentClassName="!h-16"
                    innerClassName="!h-16 !py-2 after:!opacity-30"
                    onClick={() => {
                      jumpTo(index);
                      openPanel("details");
                    }}
                    innerChildren={
                      <span className="flex w-full min-w-0 items-center justify-between gap-3">
                        <span className="min-w-0">
                          <strong className="block truncate text-[17px] font-semibold">
                            {card.kind === "physical"
                              ? "Физическая карта"
                              : "Виртуальная карта"}
                          </strong>
                          <span className="mt-0.5 block text-[13px] text-black/45 dark:text-white/45">
                            {card.masked_pan ?? "Номер появится после выпуска"}
                          </span>
                        </span>
                        <span className="text-right text-[12px] text-black/45 dark:text-white/45">
                          {card.frozen
                            ? "Заморожена"
                            : (statusText[card.status] ?? card.status)}
                          <ChevronRight className="ml-auto mt-1" size={17} />
                        </span>
                      </span>
                    }
                  />
                ))}
                <ListItem
                  link
                  title="Выпустить карту"
                  subtitle="Виртуальная или с доставкой"
                  contentClassName="!h-16"
                  innerClassName="!h-16 !py-2 after:!opacity-30"
                  onClick={() => order("virtual")}
                  media={<Plus className="text-primary" size={25} />}
                />
              </List>
              {physical && (
                <>
                  <div className="wpay-aura-section-head">
                    <h2>Доставка и активация</h2>
                  </div>
                  <List strong inset className="wpay-aura-list !my-0">
                    <ListItem
                      link
                      title="Физическая карта"
                      subtitle={
                        deliveryText[selected.delivery_status ?? ""] ??
                        "Статус доставки уточняется"
                      }
                      contentClassName="!h-16"
                      innerClassName="!h-16 !py-2"
                      media={<Truck className="text-primary" size={25} />}
                      onClick={() => openPanel("delivery")}
                    />
                  </List>
                </>
              )}
              <div className="wpay-aura-section-head">
                <h2>Платежи по карте</h2>
              </div>
              {operationsLoading ? (
                <div className="wpay-aura-empty" role="status">
                  Загружаем операции…
                </div>
              ) : operations.length ? (
                <List strong inset dividers className="wpay-aura-list !my-0">
                  {operations.slice(0, 20).map((op) => (
                    <ListItem
                      key={op.operation_id}
                      title={operationTitle(op)}
                      subtitle={`${operationStatus(op.status)}${op.decline_message ? ` · ${op.decline_message}` : ""}`}
                      contentClassName="!min-h-16"
                      innerClassName="!min-h-16 !py-2 after:!opacity-30"
                      media={
                        <span className="wpay-aura-operation-icon">
                          <CreditCard size={22} />
                        </span>
                      }
                      after={
                        <span className="text-[15px] font-medium tabular-nums text-black dark:text-white">
                          {["refund", "recharge"].includes(op.operation_type)
                            ? "+"
                            : "−"}
                          {op.amount} {op.asset}
                        </span>
                      }
                    />
                  ))}
                </List>
              ) : (
                <div className="wpay-aura-empty">
                  <History size={30} />
                  <p>Операций по карте пока нет</p>
                </div>
              )}
            </>
          )
        )}
      </main>
      <Popup
        push
        opened={panel !== null}
        className="wpay-profile-popup wpay-aura-card-popup"
        closeByBackdropClick
        closeOnEscape
        swipeToClose="to-bottom"
        swipeHandler=".navbar"
        onPopupClosed={closePanel}
      >
        <div className="view">
          <Page>
            <Navbar
              title={
                displayPanel === "details" ? "" : panelTitles[displayPanel]
              }
              transparent
            >
              <NavRight>
                <Link popupClose aria-label="Закрыть окно карты">
                  <i className="icon icon-close" />
                </Link>
              </NavRight>
            </Navbar>
            <main className="wpay-aura-panel mx-auto w-full max-w-[560px] px-4 pb-8 pt-4">
              {error && (
                <div role="alert" className="wpay-aura-error mb-4">
                  {error}
                </div>
              )}
              {busy && (
                <p
                  role="status"
                  className="mb-4 text-[14px] text-black/50 dark:text-white/50"
                >
                  Выполняем запрос…
                </p>
              )}
              {displayPanel === "issue" && (
                <>
                  <div className="mb-5">
                    <LiveCardArtwork kind={issueKind} skin={skin} />
                  </div>
                  <div
                    className="wpay-aura-kind-picker"
                    role="group"
                    aria-label="Тип новой карты"
                  >
                    {(["virtual", "physical"] as const).map((kind) => (
                      <button
                        type="button"
                        key={kind}
                        disabled={
                          Boolean(busy) ||
                          (kind === "physical" && !fees?.open_physical_card_fee)
                        }
                        aria-pressed={issueKind === kind}
                        onClick={() => {
                          if (issueKind !== kind) issueKey.current = "";
                          setIssueKind(kind);
                        }}
                      >
                        {kind === "physical" ? "Физическая" : "Виртуальная"}
                      </button>
                    ))}
                  </div>
                  {issueKind === "physical" && (
                    <>
                      <h2 className="wpay-aura-panel-heading">
                        Адрес доставки
                      </h2>
                      <div className="wpay-aura-fields">
                        {(
                          Object.keys(
                            emptyShipping,
                          ) as (keyof ShippingAddress)[]
                        ).map((field) => (
                          <label key={field}>
                            <span>{shippingLabels[field]}</span>
                            <input
                              disabled={Boolean(busy)}
                              value={shipping[field]}
                              onChange={(event) => {
                                issueKey.current = "";
                                setShipping((value) => ({
                                  ...value,
                                  [field]: event.target.value,
                                }));
                              }}
                              autoComplete={shippingAutoComplete[field]}
                              type={field === "phone" ? "tel" : "text"}
                              placeholder={
                                field === "country"
                                  ? "RU"
                                  : shippingLabels[field]
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                  <h2 className="wpay-aura-panel-heading">Стоимость выпуска</h2>
                  <div className="wpay-aura-info">
                    {infoRow(
                      "Карта",
                      issueKind === "physical" ? "Физическая" : "Виртуальная",
                    )}
                    {issueKind === "physical" &&
                      skin === "ice" &&
                      infoRow("Доставка", "Бесплатно")}
                    {infoRow(
                      "Спишется с кошелька",
                      fees
                        ? `${issueKind === "physical" ? fees.open_physical_card_fee : fees.open_virtual_card_fee} USDT`
                        : "Тариф не загружен",
                    )}
                  </div>
                  <Button
                    large
                    rounded
                    data-wpay-primary=""
                    className="wpay-aura-primary !mt-5 !w-full"
                    disabled={
                      !fees ||
                      Boolean(busy) ||
                      (issueKind === "physical" &&
                        Object.values(shipping).some((value) => !value.trim()))
                    }
                    onClick={() => void issue()}
                  >
                    {busy === "issue" ? "Отправляем…" : "Выпустить карту"}
                  </Button>
                </>
              )}
              {displayPanel === "credentials" && selected && (
                <>
                  {credentials && credentials.card_id === selected.card_id && (
                    <div className="mt-4 rounded-2xl bg-black/[0.04] p-4 font-mono dark:bg-white/[0.07]">
                      <div className="break-all text-[18px] tracking-wide">
                        {credentials.number}
                      </div>
                      <div className="mt-2 flex justify-between text-[14px]">
                        <span>{credentials.expiry}</span>
                        <span>CVV {credentials.cvv}</span>
                      </div>
                      <button
                        type="button"
                        className="mt-3 text-[13px] text-primary"
                        onClick={() => setCredentials(null)}
                      >
                        Скрыть сейчас
                      </button>
                    </div>
                  )}
                </>
              )}
              {displayPanel === "otp" && selected && (
                <>
                  {otp !== undefined &&
                    (!otp || otp.card_id === selected.card_id) && (
                      <div className="mt-4 rounded-2xl bg-black/[0.04] p-4 dark:bg-white/[0.07]">
                        {otp ? (
                          <>
                            <div className="text-[12px] uppercase tracking-wide text-black/40 dark:text-white/40">
                              Действует до{" "}
                              {new Date(otp.expires_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                            <div className="mt-1 font-mono text-[30px] font-semibold tracking-[0.2em]">
                              {otp.code}
                            </div>
                          </>
                        ) : (
                          <div className="text-[14px]">
                            Действующего 3DS-кода нет
                          </div>
                        )}
                      </div>
                    )}
                </>
              )}
              {displayPanel === "recharge" && selected && (
                <>
                  <p className="mb-4 text-[15px] text-black/50 dark:text-white/50">
                    Пополнение карты {selected.masked_pan ?? "wPay"} с баланса
                    USDT.
                  </p>
                  <div className="wpay-aura-fields">
                    <label>
                      <span>Сумма, USDT</span>
                      <input
                        aria-label="Сумма пополнения карты"
                        disabled={Boolean(busy)}
                        value={recharge}
                        inputMode="decimal"
                        placeholder={
                          fees
                            ? `От ${fees.minimum_recharge_amount}`
                            : "Введите сумму"
                        }
                        onChange={(event) => {
                          rechargeKey.current = "";
                          setRecharge(event.target.value);
                        }}
                      />
                    </label>
                  </div>
                  <div className="wpay-aura-info mt-4">
                    {infoRow(
                      "Минимум",
                      fees ? `${fees.minimum_recharge_amount} USDT` : "—",
                    )}
                    {infoRow(
                      "Комиссия",
                      fees
                        ? `${physical ? fees.physical_recharge_fee_pct : fees.recharge_fee_pct}%`
                        : "—",
                    )}
                  </div>
                  <Button
                    large
                    rounded
                    data-wpay-primary=""
                    className="wpay-aura-primary !mt-5 !w-full"
                    disabled={
                      Boolean(busy) ||
                      !fees ||
                      !/^\d+(?:[.,]\d{1,6})?$/.test(recharge) ||
                      Number(recharge.replace(",", ".")) <= 0
                    }
                    onClick={() =>
                      mutate(
                        "recharge",
                        async () => {
                          rechargeKey.current ||= operationKey();
                          const result = await walletIdempotentRequest(
                            "aura-card-recharge",
                            {
                              card_id: selected.card_id,
                              amount: recharge.replace(",", "."),
                            },
                            rechargeKey.current,
                          );
                          rechargeKey.current = "";
                          setRecharge("");
                          return result;
                        },
                        "Карта пополнена",
                      )
                    }
                  >
                    Пополнить
                  </Button>
                </>
              )}
              {displayPanel === "activation" && selected && (
                <>
                  {selected.kind === "physical" &&
                    selected.status === "opened" &&
                    selected.delivery_status !== "activated" && (
                      <div className="mt-5 border-t border-black/5 pt-5 dark:border-white/10">
                        <label className="text-[13px] font-medium">
                          Код активации из конверта
                        </label>
                        <div className="mt-2 flex gap-2">
                          <input
                            aria-label="Код активации из конверта"
                            value={activationCode}
                            onChange={(event) =>
                              setActivationCode(event.target.value)
                            }
                            autoComplete="one-time-code"
                            className="min-w-0 flex-1 rounded-2xl bg-black/5 px-4 py-3 outline-none dark:bg-white/10"
                          />
                          <Button
                            rounded
                            disabled={Boolean(busy) || !activationCode}
                            onClick={() =>
                              mutate(
                                "aura-card-activate",
                                async () => {
                                  const result = await walletRequest(
                                    "aura-card-activate",
                                    {
                                      card_id: selected.card_id,
                                      activation_code: activationCode,
                                    },
                                  );
                                  setActivationCode("");
                                  return result;
                                },
                                "Карта активирована",
                              )
                            }
                          >
                            Активировать
                          </Button>
                        </div>
                      </div>
                    )}
                </>
              )}
              {displayPanel === "pin" && selected && (
                <>
                  {selected.status === "opened" && (
                    <div className="mt-5 border-t border-black/5 pt-5 dark:border-white/10">
                      <label className="text-[13px] font-medium">
                        PIN аккаунта держателя
                      </label>
                      <div className="mt-2 flex gap-2">
                        <input
                          aria-label="PIN держателя"
                          value={pin}
                          onChange={(event) =>
                            setPin(
                              event.target.value.replace(/\D/g, "").slice(0, 6),
                            )
                          }
                          inputMode="numeric"
                          type="password"
                          autoComplete="new-password"
                          placeholder="6 цифр"
                          className="min-w-0 flex-1 rounded-2xl bg-black/5 px-4 py-3 outline-none dark:bg-white/10"
                        />
                        <Button
                          rounded
                          disabled={Boolean(busy) || pin.length !== 6}
                          onClick={() =>
                            mutate(
                              "aura-card-pin",
                              async () => {
                                const result = await walletRequest(
                                  "aura-card-pin",
                                  { card_id: selected.card_id, pin },
                                );
                                setPin("");
                                return result;
                              },
                              "PIN установлен",
                            )
                          }
                        >
                          Установить
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {["details", "more"].includes(displayPanel) && selected && (
                <>
                  {displayPanel === "details" && (
                    <div className="mb-5">
                      <LiveCardArtwork card={selected} skin={skin} />
                    </div>
                  )}
                  <div className="wpay-aura-info">
                    {infoRow(
                      "Тип карты",
                      physical ? "Физическая" : "Виртуальная",
                    )}
                    {infoRow(
                      "Статус",
                      selected.frozen
                        ? "Заморожена"
                        : (statusText[selected.status] ?? selected.status),
                    )}
                    {infoRow("Номер", selected.masked_pan ?? "Ещё не присвоен")}
                  </div>
                  <h2 className="wpay-aura-panel-heading">Управление</h2>
                  <div className="wpay-aura-menu">
                    {canUse && (
                      <>
                        <PanelRow
                          title="Реквизиты карты"
                          Icon={Eye}
                          onClick={() => void reveal("credentials")}
                        />
                        <PanelRow
                          title="Код 3DS"
                          Icon={MessageSquareLock}
                          onClick={() => void reveal("otp")}
                        />
                        <PanelRow
                          title="PIN держателя"
                          Icon={KeyRound}
                          onClick={() => openPanel("pin")}
                        />
                      </>
                    )}
                    {physical && (
                      <PanelRow
                        title="Доставка и активация"
                        Icon={Truck}
                        onClick={() => openPanel("delivery")}
                      />
                    )}
                    <PanelRow
                      title="Тарифы"
                      Icon={ShieldCheck}
                      onClick={() => openPanel("fees")}
                    />
                    {selected.status === "processing" && (
                      <button
                        className="wpay-aura-cancel"
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          control(
                            "aura-card-cancel",
                            { card_id: selected.card_id },
                            "Заявка отменена",
                          )
                        }
                      >
                        Отменить выпуск карты
                      </button>
                    )}
                  </div>
                </>
              )}
              {displayPanel === "fees" && (
                <div className="wpay-aura-info">
                  {infoRow(
                    "Виртуальная карта",
                    fees ? `${fees.open_virtual_card_fee} USDT` : "—",
                  )}
                  {infoRow(
                    "Физическая карта",
                    fees?.open_physical_card_fee
                      ? `${fees.open_physical_card_fee} USDT`
                      : "Недоступна",
                  )}
                  {infoRow(
                    "Пополнение виртуальной",
                    fees ? `${fees.recharge_fee_pct}%` : "—",
                  )}
                  {infoRow(
                    "Пополнение физической",
                    fees ? `${fees.physical_recharge_fee_pct}%` : "—",
                  )}
                </div>
              )}
              {displayPanel === "delivery" && selected && (
                <>
                  <div className="wpay-aura-delivery-icon">
                    <Truck size={36} />
                  </div>
                  <h2 className="text-center text-[24px] font-semibold">
                    {deliveryText[selected.delivery_status ?? ""] ??
                      "Статус уточняется"}
                  </h2>
                  <p className="mb-5 mt-2 text-center text-[14px] text-black/45 dark:text-white/45">
                    {selected.delivery_status === "activated"
                      ? "Карта активирована и готова к использованию."
                      : "Отслеживайте статус карты здесь. После получения активируйте её кодом из конверта."}
                  </p>
                  <div className="wpay-aura-info">
                    {infoRow("Карта", selected.masked_pan ?? "Выпускается")}
                    {infoRow(
                      "Доставка",
                      deliveryText[selected.delivery_status ?? ""] ??
                        "Нет обновлений",
                    )}
                  </div>
                  {canUse && selected.delivery_status !== "activated" && (
                    <Button
                      large
                      rounded
                      data-wpay-primary=""
                      className="wpay-aura-primary !mt-5 !w-full"
                      onClick={() => openPanel("activation")}
                    >
                      Карта получена — активировать
                    </Button>
                  )}
                </>
              )}
            </main>
          </Page>
        </div>
      </Popup>
    </>
  );
}
const operationStatus = (status: string) =>
  ({
    completed: "Завершено",
    processing: "Обрабатывается",
    pending: "Ожидает",
    failed: "Не выполнено",
    declined: "Отклонено",
    refunded: "Возвращено",
  })[status] ?? status;
function PanelRow({
  title,
  Icon,
  onClick,
}: {
  title: string;
  Icon: React.ElementType;
  onClick: () => void;
}) {
  return (
    <button type="button" className="wpay-aura-panel-row" onClick={onClick}>
      <Icon size={23} />
      <span>{title}</span>
      <ChevronRight size={18} />
    </button>
  );
}
function LiveCardArtwork({
  card,
  kind,
  skin,
}: {
  card?: AuraCard;
  kind?: "physical" | "virtual";
  skin: CardSkin;
}) {
  return (
    <WalletCardFace
      skin={skin}
      kind={card?.kind ?? kind ?? "virtual"}
      status={
        card
          ? card.frozen
            ? "Заморожена"
            : (statusText[card.status] ?? card.status)
          : "Новая карта"
      }
      maskedPan={card?.masked_pan}
      offer={!card}
    />
  );
}

const shippingLabels: Record<keyof ShippingAddress, string> = {
  full_name: "Получатель",
  phone: "Телефон",
  country: "Код страны",
  city: "Город",
  address_line: "Улица, дом, квартира",
  postal_code: "Индекс",
};
const shippingAutoComplete: Record<keyof ShippingAddress, string> = {
  full_name: "name",
  phone: "tel",
  country: "country",
  city: "address-level2",
  address_line: "street-address",
  postal_code: "postal-code",
};
