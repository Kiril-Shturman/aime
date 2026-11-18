import WalletSubscriptionFeatures from "./WalletSubscriptionFeatures";
import WalletCardFace, { type CardSkin } from "./WalletCardFace";
import PlusCircleFill from "framework7-icons/react/esm/PlusCircleFill.js";
import EyeFill from "framework7-icons/react/esm/EyeFill.js";
import Snow from "framework7-icons/react/esm/Snow.js";
import Ellipsis from "framework7-icons/react/esm/Ellipsis.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, List, ListItem } from "konsta/react";
import {
  f7,
  Popup,
  Page,
  Navbar,
  NavRight,
  Link,
  Preloader,
} from "framework7-react";
import "framework7/components/dialog/css";
import {
  CreditCard,
  Copy,
  Truck,
  KeyRound,
  ShieldCheck,
  MessageSquareLock,
  ChevronRight,
  History,
  Eye,
  EyeOff,
  ArrowUpRight,
  Trash2,
} from "lucide-react";
import { haptic } from "../lib/telegram";
import "./WalletAuraCards.css";
import { DesktopOwnedCards, useDesktopWalletLayout } from "./WalletDesktop";
import {
  walletIdempotentRequest,
  walletNullableRequest,
  walletRequest,
  WalletApiError,
} from "../lib/wallet-api";
import { useLiveWallet, usd } from "./WalletLive";

