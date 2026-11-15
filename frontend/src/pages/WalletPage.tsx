import WalletVerification, {
  preloadVerificationArtwork,
} from "./WalletVerification";
import { useAuraProfile } from "../wallet/useAuraProfile";
import { WalletBiometricGate, WalletBiometricRow } from "./WalletBiometrics";
import { resolveDeposit } from "../wallet/deposit";
import WalletAssetAvatar from "./WalletAssetAvatar";
import { type PointerEvent as ReactPointerEvent } from "react";
import SunMax from "framework7-icons/react/esm/SunMax.js";
import MoonStars from "framework7-icons/react/esm/MoonStars.js";
import { WalletNavbar, PushViewShell } from "./WalletNavigation";
import { usePullToRefresh, PullRefreshIndicator } from "./WalletScroll";
import { assetIconStyle, type Asset } from "../wallet/appearance";
import { CurrencyRow, CurrencySkeletonRow } from "./WalletCurrencyRow";
import WalletCryptoDeposit from "./WalletCryptoDeposit";
import WalletAddressDetails, {
  addressNetworkNames,
  addressNetworkStandards,
  type WalletAddressSelection,
} from "./WalletAddressDetails";
import WalletIntro, { walletIntroKey } from "./WalletIntro";
import "./WalletInputTheme.css";
import "./WalletButtons.css";
import WalletSheetClose from "./WalletSheetClose";
import WalletAuraCards from "./WalletAuraCards";
import { DesktopSidebar, DesktopOverview } from "./WalletDesktop";
import "./WalletDesktop.css";
import {
  ReferralProgram,
  WithdrawalMethods,
  WithdrawalForm,
  withdrawalTitles,
  type WithdrawalMethod,
} from "./WalletPrograms";
import DocTextFill from "framework7-icons/react/esm/DocTextFill.js";
import Framework7 from "framework7/lite-bundle";
import Framework7React, {
  List as F7List,
  ListItem as F7ListItem,
  Messages,
  Message,
  Messagebar,
  ListInput as F7ListInput,
  Toggle as F7Toggle,
  App as F7App,
  Sheet as F7Sheet,
  Popup as F7Popup,
  Navbar as F7Navbar,
  NavRight,
  Link as F7Link,
  Page as F7Page,
} from "framework7-react";
import "./WalletFramework7.css";
import "framework7/components/popup/css";
import "framework7/components/sheet/css";
import "./WalletExchange.css";
import { Search, Check, Delete } from "lucide-react";
import "./WalletProfile.css";
import "./WalletCard.css";
import {
  useId,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ComponentProps,
} from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Card,
  Link as KLink,
  List,
  ListItem,
  Page,
  Popover,
  Tabbar,
  TabbarLink,
  ToolbarPane,
} from "konsta/react";
import {
  SiBitcoin,
  SiBnbchain,
  SiEthereum,
  SiSolana,
  SiTether,
  SiTon,
} from "@icons-pack/react-simple-icons";
import ArrowRightArrowLeft from "framework7-icons/react/esm/ArrowRightArrowLeft.js";
import ArrowDownCircleFill from "framework7-icons/react/esm/ArrowDownCircleFill.js";
import ArrowUpCircleFill from "framework7-icons/react/esm/ArrowUpCircleFill.js";
import BellFill from "framework7-icons/react/esm/BellFill.js";
import BuildingColumnsFill from "framework7-icons/react/esm/BuildingColumnsFill.js";
import ChevronRight from "framework7-icons/react/esm/ChevronRight.js";
import Clock from "framework7-icons/react/esm/Clock.js";
import ClockFill from "framework7-icons/react/esm/ClockFill.js";
import CreditcardFill from "framework7-icons/react/esm/CreditcardFill.js";
import DocOnDoc from "framework7-icons/react/esm/DocOnDoc.js";
import Ellipsis from "framework7-icons/react/esm/Ellipsis.js";
import Eye from "framework7-icons/react/esm/Eye.js";
import EyeSlash from "framework7-icons/react/esm/EyeSlash.js";
import GearAlt from "framework7-icons/react/esm/GearAlt.js";
import Globe from "framework7-icons/react/esm/Globe.js";
import CheckmarkShieldFill from "framework7-icons/react/esm/CheckmarkShieldFill.js";
import LockShieldFill from "framework7-icons/react/esm/LockShieldFill.js";
import LogoApple from "framework7-icons/react/esm/LogoApple.js";
import LogoGoogle from "framework7-icons/react/esm/LogoGoogle.js";
import PersonCropCircleFill from "framework7-icons/react/esm/PersonCropCircleFill.js";
import PlusCircleFill from "framework7-icons/react/esm/PlusCircleFill.js";
import Qrcode from "framework7-icons/react/esm/Qrcode.js";
import QuestionCircleFill from "framework7-icons/react/esm/QuestionCircleFill.js";
import SliderHorizontal3 from "framework7-icons/react/esm/SliderHorizontal3.js";
import Snow from "framework7-icons/react/esm/Snow.js";
import WalletFill from "framework7-icons/react/esm/WalletFill.js";
import {
  getUser,
  haptic,
  installWalletButtonHaptics,
  tg,
} from "../lib/telegram";
import { useTheme } from "../store/ThemeStore";

type Action = {
  label: string;
  icon: ComponentType<{ className?: string }>;
};

import WalletAssetPanel from "./WalletAssetPanel";
import {
  WalletLiveProvider,
  useLiveWallet,
  WalletConnectionNote,
  LiveDepositPanel,
  LiveHistory,
  LiveQrPanel,
  usd,
} from "./WalletLive";

// oxlint-disable-next-line react-hooks/rules-of-hooks -- Framework7 plugin registration is not a React Hook.
Framework7.use(Framework7React);

type WalletTab = "wallet" | "history" | "cards" | "profile";
type CryptoFlow = {
  kind: "deposit" | "withdraw" | "exchange";
  assetCode?: string;
  network?: string;
  depositAddress?: WalletAddressSelection;
};

const tabMeta: Record<WalletTab, { title: string; subtitle: string }> = {
  wallet: { title: "Кошелёк", subtitle: "Все активы" },
  history: { title: "История", subtitle: "Платежи и переводы" },
  cards: { title: "Карты", subtitle: "Виртуальные карты Visa" },
  profile: { title: "Профиль", subtitle: "Настройки аккаунта" },
};

const actions: Action[] = [
  { label: "QR-код", icon: Qrcode },
  { label: "Пополнить", icon: PlusCircleFill },
  { label: "Вывести", icon: ArrowUpCircleFill },
  { label: "Обменять", icon: ArrowRightArrowLeft },
];

const walletActionClass =
  "!m-0 !h-[62px] !min-w-0 !rounded-[22px] !bg-black/[.055] !px-1 !text-primary active:!bg-black/10 dark:!bg-white/[.10] dark:active:!bg-white/[.16]";
function WalletActionGrid({
  items,
  label = "Действия с кошельком",
  columns = 4,
}: {
  columns?: 3 | 4;
  items: { label: string; icon: Action["icon"]; onClick: () => void }[];
  label?: string;
}) {
  return (
    <section
      className={`grid ${columns === 3 ? "grid-cols-3" : "grid-cols-4"} gap-2 px-safe-4`}
      aria-label={label}
    >
      {items.map(({ label, icon: Icon, onClick }) => (
        <Button
          key={label}
          rounded
          clear
          onClick={onClick}
          className={walletActionClass}
        >
          <span className="flex min-w-0 flex-col items-center justify-center gap-1">
            <Icon className="text-[22px]" />
            <span className="w-full truncate text-[10px] font-medium leading-none normal-case">
              {label}
            </span>
          </span>
        </Button>
      ))}
    </section>
  );
}

const rubleAsset: Asset = {
  code: "RUB",
  name: "Рубли",
  rate: "",
  color: "#F5A623",
  iconColor: "#fff",
  icon: <span className="text-[27px] font-medium">₽</span>,
};
const sbpDepositAsset: Asset = {
  ...rubleAsset,
  color: "#ffffff",
  icon: <img src="/brands/sbp-symbol.svg" alt="СБП" width="28" height="32" />,
};
const assets: Asset[] = [
  {
    code: "USDT",
    name: "Tether",
    rate: "",
    color: "#26A17B",
    iconColor: "#fff",
    icon: <SiTether size={25} />,
  },
  {
    code: "TRX",
    name: "TRON",
    rate: "",
    color: "#ef0027",
    iconColor: "#fff",
    icon: (
      <svg
        viewBox="0 0 32 32"
        width="25"
        height="25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      >
        <path d="M4 4 28 9 14 29 4 4Z M4 4 17 12 28 9 M17 12 14 29 M17 12 23 8" />
      </svg>
    ),
  },
  {
    code: "BNB",
    name: "BNB",
    rate: "",
    color: "#F3BA2F",
    iconColor: "#fff",
    icon: <SiBnbchain size={25} />,
  },
  {
    code: "ETH",
    name: "Ethereum",
    rate: "",
    color: "#627EEA",
    iconColor: "#fff",
    icon: <SiEthereum size={25} />,
  },
  {
    code: "GRAM",
    name: "Gram",
    rate: "",
    color: "#0098EA",
    iconColor: "#fff",
    icon: <SiTon size={25} />,
  },
  {
    code: "SOL",
    name: "Solana",
    rate: "",
    color: "#111",
    iconColor: "#14F195",
    icon: <SiSolana size={25} />,
  },
  {
    code: "BTC",
    name: "Bitcoin",
    rate: "",
    color: "#F7931A",
    iconColor: "#fff",
    icon: <SiBitcoin size={25} />,
  },
  {
    code: "XAUT",
    name: "GOLD (XAUT)",
    rate: "",
    color: "#c89b43",
    iconColor: "#fff",
    icon: <SiTether size={25} />,
  },
];

