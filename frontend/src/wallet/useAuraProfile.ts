import { useCallback, useEffect, useRef, useState } from "react";
import { walletRequest, WalletApiError } from "../lib/wallet-api";
import { tg } from "../lib/telegram";
export type KycState = {
  status: string;
  verified: boolean;
  terminal: boolean;
  reason?: string | null;
};
const messages: Record<string, string> = {
  NOT_CONFIGURED: "Подключение профиля пока недоступно. Попробуйте позже.",
  sbp_buy_not_enabled: "Проверка личности пока недоступна для этого сервиса.",
  kyc_email_required: "Сначала сохраните электронную почту в личных данных.",
  kyc_pending: "Документы уже на проверке.",
  kyc_identity_locked: "Данные проверки заблокированы. Обратитесь в поддержку.",
  kyc_session_unavailable:
    "Сервис проверки временно недоступен. Попробуйте позже.",
  INVALID_REQUEST: "Проверьте телефон и электронную почту.",
};
function message(error: unknown) {
  return error instanceof WalletApiError
    ? messages[error.code] || "Не удалось обновить профиль. Попробуйте позже."
    : "Нет связи с сервисом. Попробуйте ещё раз.";
}
export function useAuraProfile(page: string | null) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState("");
  const [kyc, setKyc] = useState<KycState | null>(null);
  const [sessionUrl, setSessionUrl] = useState("");
  const [sessionOpen, setSessionOpen] = useState(false);
  const working = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const state = await walletRequest<KycState>("aura-kyc", undefined, signal);
    setKyc(state);
    return state;
  }, []);
  useEffect(() => {
    if (page !== "personal" && page !== "verification") {
      setSessionUrl("");
      setSessionOpen(false);
      return;
    }
    const controller = new AbortController();
    const current = ++generation.current;
    setLoading(true);
    setError("");
    setSessionUrl("");
    setSessionOpen(false);
    void (async () => {
      try {
        const status = await walletRequest<{
          providers?: { aura?: { enabled: boolean; configured: boolean } };
        }>("status", undefined, controller.signal);
        const enabled = Boolean(
          status.providers?.aura?.enabled && status.providers.aura.configured,
        );
        if (controller.signal.aborted) return;
        setAvailable(enabled);
        if (!enabled) {
          setError(messages.NOT_CONFIGURED);
          return;
        }
        try {
          const profile = await walletRequest<{
            email?: string | null;
            phone?: string | null;
          }>("aura-customer", undefined, controller.signal);
          if (controller.signal.aborted) return;
          setEmail(profile.email || "");
          setPhone(profile.phone || "");
          if (page === "verification") await refresh(controller.signal);
        } catch (e) {
          if (
            e instanceof WalletApiError &&
            e.code === "CUSTOMER_NOT_REGISTERED"
          ) {
            setPhone("");
            setEmail("");
            setKyc({ status: "not_started", verified: false, terminal: false });
          } else throw e;
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(message(e));
      } finally {
        if (!controller.signal.aborted && current === generation.current)
          setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [page, refresh]);
  useEffect(() => {
    if (page !== "verification" || !available) return;
    let last = 0;
    const update = () => {
      if (document.hidden || Date.now() - last < 5000 || working.current)
        return;
      last = Date.now();
      void refresh().catch((e) => setError(message(e)));
    };
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    const app = tg();
    app?.onEvent?.("activated", update);
    return () => {
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
      app?.offEvent?.("activated", update);
    };
  }, [page, available, refresh]);
  useEffect(() => {
    if (page !== "verification" || !sessionOpen || !available) return;
    const controller = new AbortController();
    let polling = false;
    const timer = window.setInterval(async () => {
      if (document.hidden || polling || working.current) return;
      polling = true;
      try {
        const state = await refresh(controller.signal);
        if (!controller.signal.aborted && (state.verified || state.terminal)) {
          setSessionOpen(false);
          setSessionUrl("");
        }
      } catch {
        /* Keep the form open during a temporary status outage. */
      } finally {
        polling = false;
      }
    }, 8000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [page, sessionOpen, available, refresh]);
  const save = async () => {
    if (working.current || !available) return false;
    const cleanEmail = email.trim();
    let cleanPhone = phone.replace(/[\s()\-]/g, "");
    if (/^8\d{10}$/.test(cleanPhone)) cleanPhone = "+7" + cleanPhone.slice(1);
    if (!/^\+7\d{10}$/.test(cleanPhone)) {
      setError("Укажите российский номер в формате +7 999 123-45-67.");
      return false;
    }
    if (
      cleanEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
    ) {
      setError("Укажите корректную электронную почту.");
      return false;
    }
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await walletRequest("aura-customer", {
        phone: cleanPhone,
        email: cleanEmail,
      });
      setPhone(cleanPhone);
      setEmail(cleanEmail);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const start = async () => {
    if (working.current || !available) return;
    if (!email || !phone) {
      setError(
        "Сначала заполните и сохраните телефон и почту в личных данных.",
      );
      return;
    }
    working.current = true;
    setBusy(true);
    setError("");
    setSessionUrl("");
    try {
      const result = await walletRequest<
        KycState & { session_url?: string | null }
      >("aura-kyc", {});
      setKyc({
        status: result.status,
        verified: result.verified,
        terminal: result.terminal,
        reason: result.reason,
      });
      if (result.verified) return;
      if (
        !result.session_url ||
        new URL(result.session_url).protocol !== "https:"
      )
        throw Error("No session URL");
      setSessionUrl(result.session_url);
      setSessionOpen(true);
    } catch (e) {
      setError(message(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  return {
    phone,
    email,
    setPhone,
    setEmail,
    loading,
    busy,
    available,
    error,
    kyc,
    sessionUrl,
    sessionOpen,
    closeSession: () => setSessionOpen(false),
    resumeSession: () => setSessionOpen(true),
    save,
    start,
    refresh: async () => {
      try {
        setError("");
        await refresh();
      } catch (e) {
        setError(message(e));
      }
    },
  };
}
