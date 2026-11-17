import { useEffect, useRef } from "react";
import { tg } from "../lib/telegram";

/** Keep only this form's scroll area in view; do not pan the fixed app shell. */
export function useKeyboardFormScroll(enabled = true) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = ref.current;
    if (!enabled || !form) return;
    const body = form.querySelector<HTMLElement>(
      ".wpay-verification-contact-body",
    );
    if (!body) return;
    const viewport = window.visualViewport;
    const app = tg();
    const originalMaxHeight = form.style.maxHeight;
    let frame = 0;
    let timers: number[] = [];
    const sync = () => {
      frame = 0;
      if (!form.isConnected) return;
      const visualTop = viewport?.offsetTop ?? 0;
      const visualBottom = visualTop + (viewport?.height ?? window.innerHeight);
      const telegramHeight = app?.viewportHeight;
      const bottom = Math.min(
        visualBottom,
        telegramHeight && telegramHeight > 0 ? telegramHeight : Infinity,
      );
      const formTop = form.getBoundingClientRect().top;
      const parentBottom =
        form.parentElement?.getBoundingClientRect().bottom ??
        window.innerHeight;
      form.style.maxHeight =
        parentBottom > bottom + 16
          ? `${Math.max(120, bottom - formTop - 8)}px`
          : originalMaxHeight;
      const input = document.activeElement;
      if (
        !(input instanceof HTMLElement) ||
        !form.contains(input) ||
        !input.matches('input:not([type="checkbox"]), textarea')
      )
        return;
      const field = input.closest<HTMLElement>(".item-content") ?? input;
      let bounds = field.getBoundingClientRect();
      const area = body.getBoundingClientRect();
      const top = Math.max(area.top, visualTop) + 12;
      const end = Math.min(area.bottom, bottom) - 16;
      if (end <= top) return;
      if (bounds.height > end - top) bounds = input.getBoundingClientRect();
      if (bounds.bottom > end) body.scrollTop += bounds.bottom - end;
      else if (bounds.top < top) body.scrollTop -= top - bounds.top;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    const focus = () => {
      timers.forEach(clearTimeout);
      schedule();
      // iOS and Telegram report keyboard geometry at different points in the
      // opening animation. Re-read the active element rather than a stale field.
      timers = [80, 260, 520].map((delay) =>
        window.setTimeout(schedule, delay),
      );
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(schedule);
    observer?.observe(body);
    form.addEventListener("focusin", focus);
    form.addEventListener("focusout", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    app?.onEvent?.("viewportChanged", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      timers.forEach(clearTimeout);
      form.removeEventListener("focusin", focus);
      form.removeEventListener("focusout", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      app?.offEvent?.("viewportChanged", schedule);
      form.style.maxHeight = originalMaxHeight;
    };
  }, [enabled]);
  return ref;
}