export default function WalletPage() {
  useEffect(installWalletButtonHaptics, []);
  const { theme } = useTheme();
  useEffect(() => {
    const host = document.querySelector<HTMLElement>(".wpay-f7-root");
    const sync = () => {
      const style = getComputedStyle(document.documentElement);
      const top =
        parseFloat(style.getPropertyValue("--tg-safe-area-inset-top")) || 0;
      const controls =
        parseFloat(
          style.getPropertyValue("--tg-content-safe-area-inset-top"),
        ) || 0;
      host?.style.setProperty(
        "--f7-popup-push-offset",
        `${Math.max(16, top + controls) + 8}px`,
      );
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <F7App
      name="WPay"
      theme="ios"
      darkMode={theme === "dark"}
      className={`wpay-f7-root ios ${theme === "dark" ? "dark" : ""}`}
      style={
        {
          height: "100%",
          "--f7-safe-area-top":
            "max(env(safe-area-inset-top, 0px), var(--tg-safe-area-inset-top, 0px))",
          "--f7-popup-push-offset":
            "max(16px, calc(var(--tg-safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px)))",
        } as React.CSSProperties
      }
    >
      <div className="view wpay-main-view">
        <WalletBiometricGate>
          <WalletLiveProvider>
            <WalletScreen />
          </WalletLiveProvider>
        </WalletBiometricGate>
      </div>
    </F7App>
  );
}

function WalletScreen() {
  const live = useLiveWallet();
  const enabledAssets = assets.filter(
    (asset) => (live.assetRoutes[asset.code] ?? []).length > 0,
  );
  const [qrValue, setQrValue] = useState<string | null>(null);
  const user = getUser();
  const { theme, toggle: toggleTheme } = useTheme();
  const menuButton = useRef<HTMLElement | null>(null);
  const pageRef = useRef<HTMLElement | null>(null);
  const [activeTab, setActiveTab] = useState<WalletTab>("wallet");
  const [selectedAssetCode, setSelectedAssetCode] = useState<string | null>(
    null,
  );
  const [cryptoFlow, setCryptoFlow] = useState<CryptoFlow | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(() => {
    try {
      return localStorage.getItem(walletIntroKey) !== "seen";
    } catch {
      return true;
    }
  });
  const finishIntro = () => {
    try {
      localStorage.setItem(walletIntroKey, "seen");
    } catch {}
    setIntroOpen(false);
  };
  const [loading, setLoading] = useState(true);
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "WPay · Кошелёк";
    const timer = window.setTimeout(() => setLoading(false), 850);
    return () => {
      document.title = previousTitle;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (activeTab === "cards" && !live.capabilities.cards)
      setActiveTab("wallet");
    if (!live.capabilities.qr_pay) setQrValue(null);
  }, [activeTab, live.capabilities.cards, live.capabilities.qr_pay]);

  const initials = (user?.first_name || "К").slice(0, 1).toUpperCase();
  const menuItems = useMemo(
    () => [
      {
        title: theme === "dark" ? "Светлая тема" : "Тёмная тема",
        icon: theme === "dark" ? <SunMax /> : <MoonStars />,
        action: () => toggleTheme(),
      },
      {
        title: balanceHidden ? "Показать баланс" : "Скрыть баланс",
        icon: balanceHidden ? <Eye /> : <EyeSlash />,
        action: () => setBalanceHidden((value) => !value),
      },
      {
        title: "История операций",
        icon: <Clock />,
        action: () => selectTab("history"),
      },
      {
        title: "О WPay",
        icon: <QuestionCircleFill />,
        action: () => setIntroOpen(true),
      },
      {
        title: "Настройки кошелька",
        icon: <GearAlt />,
        action: () => selectTab("profile"),
      },
    ],
    [balanceHidden, theme, toggleTheme],
  );

  function showNotice(text: string) {
    haptic("light");
    setNotice(text);
    window.setTimeout(() => setNotice(""), 1800);
  }

  function runMenuAction(action: () => void) {
    haptic("light");
    setMenuOpen(false);
    action();
  }

  function selectTab(tab: WalletTab) {
    haptic("light");
    setSelectedAssetCode(null);
    setActiveTab(tab);
    pageRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function scanPaymentQr() {
    if (!live.capabilities.qr_pay) {
      showNotice("Оплата QR сейчас не подключена");
      return;
    }
    const telegram = tg();
    if (!telegram?.showScanQrPopup || !telegram.isVersionAtLeast?.("6.4")) {
      showNotice("Откройте миниапку в Telegram для сканирования QR-кода");
      return;
    }
    try {
      telegram.showScanQrPopup(
        { text: "Наведите камеру на QR СБП" },
        (data) => {
          if (!data) return false;
          setQrValue(data);
          haptic("success");
          return true;
        },
      );
    } catch {
      showNotice("Не удалось открыть сканер Telegram. Переоткройте миниапку");
    }
  }

  const pull = usePullToRefresh(pageRef, {
    softPull: activeTab === "cards",
    delay: 900,
    onRefreshStart: () => setLoading(true),
    onRefreshed: () => {
      setLoading(false);
      void live.refresh(true);
      showNotice(
        `${tabMeta[activeTab].title} обновлен${activeTab === "history" ? "а" : activeTab === "cards" ? "ы" : ""}`,
      );
    },
  });

  const menu = createPortal(
    <Popover
      opened={menuOpen}
      target={menuButton.current}
      onBackdropClick={() => setMenuOpen(false)}
      className="!mt-3 !w-72"
    >
      <List nested className="!my-0">
        {menuItems.map((item) => (
          <ListItem
            key={item.title}
            link
            onClick={() => runMenuAction(item.action)}
            chevron={false}
            contentClassName="!h-13"
            innerClassName="!min-w-0 !h-13 !py-0 after:!opacity-30"
            media={
              <span className="flex h-6 w-6 items-center justify-center text-[21px] text-primary">
                {item.icon}
              </span>
            }
            innerChildren={
              <span className="flex h-full min-w-0 items-center justify-between gap-3">
                <span className="truncate text-[16px] font-medium text-black dark:text-white">
                  {item.title}
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="shrink-0 text-[18px] text-black/30 dark:text-white/30"
                />
              </span>
            }
          />
        ))}
      </List>
    </Popover>,
    document.querySelector(".k-app") ?? document.body,
  );

  return (
    <Page
      ref={pageRef}
      className="wpay-desktop-page wpay-viewport overscroll-y-none pb-[calc(96px+env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      onPointerDown={pull.pointerDown}
      onPointerMove={pull.pointerMove}
      onPointerUp={pull.finish}
      onPointerCancel={pull.finish}
    >
      <DesktopSidebar
        tab={activeTab}
        onSelect={selectTab}
        dark={theme === "dark"}
        onTheme={toggleTheme}
        name={user?.first_name || "Ваш аккаунт"}
        cardsEnabled={live.capabilities.cards}
      />
      <WalletNavbar
        title={tabMeta[activeTab].title}
        subtitle={tabMeta[activeTab].subtitle}
        left={
          <button
            type="button"
            onClick={() => selectTab("profile")}
            aria-label="Профиль"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/45 p-[5px] text-[15px] font-semibold leading-none text-white shadow-sm backdrop-blur-xl active:opacity-60 dark:border-white/[.16] dark:bg-white/10"
          >
            {user?.photo_url ? (
              <img
                src={user.photo_url}
                alt=""
                className="block h-full w-full rounded-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center rounded-full bg-primary">
                {initials}
              </span>
            )}
          </button>
        }
        right={
          <span ref={menuButton} className="inline-flex h-11 w-11">
            <KLink
              iconOnly
              onClick={() => {
                haptic("light");
                setMenuOpen(true);
              }}
              aria-label="Ещё"
              className="!h-full !w-full !text-black dark:!text-white"
            >
              <Ellipsis className="text-[25px]" />
            </KLink>
          </span>
        }
      />
      {menu}
      {introOpen && <WalletIntro onDone={finishIntro} />}

      <PullRefreshIndicator
        distance={pull.distance}
        refreshing={pull.refreshing}
        dragging={pull.dragging}
      />

      <div className="wpay-desktop-body" data-tab={activeTab}>
        {activeTab === "wallet" && (
          <main
            className={`wpay-wallet-home mx-auto w-full max-w-[560px] transition-[transform,opacity] duration-300 ease-out ${selectedAssetCode ? "-translate-x-[22%] opacity-60" : "translate-x-0 opacity-100"}`}
          >
            <div className="wpay-desktop-balance-card">
              <section
                className="px-safe-4 pb-7 pt-9 text-center"
                aria-label="Общий баланс"
              >
                <div className="text-[15px] font-medium text-black/50 dark:text-white/50">
                  Общий баланс
                </div>
                {loading ? (
                  <div className="mx-auto mt-3 h-[52px] w-44 animate-pulse rounded-2xl bg-black/10 dark:bg-white/10" />
                ) : (
                  <>
                    <div className="mt-2 text-[52px] font-semibold leading-none tracking-[-0.045em] tabular-nums text-black dark:text-white">
                      {balanceHidden
                        ? "••••••"
                        : live.ready
                          ? usd(live.total)
                          : "—"}
                    </div>
                    <div className="mt-3 text-[14px] text-black/40 dark:text-white/40">
                      {live.ready
                        ? "Доступно в криптовалюте"
                        : "Ожидает подключения"}
                    </div>
                  </>
                )}
              </section>

              <WalletActionGrid
                items={actions
                  .filter(
                    (action) =>
                      action.label !== "QR-код" || live.capabilities.qr_pay,
                  )
                  .map((action) => ({
                    ...action,
                    onClick: () => {
                      if (action.label === "QR-код") scanPaymentQr();
                      else if (action.label === "Пополнить")
                        setCryptoFlow({ kind: "deposit" });
                      else if (action.label === "Вывести")
                        setCryptoFlow({ kind: "withdraw" });
                      else if (action.label === "Обменять")
                        setCryptoFlow({ kind: "exchange" });
                    },
                  }))}
              />
            </div>
            <List
              strong
              inset
              className="!mb-0 !mt-6 overflow-hidden !rounded-[30px] [&>ul]:!rounded-[30px]"
            >
              {live.capabilities.sbp_buy &&
                (loading ? (
                  <CurrencySkeletonRow rubles />
                ) : (
                  <CurrencyRow
                    asset={rubleAsset}
                    balanceHidden={balanceHidden}
                  />
                ))}
            </List>

            <section className="mt-8">
              <div className="mb-2 flex items-end justify-between px-safe-4">
                <h2 className="m-0 text-[21px] font-semibold tracking-tight text-black dark:text-white">
                  Криптовалюты
                </h2>
                <span className="text-[13px] text-black/40 dark:text-white/40">
                  Всего: {live.ready ? usd(live.total) : "—"}
                </span>
              </div>

              {loading ? (
                <WalletSkeleton />
              ) : (
                <List
                  strong
                  inset
                  dividers
                  className="!mt-0 overflow-hidden !rounded-[32px] [&>ul]:!rounded-[32px]"
                >
                  {enabledAssets.map((asset) => (
                    <CurrencyRow
                      key={asset.code}
                      asset={asset}
                      balanceHidden={balanceHidden}
                      onClick={() => {
                        haptic("light");
                        setSelectedAssetCode(asset.code);
                      }}
                    />
                  ))}
                </List>
              )}
            </section>

            <WalletConnectionNote />
          </main>
        )}

        {activeTab === "wallet" && (
          <DesktopOverview
            onHistory={() => selectTab("history")}
            onDeposit={() => setCryptoFlow({ kind: "deposit" })}
            onExchange={() => setCryptoFlow({ kind: "exchange" })}
          />
        )}
        {activeTab === "history" && <LiveHistory />}
        {activeTab === "cards" &&
          live.capabilities.cards &&
          (live.demo ? (
            <CardsSection showNotice={showNotice} />
          ) : (
            <WalletAuraCards showNotice={showNotice} />
          ))}
        {activeTab === "profile" && (
          <ProfileSection
            user={user}
            initials={initials}
            showNotice={showNotice}
          />
        )}
      </div>

      <AssetPushView
        onScan={scanPaymentQr}
        asset={
          enabledAssets.find((item) => item.code === selectedAssetCode) ?? null
        }
        onClose={() => setSelectedAssetCode(null)}
        showNotice={showNotice}
        openFlow={(kind, assetCode, network, depositAddress) =>
          setCryptoFlow({ kind, assetCode, network, depositAddress })
        }
      />

      <CryptoFlowPushView
        flow={cryptoFlow}
        onClose={() => setCryptoFlow(null)}
        showNotice={showNotice}
      />

      {qrValue !== null && live.capabilities.qr_pay && (
        <LiveQrPanel initialQr={qrValue} onClose={() => setQrValue(null)} />
      )}

      {/* Нижняя панель — та же Konsta Tabbar, что у доски (TabPill); QR-оплата пятой кнопкой */}
      <Tabbar
        labels
        icons
        className="wpay-bottom-menu !fixed !left-0 !right-0 !bottom-0 !w-full z-30"
      >
        <ToolbarPane>
          {[
            { id: "wallet" as const, label: "Кошелёк", icon: WalletFill },
            { id: "cards" as const, label: "Карты", icon: CreditcardFill },
            { id: "history" as const, label: "История", icon: ClockFill },
            {
              id: "profile" as const,
              label: "Профиль",
              icon: PersonCropCircleFill,
            },
          ]
            .filter((item) => item.id !== "cards" || live.capabilities.cards)
            .map(({ id, label, icon: Icon }) => (
              <TabbarLink
                key={id}
                active={activeTab === id}
                onClick={() => selectTab(id)}
                icon={<Icon className="w-6 h-6" />}
                label={label}
              />
            ))}
        </ToolbarPane>
      </Tabbar>

      <div
        role="status"
        className={`pointer-events-none fixed bottom-[calc(88px+env(safe-area-inset-bottom))] left-1/2 z-[13000] -translate-x-1/2 whitespace-nowrap rounded-full bg-black px-4 py-2.5 text-[13px] font-medium text-white shadow-xl transition-all dark:bg-white dark:text-black ${notice ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}
      >
        {notice}
      </div>
    </Page>
  );
}

type NoticeHandler = (text: string) => void;

function AssetPushView({
  asset,
  onClose,
  showNotice,
  openFlow,
  onScan,
}: {
  onScan: () => void;
  asset: Asset | null;
  onClose: () => void;
  showNotice: NoticeHandler;
  openFlow: (
    kind: CryptoFlow["kind"],
    assetCode: string,
    network?: string,
    depositAddress?: WalletAddressSelection,
  ) => void;
}) {
  const [historyRequest, setHistoryRequest] = useState(0);
  const [displayAsset, setDisplayAsset] = useState(asset ?? assets[0]);
  const [addressEntry, setAddressEntry] =
    useState<WalletAddressSelection | null>(null);
  const [depositChoice, setDepositChoice] = useState(false),
    [allDepositNetworks, setAllDepositNetworks] = useState(false),
    [choosingDeposit, setChoosingDeposit] = useState(false);
  const depositRequest = useRef(0);
  const live = useLiveWallet();
  useEffect(() => {
    if (asset) setDisplayAsset(asset);
    else {
      setAddressEntry(null);
      setDepositChoice(false);
    }
  }, [asset]);
  async function chooseDeposit(code: string, network?: string) {
    if (choosingDeposit) return;
    const run = ++depositRequest.current;
    let selected = code === "RUB" ? undefined : (addressEntry ?? undefined);
    if (code !== "RUB" && network && !selected) {
      setChoosingDeposit(true);
      try {
        selected =
          (await resolveDeposit(code, network, live.demo)) ?? undefined;
      } catch (error) {
        if (run === depositRequest.current)
          showNotice(
            error instanceof Error
              ? error.message
              : "Не удалось получить реквизиты",
          );
        return;
      } finally {
        if (run === depositRequest.current) setChoosingDeposit(false);
      }
    }
    if (run !== depositRequest.current) return;
    setDepositChoice(false);
    setAddressEntry(null);
    openFlow("deposit", code, network, selected);
  }
  return (
    <>
      <PushViewShell
        open={asset !== null}
        assetSurface
        menuItems={
          displayAsset.code === "USDT"
            ? [
                {
                  title: "Пополнить",
                  icon: <PlusCircleFill className="text-[22px] text-primary" />,
                  onClick: () => {
                    setAllDepositNetworks(true);
                    setDepositChoice(true);
                  },
                },
                {
                  title: "Вывести",
                  icon: (
                    <ArrowUpCircleFill className="text-[22px] text-primary" />
                  ),
                  onClick: () => openFlow("withdraw", displayAsset.code),
                },
                {
                  title: "Обменять",
                  icon: (
                    <ArrowRightArrowLeft className="text-[22px] text-primary" />
                  ),
                  onClick: () => openFlow("exchange", displayAsset.code),
                },
                {
                  title: "История транзакций",
                  icon: <ClockFill className="text-[22px] text-primary" />,
                  onClick: () => setHistoryRequest((value) => value + 1),
                },
                {
                  title: "AML проверка",
                  icon: <LockShieldFill className="text-[22px] text-primary" />,
                  onClick: () => showNotice("AML проверка пока не подключена"),
                },
              ]
            : undefined
        }
        title={displayAsset.name}
        subtitle={displayAsset.code}
        onClose={onClose}
        onRefreshed={() => {
          void live.refresh(true);
          showNotice("Обновляем баланс");
        }}
      >
        <WalletAssetPanel
          historyRequest={historyRequest}
          onOpenAddress={setAddressEntry}
          active={asset !== null}
          key={displayAsset.code}
          code={displayAsset.code}
          name={displayAsset.name}
          icon={displayAsset.icon}
          color={displayAsset.color}
          iconColor={displayAsset.iconColor}
          onDeposit={(network) => {
            if (!network) {
              setAllDepositNetworks(displayAsset.code === "USDT");
              setDepositChoice(true);
            } else openFlow("deposit", displayAsset.code, network);
          }}
          onWithdraw={() => openFlow("withdraw", displayAsset.code)}
          onExchange={() => openFlow("exchange", displayAsset.code)}
        />
      </PushViewShell>
      <PushViewShell
        open={asset !== null && addressEntry !== null}
        title={
          addressEntry
            ? `${displayAsset.code} ${["BTC", "TRX"].includes(displayAsset.code) ? "" : (addressNetworkStandards[addressEntry.network] ?? "")}`.trim()
            : "Адрес"
        }
        subtitle={
          addressEntry ? addressNetworkNames[addressEntry.network] : undefined
        }
        zClass="z-[80]"
        onClose={() => setAddressEntry(null)}
      >
        {addressEntry && (
          <WalletAddressDetails
            actions={
              <div className="-mx-4">
                <WalletActionGrid
                  columns={3}
                  label="Действия с адресом"
                  items={actions
                    .filter((action) => action.label !== "QR-код")
                    .map((action) => ({
                      ...action,
                      onClick: () => {
                        haptic("light");
                        if (action.label === "Пополнить") {
                          setAllDepositNetworks(false);
                          setDepositChoice(true);
                          return;
                        }
                        setAddressEntry(null);
                        if (action.label === "QR-код") onScan();
                        else
                          openFlow(
                            action.label === "Пополнить"
                              ? "deposit"
                              : action.label === "Вывести"
                                ? "withdraw"
                                : "exchange",
                            displayAsset.code,
                            addressEntry.network,
                          );
                      },
                    }))}
                />
              </div>
            }
            entry={addressEntry}
            code={displayAsset.code}
            icon={displayAsset.icon}
            color={displayAsset.color}
            iconColor={displayAsset.iconColor}
          />
        )}
      </PushViewShell>
      {createPortal(
        <F7Sheet
          opened={depositChoice && asset !== null}
          backdrop
          closeByBackdropClick
          closeOnEscape
          swipeToClose
          swipeHandler=".wpay-deposit-method-header"
          className={`wpay-exchange-sheet wpay-deposit-method-sheet ${allDepositNetworks ? "wpay-deposit-method-sheet--all" : ""}`}
          onSheetClose={() => {
            depositRequest.current++;
            setChoosingDeposit(false);
          }}
          onSheetClosed={() => setDepositChoice(false)}
        >
          <header className="wpay-deposit-method-header shrink-0 px-5 pb-6 pt-3">
            <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-black/15 dark:bg-white/20" />
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[23px] font-semibold text-black dark:text-white">
                  Пополнить
                </h2>
                <p className="mt-1 text-[14px] text-black/45 dark:text-white/45">
                  Выберите способ пополнения
                </p>
              </div>
              <WalletSheetClose
                label="Закрыть способы пополнения"
                onClick={() => setDepositChoice(false)}
              />
            </div>
          </header>
          <div className="min-h-0 overflow-y-auto px-4 pb-[max(20px,env(safe-area-inset-bottom))]">
            <List
              strong
              inset
              className="!mx-0 !mb-4 !mt-0 overflow-hidden !rounded-full [&>ul]:!rounded-full"
            >
              <CurrencyRow
                asset={sbpDepositAsset}
                deposit
                onClick={() => chooseDeposit("RUB")}
              />
            </List>
            <List
              strong
              inset
              dividers={allDepositNetworks}
              className={`!mx-0 !my-0 overflow-hidden ${allDepositNetworks ? "!rounded-[30px] [&>ul]:!rounded-[30px]" : "!rounded-full [&>ul]:!rounded-full"}`}
            >
              {(allDepositNetworks
                ? (live.assetRoutes[displayAsset.code] ?? [])
                : [
                    addressEntry?.network ??
                      live.assetRoutes[displayAsset.code]?.[0] ??
                      "",
                  ]
              ).map((network) => (
                <ListItem
                  key={network}
                  link
                  chevron={false}
                  onClick={() => void chooseDeposit(displayAsset.code, network)}
                  contentClassName="!h-[64px]"
                  innerClassName="!min-w-0 !h-[64px] !py-2 after:!opacity-30"
                  media={
                    <WalletAssetAvatar
                      icon={displayAsset.icon}
                      color={displayAsset.color}
                      iconColor={displayAsset.iconColor}
                      network={network}
                    />
                  }
                  innerChildren={
                    <span className="flex h-full w-full items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[17px] font-semibold leading-6 text-black dark:text-white">
                          {displayAsset.code}
                          {!["BTC", "TRX"].includes(displayAsset.code)
                            ? " · " +
                              (addressNetworkStandards[network] ?? network)
                            : ""}
                        </span>
                        <span className="mt-0.5 block text-[14px] leading-5 text-black/45 dark:text-white/45">
                          {addressNetworkNames[network]}
                        </span>
                      </span>
                      <ChevronRight className="shrink-0 text-[19px] text-black/25 dark:text-white/30" />
                    </span>
                  }
                />
              ))}
            </List>
            {choosingDeposit && (
              <p
                role="status"
                className="mt-3 px-2 text-[13px] text-black/45 dark:text-white/45"
              >
                Открываем реквизиты…
              </p>
            )}
          </div>
        </F7Sheet>,
        document.querySelector(".wpay-f7-root") ?? document.body,
      )}
    </>
  );
}

function NotificationSheet({
  open,
  title,
  onClose,
  children,
}: ComponentProps<typeof PushViewShell>) {
  const Icon =
    title === "Карта" || title === "Новая карта"
      ? CreditcardFill
      : title === "Безопасность"
        ? LockShieldFill
        : title === "Основная валюта"
          ? Globe
          : title === "Поддержка"
            ? QuestionCircleFill
            : BellFill;
  const color =
    title === "Карта" || title === "Новая карта"
      ? "#007aff"
      : title === "Безопасность"
        ? "#30c759"
        : title === "Основная валюта"
          ? "#8e8e93"
          : title === "Поддержка"
            ? "#ff9500"
            : "#ff3b30";
  return (
    <F7Popup
      push
      opened={open}
      className={`wpay-profile-popup ${title === "Карта" ? "wpay-card-popup" : ""}`}
      closeByBackdropClick
      closeOnEscape
      swipeToClose="to-bottom"
      swipeHandler=".wpay-profile-popup .navbar"
      onPopupClosed={onClose}
    >
      <div className="view">
        <F7Page>
          <F7Navbar large={title !== "Карта"} transparent>
            {title !== "Карта" && (
              <span slot="title" className="inline-flex items-center gap-2">
                <Icon className="text-[20px]" style={{ color }} />
                {title}
              </span>
            )}
            {title !== "Карта" && (
              <span
                slot="title-large"
                className="inline-flex items-center gap-3"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] text-white"
                  style={{
                    background: `linear-gradient(to bottom,color-mix(in srgb, ${color} 75%, white),${color})`,
                  }}
                >
                  <Icon className="text-[27px]" />
                </span>
                {title}
              </span>
            )}
            <NavRight>
              <F7Link popupClose aria-label={`Закрыть ${title.toLowerCase()}`}>
                <i className="icon icon-close" />
              </F7Link>
            </NavRight>
          </F7Navbar>
          {children}
        </F7Page>
      </div>
    </F7Popup>
  );
}

function DepositMethodsView({
  flow,
  onClose,
}: {
  flow: CryptoFlow | null;
  onClose: () => void;
  showNotice: NoticeHandler;
}) {
  const live = useLiveWallet();
  const controller = useRef<AbortController | null>(null);
  const [resolving, setResolving] = useState(false),
    [depositError, setDepositError] = useState("");

  const [entry, setEntry] = useState<WalletAddressSelection | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    setSelected(flow?.assetCode ?? null);
    setEntry(flow?.depositAddress ?? null);
    setNetwork(flow?.network ?? null);
  }, [flow]);
  async function chooseNetwork(code: string, network: string) {
    if (resolving) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setSelected(code);
    setEntry(null);
    setResolving(true);
    setDepositError("");
    try {
      const resolved = await resolveDeposit(
        code,
        network,
        live.demo,
        request.signal,
      );
      if (request.signal.aborted) return;
      setNetwork(network);
      setEntry(resolved);
    } catch (error) {
      if (!request.signal.aborted)
        setDepositError(
          error instanceof Error
            ? error.message
            : "Не удалось получить реквизиты",
        );
    } finally {
      if (!request.signal.aborted) setResolving(false);
    }
  }
  useEffect(() => () => controller.current?.abort(), [flow]);
  function chooseAsset(code: string) {
    setSelected(code);
    setEntry(null);
    setNetwork(null);
    if (code !== "RUB" && code !== "USDT") {
      const first = live.assetRoutes[code]?.[0];
      if (first) chooseNetwork(code, first);
    }
  }
  function back() {
    controller.current?.abort();
    setResolving(false);
    setDepositError("");
    if (entry) {
      setEntry(null);
      if (selected !== "USDT") {
        setSelected(null);
        setNetwork(null);
      } else setNetwork(null);
    } else if (network) {
      setNetwork(null);
      if (selected !== "USDT") setSelected(null);
    } else if (selected) setSelected(null);
    else onClose();
  }
  const depositAssets = assets.filter(
    (item) => (live.assetRoutes[item.code] ?? []).length > 0,
  );
  const selectedAsset = depositAssets.find((item) => item.code === selected);
  if (entry && selected && selectedAsset)
    return (
      <PushViewShell
        open={flow !== null}
        title={`Пополнить ${selected}`}
        subtitle={addressNetworkNames[entry.network]}
        onClose={flow?.depositAddress ? onClose : back}
      >
        <WalletCryptoDeposit
          code={selected}
          entry={entry}
          icon={selectedAsset.icon}
          color={selectedAsset.color}
          iconColor={selectedAsset.iconColor}
        />
      </PushViewShell>
    );
  return (
    <PushViewShell
      open={flow !== null}
      title={selected ? `Пополнить ${selected}` : "Пополнить"}
      onClose={back}
    >
      {resolving && (
        <p
          role="status"
          className="px-5 py-4 text-center text-black/45 dark:text-white/45"
        >
          Получаем реквизиты выбранной сети…
        </p>
      )}
      {depositError && (
        <p
          role="alert"
          className="mx-4 rounded-2xl bg-red-500/10 p-4 text-red-600 dark:text-red-400"
        >
          {depositError}
        </p>
      )}

      {selected === "USDT" && !network ? (
        <main className="mx-auto w-full max-w-[560px] px-4 pb-8 pt-1">
          <p className="mb-4 text-center text-[14px] text-black/45 dark:text-white/45">
            Выберите сеть
          </p>
          <List
            strong
            inset
            dividers
            className="!mx-0 !my-0 overflow-hidden !rounded-[30px] [&>ul]:!rounded-[30px]"
          >
            {(live.assetRoutes.USDT ?? []).map((net) => (
              <ListItem
                key={net}
                link
                chevron={false}
                onClick={() => chooseNetwork("USDT", net)}
                contentClassName="!h-[64px]"
                innerClassName="!min-w-0 !h-[64px] !py-2 after:!opacity-30"
                media={
                  <WalletAssetAvatar
                    icon={
                      depositAssets.find((item) => item.code === "USDT")
                        ?.icon ?? assets[0].icon
                    }
                    color={
                      depositAssets.find((item) => item.code === "USDT")
                        ?.color ?? assets[0].color
                    }
                    iconColor={
                      depositAssets.find((item) => item.code === "USDT")
                        ?.iconColor ?? assets[0].iconColor
                    }
                    network={net}
                  />
                }
                innerChildren={
                  <span className="flex h-full w-full items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-[17px] font-semibold leading-6 text-black dark:text-white">
                        {assets[0].code}
                        {!["BTC", "TRX"].includes(assets[0].code)
                          ? " · " + (addressNetworkStandards[net] ?? net)
                          : ""}
                      </span>
                      <span className="mt-0.5 block text-[14px] leading-5 text-black/45 dark:text-white/45">
                        {addressNetworkNames[net]}
                      </span>
                    </span>
                    <ChevronRight className="shrink-0 text-[19px] text-black/25 dark:text-white/30" />
                  </span>
                }
              />
            ))}
          </List>
        </main>
      ) : selected ? (
        <LiveDepositPanel
          defaultNetwork={network ?? flow?.network}
          defaultAsset={selected}
          onAssetChange={chooseAsset}
          options={[sbpDepositAsset, ...depositAssets].map((item) => ({
            code: item.code,
            name: item.name,
            icon: item.icon,
            style: assetIconStyle(item),
          }))}
        />
      ) : (
        <main
          aria-busy={live.loading}
          aria-label="Способы пополнения"
          className="mx-auto w-full max-w-[560px] px-4 pb-8 pt-1"
        >
          <p className="mb-4 mt-1 text-center text-[14px] text-black/45 dark:text-white/45">
            Выберите способ пополнения
          </p>
          <List
            strong
            inset
            className="!mx-0 !my-0 overflow-hidden !rounded-[30px] [&>ul]:!rounded-[30px]"
          >
            {live.loading ? (
              <CurrencySkeletonRow rubles deposit />
            ) : (
              <CurrencyRow
                asset={sbpDepositAsset}
                deposit
                onClick={() => chooseAsset("RUB")}
              />
            )}
          </List>
          <h2 className="mb-2 mt-6 px-1 text-[17px] font-semibold text-black/50 dark:text-white/50">
            Криптовалютой
          </h2>
          <List
            strong
            inset
            dividers
            className="!mx-0 !my-0 overflow-hidden !rounded-[30px] [&>ul]:!rounded-[30px]"
          >
            {live.loading
              ? depositAssets.map((item) => (
                  <CurrencySkeletonRow key={item.code} deposit />
                ))
              : depositAssets.map((item) => (
                  <CurrencyRow
                    key={item.code}
                    asset={item}
                    deposit
                    onClick={() => {
                      chooseAsset(item.code);
                      haptic("light");
                    }}
                  />
                ))}
          </List>
        </main>
      )}
    </PushViewShell>
  );
}

function CryptoFlowPushView({
  flow,
  onClose,
  showNotice,
}: {
  flow: CryptoFlow | null;
  onClose: () => void;
  showNotice: NoticeHandler;
}) {
  const live = useLiveWallet();
  const availableAssets = assets.filter(
    (item) => (live.assetRoutes[item.code] ?? []).length > 0,
  );
  const [displayFlow, setDisplayFlow] = useState<CryptoFlow>({
    kind: "withdraw",
  });
  const [fromCode, setFromCode] = useState("USDT");
  const [toCode, setToCode] = useState("GRAM");
  const [amount, setAmount] = useState("");
  const [assetPicker, setAssetPicker] = useState<"from" | "to" | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  useEffect(() => {
    if (!flow) return;
    setDisplayFlow(flow);
    setAssetPicker(null);
    setPickerQuery("");
    if (flow.assetCode) {
      setFromCode(flow.assetCode);
      setToCode((previous) =>
        previous === flow.assetCode
          ? flow.assetCode === "USDT"
            ? "GRAM"
            : "USDT"
          : previous,
      );
    }
  }, [flow]);

  const activeFlow = flow ?? displayFlow;
  const isDeposit = activeFlow.kind === "deposit";
  const isWithdraw = activeFlow.kind === "withdraw";
  const fromAsset =
    availableAssets.find((item) => item.code === fromCode) ??
    availableAssets[0] ??
    assets[0];
  const toAsset =
    availableAssets.find((item) => item.code === toCode) ??
    availableAssets[1] ??
    fromAsset;
  const usdRates: Record<string, number> = Object.fromEntries(
    availableAssets.map((item) => [item.code, live.rate(item.code) ?? 0]),
  );
  const balances: Record<string, number> = Object.fromEntries(
    availableAssets.map((item) => [item.code, Number(live.balance(item.code))]),
  );
  const parsedAmount = Number(amount.replace(",", ".")) || 0;
  const exchangeRate =
    (usdRates[fromAsset.code] ?? 0) / (usdRates[toAsset.code] || 1);
  const receiveAmount = parsedAmount * exchangeRate;
  const formatCrypto = (value: number, maximumFractionDigits = 6) =>
    value.toLocaleString("en-US", { maximumFractionDigits });

  const selectExchangeAsset = (code: string) => {
    if (assetPicker === "from") {
      setFromCode(code);
      if (code === toCode) setToCode(fromCode);
    }
    if (assetPicker === "to") {
      setToCode(code);
      if (code === fromCode) setFromCode(toCode);
    }
    haptic("light");
    setAssetPicker(null);
  };

  const swapExchangeAssets = () => {
    setFromCode(toCode);
    setToCode(fromCode);
    setAmount(
      receiveAmount > 0 ? String(Number(receiveAmount.toFixed(8))) : "",
    );
    haptic("light");
  };

  if (isDeposit) {
    return (
      <DepositMethodsView
        flow={flow}
        onClose={onClose}
        showNotice={showNotice}
      />
    );
  }

  if (!isWithdraw) {
    if (availableAssets.length < 2) {
      return (
        <PushViewShell open={flow !== null} title="Обмен" onClose={onClose}>
          <p className="mx-4 rounded-2xl bg-black/[.04] p-5 text-center text-sm text-black/45 dark:bg-white/[.06] dark:text-white/45">
            Для обмена должны быть включены минимум две валюты.
          </p>
        </PushViewShell>
      );
    }
    const pickerAssets = availableAssets.filter((item) =>
      `${item.name} ${item.code}`
        .toLowerCase()
        .includes(pickerQuery.trim().toLowerCase()),
    );

    const balancePercent =
      balances[fromCode] > 0
        ? Math.min(100, Math.max(0, (parsedAmount / balances[fromCode]) * 100))
        : 0;
    const enterKey = (key: string) => {
      haptic("light");
      setAmount((previous) => {
        if (key === "delete") return previous.slice(0, -1);
        const digit = key === "," ? "." : key;
        if (digit === ".")
          return /[.,]/.test(previous) ? previous : (previous || "0") + ".";
        if (previous.length >= 18) return previous;
        const fraction = previous.split(/[.,]/)[1];
        if (fraction !== undefined && fraction.length >= 8) return previous;
        return previous === "0" ? digit : previous + digit;
      });
    };
    const hasRate =
      (live.rate(fromAsset.code) ?? 0) > 0 &&
      (live.rate(toAsset.code) ?? 0) > 0;
    return (
      <PushViewShell
        open={flow !== null}
        title="Обмен"
        onClose={onClose}
        onRefreshed={() => void live.refresh()}
      >
        <main className="wpay-exchange-desktop relative mx-auto w-full max-w-[560px] px-4 pb-6 pt-3">
          <div className="relative space-y-1">
            {(["from", "to"] as const).map((side) => {
              const giving = side === "from",
                asset = giving ? fromAsset : toAsset;
              return (
                <section
                  key={side}
                  className={`bg-white px-5 py-4 dark:bg-[#1c1c1e] ${giving ? "rounded-t-[32px] rounded-b-lg" : "rounded-t-lg rounded-b-[32px]"}`}
                >
                  <div className="flex items-center justify-between text-[15px] text-black/45 dark:text-white/45">
                    <span>{giving ? "Отдаёте" : "Получаете"}</span>
                    <span className="flex items-center gap-1.5 text-[13px]">
                      <WalletFill className="text-[15px]" />
                      <span className="tabular-nums">
                        {live.ready
                          ? formatCrypto(balances[asset.code] ?? 0)
                          : "—"}
                      </span>
                    </span>
                  </div>
                  <div className="mt-4 flex h-12 items-center gap-3">
                    {giving ? (
                      <input
                        aria-label={`Сумма в ${asset.code}`}
                        inputMode="none"
                        readOnly
                        value={amount}
                        placeholder="0"
                        onKeyDown={(e) => {
                          if (/^[0-9.,]$/.test(e.key)) {
                            e.preventDefault();
                            enterKey(e.key);
                          } else if (e.key === "Backspace") {
                            e.preventDefault();
                            enterKey("delete");
                          }
                        }}
                        className="min-w-0 flex-1 bg-transparent p-0 text-left text-[44px] font-medium leading-none tracking-tight text-black outline-none placeholder:text-black/30 dark:text-white dark:placeholder:text-white/30"
                      />
                    ) : (
                      <output
                        aria-label="Сумма получения"
                        className={`min-w-0 flex-1 truncate text-[44px] font-medium leading-none tracking-tight ${receiveAmount > 0 && hasRate ? "text-black dark:text-white" : "text-black/30 dark:text-white/30"}`}
                      >
                        {hasRate && receiveAmount > 0
                          ? formatCrypto(receiveAmount, 8)
                          : "0.00"}
                      </output>
                    )}
                    <button
                      type="button"
                      aria-label={
                        giving ? "Валюта списания" : "Валюта получения"
                      }
                      onClick={() => {
                        setPickerQuery("");
                        setAssetPicker(side);
                      }}
                      className="flex min-h-12 shrink-0 items-center gap-2 py-1 pl-2 text-black dark:text-white"
                    >
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-full [&>svg]:!h-[21px] [&>svg]:!w-[21px]"
                        style={assetIconStyle(asset)}
                      >
                        {asset.icon}
                      </span>
                      <span className="text-[18px] font-semibold">
                        {asset.code}
                      </span>
                      <ChevronRight className="rotate-90 text-[16px] text-black/35 dark:text-white/35" />
                    </button>
                  </div>
                </section>
              );
            })}
            <button
              type="button"
              aria-label="Поменять валюты местами"
              onClick={swapExchangeAssets}
              className="absolute left-1/2 top-1/2 z-10 !mt-0 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[5px] border-[#efeff4] bg-blue-50 text-primary active:scale-95 dark:border-black dark:bg-[#13233c]"
            >
              <ArrowRightArrowLeft className="rotate-90 text-[22px]" />
            </button>
          </div>
          <p
            role="status"
            className="my-4 text-center text-[13px] text-black/45 dark:text-white/45"
          >
            {hasRate
              ? `1 ${fromAsset.code} ≈ ${formatCrypto(exchangeRate, 8)} ${toAsset.code}`
              : "Курс пока недоступен"}
          </p>
          <div className="flex h-11 items-center gap-4 px-2">
            <button
              type="button"
              onClick={() => setAmount("")}
              className="min-h-11 text-[14px] font-medium text-primary"
            >
              Мин
            </button>
            <input
              aria-label="Доля доступного баланса"
              type="range"
              min="0"
              max="100"
              step="1"
              value={balancePercent}
              disabled={!live.ready || !(balances[fromCode] > 0)}
              onChange={(e) =>
                setAmount(
                  String(
                    Number(
                      (
                        ((balances[fromCode] ?? 0) * Number(e.target.value)) /
                        100
                      ).toFixed(8),
                    ),
                  ),
                )
              }
              className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[#3275e9] disabled:opacity-35"
            />
            <button
              type="button"
              disabled={!live.ready}
              onClick={() => setAmount(String(balances[fromCode] ?? 0))}
              className="min-h-11 text-[14px] font-medium text-primary disabled:opacity-40"
            >
              Макс
            </button>
          </div>
          <div
            className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1"
            aria-label="Цифровая клавиатура"
          >
            {[
              "1",
              "2",
              "3",
              "4",
              "5",
              "6",
              "7",
              "8",
              "9",
              ".",
              "0",
              "delete",
            ].map((key) => (
              <button
                key={key}
                type="button"
                aria-label={
                  key === "delete"
                    ? "Удалить цифру"
                    : key === "."
                      ? "Десятичный разделитель"
                      : key
                }
                onClick={() => enterKey(key)}
                className="flex h-[clamp(44px,7dvh,64px)] items-center justify-center rounded-2xl text-[31px] font-medium text-black transition-colors active:bg-black/5 dark:text-white dark:active:bg-white/10"
              >
                {key === "delete" ? (
                  <Delete size={25} strokeWidth={1.8} />
                ) : (
                  key
                )}
              </button>
            ))}
          </div>
          <Button
            data-wpay-primary=""
            large
            rounded
            disabled={
              !(parsedAmount > 0) ||
              !hasRate ||
              !live.ready ||
              parsedAmount > (balances[fromCode] ?? 0)
            }
            onClick={() =>
              showNotice("Обмен пока недоступен. Средства не списываются.")
            }
            className="wpay-bottom-action !mt-5 !h-14 !w-full !rounded-[22px] !text-[17px] !font-semibold"
          >
            Продолжить
          </Button>
          <p className="mt-3 text-center text-[12px] text-black/35 dark:text-white/35">
            Расчёт справочный. Обмен пока недоступен.
          </p>
        </main>
        {createPortal(
          <F7Sheet
            opened={assetPicker !== null && flow !== null}
            backdrop
            closeByBackdropClick
            closeOnEscape
            swipeToClose
            swipeHandler=".wpay-exchange-picker-header"
            className="wpay-exchange-sheet"
            onSheetClosed={() => {
              setAssetPicker(null);
              setPickerQuery("");
            }}
          >
            <header className="wpay-exchange-picker-header shrink-0 px-5 pb-4 pt-3">
              <div
                aria-hidden="true"
                className="mx-auto mb-4 h-1 w-9 rounded-full bg-black/[.08] dark:bg-white/10"
              />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[23px] font-semibold tracking-tight text-black dark:text-white">
                    Выберите валюту
                  </h2>
                  <p className="mt-1 text-[14px] text-black/45 dark:text-white/45">
                    {assetPicker === "from"
                      ? "С какого счёта списать"
                      : "На какой счёт получить"}
                  </p>
                </div>
                <WalletSheetClose
                  label="Закрыть выбор валюты"
                  onClick={() => setAssetPicker(null)}
                />
              </div>
              <label className="mt-5 flex h-12 items-center gap-2.5 rounded-[20px] bg-black/5 px-3.5 dark:bg-white/10">
                <Search
                  size={19}
                  aria-hidden="true"
                  className="shrink-0 text-black/40 dark:text-white/40"
                />
                <input
                  aria-label="Найти валюту"
                  placeholder="Название или тикер"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-black outline-none placeholder:text-black/40 dark:text-white dark:placeholder:text-white/40"
                />
              </label>
            </header>
            <section
              aria-label="Валюты для обмена"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-[max(20px,env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <List
                strong
                inset
                dividers
                className="!mx-0 !my-0 !bg-transparent"
              >
                {pickerAssets.map((item) => {
                  const selected =
                    item.code === (assetPicker === "from" ? fromCode : toCode);
                  return (
                    <ListItem
                      key={item.code}
                      link
                      chevron={false}
                      onClick={() => selectExchangeAsset(item.code)}
                      contentClassName="!h-[72px]"
                      innerClassName="!h-[72px] !min-w-0 !py-2 after:!opacity-30"
                      media={
                        <span
                          className="wpay-currency-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full [&>svg]:!h-6 [&>svg]:!w-6"
                          style={assetIconStyle(item)}
                        >
                          {item.icon}
                        </span>
                      }
                      innerChildren={
                        <span className="flex min-w-0 items-center justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-[17px] font-semibold text-black dark:text-white">
                              {item.name}
                            </span>
                            <span className="mt-0.5 block text-[13px] text-black/45 dark:text-white/45">
                              {item.code}
                            </span>
                          </span>
                          <span className="ml-auto text-right">
                            <span className="block text-[16px] font-medium tabular-nums text-black dark:text-white">
                              {live.ready
                                ? formatCrypto(balances[item.code] ?? 0)
                                : "—"}
                            </span>
                            <span className="mt-0.5 block text-[12px] text-black/40 dark:text-white/40">
                              {live.ready && live.rate(item.code) !== null
                                ? usd(
                                    (balances[item.code] ?? 0) *
                                      (live.rate(item.code) ?? 0),
                                  )
                                : "Нет данных"}
                            </span>
                          </span>
                          <span className="flex w-5 shrink-0 items-center justify-center text-primary">
                            {selected && <Check size={20} strokeWidth={2.5} />}
                          </span>
                        </span>
                      }
                    />
                  );
                })}
              </List>
              {!pickerAssets.length && (
                <p
                  role="status"
                  className="px-5 py-10 text-center text-[15px] text-black/45 dark:text-white/45"
                >
                  Валюта не найдена
                </p>
              )}
            </section>
          </F7Sheet>,
          document.querySelector(".wpay-f7-root") ?? document.body,
        )}
      </PushViewShell>
    );
  }

  return <WithdrawalMethodsView open={flow !== null} onClose={onClose} />;
}

function WithdrawalMethodsView({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<WithdrawalMethod | null>(null);
  useEffect(() => {
    if (open) setMethod(null);
  }, [open]);
  return (
    <PushViewShell
      open={open}
      title={method ? withdrawalTitles[method] : "Вывод"}
      onClose={() => (method ? setMethod(null) : onClose())}
    >
      {method ? (
        <WithdrawalForm key={method} method={method} />
      ) : (
        <WithdrawalMethods onSelect={setMethod} />
      )}
    </PushViewShell>
  );
}

const bankCards = [
  {
    id: "rub",
    name: "Основная карта",
    currency: "₽",
    balance: "0.00 ₽",
    last4: "0000",
    network: "Visa",
    gradient: "from-[#1d4ed8] via-[#2563eb] to-[#60a5fa]",
  },
  {
    id: "usd",
    name: "Долларовая карта",
    currency: "$",
    balance: "$0.00",
    last4: "0001",
    network: "Visa",
    gradient: "from-[#312e81] via-[#5b21b6] to-[#a855f7]",
  },
  {
    id: "amex",
    name: "Green",
    currency: "$",
    balance: "$0.00",
    last4: "1002",
    network: "American Express",
    gradient: "from-[#f1f3f6] via-[#cdd3dc] to-[#e6ebf0]",
  },
];

const cardPayments = {
  amex: [],
  rub: [
    {
      id: 1,
      title: "Кофейня",
      subtitle: "Сегодня, 10:15",
      amount: "−620 ₽",
      icon: CreditcardFill,
    },
    {
      id: 2,
      title: "Пополнение",
      subtitle: "Сегодня, 09:40",
      amount: "+10 000 ₽",
      icon: ArrowDownCircleFill,
      income: true,
    },
    {
      id: 3,
      title: "Подписка",
      subtitle: "Вчера, 18:06",
      amount: "−490 ₽",
      icon: CreditcardFill,
    },
  ],
  usd: [
    {
      id: 1,
      title: "App Store",
      subtitle: "Сегодня, 08:20",
      amount: "−$12.99",
      icon: CreditcardFill,
    },
    {
      id: 2,
      title: "Пополнение",
      subtitle: "Вчера, 16:32",
      amount: "+$100.00",
      icon: ArrowDownCircleFill,
      income: true,
    },
  ],
};

type BankCard = (typeof bankCards)[number];
const roundedWalletList =
  "!mt-0 overflow-hidden !rounded-[32px] [&>ul]:!rounded-[32px]";
function BankCardArtwork({ card }: { card: BankCard }) {
  const chipId = useId();
  if (card.id === "amex")
    return (
      <span
        role="img"
        aria-label={`${card.name}, ${card.network}, демо, ${card.balance}, номер заканчивается на ${card.last4}`}
        className="wpay-classic-card"
      >
        <img
          src="/cards/amex-green-classic.png"
          width="315"
          height="199"
          alt=""
          draggable={false}
          className="wpay-classic-card-image"
        />
        <span className="wpay-classic-card-status">
          {card.balance}
          <span>·</span>Демо
        </span>
      </span>
    );
  return (
    <span
      role="img"
      aria-label={`${card.name}, ${card.network}, демо, ${card.balance}, номер заканчивается на ${card.last4}`}
      className={`wpay-bank-card wpay-bank-card--${card.id}`}
    >
      <span className="wpay-bank-card-orbit" aria-hidden="true" />
      <span className="wpay-bank-card-head">
        <span className="wpay-bank-card-brand">
          WPay
          <span className="wpay-bank-card-brand-dot" />
        </span>
        <span className="wpay-bank-card-tag">
          {card.currency === "₽" ? "RUB" : "USD"}
          <span>·</span>Демо
        </span>
      </span>
      <span className="wpay-bank-card-middle">
        <span>
          <span className="wpay-bank-card-name">{card.name}</span>
          <span className="wpay-bank-card-balance">{card.balance}</span>
        </span>
        <span className="wpay-bank-card-chip-group" aria-hidden="true">
          <svg width="36" height="28" viewBox="0 0 36 28" fill="none">
            <rect
              x=".5"
              y=".5"
              width="35"
              height="27"
              rx="7"
              fill={`url(#${chipId})`}
              stroke="#fff"
              strokeOpacity=".4"
            />
            <path
              d="M12 0v8L8 11H0m36 0h-8l-4-3V0M0 17h8l4 3v8m12 0v-8l4-3h8M12 8h12v12H12z"
              stroke="#836b40"
              strokeOpacity=".55"
              strokeWidth=".75"
            />
            <defs>
              <linearGradient
                id={chipId}
                x1="0"
                y1="0"
                x2="36"
                y2="28"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#f4e8c7" />
                <stop offset=".5" stopColor="#c9ad71" />
                <stop offset="1" stopColor="#efddaf" />
              </linearGradient>
            </defs>
          </svg>
          <svg width="17" height="24" viewBox="0 0 17 24" fill="none">
            <path
              d="M3 8a7 7 0 0 1 0 8m4-11a12 12 0 0 1 0 14m4-17a17 17 0 0 1 0 20"
              stroke="currentColor"
              strokeOpacity=".75"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </span>
      <span className="wpay-bank-card-bottom">
        <span>
          <span className="wpay-bank-card-number">
            ••••<span>{card.last4}</span>
          </span>
          <span className="wpay-bank-card-kind">VIRTUAL DEBIT</span>
        </span>
        <span className="wpay-bank-card-visa">VISA</span>
      </span>
    </span>
  );
}

function CardAvatar({ card }: { card: BankCard }) {
  return (
    <span
      className="wpay-currency-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
      style={assetIconStyle({
        color:
          card.id === "rub"
            ? "#3275e9"
            : card.id === "amex"
              ? "#42765b"
              : "#7c3aed",
        iconColor: "#fff",
      })}
    >
      <CreditcardFill className="text-[23px]" />
    </span>
  );
}
function CardsPaymentsList({
  card,
  showNotice,
}: {
  card: BankCard;
  showNotice: NoticeHandler;
}) {
  const payments = cardPayments[card.id as keyof typeof cardPayments];
  if (!payments.length)
    return (
      <p className="mx-4 rounded-[28px] bg-white px-5 py-6 text-center text-[14px] text-black/40 dark:bg-[#1c1c1e] dark:text-white/40">
        По этой карте пока нет операций
      </p>
    );
  return (
    <List strong inset dividers className={roundedWalletList}>
      {payments.map((payment) => {
        const Icon = payment.icon;
        return (
          <ListItem
            key={`${card.id}-${payment.id}`}
            link
            chevron={false}
            onClick={() => showNotice(`${payment.title} · пример операции`)}
            contentClassName="!h-16"
            innerClassName="!min-w-0 !h-16 !py-2 after:!opacity-30"
            media={
              <span
                className={`wpay-currency-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${payment.income ? "bg-gradient-to-b from-green-300 to-green-500 text-white dark:from-green-400 dark:to-green-600" : "bg-gradient-to-b from-blue-300 to-blue-500 text-white dark:from-blue-400 dark:to-blue-600"}`}
              >
                <Icon className="text-[22px]" />
              </span>
            }
            innerChildren={
              <span className="flex h-full min-w-0 items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-[17px] font-semibold leading-6 text-black dark:text-white">
                    {payment.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[14px] leading-5 text-black/45 dark:text-white/45">
                    {payment.subtitle}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-right text-[16px] font-medium tabular-nums ${payment.income ? "text-green-600 dark:text-green-400" : "text-black dark:text-white"}`}
                >
                  {payment.amount}
                </span>
              </span>
            }
          />
        );
      })}
    </List>
  );
}
function CardWalletOptions({ showNotice }: { showNotice: NoticeHandler }) {
  return (
    <List strong inset dividers className={roundedWalletList}>
      {[
        {
          title: "Apple Wallet",
          subtitle: "Добавить карту",
          Icon: LogoApple,
          color: "bg-black text-white dark:bg-white dark:text-black",
        },
        {
          title: "Google Wallet",
          subtitle: "Добавить карту",
          Icon: LogoGoogle,
          color:
            "bg-gradient-to-b from-blue-300 to-blue-500 text-white dark:from-blue-400 dark:to-blue-600",
        },
      ].map(({ title, subtitle, Icon, color }) => (
        <ListItem
          key={title}
          link
          title={title}
          subtitle={subtitle}
          contentClassName="!h-16"
          innerClassName="!h-16 !py-2 after:!opacity-30"
          titleWrapClassName="pr-6"
          chevronIcon={
            <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-[19px] text-black/25 dark:text-white/30" />
          }
          onClick={() =>
            showNotice(`${title}: подключение появится после выпуска карты`)
          }
          media={
            <span
              className={`wpay-currency-icon flex h-11 w-11 items-center justify-center rounded-full ${color}`}
            >
              <Icon className="text-[24px]" />
            </span>
          }
        />
      ))}
    </List>
  );
}
const cardOffers = [
  {
    id: "virtual",
    name: "Виртуальная USD",
    caption: "Для ваших онлайн-покупок",
    network: "Visa",
    premium: false,
  },
  {
    id: "premium",
    name: "Premium USD",
    caption: "Ещё одна карта для ваших планов",
    network: "Mastercard",
    premium: true,
  },
];
type CardOffer = (typeof cardOffers)[number];
function CardOfferArtwork({ offer }: { offer: CardOffer }) {
  return (
    <span
      className={`wpay-bank-card wpay-card-offer ${offer.premium ? "wpay-card-offer-premium" : ""}`}
    >
      <span className="wpay-bank-card-orbit" aria-hidden="true" />
      <span className="wpay-bank-card-head">
        <span className="wpay-bank-card-brand">
          WPay
          <span className="wpay-bank-card-brand-dot" />
        </span>
        <span className="wpay-bank-card-tag">USD · Новая</span>
      </span>
      <span className="wpay-card-offer-plus" aria-hidden="true">
        +
      </span>
      <span className="wpay-bank-card-bottom">
        <span>
          <span className="wpay-card-offer-title">{offer.name}</span>
          <span className="wpay-bank-card-kind">ДОБАВИТЬ КАРТУ</span>
        </span>
        <span
          className={
            offer.premium ? "text-[12px] font-semibold" : "wpay-bank-card-visa"
          }
        >
          {offer.network}
        </span>
      </span>
    </span>
  );
}
function CardOfferDetails({
  offer,
  onOrder,
  checkout = false,
}: {
  offer: CardOffer;
  onOrder?: () => void;
  checkout?: boolean;
}) {
  return (
    <div className="px-4 pb-7 pt-6">
      <h2 className="text-[27px] font-semibold tracking-tight text-black dark:text-white">
        {offer.name}
      </h2>
      <p className="mt-2 text-[16px] leading-6 text-black/45 dark:text-white/45">
        {offer.caption}. Отдельная карта в долларах поможет разделить расходы и
        подписки.
      </p>
      <List
        strong
        dividers
        className="!mx-0 !mb-5 !mt-5 overflow-hidden !rounded-[28px] [&>ul]:!rounded-[28px]"
      >
        {["Выпуск карты", "Обслуживание", "Пополнение"].map((title) => (
          <ListItem
            key={title}
            title={title}
            after="Уточняется"
            contentClassName="!h-14"
            innerClassName="!h-14 after:!opacity-30"
          />
        ))}
      </List>
      <Button
        data-wpay-primary=""
        rounded
        large
        disabled={checkout}
        className="!m-0 !w-full !rounded-[22px]"
        onClick={onOrder}
      >
        {checkout ? "Выпуск пока недоступен" : "Заказать карту"}
      </Button>
      <p className="mt-3 px-2 text-center text-[13px] leading-5 text-black/40 dark:text-white/40">
        {checkout
          ? "Провайдер выпуска ещё не подключён. Цена, комиссии и доступные способы оплаты появятся до подтверждения заказа. Средства не списываются."
          : "Предварительный каталог. Условия и стоимость выпуска пока не опубликованы."}
      </p>
    </div>
  );
}
function CardPurchaseView({
  offer,
  onSelect,
  onClose,
}: {
  offer: CardOffer | null;
  onSelect: (offer: CardOffer) => void;
  onClose: () => void;
}) {
  const [displayOffer, setDisplayOffer] = useState(cardOffers[0]);
  useEffect(() => {
    if (offer) setDisplayOffer(offer);
  }, [offer]);
  return (
    <NotificationSheet
      open={offer !== null}
      title="Новая карта"
      onClose={onClose}
    >
      <main className="mx-auto w-full max-w-[560px] pb-6">
        <div className="flex gap-2 px-4 pb-4 pt-3">
          {cardOffers.map((item) => (
            <button
              key={item.id}
              type="button"
              data-wpay-primary={displayOffer.id === item.id ? "" : undefined}
              aria-pressed={displayOffer.id === item.id}
              onClick={() => onSelect(item)}
              className={`min-h-10 flex-1 rounded-full px-3 text-[14px] font-medium ${displayOffer.id === item.id ? "bg-primary text-white dark:bg-primary" : "bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50"}`}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div className="px-4">
          <CardOfferArtwork offer={displayOffer} />
        </div>
        <CardOfferDetails offer={displayOffer} checkout />
      </main>
    </NotificationSheet>
  );
}

function CardsSection({ showNotice }: { showNotice: NoticeHandler }) {
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const cardDrag = useRef({
    active: false,
    startX: 0,
    scrollLeft: 0,
    moved: false,
  });
  const suppressCardClick = useRef(false);
  const [draggingCard, setDraggingCard] = useState(false);
  const finishCardDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = cardDrag.current;
    if (!drag.active) return;
    drag.active = false;
    if (!drag.moved) return;
    event.stopPropagation();
    setDraggingCard(false);
    const container = event.currentTarget;
    const card = container.firstElementChild as HTMLElement | null;
    const step = (card?.offsetWidth ?? container.clientWidth) + 12;
    const target = Math.round(container.scrollLeft / step) * step;
    container.style.scrollSnapType = "";
    container.scrollTo({
      left: target,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    if (container.hasPointerCapture(event.pointerId))
      container.releasePointerCapture(event.pointerId);
    window.setTimeout(() => {
      suppressCardClick.current = false;
    }, 0);
  };
  const [purchaseOffer, setPurchaseOffer] = useState<CardOffer | null>(null);
  const activeOffer = cardOffers[activeCardIndex - bankCards.length];
  const carouselCount = bankCards.length + cardOffers.length;
  const [settingsCardId, setSettingsCardId] = useState<string | null>(null);
  const activeCard = bankCards[activeCardIndex] ?? bankCards[0];
  const selectedCard =
    bankCards.find((card) => card.id === settingsCardId) ?? activeCard;
  return (
    <>
      <main className="mx-auto w-full max-w-[560px] pb-6">
        <section aria-label="Ваши карты" className="pt-5">
          <div
            className={`flex snap-x snap-mandatory gap-3 overflow-x-auto select-none px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${draggingCard ? "cursor-grabbing" : "cursor-grab"}`}
            onDragStart={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (event.pointerType !== "mouse" || event.button !== 0) return;
              event.stopPropagation();
              cardDrag.current = {
                active: true,
                startX: event.clientX,
                scrollLeft: event.currentTarget.scrollLeft,
                moved: false,
              };
            }}
            onPointerMove={(event) => {
              const drag = cardDrag.current;
              if (event.pointerType !== "mouse" || !drag.active) return;
              const delta = event.clientX - drag.startX;
              if (!drag.moved && Math.abs(delta) < 6) return;
              if (!drag.moved) {
                drag.moved = true;
                suppressCardClick.current = true;
                setDraggingCard(true);
                event.currentTarget.style.scrollSnapType = "none";
                event.currentTarget.setPointerCapture(event.pointerId);
              }
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.scrollLeft = drag.scrollLeft - delta;
            }}
            onPointerUp={finishCardDrag}
            onPointerCancel={finishCardDrag}
            onLostPointerCapture={finishCardDrag}
            onPointerLeave={() => {
              if (!cardDrag.current.moved) cardDrag.current.active = false;
            }}
            onClickCapture={(event) => {
              if (suppressCardClick.current) {
                event.preventDefault();
                event.stopPropagation();
                suppressCardClick.current = false;
              }
            }}
            onScroll={(event) => {
              const container = event.currentTarget;
              const card = container.firstElementChild as HTMLElement | null;
              if (card)
                setActiveCardIndex(
                  Math.max(
                    0,
                    Math.min(
                      carouselCount - 1,
                      Math.round(
                        container.scrollLeft / (card.offsetWidth + 12),
                      ),
                    ),
                  ),
                );
            }}
          >
            {bankCards.map((card) => (
              <button
                key={card.id}
                type="button"
                aria-label={`Открыть ${card.name}`}
                onClick={() => setSettingsCardId(card.id)}
                className="min-w-0 shrink-0 basis-full snap-center rounded-[30px] text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <BankCardArtwork card={card} />
              </button>
            ))}
            {cardOffers.map((offer) => (
              <button
                key={offer.id}
                type="button"
                aria-label={`Заказать ${offer.name}`}
                onClick={() => setPurchaseOffer(offer)}
                className="min-w-0 shrink-0 basis-full snap-center rounded-[30px] text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <CardOfferArtwork offer={offer} />
              </button>
            ))}
          </div>
          <div
            className="mt-2 flex justify-center gap-1.5"
            aria-label={`Карта ${activeCardIndex + 1} из ${carouselCount}`}
          >
            {[...bankCards, ...cardOffers].map((card, index) => (
              <span
                key={card.id}
                className={`h-1.5 w-1.5 rounded-full ${index === activeCardIndex ? "bg-black/60 dark:bg-white/70" : "bg-black/15 dark:bg-white/20"}`}
              />
            ))}
          </div>
        </section>
        {activeOffer ? (
          <CardOfferDetails
            offer={activeOffer}
            onOrder={() => setPurchaseOffer(activeOffer)}
          />
        ) : (
          <>
            <div className="h-5" />
            <WalletActionGrid
              label="Действия с картами"
              items={[
                {
                  label: "Пополнить",
                  icon: PlusCircleFill,
                  onClick: () =>
                    showNotice(
                      "Пополнение карты появится после подключения провайдера",
                    ),
                },
                {
                  label: "Реквизиты",
                  icon: DocOnDoc,
                  onClick: () => setSettingsCardId(activeCard.id),
                },
                {
                  label: "Wallet",
                  icon: WalletFill,
                  onClick: () => setSettingsCardId(activeCard.id),
                },
                {
                  label: "Ещё",
                  icon: Ellipsis,
                  onClick: () => setSettingsCardId(activeCard.id),
                },
              ]}
            />
            <div className="mb-2 mt-8 flex items-end justify-between px-safe-4">
              <h2 className="text-[21px] font-semibold tracking-tight text-black dark:text-white">
                Мои карты
              </h2>
              <span className="text-[13px] text-black/40 dark:text-white/40">
                {bankCards.length} карты
              </span>
            </div>
            <List strong inset dividers className={roundedWalletList}>
              {bankCards.map((card, index) => (
                <ListItem
                  key={card.id}
                  link
                  chevron={false}
                  contentClassName="!h-16"
                  innerClassName="!min-w-0 !h-16 !py-2 after:!opacity-30"
                  onClick={() => {
                    haptic("light");
                    setActiveCardIndex(index);
                    setSettingsCardId(card.id);
                  }}
                  media={<CardAvatar card={card} />}
                  innerChildren={
                    <span className="flex h-full min-w-0 items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[17px] font-semibold leading-6 text-black dark:text-white">
                          {card.name}
                        </span>
                        <span className="mt-0.5 block text-[14px] leading-5 text-black/45 dark:text-white/45">
                          {card.network} · •••• {card.last4}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[16px] font-medium leading-6 tabular-nums text-black dark:text-white">
                          {card.balance}
                        </span>
                        <span className="block text-[12px] leading-5 text-black/40 dark:text-white/40">
                          {card.currency === "₽" ? "RUB" : "USD"} · Демо
                        </span>
                      </span>
                    </span>
                  }
                />
              ))}
              <ListItem
                link
                title="Выпустить карту"
                subtitle="Новая виртуальная карта"
                contentClassName="!h-16"
                innerClassName="!h-16 !py-2 after:!opacity-30"
                titleWrapClassName="pr-6"
                chevronIcon={
                  <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-[19px] text-black/25 dark:text-white/30" />
                }
                media={
                  <span className="wpay-currency-icon flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary dark:bg-primary/20">
                    <PlusCircleFill className="text-[25px]" />
                  </span>
                }
                onClick={() => setPurchaseOffer(cardOffers[0])}
              />
            </List>
            <h2 className="mb-2 mt-7 px-safe-4 text-[21px] font-semibold tracking-tight text-black dark:text-white">
              Оплата телефоном
            </h2>
            <CardWalletOptions showNotice={showNotice} />
            <div className="mb-2 mt-7 flex items-end justify-between px-safe-4">
              <h2 className="text-[21px] font-semibold tracking-tight text-black dark:text-white">
                Платежи по карте
              </h2>
              <span className="text-[13px] text-black/40 dark:text-white/40">
                Демо
              </span>
            </div>
            <CardsPaymentsList card={activeCard} showNotice={showNotice} />
            <p className="mx-auto mt-5 max-w-[360px] px-5 text-center text-[12px] leading-relaxed text-black/35 dark:text-white/35">
              Демонстрационные карты и операции. Выпуск и платежи появятся после
              подключения банковского провайдера.
            </p>
          </>
        )}
      </main>
      <CardPurchaseView
        offer={purchaseOffer}
        onSelect={setPurchaseOffer}
        onClose={() => setPurchaseOffer(null)}
      />
      <CardPushView
        card={selectedCard}
        open={settingsCardId !== null}
        onClose={() => setSettingsCardId(null)}
        showNotice={showNotice}
      />
    </>
  );
}
function CardPushView({
  card,
  open,
  onClose,
  showNotice,
}: {
  card: BankCard;
  open: boolean;
  onClose: () => void;
  showNotice: NoticeHandler;
}) {
  return (
    <NotificationSheet open={open} title="Карта" onClose={onClose}>
      <main className="mx-auto w-full max-w-[560px] pb-6">
        <div className="px-safe-4 pb-7 pt-3">
          <BankCardArtwork card={card} />
        </div>
        <WalletActionGrid
          label="Действия с картой"
          items={[
            {
              label: "Пополнить",
              icon: PlusCircleFill,
              onClick: () => showNotice("Пополнение карты пока не подключено"),
            },
            {
              label: "Реквизиты",
              icon: DocOnDoc,
              onClick: () =>
                showNotice("Реквизиты появятся после выпуска карты"),
            },
            {
              label: "Заморозить",
              icon: Snow,
              onClick: () =>
                showNotice("Заморозка появится после подключения провайдера"),
            },
            {
              label: "Ещё",
              icon: Ellipsis,
              onClick: () =>
                showNotice(
                  "Управление картой появится после подключения провайдера",
                ),
            },
          ]}
        />
        <h2 className="mb-2 mt-8 px-safe-4 text-[21px] font-semibold tracking-tight text-black dark:text-white">
          Управление картой
        </h2>
        <List strong inset dividers className={roundedWalletList}>
          {[
            {
              title: "Лимиты и операции",
              subtitle: "Ограничения и тарифы",
              Icon: SliderHorizontal3,
            },
            {
              title: "Безопасность",
              subtitle: "Настройки платежей",
              Icon: LockShieldFill,
            },
          ].map(({ title, subtitle, Icon }) => (
            <ListItem
              key={title}
              link
              title={title}
              subtitle={subtitle}
              contentClassName="!h-16"
              innerClassName="!h-16 !py-2 after:!opacity-30"
              titleWrapClassName="pr-6"
              chevronIcon={
                <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-[19px] text-black/25 dark:text-white/30" />
              }
              media={
                <span className="wpay-currency-icon flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-b from-blue-300 to-blue-500 text-white dark:from-blue-400 dark:to-blue-600">
                  <Icon className="text-[23px]" />
                </span>
              }
              onClick={() => showNotice(`${title}: пока недоступно`)}
            />
          ))}
        </List>
        <h2 className="mb-2 mt-7 px-safe-4 text-[21px] font-semibold tracking-tight text-black dark:text-white">
          Оплата телефоном
        </h2>
        <CardWalletOptions showNotice={showNotice} />
        <div className="mb-2 mt-7 flex items-end justify-between px-safe-4">
          <h2 className="text-[21px] font-semibold tracking-tight text-black dark:text-white">
            История карты
          </h2>
          <span className="text-[13px] text-black/40 dark:text-white/40">
            Демо
          </span>
        </div>
        <CardsPaymentsList card={card} showNotice={showNotice} />
      </main>
    </NotificationSheet>
  );
}

function ProfileListItem(props: ComponentProps<typeof F7ListItem>) {
  const title = String(props.title ?? "");
  const verification = /Верификац/i.test(title);
  const security = /защит|парол|устройств|доступ|Безопасность/.test(title);
  const notification = /Уведомления|Платежи|Пополнения|курсов|Новости/.test(
    title,
  );
  const personal = /Имя|данные|проверки|Документы/.test(title);
  const Icon = verification
    ? CheckmarkShieldFill
    : /кошельк/i.test(title)
      ? WalletFill
      : /Реферальная/.test(title)
        ? PersonCropCircleFill
        : security
          ? LockShieldFill
          : notification
            ? BellFill
            : personal
              ? PersonCropCircleFill
              : /валюта|RUB|USD|EUR/.test(title)
                ? Globe
                : /провайдер/.test(title)
                  ? BuildingColumnsFill
                  : QuestionCircleFill;
  const color = verification
    ? "#30C759"
    : /Реферальная/.test(title)
      ? "#FF9500"
      : security
        ? "#30C759"
        : notification
          ? "#FF3B30"
          : personal
            ? "#5856D6"
            : /валюта|RUB|USD|EUR/.test(title)
              ? "#8E8E93"
              : /вопрос/.test(title)
                ? "#32ADE6"
                : /поддерж|Чат|проблем/.test(title)
                  ? "#FF9500"
                  : "#AF52DE";
  return (
    <F7ListItem
      {...props}
      mediaItem={Boolean(props.subtitle)}
      external
      link={props.link ? "#" : undefined}
      onClick={(event) => {
        if (props.link) event.preventDefault();
        props.onClick?.(event);
      }}
    >
      <span
        slot="media"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-white"
        style={{
          background: `linear-gradient(155deg, color-mix(in srgb, ${color} 78%, white) 0%, ${color} 55%, color-mix(in srgb, ${color} 92%, black) 100%)`,
          boxShadow: "inset 0 1px 0 rgb(255 255 255 / .35)",
        }}
      >
        <Icon className="text-[27px]" />
      </span>
      {props.children}
    </F7ListItem>
  );
}

function ProfileSection({
  user,
  initials,
  showNotice,
}: {
  user: ReturnType<typeof getUser>;
  initials: string;
  showNotice: NoticeHandler;
}) {
  useEffect(() => {
    preloadVerificationArtwork();
  }, []);
  const [profileName, setProfileName] = useState("");
  const displayName =
    profileName ||
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
    "Ваш профиль";
  const [profilePage, setProfilePage] = useState<
    keyof typeof profilePageTitles | null
  >(null);

  return (
    <>
      <main
        className={`wpay-f7-profile ios mx-auto w-full max-w-[560px] pb-6 transition-[transform,opacity] duration-300 ease-out ${profilePage && !["notifications", "security", "currency", "support"].includes(profilePage) ? "-translate-x-[22%] opacity-60" : "translate-x-0 opacity-100"}`}
      >
        <section className="px-safe-4 pb-6 pt-7 text-center">
          <div className="wpay-currency-icon mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-gradient-to-b from-blue-300 to-blue-600 text-[34px] font-semibold text-white shadow-sm dark:from-blue-400 dark:to-blue-700">
            {user?.photo_url ? (
              <img
                src={user.photo_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              initials
            )}
          </div>
          <h2 className="mb-0 mt-4 text-[28px] font-semibold text-black dark:text-white">
            {displayName}
          </h2>
          <div className="mt-1.5 text-[16px] text-black/45 dark:text-white/45">
            {user?.username ? `@${user.username}` : "Профиль кошелька"}
          </div>
        </section>

        <h2 className="mb-2 px-safe-4 text-[21px] font-semibold tracking-tight text-black dark:text-white">
          Аккаунт
        </h2>
        <F7List strong inset dividers className="profile-settings-list">
          <ProfileListItem
            link
            title="Личные данные"
            subtitle="Имя и контакты"
            onClick={() => setProfilePage("personal")}
          />
          <ProfileListItem
            link
            title="Верификация"
            subtitle="Подтверждение личности"
            onClick={() => setProfilePage("verification")}
          />
          <WalletBiometricRow showNotice={showNotice} />
          <ProfileListItem
            link
            title="Уведомления"
            subtitle="Платежи и курсы"
            onClick={() => setProfilePage("notifications")}
          />
          <ProfileListItem
            link
            title="Реферальная программа"
            subtitle="Приглашайте друзей"
            onClick={() => setProfilePage("referral")}
          />
        </F7List>

        <h2 className="mb-2 mt-7 px-safe-4 text-[21px] font-semibold tracking-tight text-black dark:text-white">
          Настройки и помощь
        </h2>
        <F7List strong inset dividers className="profile-settings-list">
          <ProfileListItem
            link
            title="Основная валюта"
            after="RUB"
            onClick={() => setProfilePage("currency")}
          />
          <ProfileListItem
            link
            title="Банковский провайдер"
            subtitle="Не подключён"
            onClick={() => setProfilePage("provider")}
          />
          <ProfileListItem
            link
            title="Помощь и поддержка"
            onClick={() => setProfilePage("support")}
          />
        </F7List>
        <F7List strong inset dividers className="profile-legal-list">
          <F7ListItem
            link="#"
            external
            title="Пользовательское соглашение"
            onClick={(event) => {
              event.preventDefault();
              setProfilePage("terms");
            }}
          >
            <DocTextFill
              slot="media"
              className="text-[26px] text-[#007aff] dark:text-[#0a84ff]"
            />
          </F7ListItem>
          <F7ListItem
            link="#"
            external
            title="Политика конфиденциальности"
            onClick={(event) => {
              event.preventDefault();
              setProfilePage("privacy");
            }}
          >
            <LockShieldFill
              slot="media"
              className="text-[27px] text-[#007aff] dark:text-[#0a84ff]"
            />
          </F7ListItem>
        </F7List>
        <p className="px-8 text-[13px] leading-5 text-black/45 dark:text-white/45">
          <span className="text-primary">
            Операции с криптовалютой связаны с риском.
          </span>{" "}
          Стоимость активов может меняться. Перед операцией проверяйте курс,
          комиссию и реквизиты получателя.
        </p>
      </main>
      <ProfileSettingsPushView
        page={profilePage}
        onClose={() => setProfilePage(null)}
        showNotice={showNotice}
        onSaveName={setProfileName}
      />
    </>
  );
}

const profilePageTitles = {
  personal: "Личные данные",
  verification: "Верификация",
  security: "Безопасность",
  notifications: "Уведомления",
  currency: "Основная валюта",
  provider: "Банковский провайдер",
  support: "Поддержка",
  referral: "Рефералы",
  terms: "Соглашение",
  privacy: "Конфиденциальность",
} as const;

function ProfileSettingsPushView({
  page,
  onClose,
  showNotice,
  onSaveName,
}: {
  page: keyof typeof profilePageTitles | null;
  onClose: () => void;
  showNotice: NoticeHandler;
  onSaveName: (name: string) => void;
}) {
  const user = getUser();
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const notificationKey = `wpay-notifications:${user?.id ?? "guest"}`;
  const [notifications, setNotifications] = useState<Record<string, boolean>>(
    () => {
      const defaults = {
        payments: true,
        deposits: true,
        rates: false,
        news: false,
      };
      try {
        const saved = JSON.parse(localStorage.getItem(notificationKey) || "{}");
        return Object.fromEntries(
          Object.entries(defaults).map(([key, value]) => [
            key,
            typeof saved[key] === "boolean" ? saved[key] : value,
          ]),
        );
      } catch {
        return defaults;
      }
    },
  );
  const [nameSaved, setNameSaved] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [displayPage, setDisplayPage] =
    useState<keyof typeof profilePageTitles>("personal");
  const [verificationContacts, setVerificationContacts] = useState(false);
  const aura = useAuraProfile(page ? displayPage : null);
  const { phone, email, setPhone, setEmail } = aura;
  useEffect(() => {
    setVerificationContacts(false);
    if (page) setDisplayPage(page);
    else setChatOpen(false);
  }, [page]);

  const notificationContent = (
    <>
      <F7List
        strong
        inset
        dividers
        className="profile-settings-list profile-notifications"
      >
        {[
          ["payments", "Платежи и переводы"],
          ["deposits", "Пополнения"],
          ["rates", "Изменения курсов"],
          ["news", "Новости сервиса"],
        ].map(([key, title]) => (
          <F7ListItem key={key} title={title}>
            <span slot="after">
              <F7Toggle
                init={false}
                name={key}
                aria-label={title}
                defaultChecked={notifications[key]}
                onChange={(event) => {
                  const next = {
                    ...notifications,
                    [key]: event.target.checked,
                  };
                  setNotifications(next);
                  try {
                    localStorage.setItem(notificationKey, JSON.stringify(next));
                  } catch {
                    /* Keep current session state. */
                  }
                }}
              />
            </span>
          </F7ListItem>
        ))}
      </F7List>
      <p className="px-6 text-[13px] leading-5 text-black/45 dark:text-white/45">
        Настройки сохраняются на этом устройстве. Доставка уведомлений пока не
        подключена.
      </p>
    </>
  );

  const securityContent = (
    <F7List strong inset dividers className="profile-settings-list">
      <ProfileListItem
        link
        title="Код доступа"
        subtitle="Для входа и подтверждения операций"
        after="Выкл."
        onClick={() => showNotice("Код доступа: скоро будет доступен")}
      />
      <ProfileListItem
        link
        title="Двухфакторная защита"
        subtitle="Дополнительный код подтверждения"
        after="Выкл."
        onClick={() => showNotice("2FA: скоро будет доступна")}
      />
      <ProfileListItem
        link
        title="Активные устройства"
        after="1"
        onClick={() => showNotice("Это устройство активно")}
      />
      <ProfileListItem
        link
        title="Сменить пароль"
        onClick={() => showNotice("Смена пароля: скоро будет доступна")}
      />
    </F7List>
  );
  const currencyContent = (
    <F7List strong inset dividers className="profile-settings-list">
      {["RUB — Российский рубль", "USD — Доллар США", "EUR — Евро"].map(
        (currency, index) => (
          <ProfileListItem
            key={currency}
            link
            title={currency}
            after={index === 0 ? "✓" : undefined}
            onClick={() =>
              showNotice(`Выбрана валюта: ${currency.slice(0, 3)}`)
            }
          />
        ),
      )}
    </F7List>
  );
  const supportContent = (
    <F7List strong inset dividers className="profile-settings-list">
      <ProfileListItem
        link
        title="Чат с поддержкой"
        subtitle="Сообщения и обращения"
        onClick={() => setChatOpen(true)}
      />
      <ProfileListItem
        link
        title="Частые вопросы"
        onClick={() => showNotice("Раздел помощи: скоро будет доступен")}
      />
      <ProfileListItem
        link
        title="Сообщить о проблеме"
        onClick={() => showNotice("Форма обращения: скоро будет доступна")}
      />
    </F7List>
  );
  const popupPages = ["notifications", "security", "currency", "support"];
  return (
    <>
      <PushViewShell
        open={page !== null && !popupPages.includes(page)}
        title={profilePageTitles[displayPage]}
        subtitle="Настройки профиля"
        scrollContent={displayPage !== "verification"}
        hideNavbar={displayPage === "verification"}
        nativeBack={displayPage === "verification"}
        onClose={() => {
          if (displayPage === "verification" && verificationContacts)
            setVerificationContacts(false);
          else onClose();
        }}
        onRefreshed={() => showNotice("Данные профиля обновлены")}
      >
        <main
          className={`wpay-f7-profile ios mx-auto w-full max-w-[560px] ${displayPage === "verification" ? "flex min-h-0 flex-1" : "pb-5 pt-3"}`}
        >
          {displayPage === "personal" && (
            <>
              <div className="pb-5 pt-4 text-center">
                <span className="mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-gradient-to-b from-blue-300 to-blue-600 text-[34px] font-semibold text-white dark:from-blue-400 dark:to-blue-700">
                  {user?.photo_url ? (
                    <img
                      src={user.photo_url}
                      alt="Аватар профиля"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    (
                      firstName.trim()[0] ||
                      user?.first_name?.[0] ||
                      "W"
                    ).toUpperCase()
                  )}
                </span>
                <p className="mt-3 text-[14px] text-black/45 dark:text-white/45">
                  Фото профиля Telegram
                </p>
              </div>
              <h2 className="mb-3 mt-3 px-5 text-[21px] font-semibold text-black dark:text-white">
                Ваши данные
              </h2>
              <F7List strong inset dividers className="profile-input-list">
                <F7ListInput
                  label="Имя"
                  inputId="profile-first-name"
                  type="text"
                  name="given-name"
                  autocomplete="given-name"
                  placeholder="Введите имя"
                  value={firstName}
                  maxlength={64}
                  onInput={(event) => {
                    setFirstName(event.target.value);
                    setNameSaved(false);
                  }}
                />
                <F7ListInput
                  label="Фамилия"
                  inputId="profile-last-name"
                  type="text"
                  name="family-name"
                  autocomplete="family-name"
                  placeholder="Введите фамилию"
                  value={lastName}
                  maxlength={64}
                  onInput={(event) => {
                    setLastName(event.target.value);
                    setNameSaved(false);
                  }}
                />
              </F7List>
              <F7List strong inset dividers className="profile-input-list">
                <F7ListInput
                  label="Номер телефона"
                  inputId="profile-phone"
                  disabled={aura.loading || aura.busy}
                  type="tel"
                  name="tel"
                  autocomplete="tel"
                  placeholder="+7 999 123-45-67"
                  value={phone}
                  maxlength={32}
                  onInput={(event) => {
                    setPhone(event.target.value);
                    setNameSaved(false);
                  }}
                />
                <F7ListInput
                  label="Электронная почта"
                  inputId="profile-email"
                  disabled={aura.loading || aura.busy}
                  type="email"
                  name="email"
                  autocomplete="email"
                  placeholder="name@example.com"
                  value={email}
                  maxlength={254}
                  onInput={(event) => {
                    setEmail(event.target.value);
                    setNameSaved(false);
                  }}
                />
                <F7ListInput
                  label="Telegram"
                  inputId="profile-telegram"
                  type="text"
                  readonly
                  value={
                    user?.username
                      ? `@${user.username}`
                      : "Имя пользователя не указано"
                  }
                />
              </F7List>
              <div className="px-4">
                <Button
                  data-wpay-primary=""
                  rounded
                  large
                  disabled={
                    !firstName.trim() ||
                    aura.loading ||
                    aura.busy ||
                    !aura.available
                  }
                  className="!m-0 !w-full !rounded-[22px]"
                  onClick={async () => {
                    if (!(await aura.save())) return;
                    onSaveName(
                      [firstName.trim(), lastName.trim()]
                        .filter(Boolean)
                        .join(" "),
                    );
                    setNameSaved(true);
                  }}
                >
                  {aura.busy ? "Сохраняем…" : "Сохранить"}
                </Button>
                {aura.error && (
                  <p
                    role="alert"
                    className="mt-3 text-center text-[13px] text-red-600 dark:text-red-400"
                  >
                    {aura.error}
                  </p>
                )}
                <p
                  role="status"
                  className="mt-3 px-2 text-center text-[13px] leading-5 text-black/45 dark:text-white/45"
                >
                  {nameSaved
                    ? "Телефон и почта сохранены."
                    : aura.loading
                      ? "Загружаем профиль…"
                      : "Телефон и почта сохраняются в сервисе. Имя меняется только в этой сессии WPay; профиль Telegram не изменится."}
                </p>
              </div>
            </>
          )}

          {displayPage === "verification" && (
            <WalletVerification
              aura={aura}
              contacts={verificationContacts}
              onContacts={() => setVerificationContacts(true)}
              onPersonal={() => setDisplayPage("personal")}
            />
          )}

          {displayPage === "provider" && (
            <>
              <Card
                className="!mx-4 !rounded-[32px] text-center"
                contentWrapPadding="p-6"
              >
                <BuildingColumnsFill className="mx-auto text-[42px] text-primary" />
                <h2 className="mb-0 mt-3 text-[19px] font-semibold">
                  Провайдер не подключён
                </h2>
                <p className="mb-0 mt-2 text-[15px] leading-6 text-black/45 dark:text-white/45">
                  После подключения станут доступны выпуск карт, пополнение,
                  вывод и реальные платежи.
                </p>
              </Card>
              <div className="px-safe-4">
                <Button
                  data-wpay-primary=""
                  rounded
                  large
                  className="!m-0 !w-full"
                  onClick={() =>
                    showNotice("Заявка на подключение подготовлена")
                  }
                >
                  <span className="normal-case">Подключить провайдера</span>
                </Button>
              </div>
            </>
          )}

          {displayPage === "referral" && <ReferralProgram />}
          {(displayPage === "terms" || displayPage === "privacy") && (
            <Card className="!mx-4 !rounded-[28px]" contentWrapPadding="p-6">
              <DocOnDoc className="text-[32px] text-primary" />
              <h2 className="mt-4 text-[22px] font-semibold text-black dark:text-white">
                {displayPage === "terms"
                  ? "Пользовательское соглашение"
                  : "Политика конфиденциальности"}
              </h2>
              <p className="mt-3 text-[16px] leading-6 text-black/50 dark:text-white/50">
                Документ пока не опубликован. Здесь появится актуальная редакция
                перед запуском сервиса.
              </p>
            </Card>
          )}
        </main>
      </PushViewShell>
      <NotificationSheet
        open={page !== null && popupPages.includes(page)}
        title={profilePageTitles[displayPage]}
        onClose={onClose}
      >
        <main className="wpay-f7-profile ios mx-auto w-full max-w-[560px] pb-5 pt-3">
          {displayPage === "notifications"
            ? notificationContent
            : displayPage === "security"
              ? securityContent
              : displayPage === "currency"
                ? currencyContent
                : displayPage === "support"
                  ? supportContent
                  : null}
        </main>
      </NotificationSheet>
      <SupportChatPushView
        open={chatOpen && page !== null}
        onClose={() => setChatOpen(false)}
      />
    </>
  );
}

function SupportChatPushView({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<
    { id: number; text: string; time: string }[]
  >([]);
  const mainRef = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open)
      endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, open]);
  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const panel = mainRef.current?.closest("section");
    if (!viewport || !panel) return;
    const resize = () => {
      panel.style.height = `${viewport.height}px`;
      panel.style.top = `${viewport.offsetTop}px`;
      panel.style.bottom = "auto";
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
      panel.style.height = "";
      panel.style.top = "";
      panel.style.bottom = "";
    };
  }, [open]);
  function saveDraft() {
    const text = draft.trim();
    if (!text) return;
    setMessages((previous) => [
      ...previous,
      {
        id: Date.now(),
        text,
        time: new Date().toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    ]);
    setDraft("");
    const input = mainRef.current?.querySelector("textarea");
    if (input) input.style.height = "46px";
  }
  return (
    <PushViewShell
      open={open}
      title="Поддержка"
      subtitle="WPay"
      scrollContent={false}
      zClass="z-[12000]"
      onClose={onClose}
    >
      <main
        ref={mainRef}
        className="wpay-support-chat mx-auto flex min-h-0 w-full max-w-[560px] flex-1 flex-col"
      >
        <div
          className="support-thread min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
          role="log"
          aria-label="Переписка с поддержкой"
          aria-live="polite"
        >
          <div className="support-contact mt-4 flex items-center gap-3 rounded-[24px] bg-white p-4 dark:bg-[#1c1c1e]">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[17px] bg-gradient-to-br from-blue-300 via-blue-500 to-indigo-600 text-white">
              <QuestionCircleFill className="text-[30px]" />
            </span>
            <div>
              <h2 className="text-[17px] font-semibold text-black dark:text-white">
                Команда WPay
              </h2>
              <p className="mt-0.5 text-[13px] leading-5 text-black/45 dark:text-white/45">
                Поможем разобраться с кошельком
              </p>
            </div>
          </div>
          {!messages.length && (
            <div className="support-welcome px-3 pb-5 pt-10">
              <h3 className="text-[26px] font-semibold tracking-tight text-black dark:text-white">
                Чем можем помочь?
              </h3>
              <p className="mt-2 max-w-[290px] text-[15px] leading-6 text-black/45 dark:text-white/45">
                Выберите тему или опишите вопрос своими словами.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {["Пополнение", "Оплата по QR", "Карты", "Другой вопрос"].map(
                  (topic) => (
                    <button
                      key={topic}
                      type="button"
                      className="rounded-full bg-white px-4 py-2.5 text-[14px] font-medium text-primary dark:bg-[#1c1c1e]"
                      onClick={() => {
                        setDraft(`Вопрос: ${topic.toLowerCase()}. `);
                        mainRef.current?.querySelector("textarea")?.focus();
                      }}
                    >
                      {topic}
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
          <Messages init={false} aria-label="Сообщения поддержки">
            {messages.length > 0 && (
              <div className="messages-title">
                <span>Сегодня</span>
              </div>
            )}
            {messages.map((message) => (
              <Message
                key={message.id}
                type="sent"
                text={message.text}
                first
                last
                tail
                footer={`${message.time} · Не отправлено`}
              />
            ))}
            <div ref={endRef} />
          </Messages>
        </div>
        <div className="support-compose shrink-0 px-4 pt-3">
          <p
            className="mb-3 text-center text-[12px] leading-4 text-black/45 dark:text-white/45"
            role="status"
          >
            Операторы пока не подключены · режим черновика
          </p>
          <Messagebar
            init={false}
            resizable={false}
            value={draft}
            placeholder="Сообщение…"
            onInput={(event) => {
              setDraft(event.target.value);
              event.target.style.height = "0px";
              event.target.style.height = `${Math.max(46, Math.min(120, event.target.scrollHeight + 2))}px`;
            }}
          >
            <button
              slot="inner-end"
              type="button"
              aria-label="Сохранить черновик обращения"
              disabled={!draft.trim()}
              onClick={saveDraft}
              className="support-send flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-30"
            >
              <svg
                width="23"
                height="23"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M12 19V5m-6 6 6-6 6 6"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </Messagebar>
        </div>
      </main>
    </PushViewShell>
  );
}

function WalletSkeleton() {
  return (
    <List
      strong
      inset
      dividers
      className="!mt-0 overflow-hidden !rounded-[32px] [&>ul]:!rounded-[32px]"
      aria-label="Загрузка криптовалют"
      aria-busy="true"
    >
      {assets.map((asset) => (
        <CurrencySkeletonRow key={asset.code} />
      ))}
    </List>
  );
}
