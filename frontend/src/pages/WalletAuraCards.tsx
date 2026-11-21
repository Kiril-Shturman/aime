import usaServices from "../assets/card-benefits/usa-services.png";
import usaSceneFlag from "../assets/card-benefits/usa-scene-flag.png";
import usaArtwork from "../assets/card-benefits/usa-composition.png";
import travelArtwork from "../assets/card-benefits/travel-composition.png";
import subscriptionClaude from "../assets/card-benefits/subscription-claude.png";
import subscriptionArtwork from "../assets/card-benefits/subscription-composition.png";
import LogoApple from "framework7-icons/react/esm/LogoApple.js";
import LogoGoogle from "framework7-icons/react/esm/LogoGoogle.js";
import CreditcardFill from "framework7-icons/react/esm/CreditcardFill.js";
import { createPortal } from "react-dom";
import { TransactionDetails, TransactionListRow, type TransactionView } from "./WalletTransaction";
import WalletSubscriptionFeatures from "./WalletSubscriptionFeatures";
import desktopWalletIcon from "../assets/desktop-wallet-icon.svg";
import WalletCardFace, { type CardSkin } from "./WalletCardFace";
import PlusCircleFill from "framework7-icons/react/esm/PlusCircleFill.js";
import EyeFill from "framework7-icons/react/esm/EyeFill.js";
import Snow from "framework7-icons/react/esm/Snow.js";
import Ellipsis from "framework7-icons/react/esm/Ellipsis.js";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Button, Card, List, ListItem } from "konsta/react";
import {
  f7,
  Popup,
  Sheet,
  Page,
  Navbar,
  NavRight,
  Link,
  Preloader,
} from "framework7-react";
import "framework7/components/dialog/css";
import {
  Check,
  CreditCard,
  ShoppingBasket,
  Copy,
  Truck,
  KeyRound,
  ShieldCheck,
  MessageSquareLock,
  ChevronRight,
  ChevronDown,
  History,
  Eye,
  EyeOff,
  ArrowUpRight,
  Trash2,
} from "lucide-react";
import { haptic, tg } from "../lib/telegram";
import "./WalletAuraCards.css";
import { DesktopOwnedCards, useDesktopWalletLayout } from "./WalletDesktop";
import {
  walletIdempotentRequest,
  walletNullableRequest,
  walletRequest,
  WalletApiError,
} from "../lib/wallet-api";
import { useLiveWallet } from "./WalletLive";

function watchCheckoutTilt(card: HTMLDivElement) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const app = tg();
  const orientation = app?.isVersionAtLeast?.("8.0") ? app.DeviceOrientation : undefined;
  let neutral: { beta: number; gamma: number } | undefined;
  let stopped = false;
  const clampTilt = (value: number) => Math.max(-9, Math.min(9, value * 0.45));
  const update = (beta: number, gamma: number) => {
    if (motion.matches || !Number.isFinite(beta) || !Number.isFinite(gamma)) return;
    neutral ??= { beta, gamma };
    const pitch = ((beta - neutral.beta + 540) % 360) - 180;
    card.style.setProperty("--card-tilt-x", `${clampTilt(pitch)}deg`);
    card.style.setProperty("--card-tilt-y", `${clampTilt(gamma - neutral.gamma)}deg`);
  };
  const nativeUpdate = () => {
    if (orientation) update(orientation.beta * 180 / Math.PI, orientation.gamma * 180 / Math.PI);
  };
  const browserUpdate = (event: DeviceOrientationEvent) => {
    if (event.beta !== null && event.gamma !== null) update(event.beta, event.gamma);
  };
  const listenInBrowser = () => window.addEventListener("deviceorientation", browserUpdate);
  if (orientation && app?.onEvent) {
    app.onEvent("deviceOrientationChanged", nativeUpdate);
    orientation.start({ refresh_rate: 40 }, started => {
      if (stopped && started) orientation.stop();
      else if (!stopped && !started) listenInBrowser();
    });
  } else listenInBrowser();
  return () => {
    stopped = true;
    window.removeEventListener("deviceorientation", browserUpdate);
    app?.offEvent?.("deviceOrientationChanged", nativeUpdate);
    orientation?.stop();
    card.style.removeProperty("--card-tilt-x");
    card.style.removeProperty("--card-tilt-y");
  };
}

function ripplePaymentTile(event: MouseEvent<HTMLInputElement>) {
  haptic("light");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const tile = event.currentTarget.parentElement;
  if (!tile) return;
  const { left, top, width, height } = tile.getBoundingClientRect();
  const diameter = Math.hypot(width, height) * 2;
  const x = event.detail ? event.clientX - left : width / 2;
  const y = event.detail ? event.clientY - top : height / 2;
  const ripple = tile.querySelector<HTMLElement>(".wpay-goswap-payment-ripple");
  if (!ripple) return;
  ripple.getAnimations().forEach(animation => animation.cancel());
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  ripple.style.width = ripple.style.height = `${diameter}px`;
  ripple.animate([
    { transform: "translate(-50%, -50%) scale(0)", opacity: 0.19 },
    { transform: "translate(-50%, -50%) scale(1)", opacity: 0 },
  ], { duration: 360, easing: "ease-out" });
}