const DEMO_CARD_ID = "wpay-ui-demo-card";
type AuraCard = {
  demo?: boolean;
  plan_id?: string;
  skin?: CardSkin;
  balance?: string | null;
  currency?: string;
  tracking?: { carrier?: string; number?: string; url?: string } | null;
  card_id: string;
  kind: "virtual" | "physical";
  status: "processing" | "opened" | "failed_to_open" | "cancelled";
  frozen: boolean;
  masked_pan: string | null;
  delivery_status: string | null;
  provider_updated_at: string | null;
};
type CardPlan = {
  plan_id: string;
  label: string;
  kind: string;
  skin: CardSkin;
  issue_fee: string | null;
  available: boolean;
  tariff_configured?: boolean;
  service_recharge_pct: string;
  service_minimum_fee: string;
};
type CardQuote = {
  spendable?: string;
  funding_error?: string | null;
  quote_id: string;
  retry_key?: string | null;
  total: string;
  reserve: string;
  provider_fee: string;
  service_fee: string;
  can_afford: boolean;
  estimated: boolean;
  expires_at: number;
};
type CardFees = {
  plans?: CardPlan[];
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
  const [quote, setQuote] = useState<CardQuote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [quoteRetry, setQuoteRetry] = useState(0);
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
  const [cardWithdrawal, setCardWithdrawal] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [pin, setPin] = useState("");
  const [cvvVisible, setCvvVisible] = useState(false);
  const [credentials, setCredentials] = useState<CardCredentials | null>(null);
  const [otp, setOtp] = useState<CardOtp | null | undefined>(undefined);
  const [panel, setPanel] = useState<string | null>(null);
  const [displayPanel, setDisplayPanel] = useState("more");
  const desktop = useDesktopWalletLayout();
  const [activeSlide, setActiveSlide] = useState(0);
  const carousel = useRef<HTMLDivElement>(null);
  const scrollTarget = useRef<number | null>(null);
  const touchingCarousel = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const revealRequest = useRef<AbortController | null>(null);
  const freezeConfirmation = useRef<ReturnType<typeof f7.dialog.create> | null>(
    null,
  );
  useEffect(
    () => () => {
      freezeConfirmation.current?.close(false);
      freezeConfirmation.current = null;
    },
    [selectedId],
  );
  const busyRef = useRef(false);
  const issueKey = useRef("");
  const rechargeKey = useRef("");
  useEffect(() => () => revealRequest.current?.abort(), []);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        revealRequest.current?.abort();
        setCredentials(null);
        setCvvVisible(false);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);

  const loadCards = useCallback(async () => {
    setError("");
    try {
      const [cardResponse, feeResponse] = await Promise.allSettled([
        walletRequest<{ data: AuraCard[]; refresh_warning?: string }>(
          "aura-cards",
        ),
        walletRequest<CardFees>("aura-card-fees"),
      ]);
      if (cardResponse.status === "rejected") throw cardResponse.reason;
      const availableCards: AuraCard[] = cardResponse.value.data;
      setCards(availableCards);
      if (feeResponse.status === "fulfilled") setFees(feeResponse.value);
      else {
        setFees(null);
        setError(errorText(feeResponse.reason));
      }
      if (cardResponse.value.refresh_warning)
        setError(
          "Не удалось обновить данные карты. Показано последнее сохранённое состояние.",
        );
      setSelectedId((current) =>
        current && availableCards.some((card) => card.card_id === current)
          ? current
          : (availableCards[0]?.card_id ?? null),
      );
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCards();
    const refresh = window.setInterval(() => {
      if (!document.hidden && !busyRef.current) void loadCards();
    }, 30_000);
    return () => window.clearInterval(refresh);
  }, [loadCards]);
  useEffect(() => {
    if (!selectedId || selectedId === DEMO_CARD_ID) {
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
  const shippingKey = JSON.stringify(shipping);
  const issuePlanId =
    issueKind === "physical"
      ? skin === "graphite"
        ? "card_platinum"
        : "card_premium"
      : skin === "navy"
        ? "card_travel"
        : "card_subscriptions";
  const issuePlan = fees?.plans?.find((plan) => plan.plan_id === issuePlanId);
  const planPrice = (kind: string, appearance?: CardSkin) => {
    const plan = fees?.plans?.find(
      (plan) => plan.kind === kind && plan.skin === appearance,
    );
    return plan
      ? plan.issue_fee === null
        ? "Тариф не настроен"
        : plan.issue_fee + " USDT"
      : (kind === "physical"
          ? fees?.open_physical_card_fee
          : fees?.open_virtual_card_fee) + " USDT";
  };
  useEffect(() => {
    if (panel !== "issue" && panel !== "recharge") return;
    const controller = new AbortController();
    setQuote(null);
    setQuoteError("");
    setQuoteBusy(true);
    if (
      panel === "recharge" &&
      (!selectedId ||
        !/^\d+(?:[.,]\d{1,6})?$/.test(recharge) ||
        Number(recharge.replace(",", ".")) <= 0)
    ) {
      setQuoteBusy(false);
      return;
    }
    const timer = setTimeout(() => {
      void walletRequest<CardQuote>(
        "card-quote",
        panel === "issue"
          ? {
              operation: "issue",
              plan_id: issuePlanId,
              ...(issueKind === "physical"
                ? { shipping_address: JSON.parse(shippingKey) }
                : {}),
            }
          : {
              operation: "recharge",
              card_id: selectedId,
              amount: recharge.replace(",", "."),
            },
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted) setQuote(result);
        })
        .catch((error) => {
          if (!controller.signal.aborted) setQuoteError(errorText(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) setQuoteBusy(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    panel,
    issuePlanId,
    selectedId,
    recharge,
    quoteRetry,
    shippingKey,
    issueKind,
  ]);
  useEffect(() => {
    if (panel !== "issue" && panel !== "recharge") return;
    const refresh = () => {
      if (!document.hidden && !busyRef.current)
        setQuoteRetry((value) => value + 1);
    };
    const timer = window.setInterval(refresh, 20_000);
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [panel]);
  const copyCardValue = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      haptic("light");
      showNotice(message);
    } catch {
      showNotice("Не удалось скопировать реквизиты");
    }
  };
  const mutate = async (
    name: string,
    task: () => Promise<unknown>,
    success: string | ((result: unknown) => string),
  ) => {
    if (busyRef.current) return;
    if (selected?.demo && name !== "issue") {
      if (name === "aura-card-freeze" || name === "aura-card-unfreeze") {
        setCards((items) =>
          items.map((card) =>
            card.demo ? { ...card, frozen: !card.frozen } : card,
          ),
        );
        showNotice(
          typeof success === "string" ? success : "Демо: баланс не изменён",
        );
      } else
        showNotice(
          "Демо-карта: действие показано для примера, деньги не списываются",
        );
      return;
    }
    busyRef.current = true;
    setBusy(name);
    setError("");
    try {
      const result = await task();
      await Promise.all([loadCards(), wallet.refresh()]);
      showNotice(typeof success === "function" ? success(result) : success);
    } catch (requestError) {
      setError(errorText(requestError));
      if (
        requestError instanceof WalletApiError &&
        [400, 401, 403, 404, 409, 412, 422].includes(
          requestError.httpStatus ?? 0,
        )
      ) {
        issueKey.current = "";
        rechargeKey.current = "";
        setQuoteRetry((value) => value + 1);
      }
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  };
  const issue = () =>
    mutate(
      "issue",
      async () => {
        if (!quote) return;
        issueKey.current ||= quote.retry_key ?? operationKey();
        const result = await walletIdempotentRequest(
          "aura-cards",
          issueKind === "physical"
            ? {
                kind: issueKind,
                shipping_address: shipping,
                plan_id: issuePlanId,
                quote_id: quote.quote_id,
              }
            : {
                kind: issueKind,
                plan_id: issuePlanId,
                quote_id: quote.quote_id,
              },
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
    setCvvVisible(false);
    setOtp(undefined);
    setError("");
    setDisplayPanel(name);
    setPanel(name);
  };
  const closePanel = () => {
    revealRequest.current?.abort();
    setPanel(null);
    setCredentials(null);
    setCvvVisible(false);
    setOtp(undefined);
    setPin("");
    setActivationCode("");
  };
  const selectCard = (id: string) => {
    revealRequest.current?.abort();
    setCredentials(null);
    setCvvVisible(false);
    setOtp(undefined);
    setPin("");
    setActivationCode("");
    setSelectedId(id);
  };
  const reveal = async (kind: "credentials" | "otp") => {
    if (!selected || busyRef.current) return;
    if (kind === "credentials") {
      setCvvVisible(false);
      if (credentials?.card_id === selected.card_id) {
        setCredentials(null);
        setCvvVisible(false);
        return;
      }
      setPanel(null);
      carousel.current?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "smooth",
      });
    } else openPanel(kind);
    if (selected.demo) {
      if (kind === "credentials")
        setCredentials({
          card_id: DEMO_CARD_ID,
          number: "0000 0000 0000 4242",
          expiry: "12/29",
          cvv: "123",
        });
      else setOtp(null);
      return;
    }
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
  const carouselOffers = desktop ? [] : offers;
  const activeOffer = carouselOffers[activeSlide - cards.length];
  useEffect(() => {
    if (desktop && activeSlide >= cards.length && activeSlide !== 0) {
      scrollTarget.current = null;
      carousel.current?.scrollTo({ left: 0, behavior: "instant" });
      setActiveSlide(0);
    }
  }, [desktop, activeSlide, cards.length]);
  const offerKind = activeOffer?.kind;
  const showOffer = !desktop && !loading && Boolean(offerKind || !cards.length);
  const currentKind = offerKind ?? issueKind;
  const travelOffer = currentKind === "virtual" && activeOffer?.skin === "navy";
  const premiumOffer =
    currentKind === "physical" && activeOffer?.skin === "ice";
  const tariffKind = selected?.kind;
  const tariffPlan = fees?.plans?.find((plan) => plan.plan_id === selected?.plan_id);
  const tariffRechargeFee = tariffKind === "physical"
    ? fees?.physical_recharge_fee_pct : fees?.recharge_fee_pct;
  const physical = selected?.kind === "physical";
  const canUse = selected?.status === "opened";
  const slideLeft = (el: HTMLDivElement, index: number) => {
    const slide = el.children[index] as HTMLElement | undefined;
    return slide
      ? slide.getBoundingClientRect().left -
          el.getBoundingClientRect().left +
          el.scrollLeft
      : 0;
  };
  const nearestSlide = (el: HTMLDivElement) => {
    let nearest = 0,
      distance = Infinity;
    Array.from(el.children).forEach((_, index) => {
      const next = Math.abs(el.scrollLeft - slideLeft(el, index));
      if (next < distance) {
        nearest = index;
        distance = next;
      }
    });
    return nearest;
  };
  const settleCarousel = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const el = carousel.current;
      if (!el || touchingCarousel.current || drag.current) return;
      const index = scrollTarget.current ?? nearestSlide(el);
      const left = slideLeft(el, index);
      if (Math.abs(el.scrollLeft - left) > 1.5) {
        scrollTarget.current = index;
        el.scrollTo({ left, behavior: "smooth" });
      } else scrollTarget.current = null;
    }, 140);
  };
  const jumpTo = (index: number) => {
    const el = carousel.current;
    scrollTarget.current = index;
    if (el) el.scrollTo({ left: slideLeft(el, index), behavior: "smooth" });
    setActiveSlide(index);
    if (cards[index]) selectCard(cards[index].card_id);
    else {
      revealRequest.current?.abort();
      setCredentials(null);
      setCvvVisible(false);
    }
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
    withdraw: "Вывести с карты",
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
  const confirmFreeze = () => {
    if (!selected || busyRef.current || freezeConfirmation.current?.opened)
      return;
    const unfreeze = selected.frozen;
    freezeConfirmation.current = f7.dialog.create({
      cssClass: "wpay-card-freeze-confirm",
      title: unfreeze ? "Разморозить карту?" : "Заморозить карту?",
      text: unfreeze
        ? "После разморозки картой снова можно будет оплачивать покупки."
        : "Оплата картой будет временно недоступна. Вы сможете разморозить её в любой момент.",
      destroyOnClose: true,
      buttons: [
        { text: "Отмена", keyCodes: [27] },
        {
          text: unfreeze ? "Разморозить" : "Заморозить",
          strong: true,
          keyCodes: [13],
          onClick: () =>
            void control(
              unfreeze ? "aura-card-unfreeze" : "aura-card-freeze",
              { card_id: selected.card_id },
              unfreeze ? "Карта разморожена" : "Карта заморожена",
            ),
        },
      ],
      on: {
        closed: () => {
          if (!freezeConfirmation.current?.opened)
            freezeConfirmation.current = null;
        },
      },
    });
    freezeConfirmation.current.open();
  };
  const confirmDeleteCard = () => {
    if (!selected || busyRef.current || freezeConfirmation.current?.opened)
      return;
    freezeConfirmation.current = f7.dialog.create({
      cssClass: "wpay-card-freeze-confirm",
      title: selected.demo ? "Удалить демо-карту?" : "Закрытие карты",
      text: selected.demo
        ? "Пример карты исчезнет из карусели. Настоящие карты и баланс не изменятся."
        : "Закрытие выпущенной карты пока недоступно в приложении. Обратитесь в поддержку.",
      destroyOnClose: true,
      buttons: selected.demo
        ? [
            { text: "Отмена", keyCodes: [27] },
            {
              text: "Удалить",
              color: "red",
              strong: true,
              onClick: () => {
                setPanel(null);
                setCredentials(null);
                setCvvVisible(false);
                setCards((items) =>
                  items.filter((card) => card.card_id !== selected.card_id),
                );
                setSelectedId(null);
                setActiveSlide(0);
                carousel.current?.scrollTo({ left: 0, behavior: "instant" });
                showNotice("Демо-карта удалена");
              },
            },
          ]
        : [{ text: "Понятно", strong: true }],
      on: {
        closed: () => {
          if (!freezeConfirmation.current?.opened)
            freezeConfirmation.current = null;
        },
      },
    });
    freezeConfirmation.current.open();
  };
  const actions = [
    {
      label: "Пополнить",
      Icon: PlusCircleFill,
      disabled: !canUse,
      run: () => openPanel("recharge"),
    },
    {
      label:
        credentials?.card_id === selected?.card_id && credentials
          ? "Скрыть"
          : "Реквизиты",
      Icon: EyeFill,
      disabled: !canUse || busy === "credentials",
      run: () => void reveal("credentials"),
    },
    {
      label: selected?.frozen ? "Разморозить" : "Заморозить",
      Icon: Snow,
      disabled: !canUse,
      run: confirmFreeze,
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
      topup: "Пополнение",
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
        <div className={desktop || loading || (!showOffer && selected) ? "wpay-desktop-balance-card wpay-desktop-card-selection" : undefined}>
          <section className="px-safe-4 pb-2 pt-5" aria-label="Выбор карты">
            {loading ? (
              <div
                className="wpay-aura-card-skeleton animate-pulse"
                role="status"
                aria-label="Загружаем карты"
              >
                <span className="wpay-card-skeleton-logo" aria-hidden="true" />
                <span className="wpay-card-skeleton-chip" aria-hidden="true" />
                <span className="wpay-card-skeleton-number" aria-hidden="true" />
              </div>
            ) : desktop && !cards.length ? (
              <div className="wpay-aura-empty">
                <CreditCard size={30} aria-hidden="true" />
                <p>У вас пока нет карт</p>
              </div>
            ) : (
              <>
                <div
                  ref={carousel}
                  className="wpay-aura-carousel wpay-card-peek-carousel"
                  onTouchStart={() => {
                    touchingCarousel.current = true;
                    scrollTarget.current = null;
                    if (settleTimer.current) clearTimeout(settleTimer.current);
                  }}
                  onTouchEnd={() => {
                    touchingCarousel.current = false;
                    settleCarousel();
                  }}
                  onTouchCancel={() => {
                    touchingCarousel.current = false;
                    settleCarousel();
                  }}
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
                    settleCarousel();
                    if (event.currentTarget.hasPointerCapture(event.pointerId))
                      event.currentTarget.releasePointerCapture(event.pointerId);
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                    if (carousel.current)
                      carousel.current.style.scrollSnapType = "";
                    settleCarousel();
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
                    settleCarousel();
                    const index = nearestSlide(event.currentTarget);
                    if (scrollTarget.current !== null) {
                      const target = scrollTarget.current;
                      if (
                        Math.abs(
                          event.currentTarget.scrollLeft -
                            slideLeft(event.currentTarget, target),
                        ) > 2
                      )
                        return;
                      scrollTarget.current = null;
                    }
                    setActiveSlide(index);
                    const card = cards[index];
                    if (card && card.card_id !== selectedId)
                      selectCard(card.card_id);
                    else if (!card) {
                      revealRequest.current?.abort();
                      setCredentials(null);
                      setCvvVisible(false);
                    }
                  }}
                >
                  {cards.map((card) => (
                    <div
                      key={card.card_id}
                      className="wpay-aura-carousel-item wpay-owned-card-item"
                    >
                      <button
                        type="button"
                        className="wpay-card-surface-button"
                        aria-label={
                          credentials?.card_id === card.card_id
                            ? "Скрыть реквизиты карты"
                            : `Открыть ${card.kind === "physical" ? "физическую" : "виртуальную"} карту ${card.masked_pan ?? ""}`
                        }
                        onClick={() => {
                          if (credentials?.card_id === card.card_id) {
                            setCredentials(null);
                            setCvvVisible(false);
                            return;
                          }
                          selectCard(card.card_id);
                          openPanel("details");
                        }}
                      >
                        <span
                          className={`wpay-card-flip ${credentials?.card_id === card.card_id ? "wpay-card-flip--revealed" : ""}`}
                        >
                          <span className="wpay-card-flip-inner">
                            <span
                              className="wpay-card-flip-front"
                              aria-hidden={credentials?.card_id === card.card_id}
                            >
                              <LiveCardArtwork
                                card={card}
                                skin={issuedCardSkin(card)}
                              />
                            </span>
                            <span
                              className="wpay-card-flip-back"
                              aria-hidden={credentials?.card_id !== card.card_id}
                              role="group"
                              aria-label="Реквизиты карты"
                            >
                              <span className="wpay-card-back-stripe" />
                              <img
                                className="wpay-card-back-logo"
                                src="/brands/wpay-wordmark.svg"
                                alt="wPay"
                              />
                              <span className="wpay-card-back-number">
                                <small>НОМЕР КАРТЫ</small>
                                <span>
                                  {credentials?.card_id === card.card_id
                                    ? credentials.number
                                        .replace(/\s/g, "")
                                        .match(/.{1,4}/g)
                                        ?.join(" ")
                                    : card.masked_pan}
                                </span>
                              </span>
                              <span className="wpay-card-back-fields">
                                <span>
                                  <small>ДЕЙСТВУЕТ ДО</small>
                                  <b>
                                    {credentials?.card_id === card.card_id
                                      ? credentials.expiry
                                      : "••/••"}
                                  </b>
                                </span>
                                <span>
                                  <small>CVV</small>
                                  <b>
                                    {credentials?.card_id === card.card_id &&
                                    cvvVisible
                                      ? credentials.cvv
                                      : "•••"}
                                  </b>
                                </span>
                              </span>
                              <span className="wpay-card-back-hint">
                                {card.demo ? "Демо-карта · " : ""}Нажмите, чтобы
                                скрыть
                              </span>
                            </span>
                          </span>
                        </span>
                      </button>
                      {credentials?.card_id === card.card_id && (
                        <>
                          <button
                            type="button"
                            className="wpay-card-copy wpay-card-copy--number"
                            aria-label="Скопировать номер карты"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              void copyCardValue(
                                credentials.number.replace(/\s/g, ""),
                                "Номер карты скопирован",
                              );
                            }}
                          >
                            <Copy size={17} />
                          </button>
                          <button
                            type="button"
                            className="wpay-card-copy wpay-card-copy--expiry"
                            aria-label="Скопировать срок действия"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              void copyCardValue(
                                credentials.expiry,
                                "Срок действия скопирован",
                              );
                            }}
                          >
                            <Copy size={17} />
                          </button>
                        </>
                      )}
                      {credentials?.card_id === card.card_id && (
                        <button
                          type="button"
                          className="wpay-card-cvv-toggle"
                          aria-label={cvvVisible ? "Скрыть CVV" : "Показать CVV"}
                          aria-pressed={cvvVisible}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            haptic("light");
                            setCvvVisible((value) => !value);
                          }}
                        >
                          {cvvVisible ? <Eye size={19} /> : <EyeOff size={19} />}
                        </button>
                      )}
                    </div>
                  ))}
                  {carouselOffers.map(({ kind, skin: appearance }) => (
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
                    { length: cards.length + carouselOffers.length },
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
          {!loading && !showOffer && selected && (
            <>
              {selected.demo && (
                <p className="mx-4 mb-2 text-center text-[12px] text-black/45 dark:text-white/45">
                  Демо-карта · Пример меню выпущенной карты
                </p>
              )}
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
            </>
          )}
        </div>
        {loading ? (
          <section
            className="wpay-cards-loading px-4"
            aria-label="Загружаем содержимое карт"
            aria-hidden="true"
          >
            <div className="wpay-cards-loading-dots">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="wpay-cards-loading-actions">
              {[0, 1, 2, 3].map((key) => (
                <span key={key} />
              ))}
            </div>
            <span className="wpay-cards-loading-title" />
            <div className="wpay-cards-loading-lines">
              <span />
              <span />
            </div>
            <div className="wpay-cards-loading-tiles">
              {[0, 1, 2, 3, 4, 5].map((key) => (
                <div key={key}>
                  <span />
                  <span />
                  <i />
                </div>
              ))}
            </div>
          </section>
        ) : showOffer ? (
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
              {fees?.plans
                ?.filter(
                  (plan) =>
                    plan.kind === currentKind &&
                    plan.skin === activeOffer?.skin,
                )
                .map((plan) => (
                  <div key={plan.plan_id}>
                    {infoRow(
                      "Комиссия wPay за пополнение",
                      `${plan.service_recharge_pct}% · минимум ${plan.service_minimum_fee} USDT`,
                    )}
                  </div>
                ))}
              {premiumOffer && infoRow("Доставка", "Бесплатно")}
              {infoRow(
                "Выпуск",
                fees
                  ? planPrice(currentKind, activeOffer?.skin)
                  : "Тариф загружается",
              )}
            </div>
            <Button
              rounded
              large
              data-wpay-primary=""
              className="wpay-aura-primary !mt-4 !w-full"
              disabled={
                !fees ||
                Boolean(busy) ||
                fees.plans?.find(
                  (plan) =>
                    plan.kind === currentKind &&
                    plan.skin === activeOffer?.skin,
                )?.available === false
              }
              onClick={() => order(currentKind, activeOffer?.skin)}
            >
              Оформить карту
            </Button>
          </section>
        ) : (
          selected && (
            <>
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
                          {["refund", "recharge", "topup"].includes(
                            op.operation_type,
                          )
                            ? "+"
                            : "−"}
                          {op.asset === "USDT" || op.asset === "USD"
                            ? usd(Number(op.amount))
                            : `${op.amount} ${op.asset}`}
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
      <aside className="wpay-card-tariff-aside" aria-label="Тарифы карт">
        {desktop && (
          <DesktopOwnedCards
            cards={cards.map((card) => ({
              id: card.card_id,
              label: fees?.plans?.find((plan) => plan.plan_id === card.plan_id)?.label
                ?? (card.kind === "physical" ? "Физическая карта" : "Виртуальная карта"),
              number: card.masked_pan,
              artwork: <LiveCardArtwork card={card} skin={issuedCardSkin(card)} />,
            }))}
            selectedId={selectedId}
            onSelect={jumpTo}
          />
        )}
        <section className="wpay-desktop-card">
          <div className="wpay-desktop-section-head"><h2>Тарифы и выпуск</h2></div>
          {fees ? (
            <div className="wpay-desktop-card-offers">
              {offers.map(({ kind, skin: appearance }) => {
                const plan = fees.plans?.find((item) => item.kind === kind && item.skin === appearance);
                const label = plan?.label ?? {
                  silver: "Для подписок", navy: "Для путешествий",
                  ice: "Премиальная", graphite: "Платина",
                }[appearance];
                return (
                  <button key={appearance} type="button" disabled={Boolean(busy) || plan?.available === false || plan?.issue_fee === null || (!plan && !(kind === "physical" ? fees.open_physical_card_fee : fees.open_virtual_card_fee))}
                    onClick={() => order(kind, appearance)}>
                    <span><strong>{label}</strong><small>{planPrice(kind, appearance)}</small></span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="wpay-desktop-fx-status">{loading ? "Тарифы загружаются…" : "Тарифы пока недоступны"}</p>
          )}
        </section>
        {selected && <section className="wpay-desktop-card" aria-label="Тариф выбранной карты">
          <div className="wpay-desktop-section-head">
            <h2>Тариф карты</h2><span>USDT</span>
          </div>
          {fees && tariffKind ? (
            <>
              <p className="wpay-card-tariff-name">
                {tariffPlan?.label ?? (tariffKind === "physical" ? "Физическая карта" : "Виртуальная карта")}
              </p>
              <dl>
                <div className="wpay-desktop-rate"><dt>Минимум пополнения</dt><dd>{fees.minimum_recharge_amount} USDT</dd></div>
                <div className="wpay-desktop-rate"><dt>Комиссия за пополнение</dt><dd>{tariffRechargeFee ? `${tariffRechargeFee}%` : "—"}</dd></div>
                {tariffPlan && (
                  <div className="wpay-desktop-rate">
                    <dt>Комиссия wPay</dt>
                    <dd>{tariffPlan.service_recharge_pct}%<small>от {tariffPlan.service_minimum_fee} USDT</small></dd>
                  </div>
                )}
              </dl>
              <button type="button" className="wpay-card-tariff-link" onClick={() => openPanel("fees")}>
                Все тарифы <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            </>
          ) : (
            <p className="wpay-desktop-fx-status" role="status">{loading ? "Тариф загружается…" : "Тариф пока недоступен"}</p>
          )}
        </section>}
      </aside>
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
              {selected?.demo && displayPanel !== "issue" && (
                <p className="mb-4 text-center text-[12px] text-black/45 dark:text-white/45">
                  Демо-карта · Без реальных операций
                </p>
              )}
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
              {(displayPanel === "issue" || displayPanel === "recharge") && (
                <>
                  {quoteBusy && (
                    <div className="flex items-center gap-2 py-3 text-sm">
                      <Preloader size={18} />
                      Рассчитываем стоимость…
                    </div>
                  )}
                  {quoteError && (
                    <p role="alert" className="py-2 text-sm text-red-500">
                      {quoteError}
                    </p>
                  )}
                  {quote && !quote.can_afford && (
                    <p role="status" className="py-2 text-sm text-red-500">
                      {quote.funding_error === "AURA_FUNDS_UNAVAILABLE"
                        ? `Для оплаты карты доступно ${quote.spendable ?? "0"} USDT. Пополните баланс для карт.`
                        : "Недостаточно USDT на балансе кошелька"}
                    </p>
                  )}
                </>
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
                    {infoRow(
                      "Тариф",
                      issuePlan?.label ??
                        (issueKind === "physical"
                          ? "Физическая карта"
                          : "Виртуальная карта"),
                    )}
                    {quote &&
                      infoRow(
                        "Комиссия wPay включена",
                        `${quote.service_fee} USDT`,
                      )}
                    {issueKind === "physical" &&
                      skin === "ice" &&
                      infoRow("Доставка", "Бесплатно")}
                    {infoRow(
                      "Спишется с кошелька",
                      quote ? `${quote.total} USDT` : "Рассчитываем стоимость…",
                    )}
                  </div>
                  <Button
                    large
                    rounded
                    data-wpay-primary=""
                    className="wpay-aura-primary !mt-5 !w-full"
                    disabled={
                      !fees ||
                      !quote ||
                      !quote.can_afford ||
                      quoteBusy ||
                      Boolean(busy) ||
                      (issueKind === "physical" &&
                        Object.values(shipping).some((value) => !value.trim()))
                    }
                    onClick={() => void issue()}
                  >
                    {busy === "issue" ? (
                      <span className="flex items-center gap-2">
                        <Preloader size={20} color="white" />
                        Отправляем…
                      </span>
                    ) : (
                      "Выпустить карту"
                    )}
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
              {displayPanel === "withdraw" && selected && (
                <>
                  <p className="mb-4 text-[15px] leading-6 text-black/50 dark:text-white/50">
                    {selected.demo
                      ? "Пример вывода с карты на кошелёк wPay. Баланс не изменится."
                      : "Вывод с карты пока недоступен. Обратитесь в поддержку."}
                  </p>
                  <div className="wpay-aura-fields">
                    <label>
                      <span>Сумма, USD</span>
                      <input
                        aria-label="Сумма вывода с карты"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={cardWithdrawal}
                        disabled={!selected.demo}
                        onChange={(event) =>
                          setCardWithdrawal(event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <div className="wpay-aura-info mt-4">
                    {infoRow(
                      "Откуда",
                      `Карта ${selected.masked_pan ?? "wPay"}`,
                    )}
                    {infoRow("Куда", "Кошелёк wPay")}
                  </div>
                  <Button
                    data-wpay-primary=""
                    rounded
                    large
                    className="!mt-5 !w-full"
                    disabled={
                      !selected.demo ||
                      !Number.isFinite(Number(cardWithdrawal)) ||
                      Number(cardWithdrawal) <= 0
                    }
                    onClick={() =>
                      showNotice(
                        "Демо: вывод показан для примера, баланс не изменён",
                      )
                    }
                  >
                    Вывести
                  </Button>
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
                    {quote &&
                      infoRow("Комиссия wPay", `${quote.service_fee} USDT`)}
                    {quote &&
                      infoRow("Всего ориентировочно", `${quote.total} USDT`)}
                    {quote &&
                      infoRow(
                        "Резерв до уточнения комиссии",
                        `${quote.reserve} USDT`,
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
                      !quote ||
                      !quote.can_afford ||
                      quoteBusy ||
                      !/^\d+(?:[.,]\d{1,6})?$/.test(recharge) ||
                      Number(recharge.replace(",", ".")) <= 0
                    }
                    onClick={() =>
                      mutate(
                        "recharge",
                        async () => {
                          if (!quote) return;
                          rechargeKey.current ||=
                            quote.retry_key ?? operationKey();
                          const result = await walletIdempotentRequest(
                            "aura-card-recharge",
                            {
                              card_id: selected.card_id,
                              quote_id: quote.quote_id,
                              amount: recharge.replace(",", "."),
                            },
                            rechargeKey.current,
                          );
                          rechargeKey.current = "";
                          setRecharge("");
                          return result;
                        },
                        (result) =>
                          (result as { status?: string })?.status ===
                          "completed"
                            ? "Карта пополнена"
                            : (result as { status?: string })?.status ===
                                "failed"
                              ? "Пополнение не прошло. Средства возвращены"
                              : "Пополнение принято. Ожидаем зачисления",
                      )
                    }
                  >
                    {busy === "recharge" ? (
                      <Preloader size={20} color="white" />
                    ) : (
                      "Пополнить"
                    )}
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
                    <div className="wpay-card-detail-hero">
                      <LiveCardArtwork card={selected} skin="silver" />
                    </div>
                  )}
                  <div className="wpay-card-detail-summary">
                    <span>
                      <h2>
                        {physical ? "Физическая карта" : "Виртуальная карта"}
                      </h2>
                      <span className="wpay-card-detail-pan">
                        {selected.masked_pan ?? "Номер появится после выпуска"}
                      </span>
                    </span>
                    <span
                      className={`wpay-card-status-badge ${selected.frozen ? "is-frozen" : selected.status === "opened" ? "is-active" : ""}`}
                    >
                      <i />
                      {selected.frozen
                        ? "Заморожена"
                        : (statusText[selected.status] ?? selected.status)}
                    </span>
                  </div>
                  <h2 className="wpay-aura-panel-heading wpay-card-management-heading">
                    Управление картой
                  </h2>
                  <div className="wpay-aura-menu">
                    {canUse && (
                      <>
                        <PanelRow
                          title="Реквизиты карты"
                          Icon={Eye}
                          onClick={() => void reveal("credentials")}
                        />
                        <PanelRow
                          title="Вывести с карты"
                          Icon={ArrowUpRight}
                          onClick={() => {
                            setCardWithdrawal("");
                            openPanel("withdraw");
                          }}
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
                  <div className="wpay-aura-menu wpay-card-danger-menu">
                    <PanelRow
                      title="Удалить карту"
                      Icon={Trash2}
                      onClick={confirmDeleteCard}
                    />
                  </div>
                </>
              )}
              {displayPanel === "fees" && (
                <div className="wpay-aura-info">
                  {fees?.plans?.map((plan) => (
                    <div key={plan.plan_id}>
                      {infoRow(
                        plan.label,
                        plan.issue_fee === null
                          ? "Тариф не настроен"
                          : `${plan.issue_fee} USDT`,
                      )}
                      {infoRow(
                        "Комиссия wPay за пополнение",
                        `${plan.service_recharge_pct}% · минимум ${plan.service_minimum_fee} USDT`,
                      )}
                    </div>
                  ))}
                  {infoRow(
                    "Базовый выпуск виртуальной",
                    fees ? `${fees.open_virtual_card_fee} USDT` : "—",
                  )}
                  {infoRow(
                    "Базовый выпуск физической",
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
                  {selected.tracking && (
                    <div className="wpay-aura-info mb-4">
                      {infoRow(
                        "Служба доставки",
                        selected.tracking.carrier ?? "—",
                      )}
                      {infoRow("Трек-номер", selected.tracking.number ?? "—")}
                      {selected.tracking.url?.startsWith("https://") && (
                        <a
                          className="block py-3 text-center text-primary"
                          href={selected.tracking.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Отследить доставку
                        </a>
                      )}
                    </div>
                  )}
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
  const details: Record<string, { description: string; tone: string }> = {
    "Реквизиты карты": {
      description: "Номер, срок действия и CVV",
      tone: "blue",
    },
    "Код 3DS": { description: "Подтверждение онлайн-покупок", tone: "purple" },
    "PIN держателя": { description: "Настройка PIN держателя", tone: "orange" },
    "Доставка и активация": {
      description: "Статус и получение карты",
      tone: "blue",
    },
    Тарифы: { description: "Комиссии и условия карты", tone: "teal" },
    "Вывести с карты": {
      description: "Перевести на кошелёк wPay",
      tone: "blue",
    },
    "Удалить карту": { description: "Удаление и закрытие карты", tone: "red" },
  };
  const detail = details[title];
  return (
    <button
      type="button"
      aria-label={title}
      className="wpay-aura-panel-row wpay-card-setting"
      onClick={onClick}
    >
      <span
        className={`wpay-card-setting-icon wpay-card-setting-icon--${detail?.tone ?? "blue"}`}
      >
        <Icon size={22} />
      </span>
      <span className="wpay-card-setting-label">
        <strong>{title}</strong>
        {detail && <small>{detail.description}</small>}
      </span>
      <ChevronRight size={17} />
    </button>
  );
}
function issuedCardSkin(card: AuraCard): CardSkin {
  if (card.skin) return card.skin;
  if (card.plan_id === "card_travel") return "navy";
  if (card.plan_id === "card_platinum") return "graphite";
  return card.kind === "physical" ? "ice" : "silver";
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
        card?.demo
          ? card.frozen
            ? "Демо · Заморожена"
            : "Демо · Активна"
          : card
            ? card.frozen
              ? "Заморожена"
              : (statusText[card.status] ?? card.status)
            : "Новая карта"
      }
      balance={card?.balance}
      currency={card?.currency}
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
