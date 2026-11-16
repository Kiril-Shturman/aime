import { useCallback, useEffect, useRef, useState } from "react";
import { walletRequest, WalletApiError } from "../lib/wallet-api";
import { tg } from "../lib/telegram";
export type KycState = {
  status: string;
  verified: boolean;
  terminal: boolean;
  reason?: string | null;
};
export type KycIdentityInput = {
  first_name: string;
  last_name: string;
  patronymic?: string;
  birth_date: string;
  passport: string;
  passport_issue_date: string;
  inn?: string;
  country_of_passport_issue: "RUS";
};
const messages: Record<string, string> = {
  NOT_CONFIGURED: "Подключение профиля пока недоступно. Попробуйте позже.",
  sbp_buy_not_enabled: "Проверка личности пока недоступна для этого сервиса.",
  kyc_email_required: "Сначала сохраните электронную почту в личных данных.",
  kyc_pending: "Документы уже на проверке.",
  kyc_rejected: "Проверка не пройдена. Обратитесь в поддержку.",
  kyc_passport_already_used:
    "Этот паспорт уже использован для другой проверки. Обратитесь в поддержку.",
  kyc_identity_locked: "Данные проверки заблокированы. Обратитесь в поддержку.",
  kyc_session_unavailable:
    "Сервис проверки временно недоступен. Попробуйте позже.",
  INVALID_REQUEST: "Проверьте заполненные данные.",
  CUSTOMER_NOT_REGISTERED: "Сначала сохраните телефон и электронную почту.",
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
  const [registered, setRegistered] = useState(false);
  const [error, setError] = useState("");
  const [kyc, setKyc] = useState<KycState | null>(null);
  const working = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const state = await walletRequest<KycState>("aura-kyc", undefined, signal);
    setKyc(state);
    return state;
  }, []);
  useEffect(() => {
    if (page !== "personal" && page !== "verification") {
      return;
    }
    const controller = new AbortController();
    const current = ++generation.current;
    setLoading(true);
    setError("");
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
          setRegistered(true);
          if (page === "verification") await refresh(controller.signal);
        } catch (e) {
          if (
            e instanceof WalletApiError &&
            e.code === "CUSTOMER_NOT_REGISTERED"
          ) {
            setPhone("");
            setEmail("");
            setRegistered(false);
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
      setRegistered(true);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const submitIdentity = async (identity: KycIdentityInput) => {
    if (working.current || !available) return false;
    if (!email || !phone) {
      setError(
        "Сначала заполните и сохраните телефон и почту в личных данных.",
      );
      return false;
    }
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await walletRequest<KycState>("aura-kyc", identity);
      setKyc({
        status: result.status,
        verified: result.verified,
        terminal: result.terminal,
        reason: result.reason,
      });
      return true;
    } catch (e) {
      setError(message(e));
      return false;
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
    registered,
    error,
    kyc,
    save,
    submitIdentity,
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