const offerNumber = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 8 });
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
  provider_issue_fee?: string | null;
  service_issue_fee?: string;
  service_recharge_pct: string;
  service_minimum_fee: string;
};
type StorefrontPlan = {
  plan_id: string;
  label: string;
  kind: "virtual" | "physical";
  skin: CardSkin;
  available: boolean;
  provider: "Aura" | "GoSwap";
  issue_fee: string | null;
  conditions?: string[];
  region?: string;
  provider_issue_fee?: string | null;
  provider_recharge_fee?: string;
  service_issue_fee?: string;
  service_recharge_pct?: string;
  service_minimum_fee?: string;
  total_recharge_pct?: string;
};
type GoSwapIssue = {
  wallet_available?: string;
  intent_id: string;
  label: string;
  total: string;
  state: "quoted" | "submitted" | "processing" | "completed" | "failed";
  last4?: string | null;
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
  storefront?: StorefrontPlan[];
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
  original_amount?: string | null;
  original_currency?: string | null;
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
  onSbpTopUp,
  bottomActionSlot,
  catalogOffer,
  onCatalogOffer,
}: {
  showNotice: (text: string) => void;
  onSbpTopUp?: () => void;
  bottomActionSlot: HTMLDivElement | null;
  catalogOffer: number | null;
  onCatalogOffer: (index: number | null) => void;
}) {
  const wallet = useLiveWallet();
  const [cards, setCards] = useState<AuraCard[]>([]);
  const [fees, setFees] = useState<CardFees | null>(null);
  const [quote, setQuote] = useState<CardQuote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedOperation, setSelectedOperation] = useState<TransactionView | null>(null);
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

  const [goswapIssues, setGoswapIssues] = useState<GoSwapIssue[]>([]);
  const loadCards = useCallback(async () => {
    setError("");
    try {
      const [cardResponse, feeResponse, goswapResponse] = await Promise.allSettled([
        walletRequest<{ data: AuraCard[]; refresh_warning?: string }>(
          "aura-cards",
        ),
        walletRequest<CardFees>("aura-card-fees"),
        walletRequest<{ items: GoSwapIssue[] }>("goswap-card-issues"),
      ]);
      if (goswapResponse.status === "fulfilled") setGoswapIssues(goswapResponse.value.items ?? []);
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
  const mutate = async <T,> (
    name: string,
    task: () => Promise<T>,
    success: string | ((result: T) => string),
  ) => {
    if (busyRef.current) return;
    if (selected?.demo && name !== "issue" && name !== "goswap-issue") {
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
      const message = typeof success === "function" ? success(result) : success;
      if (message) showNotice(message);
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
  const [goSwapOrder, setGoSwapOrder] = useState<{ plan: StorefrontPlan; quote: GoSwapIssue } | null>(null);
  const checkoutArtwork = useRef<HTMLDivElement>(null);
  const checkoutSwipeStart = useRef<{ x: number; y: number; sheet: HTMLElement } | null>(null);
  const resetCheckoutSwipe = () => {
    const start = checkoutSwipeStart.current;
    checkoutSwipeStart.current = null;
    start?.sheet.classList.remove("wpay-goswap-order-sheet--dragging");
    start?.sheet.style.removeProperty("--wpay-checkout-drag-y");
    return start;
  };
  const [goSwapSheetReady, setGoSwapSheetReady] = useState(false);
  const [goSwapSheetOpened, setGoSwapSheetOpened] = useState(false);
  useEffect(() => {
    if (!goSwapOrder) {
      setGoSwapSheetOpened(false);
      return;
    }
    const frame = requestAnimationFrame(() => setGoSwapSheetOpened(true));
    return () => cancelAnimationFrame(frame);
  }, [goSwapOrder]);
  useEffect(() => {
    const artwork = checkoutArtwork.current;
    if (goSwapSheetOpened && artwork && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return watchCheckoutTilt(artwork);
    }
  }, [goSwapSheetOpened]);
  const [goSwapPayment, setGoSwapPayment] = useState<"wallet" | "sbp">("wallet");
  const [goSwapSheetExpanded, setGoSwapSheetExpanded] = useState(false);
  const expandGoSwapSheet = () => {
    haptic("light");
    f7.sheet.get(".wpay-goswap-order-sheet")?.stepOpen();
    setGoSwapSheetExpanded(true);
  };
  const issueGoSwap = (plan: StorefrontPlan) => mutate("goswap-quote", async () => {
    const quote = await walletRequest<GoSwapIssue>("goswap-card-quote", { plan_id: plan.plan_id });
    if (quote.state === "quoted") {
      setGoSwapSheetReady(false);
      setGoSwapPayment("wallet");
      setGoSwapSheetExpanded(false);
      setGoSwapOrder({ plan, quote });
    }
    return quote;
  }, quote => quote.state === "quoted" ? "" : "Выпуск GoSwap в обработке");
  const payGoSwapOrder = () => {
    if (!goSwapOrder) return;
    void mutate("goswap-issue", async () => {
      try {
        return await walletRequest<GoSwapIssue>("goswap-card-issue", { intent_id: goSwapOrder.quote.intent_id });
      } finally {
        setGoSwapOrder(null);
      }
    }, result => result.state === "completed" ? "Карта GoSwap выпущена"
      : result.state === "failed" ? "Выпуск не состоялся. Резерв возвращён"
      : "Выпуск GoSwap в обработке");
  };
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
  const legacyOffers: { kind: "virtual" | "physical"; skin: CardSkin }[] = [
    { kind: "virtual", skin: "silver" },
    { kind: "virtual", skin: "navy" },
    ...(fees?.open_physical_card_fee
      ? [
          { kind: "physical" as const, skin: "ice" as const },
          { kind: "physical" as const, skin: "graphite" as const },
        ]
      : []),
  ];
  const offers = fees?.storefront?.map(plan => ({ kind: plan.kind, skin: plan.skin, plan }))
    ?? legacyOffers.map(offer => ({ ...offer, plan: undefined }));
  const carouselOffers = desktop ? [] : offers;
  const catalogEnabled = !desktop && !loading && cards.length === 0 && !goswapIssues.some(item => item.state === "completed") && offers.length > 0;
  const showCatalog = catalogEnabled && catalogOffer === null;
  const [rapiraMid, setRapiraMid] = useState<number | null>(null);
  useEffect(() => {
    if (!showCatalog) return;
    const controller = new AbortController();
    setRapiraMid(null);
    type Levels = { price: string }[];
    const prices = (levels: Levels) => levels.map(({ price }) => Number(price))
      .filter(price => Number.isFinite(price) && price > 0);
    void walletRequest<{ ask: Levels; bid: Levels }>("rapira-depth", undefined, controller.signal)
      .then(({ ask, bid }) => {
        const asks = prices(ask);
        const bids = prices(bid);
        if (!controller.signal.aborted && asks.length && bids.length) {
          setRapiraMid((Math.min(...asks) + Math.max(...bids)) / 2);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [showCatalog]);
  const catalogSwipe = useRef<{ x: number; y: number } | null>(null);
  const activeOffer = carouselOffers[activeSlide - cards.length];
  useEffect(() => {
    if (desktop && activeSlide >= cards.length && activeSlide !== 0) {
      carousel.current?.scrollTo({ left: 0, behavior: "instant" });
      setActiveSlide(0);
    }
  }, [desktop, activeSlide, cards.length]);
  const offerKind = activeOffer?.kind;
  const storefrontPlan = activeOffer?.plan;
  const goSwapOffer = storefrontPlan?.provider === "GoSwap";
  const showOffer = !desktop && !loading && Boolean(offerKind || (!cards.length && offers.length));
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
    if (!slide) return 0;
    const slideBox = slide.getBoundingClientRect();
    const railBox = el.getBoundingClientRect();
    const start = slideBox.left - railBox.left + el.scrollLeft;
    if (desktop || index === 0) return start;
    const gap = railBox.width - slideBox.width;
    return Math.max(0, start - (index === el.children.length - 1 ? gap : gap / 2));
  };
  useLayoutEffect(() => {
    const rail = carousel.current;
    if (!catalogEnabled || catalogOffer === null || !rail) return;
    const index = Math.min(catalogOffer, rail.children.length - 1);
    if (index < 0) return;
    setActiveSlide(index);
    rail.scrollTo({ left: slideLeft(rail, index), behavior: "instant" });
    // Only align when entering the carousel; swipes keep their own position.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogEnabled, catalogOffer]);

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
  const activateSlide = (index: number) => {
    if (index === activeSlide) return;
    setActiveSlide(index);
    const card = cards[index];
    if (card && card.card_id !== selectedId) selectCard(card.card_id);
    else if (!card) {
      revealRequest.current?.abort();
      setCredentials(null);
      setCvvVisible(false);
    }
  };
  const settleCarousel = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      const el = carousel.current;
      if (!el || touchingCarousel.current || drag.current) return;
      activateSlide(nearestSlide(el));
    }, 100);
  };
  const jumpTo = (index: number) => {
    const el = carousel.current;
    if (!el) return;
    const left = slideLeft(el, index);
    if (Math.abs(el.scrollLeft - left) <= 1.5) {
      activateSlide(index);
      return;
    }
    el.scrollTo({ left, behavior: "smooth" });
    settleCarousel();
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
  const offerTerms = (offer = storefrontPlan) => {
    const auraPlan = fees?.plans?.find(plan => plan.kind === currentKind && plan.skin === activeOffer?.skin);
    const goswap = offer?.provider === "GoSwap" ? offer : null;
    const plan = goswap ?? auraPlan;
    const providerTopup = goswap ? goswap.provider_recharge_fee
      : currentKind === "physical" ? fees?.physical_recharge_fee_pct : fees?.recharge_fee_pct;
    const serviceTopup = plan?.service_recharge_pct ?? "0";
    const totalTopup = goswap ? goswap.total_recharge_pct
      : providerTopup == null || providerTopup === "" ? undefined
        : Number(providerTopup) + Number(serviceTopup);
    const minimum = goswap ? "От 10 USD"
      : fees?.minimum_recharge_amount ? `От ${offerNumber.format(Number(fees.minimum_recharge_amount))} USDT` : "—";
    const issue = plan?.issue_fee != null ? `${offerNumber.format(Number(plan.issue_fee))} USDT`
      : goswap || !fees ? "—" : planPrice(currentKind, activeOffer?.skin);
    const rows: [string, string, string?][] = [
      ["Минимум пополнения", minimum, goswap ? "При первом пополнении" : undefined],
      ["Комиссия за пополнение", totalTopup == null ? "—" : `${offerNumber.format(Number(totalTopup))}%`],
    ];
    if (!goswap && premiumOffer) rows.push(["Доставка", "Бесплатно"]);
    rows.push(["Выпуск карты", issue]);
    return (
      <section aria-label="Условия карты" className="mt-5">
        <h3 className="mb-3 px-2 text-[16px] font-semibold text-black/50 dark:text-white/50">Условия карты</h3>
        <Card className="!m-0 !rounded-[26px]" contentWrapPadding="px-4 py-0">
          <dl>
            {rows.map(([label, value, note]) => (
              <div key={label} className="flex min-h-14 items-center justify-between gap-3 border-b border-black/[.06] py-3 last:border-0 dark:border-white/[.08]">
                <dt className="text-[15px] text-black/45 dark:text-white/45">{label}</dt>
                <dd className="min-w-0 text-right text-[15px] font-medium">
                  {value}
                  {note && <small className="mt-0.5 block text-[12px] font-normal text-black/50 dark:text-white/50">{note}</small>}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </section>
    );
  };
  const historyItem = (op: CardOperation): TransactionView => {
    const topup = ["recharge", "topup"].includes(op.operation_type);
    const refund = ["refund", "reversal"].includes(op.operation_type);
    const purchase = ["purchase", "payment"].includes(op.operation_type);
    const status = ["failed", "declined", "rejected"].includes(op.status) ? "failed"
      : ["processing", "pending", "authorized", "requested"].includes(op.status) ? "processing"
      : refund || op.status === "refunded" ? "refunded" : "completed";
    const original = op.original_amount != null && op.original_currency;
    const asset = original ? op.original_currency! : op.asset;
    const value = String(original ? op.original_amount : op.amount).replace(/^[+-]/, "");
    const rows: TransactionView["rows"] = [["Статус карты", operationStatus(op.status)]];
    if (op.merchant) rows.push(["Магазин", op.merchant]);
    if (op.fee != null) rows.push(["Комиссия", `${op.fee} ${op.asset}`]);
    if (op.decline_message) rows.push(["Причина", op.decline_message]);
    return {
      id: op.operation_id, kind: topup ? "card_topup" : refund ? "refund" : purchase ? "card_payment" : "other",
      title: refund ? "Возврат по карте" : !topup && !purchase ? "Операция по карте" : undefined,
      asset, amount: status === "failed" ? "0" : topup || refund ? value : `-${value}`,
      status, date: op.provider_created_at, rows,
    };
  };
  if (showCatalog) {
    return (
      <main className="wpay-card-catalog mx-auto w-full max-w-[560px] px-4 pb-6" aria-label="Витрина карт">
        {offers.map(({ kind, skin: appearance, plan }, index) => (
          <button key={plan?.plan_id ?? appearance} type="button" className="wpay-card-catalog-item"
            data-skin={appearance} data-region={plan?.region} onClick={() => { haptic("light"); onCatalogOffer(index); }}>
            <span className="wpay-card-catalog-services">
              {plan?.conditions?.includes("Apple Pay") && <span aria-label="Apple Pay"><LogoApple aria-hidden="true" />Pay</span>}
              {plan?.conditions?.includes("Google Pay") && <span aria-label="Google Pay"><LogoGoogle aria-hidden="true" />Pay</span>}
              {(appearance === "silver" || appearance === "navy") && (
                <span className="wpay-catalog-app-store" role="img" aria-label="App Store">
                  {/* Simple Icons 13.21.0, CC0 1.0 */}
                  <svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                    <path fill="white" d="M8.8086 14.9194l6.1107-11.0368c.0837-.1513.1682-.302.2437-.4584.0685-.142.1267-.2854.1646-.4403.0803-.3259.0588-.6656-.066-.9767-.1238-.3095-.3417-.5678-.6201-.7355a1.4175 1.4175 0 0 0-.921-.1924c-.3207.043-.6135.1935-.8443.4288-.1094.1118-.1996.2361-.2832.369-.092.1463-.175.2979-.259.4492l-.3864.6979-.3865-.6979c-.0837-.1515-.1667-.303-.2587-.4492-.0837-.1329-.1739-.2572-.2835-.369-.2305-.2353-.5233-.3857-.844-.429a1.4181 1.4181 0 0 0-.921.1926c-.2784.1677-.4964.426-.6203.7355-.1246.311-.1461.6508-.066.9767.038.155.0962.2984.1648.4403.0753.1564.1598.307.2437.4584l1.248 2.2543-4.8625 8.7825H2.0295c-.1676 0-.3351-.0007-.5026.0092-.1522.009-.3004.0284-.448.0714-.3108.0906-.5822.2798-.7783.548-.195.2665-.3006.5929-.3006.9279 0 .3352.1057.6612.3006.9277.196.2683.4675.4575.7782.548.1477.043.296.0623.4481.0715.1675.01.335.009.5026.009h13.0974c.0171-.0357.059-.1294.1-.2697.415-1.4151-.6156-2.843-2.0347-2.843zM3.113 18.5418l-.7922 1.5008c-.0818.1553-.1644.31-.2384.4705-.067.1458-.124.293-.1611.452-.0785.3346-.0576.6834.0645 1.0029.1212.3175.3346.583.607.7549.2727.172.5891.2416.9013.1975.3139-.044.6005-.1986.8263-.4402.1072-.1148.1954-.2424.2772-.3787.0902-.1503.1714-.3059.2535-.4612L6 19.4636c-.0896-.149-.9473-1.4704-2.887-.9218m20.5861-3.0056a1.4707 1.4707 0 0 0-.779-.5407c-.1476-.0425-.2961-.0616-.4483-.0705-.1678-.0099-.3352-.0091-.503-.0091H18.648l-4.3891-7.817c-.6655.7005-.9632 1.485-1.0773 2.1976-.1655 1.0333.0367 2.0934.546 3.0004l5.2741 9.3933c.084.1494.167.299.2591.4435.0837.131.1739.2537.2836.364.231.2323.5238.3809.8449.4232.3192.0424.643-.0244.9217-.1899.2784-.1653.4968-.4204.621-.7257.1246-.3072.146-.6425.0658-.9641-.0381-.1529-.0962-.2945-.165-.4346-.0753-.1543-.1598-.303-.2438-.4524l-1.216-2.1662h1.596c.1677 0 .3351.0009.5029-.009.1522-.009.3007-.028.4483-.0705a1.4707 1.4707 0 0 0 .779-.5407A1.5386 1.5386 0 0 0 24 16.452a1.539 1.539 0 0 0-.3009-.9158Z" />
                  </svg>
                </span>
              )}
            </span>
            <span className="wpay-card-catalog-item-heading">
              <span>
                <strong>{plan?.plan_id === "goswap_card_us" ? "Для дяди Сэма" : plan?.label ?? ({ silver: "Для подписок", navy: "Для путешествий", ice: "Премиальная", graphite: "Платина" }[appearance])}</strong>
              </span>
              <ChevronRight size={20} aria-hidden="true" />
            </span>
            <span className="wpay-card-catalog-art" aria-hidden="true">
              <LiveCardArtwork kind={kind} skin={appearance} usa={plan?.plan_id === "goswap_card_us"} />
              {plan?.plan_id === "goswap_card_us" && (
                <span className="wpay-subscription-stage wpay-card-catalog-subscription-art wpay-usa-stage">
                  <img className="wpay-usa-scene-flag" src={usaSceneFlag} alt="" />
                  <img className="subscription-composition" src={usaArtwork} alt="" />
                  <img className="wpay-usa-scene-services" src={usaServices} alt="" />
                </span>
              )}
              {appearance === "navy" && kind === "virtual" && (
                <span className="wpay-subscription-stage wpay-card-catalog-subscription-art">
                  <img className="subscription-composition" src={travelArtwork} alt="" />
                </span>
              )}
              {appearance === "silver" && kind === "virtual" && plan?.plan_id !== "goswap_card_us" && (
                <span className="wpay-card-catalog-subscription-art wpay-subscription-stage">
                  <img className="subscription-composition" src={subscriptionArtwork} alt="" />
                  <img className="subscription-claude" src={subscriptionClaude} alt="" />
                </span>
              )}
            </span>
            <span className="wpay-card-catalog-benefits">
              {plan?.plan_id === "goswap_card_us" ? "Для ключевых американских сервисов" : appearance === "silver" ? "Подписки и онлайн-покупки"
                : appearance === "navy" ? "Бронирования и покупки в поездках"
                : appearance === "ice" ? "Физическая карта с бесплатной доставкой"
                : "Физическая карта с доставкой"}
            </span>
            {plan?.plan_id === "goswap_card_us" && (
              <span className="wpay-card-catalog-region">
                <svg viewBox="0 0 26 26" aria-hidden="true">
                  <path fill="#fff" d="M0 0h26v26H0z" />
                  <path stroke="#bf2944" strokeWidth="2" d="M0 1h26M0 5h26M0 9h26M0 13h26M0 17h26M0 21h26M0 25h26" />
                  <path fill="#23457d" d="M0 0h13v14H0z" />
                  <path stroke="#fff" strokeWidth="1.4" strokeLinecap="round" d="M3 3h.1m4 0h.1m4 0h.1M5 7h.1m4 0h.1M3 11h.1m4 0h.1m4 0h.1" />
                </svg>
                США
              </span>
            )}
            {appearance !== "navy" && plan?.region === "Сингапур" && (
              <span className="wpay-card-catalog-region">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#fff" d="M0 0h24v24H0z" /><path fill="#ef3340" d="M0 0h24v12H0z" />
                  <path fill="#fff" d="M10 2.4a4.6 4.6 0 1 0 0 8.7 4.6 4.6 0 0 1 0-8.7Z" />
                  <path fill="#fff" d="M12 3h1v1h-1zm-2 2h1v1h-1zm4 0h1v1h-1zm-3 3h1v1h-1zm2 0h1v1h-1z" />
                </svg>
                Сингапур
              </span>
            )}
            <span className="wpay-card-catalog-price">
              <span><b>{plan?.available === false ? "Пока недоступен" : plan?.issue_fee != null
                ? `${offerNumber.format(Number(plan.issue_fee))}$${rapiraMid !== null
                  ? ` или ${Math.round(Number(plan.issue_fee) * rapiraMid).toLocaleString("ru-RU")}₽` : ""}` : planPrice(kind, appearance)}</b><small>Выпуск карты</small></span>
              {plan?.total_recharge_pct != null && (
                <span><b>{rapiraMid === null ? "—" : `$1 = ${(rapiraMid * (1 + Number(plan.total_recharge_pct) / 100))
                  .toLocaleString("ru-RU", { style: "currency", currency: "RUB" })}`}</b><small>Курс обмена</small></span>
              )}
            </span>
          </button>
        ))}
      </main>
    );
  }
  return (
    <>
      <main
        className="wpay-aura-cards mx-auto w-full max-w-[560px] pb-6"
        aria-label="Мои карты"
      >
        {goswapIssues.length > 0 && (
          <section className="mx-4 mt-3" aria-label="Карты GoSwap">
            <h2 className="mb-2 text-base font-semibold">Карты GoSwap</h2>
            <Card className="!m-0 !rounded-[26px]" contentWrapPadding="px-4 py-0">
              {goswapIssues.map(item => (
                <div className="flex min-h-14 items-center justify-between gap-3 border-b border-black/10 py-2 last:border-0 dark:border-white/10" key={item.intent_id}>
                  <span>{item.label}{item.last4 && ` · •••• ${item.last4}`}</span>
                  <small className="text-right opacity-60">{item.state === "completed" ? "Выпущена · ждёт пополнения"
                    : item.state === "failed" ? "Выпуск отклонён" : "Выпуск в обработке"}</small>
                </div>
              ))}
            </Card>
          </section>
        )}
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
                  className={`wpay-aura-carousel wpay-card-peek-carousel${desktop ? "" : " wpay-aura-carousel--centered"}`}
                  onTouchStart={event => {
                    const touch = event.touches[0];
                    catalogSwipe.current = catalogEnabled && event.currentTarget.scrollLeft <= 2 && touch ? { x: touch.clientX, y: touch.clientY } : null;
                    touchingCarousel.current = true;
                    if (settleTimer.current) clearTimeout(settleTimer.current);
                  }}
                  onTouchEnd={event => {
                    touchingCarousel.current = false;
                    const start = catalogSwipe.current;
                    catalogSwipe.current = null;
                    const touch = event.changedTouches[0];
                    if (start && touch && touch.clientX - start.x > 55
                      && touch.clientX - start.x > Math.abs(touch.clientY - start.y)) {
                      onCatalogOffer(null);
                      return;
                    }
                    settleCarousel();
                  }}
                  onTouchCancel={() => {
                    catalogSwipe.current = null;
                    touchingCarousel.current = false;
                    settleCarousel();
                  }}
                  onPointerDown={(event) => {
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
                    const moved = drag.current?.moved;
                    drag.current = null;
                    event.currentTarget.style.scrollSnapType = "";
                    if (moved) jumpTo(nearestSlide(event.currentTarget));
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
                    const rail = event.currentTarget;
                    if (!desktop) {
                      Array.from(rail.children).forEach((child, index) => {
                        const distance = Math.abs(rail.scrollLeft - slideLeft(rail, index));
                        const progress = Math.min(1, distance / (rail.clientWidth * 0.5));
                        (child as HTMLElement).style.setProperty("--wpay-card-scale-y", String(1 - 0.12 * progress));
                      });
                    }
                    settleCarousel();
                  }}
                >
                  {cards.map((card, index) => (
                    <div
                      key={card.card_id}
                      className={`wpay-aura-carousel-item wpay-owned-card-item${index === activeSlide ? " is-current-card" : ""}`}
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
                  {carouselOffers.map(({ kind, skin: appearance, plan }, index) => (
                    <button
                      type="button"
                      className={`wpay-aura-carousel-item${cards.length + index === activeSlide ? " is-current-card" : ""}`}
                      key={plan?.plan_id ?? appearance}
                      aria-label={plan ? `${plan.label} · ${plan.provider}` : `Заказать ${kind === "physical" ? "физическую" : "виртуальную"} карту`}
                      onClick={() => { if (plan?.provider !== "GoSwap" && plan?.available !== false) order(kind, appearance); }}
                    >
                      <LiveCardArtwork kind={kind} skin={appearance} usa={plan?.plan_id === "goswap_card_us"} />
                    </button>
                  ))}
                </div>
                <div
                  className="wpay-aura-card-dots"
                  aria-label="Переключить карту"
                >
                  {catalogEnabled && <button type="button" aria-label="Витрина карт" onClick={() => onCatalogOffer(null)}><span /></button>}
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
        ) : showOffer && goSwapOffer ? (
          <section className="px-4 pt-2">
            <h2 className="text-[21px] font-semibold">{storefrontPlan.label}</h2>
            <p className="mt-1 text-sm opacity-60">GoSwap{storefrontPlan.region && ` · ${storefrontPlan.region}`}</p>
            <WalletSubscriptionFeatures
              skin={storefrontPlan.skin}
              goswap={{
                issue: storefrontPlan.issue_fee,
                topup: storefrontPlan.total_recharge_pct,
                conditions: storefrontPlan.conditions,
                firstTopup: "$10",
                issuerDetails: storefrontPlan.region === "Сингапур",
              }}
            />
            {offerTerms()}
            {!storefrontPlan.available && <p className="mt-2 text-center text-sm opacity-60">Выпуск по этому тарифу пока недоступен.</p>}
          </section>
        ) : showOffer ? (
          <section className="px-4 pt-2">
            <h2 className="text-[21px] font-semibold">
              {storefrontPlan?.label ?? (currentKind === "physical"
                ? premiumOffer
                  ? "Премиальная"
                  : "Платина"
                : travelOffer
                  ? "Для путешествий"
                  : "Для подписок")}
            </h2>
            {storefrontPlan && <p className="mt-1 text-sm opacity-60">{storefrontPlan.provider}</p>}
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
            {offerTerms()}
          </section>
        ) : !desktop && !selected && !offers.length ? (
          <p className="px-4 pt-4 text-sm opacity-60">Тарифы пока недоступны</p>
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
                    <TransactionListRow key={op.operation_id} item={historyItem(op)} onSelect={setSelectedOperation} />
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
      <TransactionDetails item={selectedOperation} onClose={() => setSelectedOperation(null)} />
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
        <section className="wpay-desktop-card" id="wpay-desktop-card-issuance">
          <div className="wpay-desktop-section-head"><h2>Тарифы и выпуск</h2></div>
          {fees ? (
            <div className="wpay-desktop-card-offers">
              {offers.map(({ kind, skin: appearance, plan: storefront }) => {
                const plan = fees.plans?.find((item) => item.kind === kind && item.skin === appearance);
                const label = storefront?.label ?? plan?.label ?? {
                  silver: "Для подписок", navy: "Для путешествий",
                  ice: "Премиальная", graphite: "Платина",
                }[appearance];
                return (
                  <button key={storefront?.plan_id ?? appearance} type="button" disabled={Boolean(busy) || (storefront ? !storefront.available : plan?.available === false || plan?.issue_fee === null || (!plan && !(kind === "physical" ? fees.open_physical_card_fee : fees.open_virtual_card_fee)))}
                    onClick={() => storefront?.provider === "GoSwap" ? void issueGoSwap(storefront) : order(kind, appearance)}>
                    <span><strong>{label}</strong><small>{storefront ? `${storefront.provider} · ${storefront.provider === "GoSwap" ? storefront.available ? `${offerNumber.format(Number(storefront.issue_fee))} USDT` : "Выпуск пока недоступен" : planPrice(kind, appearance)}` : planPrice(kind, appearance)}</small></span>
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
      {showOffer && bottomActionSlot && createPortal(
        <Button rounded large data-wpay-primary="" className="wpay-aura-primary !w-full"
          disabled={!fees || Boolean(busy) || (storefrontPlan?.available === false)
            || (!storefrontPlan && fees.plans?.find(plan => plan.kind === currentKind && plan.skin === activeOffer?.skin)?.available === false)}
          onClick={() => {
            if (goSwapOffer) void issueGoSwap(storefrontPlan);
            else order(currentKind, activeOffer?.skin);
          }}>
          <span className="wpay-card-action-label">
            <ShoppingBasket size={20} aria-hidden="true" />
            {busy === "goswap-quote" ? "Загрузка…" : "Оформить карту"}
          </span>
        </Button>,
        bottomActionSlot,
      )}
      <Sheet
        opened={goSwapSheetOpened && goSwapOrder !== null}
        className={`wpay-goswap-order-sheet${goSwapSheetExpanded ? "" : " wpay-goswap-order-sheet--collapsed"}`}
        swipeToStep
        swipeToClose
        swipeHandler=".wpay-goswap-sheet-handle"
        backdrop
        closeByBackdropClick
        closeOnEscape
        onSheetOpen={sheet => {
          sheet?.setSwipeStep();
          sheet?.stepClose();
        }}
        onSheetOpened={() => setGoSwapSheetReady(true)}
        onSheetStepOpen={() => setGoSwapSheetExpanded(true)}
        onSheetStepClose={() => setGoSwapSheetExpanded(false)}
        onSheetClosed={() => setGoSwapOrder(null)}
      >
        {goSwapOrder && (
          <div className="wpay-goswap-sheet-scroll">
            <div className="sheet-modal-swipe-step wpay-goswap-order-summary">
              <button type="button" className="wpay-goswap-sheet-handle" aria-label="Раскрыть условия карты"
                aria-expanded={goSwapSheetExpanded} onClick={expandGoSwapSheet}><span /></button>
              <div className="wpay-goswap-order-art" ref={checkoutArtwork}
                onTouchStart={event => {
                  resetCheckoutSwipe();
                  const touch = event.touches[0];
                  const sheet = event.currentTarget.closest<HTMLElement>(".wpay-goswap-order-sheet");
                  if (event.touches.length === 1 && touch && sheet) {
                    checkoutSwipeStart.current = { x: touch.clientX, y: touch.clientY, sheet };
                  }
                }}
                onTouchMove={event => {
                  const start = checkoutSwipeStart.current;
                  const touch = event.touches[0];
                  if (!start || !touch) return;
                  if (event.touches.length !== 1) {
                    resetCheckoutSwipe();
                    return;
                  }
                  const dx = Math.abs(touch.clientX - start.x);
                  const dy = touch.clientY - start.y;
                  if (Math.abs(dy) <= dx && !start.sheet.classList.contains("wpay-goswap-order-sheet--dragging")) return;
                  const hiddenHeight = goSwapSheetExpanded ? 0
                    : Math.max(0, parseFloat(start.sheet.style.getPropertyValue("--f7-sheet-swipe-step")) || 0);
                  start.sheet.classList.add("wpay-goswap-order-sheet--dragging");
                  start.sheet.style.setProperty("--wpay-checkout-drag-y", `${Math.max(-hiddenHeight, dy)}px`);
                }}
                onTouchCancel={resetCheckoutSwipe}
                onTouchEnd={event => {
                  const start = resetCheckoutSwipe();
                  const touch = event.changedTouches[0];
                  if (!start || !touch) return;
                  const dy = touch.clientY - start.y;
                  if (Math.abs(dy) <= Math.abs(touch.clientX - start.x)) return;
                  if (dy > 55) f7.sheet.get(".wpay-goswap-order-sheet")?.close();
                  else if (dy < -55 && !goSwapSheetExpanded) expandGoSwapSheet();
                }}>
                <LiveCardArtwork kind="virtual" skin={goSwapOrder.plan.skin} usa={goSwapOrder.plan.plan_id === "goswap_card_us"} />
              </div>
              <p className="mt-3 text-center text-sm opacity-60">{goSwapOrder.quote.label}</p>
              <fieldset className="wpay-goswap-payment">
                <legend>
                  <span className="wpay-goswap-payment-heading">
                    <span>Способ оплаты</span>
                    {goSwapPayment === "wallet" && goSwapOrder.quote.wallet_available != null && (
                      <span className="wpay-goswap-wallet-available">
                        Баланс: {offerNumber.format(Number(goSwapOrder.quote.wallet_available))} USDT
                      </span>
                    )}
                  </span>
                </legend>
                <label>
                  <input type="radio" name="goswap-card-payment" checked={goSwapPayment === "wallet"}
                    onClick={ripplePaymentTile} onChange={() => setGoSwapPayment("wallet")} />
                  <span className="wpay-goswap-payment-ripple" aria-hidden="true" />
                  <span className="wpay-goswap-payment-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                  <img src={desktopWalletIcon} alt="" width={34} height={34} />
                  <span>С кошелька</span>
                </label>
                <label>
                  <input type="radio" name="goswap-card-payment" checked={goSwapPayment === "sbp"}
                    disabled={!onSbpTopUp} onClick={ripplePaymentTile} onChange={() => setGoSwapPayment("sbp")} />
                  <span className="wpay-goswap-payment-ripple" aria-hidden="true" />
                  <span className="wpay-goswap-payment-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                  <img src="/brands/sbp-symbol.svg" alt="" width={28} height={28} />
                  <span>Через СБП{!onSbpTopUp && <small>Недоступно</small>}</span>
                </label>
              </fieldset>
              <div className="wpay-goswap-order-total">
                <span>Итого:</span>
                <strong>{offerNumber.format(Number(goSwapOrder.quote.total))} USDT</strong>
              </div>
              <Button rounded large data-wpay-primary="" className={`wpay-aura-primary !mt-3 !w-full${goSwapSheetReady && !busy && (goSwapPayment === "wallet" || onSbpTopUp) ? " wpay-goswap-pay-shine" : ""}`}
                disabled={!goSwapSheetReady || Boolean(busy) || (goSwapPayment === "sbp" && !onSbpTopUp)}
                aria-label="Оплатить"
                aria-busy={!goSwapSheetReady || Boolean(busy)}
                onClick={() => {
                  haptic("light");
                  if (goSwapPayment === "wallet") {
                    payGoSwapOrder();
                    return;
                  }
                  setGoSwapOrder(null);
                  onSbpTopUp?.();
                }}>
                {!goSwapSheetReady || busy ? (
                  <span className="wpay-card-action-label" role="status" aria-label="Загрузка">
                    <Preloader size={18} color="white" />
                  </span>
                ) : (
                  <span className="wpay-card-action-label">
                    <CreditcardFill className="h-5 w-5" aria-hidden="true" />
                    Оплатить
                  </span>
                )}
              </Button>
              <button type="button" className="wpay-goswap-order-expand" onClick={expandGoSwapSheet}>Условия карты <ChevronDown size={15} /></button>
            </div>
            <div className="wpay-goswap-order-terms">{offerTerms({ ...goSwapOrder.plan, issue_fee: goSwapOrder.quote.total })}</div>
          </div>
        )}
      </Sheet>
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
  usa = false,
}: {
  card?: AuraCard;
  kind?: "physical" | "virtual";
  skin: CardSkin;
  usa?: boolean;
}) {
  return (
    <WalletCardFace
      skin={skin}
      usa={usa}
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
