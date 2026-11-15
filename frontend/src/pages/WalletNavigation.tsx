import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Navbar, Link as KLink, Popover, List, ListItem } from "konsta/react";
import ChevronLeft from "framework7-icons/react/esm/ChevronLeft.js";
import ChevronRight from "framework7-icons/react/esm/ChevronRight.js";
import Ellipsis from "framework7-icons/react/esm/Ellipsis.js";
import SunMax from "framework7-icons/react/esm/SunMax.js";
import MoonStars from "framework7-icons/react/esm/MoonStars.js";
import { useTheme } from "../store/ThemeStore";
import { applyTgTheme, tg } from "../lib/telegram";
import { PullToRefreshContent } from "./WalletScroll";
export type WalletMenuItem = {
  title: string;
  icon: ReactNode;
  onClick: () => void;
};

export function WalletNavbar({
  title,
  subtitle,
  left,
  right,
  menuItems,
  active = true,
  assetSurface = false,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  menuItems?: WalletMenuItem[];
  active?: boolean;
  assetSurface?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const target = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) setOpened(false);
  }, [active]);
  const { theme, toggle } = useTheme();
  return (
    <>
      <Navbar
        title={title}
        subtitle={subtitle}
        left={left}
        onClickCapture={(event) => {
          if ((event.target as Element).closest('[aria-label="Назад"]'))
            setOpened(false);
        }}
        colors={
          assetSurface
            ? {
                bgIos:
                  "bg-gradient-to-b from-white to-transparent dark:from-[#1c1c1e]",
              }
            : undefined
        }
        right={
          right ?? (
            <span ref={target} className="inline-flex h-11 w-11">
              <KLink
                iconOnly
                aria-label="Ещё"
                aria-expanded={opened}
                onClick={() => setOpened((value) => !value)}
                className="!h-full !w-full !text-black dark:!text-white"
              >
                <Ellipsis className="text-[25px]" />
              </KLink>
            </span>
          )
        }
      />
      {!right &&
        createPortal(
          <Popover
            opened={opened && active}
            target={target.current}
            onBackdropClick={() => setOpened(false)}
            className="!z-[100] !mt-3 !w-72"
          >
            <List nested className="!my-0">
              {menuItems ? (
                menuItems.map((item) => (
                  <ListItem
                    key={item.title}
                    link
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
                    onClick={() => {
                      setOpened(false);
                      item.onClick();
                    }}
                  />
                ))
              ) : (
                <ListItem
                  link
                  title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
                  media={
                    theme === "dark" ? (
                      <SunMax className="text-[22px] text-primary" />
                    ) : (
                      <MoonStars className="text-[22px] text-primary" />
                    )
                  }
                  onClick={() => {
                    toggle();
                    setOpened(false);
                  }}
                />
              )}
            </List>
          </Popover>,
          document.querySelector(".k-app") ?? document.body,
        )}
    </>
  );
}

export function PushViewShell({
  open,
  title,
  subtitle,
  onClose,
  children,
  zClass = "z-[60]",
  onRefreshed,
  assetSurface = false,
  scrollContent = true,
  hideNavbar = false,
  nativeBack = false,
  interactiveSwipe = false,
  menuItems,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  zClass?: string;
  onRefreshed?: () => void;
  assetSurface?: boolean;
  scrollContent?: boolean;
  hideNavbar?: boolean;
  nativeBack?: boolean;
  interactiveSwipe?: boolean;
  menuItems?: WalletMenuItem[];
}) {
  const { theme } = useTheme();
  useEffect(() => {
    applyTgTheme(theme);
  }, [open, theme]);
  const swipeStart = useRef<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  useEffect(() => {
    if (!open) {
      setSwipeOffset(0);
      setSwiping(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !nativeBack) return;
    const app = tg();
    const back = app?.BackButton;
    if (!back || app?.isVersionAtLeast?.("6.1") === false) return;
    app?.onEvent?.("backButtonClicked", onClose);
    back.show();
    return () => {
      app?.offEvent?.("backButtonClicked", onClose);
      back.hide();
    };
  }, [open, nativeBack, onClose]);

  const navbar = hideNavbar ? null : (
    <WalletNavbar
      title={title}
      assetSurface={assetSurface}
      menuItems={menuItems}
      active={open}
      subtitle={subtitle}
      left={
        <KLink
          onClick={onClose}
          aria-label="Назад"
          className="!-ml-2 !gap-0 !text-primary"
        >
          <ChevronLeft className="text-[29px]" />
          <span className="-ml-1 text-[17px]">Назад</span>
        </KLink>
      }
    />
  );

  return createPortal(
    <section
      aria-hidden={!open}
      data-push-view={interactiveSwipe ? "interactive" : undefined}
      style={
        interactiveSwipe && open
          ? {
              transform: `translateX(${swipeOffset}px)`,
              transitionDuration: swiping ? "0ms" : undefined,
            }
          : undefined
      }
      data-wallet-surface={assetSurface ? "asset" : "grouped"}
      className={`wpay-viewport fixed inset-0 ${zClass} flex flex-col overflow-hidden ${assetSurface ? "bg-white dark:bg-[#1c1c1e]" : "bg-[#efeff4] dark:bg-black"} transition-transform duration-300 ease-out ${open ? "translate-x-0 shadow-[-18px_0_50px_rgba(0,0,0,.18)]" : "pointer-events-none translate-x-full"}`}
      onPointerDown={(event) => {
        if (event.clientX <= 28) {
          swipeStart.current = event.clientX;
          if (interactiveSwipe) {
            setSwiping(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }
      }}
      onPointerMove={(event) => {
        if (interactiveSwipe && swipeStart.current !== null)
          setSwipeOffset(Math.max(0, event.clientX - swipeStart.current));
      }}
      onPointerUp={(event) => {
        if (
          swipeStart.current !== null &&
          event.clientX - swipeStart.current > 72
        )
          onClose();
        setSwiping(false);
        setSwipeOffset(0);
        swipeStart.current = null;
      }}
      onPointerCancel={() => {
        setSwiping(false);
        setSwipeOffset(0);
        swipeStart.current = null;
      }}
    >
      {scrollContent ? (
        <PullToRefreshContent
          assetSurface={assetSurface}
          onRefreshed={onRefreshed ?? (() => {})}
        >
          {navbar}
          {children}
        </PullToRefreshContent>
      ) : (
        <>
          {navbar}
          {children}
        </>
      )}
    </section>,
    document.querySelector(".k-app") ?? document.body,
  );
}
