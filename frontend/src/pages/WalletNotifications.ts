import { useEffect } from "react";
import { f7ready } from "framework7-react";
import type { Notification } from "framework7/components/notification";
import "framework7/components/notification/css";
import { walletRequest } from "../lib/wallet-api";

type Notice = { title: string; message: string };
type Feed = { after: string; items: Notice[] };

function safeText(value: string) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

export function useWalletNotifications(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const queue: Notice[] = [];
    let cursor: string | undefined;
    let timer: number | undefined;
    let active: Notification.Notification | undefined;
    let polling = false;

    f7ready(app => {
      if (controller.signal.aborted) return;
      function showNext() {
        if (controller.signal.aborted || active || document.hidden) return;
        const next = queue.shift();
        if (!next) return;
        active = app.notification.create({
          title: "wPay",
          subtitle: safeText(next.title),
          text: safeText(next.message),
          icon: '<img src="/favicon.svg" alt="" width="20" height="20">',
          cssClass: "wpay-live-notification",
          closeButton: true,
          closeTimeout: 5800,
          on: {
            closed(notification) {
              window.setTimeout(() => {
                if (active !== notification) return;
                active = undefined;
                app.notification.destroy(notification);
                showNext();
              }, 0);
            },
          },
        });
        active.open();
      }

      async function poll() {
        if (controller.signal.aborted || document.hidden || polling || queue.length >= 20) return;
        polling = true;
        try {
          const query = cursor === undefined ? "" : `?after=${encodeURIComponent(cursor)}`;
          const feed = await walletRequest<Feed>(`miniapp-notifications${query}`, undefined, controller.signal);
          if (controller.signal.aborted) return;
          cursor = feed.after;
          queue.push(...feed.items);
          showNext();
        } catch {
          // Preserve the cursor and retry on the next foreground poll.
        } finally {
          polling = false;
        }
      }

      const onVisibility = () => {
        if (document.hidden) return;
        showNext();
        void poll();
      };
      document.addEventListener("visibilitychange", onVisibility, { signal: controller.signal });
      controller.signal.addEventListener("abort", () => {
        if (active) {
          const notification = active;
          active = undefined;
          notification.close(false);
          app.notification.destroy(notification);
        }
      }, { once: true });
      timer = window.setInterval(() => void poll(), 5000);
      void poll();
    });

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [enabled]);
}
