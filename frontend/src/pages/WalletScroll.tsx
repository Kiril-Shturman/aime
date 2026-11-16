import { haptic } from "../lib/telegram";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Preloader } from "konsta/react";
import ArrowDownCircleFill from "framework7-icons/react/esm/ArrowDownCircleFill.js";
const PULL_THRESHOLD = 58;
const PULL_MAX_DISTANCE = 96;

export function usePullToRefresh<T extends HTMLElement>(
  scrollRef: RefObject<T | null>,
  {
    onRefreshStart,
    onRefreshed,
    delay = 800,
    softPull = false,
  }: {
    onRefreshStart?: () => void;
    onRefreshed: () => void;
    delay?: number;
    softPull?: boolean;
  },
) {
  const startY = useRef<number | null>(null);
  const startX = useRef(0);
  const distanceRef = useRef(0);
  const refreshingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const callbacksRef = useRef({ onRefreshStart, onRefreshed });
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);

  callbacksRef.current = { onRefreshStart, onRefreshed };

  const updateDistance = useCallback(
    (clientY: number) => {
      if (
        startY.current === null ||
        refreshingRef.current ||
        (scrollRef.current?.scrollTop ?? 0) > 0
      )
        return false;
      const rawDelta = clientY - startY.current;
      const delta = softPull ? Math.max(0, rawDelta - 10) * 0.85 : rawDelta;
      if (delta <= 0) {
        distanceRef.current = 0;
        setDistance(0);
        return false;
      }

      // Контент заметно следует за пальцем, но после 72 px сопротивление
      // постепенно растёт, чтобы не появлялась бесконечная пустая область.
      const easedDelta =
        delta <= 72 ? delta * 0.72 : 51.84 + (delta - 72) * 0.24;
      const nextDistance = Math.min(PULL_MAX_DISTANCE, easedDelta);
      distanceRef.current = nextDistance;
      setDistance(nextDistance);
      return true;
    },
    [scrollRef, softPull],
  );

  const finish = useCallback(() => {
    startY.current = null;
    setDragging(false);
    if (distanceRef.current < PULL_THRESHOLD || refreshingRef.current) {
      distanceRef.current = 0;
      setDistance(0);
      return;
    }

    refreshingRef.current = true;
    setRefreshing(true);
    setDistance(PULL_THRESHOLD);
    callbacksRef.current.onRefreshStart?.();
    haptic("medium");

    timerRef.current = window.setTimeout(() => {
      refreshingRef.current = false;
      setRefreshing(false);
      distanceRef.current = 0;
      setDistance(0);
      haptic("success");
      callbacksRef.current.onRefreshed();
    }, delay);
  }, [delay]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const handleTouchStart = (event: TouchEvent) => {
      if ((event.target as Element | null)?.closest?.("[data-wpay-gesture-lock]")) return;
      if (
        event.touches.length !== 1 ||
        refreshingRef.current ||
        node.scrollTop > 0
      )
        return;
      startX.current = event.touches[0].clientX;
      startY.current = event.touches[0].clientY;
      setDragging(true);
    };
    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      if (softPull && startY.current !== null) {
        const dx = Math.abs(event.touches[0].clientX - startX.current);
        const dy = Math.abs(event.touches[0].clientY - startY.current);
        if (dx > 10 && dx > dy) {
          startY.current = null;
          return;
        }
      }
      if (updateDistance(event.touches[0].clientY)) event.preventDefault();
    };
    const handleTouchEnd = () => finish();

    node.addEventListener("touchstart", handleTouchStart, { passive: true });
    node.addEventListener("touchmove", handleTouchMove, { passive: false });
    node.addEventListener("touchend", handleTouchEnd, { passive: true });
    node.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    return () => {
      node.removeEventListener("touchstart", handleTouchStart);
      node.removeEventListener("touchmove", handleTouchMove);
      node.removeEventListener("touchend", handleTouchEnd);
      node.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [finish, scrollRef, updateDistance, softPull]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const pointerDown = (event: ReactPointerEvent<T>) => {
    if (
      event.pointerType !== "mouse" ||
      refreshingRef.current ||
      (scrollRef.current?.scrollTop ?? 0) > 0
    )
      return;
    startY.current = event.clientY;
    setDragging(true);
  };
  const pointerMove = (event: ReactPointerEvent<T>) => {
    if (event.pointerType === "mouse") updateDistance(event.clientY);
  };

  return { distance, refreshing, dragging, pointerDown, pointerMove, finish };
}

export function PullRefreshIndicator({
  distance,
  refreshing,
  dragging,
}: {
  distance: number;
  refreshing: boolean;
  dragging: boolean;
}) {
  const ready = distance >= PULL_THRESHOLD;
  return (
    <div
      aria-live="polite"
      className={`relative z-20 flex shrink-0 items-center justify-center overflow-hidden text-[13px] font-medium text-black/60 dark:text-white/60 ${dragging ? "" : "transition-[height] duration-300 ease-out"}`}
      style={{ height: refreshing ? PULL_THRESHOLD : distance }}
    >
      <span className="flex items-center gap-2 whitespace-nowrap rounded-full bg-black/[.055] px-3 py-1.5 backdrop-blur-md dark:bg-white/[.10]">
        {refreshing ? (
          <>
            <Preloader className="h-5 w-5" />
            <span>Обновляем…</span>
          </>
        ) : (
          <>
            <ArrowDownCircleFill
              className={`text-[18px] text-primary transition-transform ${ready ? "rotate-180" : ""}`}
            />
            <span>
              {ready
                ? "Отпустите, чтобы обновить"
                : "Потяните вниз для обновления"}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

export function PullToRefreshContent({
  children,
  onRefreshed,
  assetSurface = false,
}: {
  children: ReactNode;
  onRefreshed: () => void;
  assetSurface?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pull = usePullToRefresh(scrollRef, { onRefreshed });
  const indicatorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!assetSurface || !indicatorRef.current) return;
    const indicator = indicatorRef.current;
    const updateSurface = () =>
      scrollRef.current?.style.setProperty(
        "--wpay-pull-distance",
        `${indicator.getBoundingClientRect().height}px`,
      );
    // Follow the rendered height, including the refresh indicator's closing transition.
    const observer = new ResizeObserver(updateSurface);
    observer.observe(indicator);
    updateSurface();
    return () => observer.disconnect();
  }, [assetSurface]);

  return (
    <div
      ref={scrollRef}
      className={`flex-1 min-h-0 overscroll-y-none overflow-y-auto ${assetSurface ? "wpay-asset-scroll pb-0" : "pb-[calc(32px+env(safe-area-inset-bottom))]"} [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
      onPointerDown={pull.pointerDown}
      onPointerMove={pull.pointerMove}
      onPointerUp={pull.finish}
      onPointerCancel={pull.finish}
    >
      <div ref={indicatorRef}>
        <PullRefreshIndicator
          distance={pull.distance}
          refreshing={pull.refreshing}
          dragging={pull.dragging}
        />
      </div>
      {children}
    </div>
  );
}
