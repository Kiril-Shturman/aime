import { boardKey, initData } from "./telegram";

import { WalletApiError, auraBackoff } from "./aura-errors";
export { WalletApiError } from "./aura-errors";

const cooldowns = new Map<string, number>();
const failures = new Map<string, number>();
async function requestOnce<T>(
  action: string,
  body?: unknown,
  signal?: AbortSignal,
  idempotencyKey?: string,
  allowNull = false,
): Promise<T> {
  const network =
    typeof body === "object" && body !== null && "network" in body
      ? String(body.network)
      : "";
  const cooldownKey = action + ":" + network;
  const until = cooldowns.get(cooldownKey) ?? 0;
  if (Date.now() < until)
    throw new WalletApiError(
      "RETRY_LATER",
      `Повторите через ${Math.ceil((until - Date.now()) / 1000)} с`,
      String(Math.ceil((until - Date.now()) / 1000)),
    );
  const response = await fetch(`/api/wallet/${action}`, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    signal,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      ...(initData() ? { "X-Telegram-Init-Data": initData() } : {}),
      ...(boardKey() ? { "X-Board-Key": boardKey() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const retryAfter = response.headers.get("Retry-After");
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = data?.error || {};
    const code = envelope.name ?? envelope.code ?? "UNAVAILABLE";
    const attempt = (failures.get(cooldownKey) || 0) + 1;
    if (code === "unavailable" || code === "internal")
      failures.set(cooldownKey, attempt);
    const error = new WalletApiError(
      code,
      data?.detail ?? envelope.message ?? "Не удалось связаться с кошельком",
      auraBackoff(code, retryAfter, attempt),
      response.status,
      {
        details: envelope.details ?? data?.details,
        param: envelope.param ?? data?.param,
        request_id:
          envelope.request_id ??
          data?.request_id ??
          response.headers.get("X-Request-ID"),
        type: envelope.type,
      },
    );
    if (error.retryAfter) {
      const seconds = Number(error.retryAfter);
      const until = Number.isFinite(seconds)
        ? Date.now() + seconds * 1000
        : Date.parse(error.retryAfter);
      if (Number.isFinite(until)) cooldowns.set(cooldownKey, until);
    }
    throw error;
  }
  if (data === null && !allowNull)
    throw new WalletApiError(
      "INVALID_RESPONSE",
      "Сервис вернул некорректный ответ",
    );
  failures.delete(cooldownKey);
  cooldowns.delete(cooldownKey);
  return data as T;
}
export function walletNullableRequest<T>(
  action: string,
  signal?: AbortSignal,
): Promise<T | null> {
  return requestOnce<T | null>(action, undefined, signal, undefined, true);
}
export function walletIdempotentRequest<T>(
  action: string,
  body: unknown,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<T> {
  if (!idempotencyKey)
    throw new WalletApiError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Не удалось создать безопасный номер операции",
    );
  return requestOnce<T>(action, body, signal, idempotencyKey);
}
export async function walletRequest<T>(
  action: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await requestOnce<T>(action, body, signal);
    } catch (error) {
      if (
        !(error instanceof WalletApiError) ||
        action !== "address" ||
        attempt === 2 ||
        !error.retryAfter ||
        (error.httpStatus !== 503 && error.code !== "RETRY_LATER")
      )
        throw error;
      const seconds = Number(error.retryAfter);
      const delay = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(error.retryAfter) - Date.now();
      if (!Number.isFinite(delay) || delay <= 0) throw error;
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Cancelled", "AbortError"));
          return;
        }
        const abort = () => {
          window.clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          reject(new DOMException("Cancelled", "AbortError"));
        };
        const timer = window.setTimeout(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        }, delay);
        signal?.addEventListener("abort", abort, { once: true });
      });
    }
  }
  throw new WalletApiError("PROVIDER_UNAVAILABLE", "Не удалось получить адрес");
}

export interface WalletTransaction {
  event_id: string;
  asset: string;
  amount: string;
  type: string;
  created_at: string;
  detail: Record<string, unknown>;
}
export interface WalletOverview {
  debts?: { asset: string; amount: string }[];
  balances: { asset: string; available: string; reserved: string }[];
  rates: { source: string; target: string; rate: string; is_valid: boolean }[];
  transactions: WalletTransaction[];
}
export interface WalletCapabilities {
  cards: boolean;
  sbp_buy: boolean;
  crypto_processing: boolean;
  qr_pay: boolean;
}
export interface WalletStatus {
  providers?: { goswap?: { configured?: boolean } };
  configured: boolean;
  capabilities: WalletCapabilities;
  routes: { qr_pay: "aura" | "goswap" | null };
  asset_routes: Record<string, string[]>;
  deposit_providers?: Record<string, Record<string, "wpay" | "aura" | "goswap">>;
  deposit_modes?: Record<
    string,
    Record<string, "address" | "exact" | "disabled">
  >;
}
export interface QrQuote {
  quote_id: string;
  spend_id: string;
  amount_rub: string;
  merchant_name: string | null;
  amount: string;
  asset: string;
  rate: string;
  expires_at: string;
}
export interface QrPayment {
  spend_id: string;
  status: string;
  payment_id?: string;
}
export interface Deposit {
  provider?: string;
  chain?: string;
  min_deposit?: string;
  address?: string | null;
  network: string;
  url?: string;
  mini_app_url?: string;
  amount?: string;
  requested?: string;
  expires_at?: string;
  claim_id?: number;
}
