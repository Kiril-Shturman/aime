import { boardKey, initData } from "./telegram";

export class WalletApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export async function walletRequest<T>(
  action: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/wallet/${action}`, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    signal,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(initData() ? { "X-Telegram-Init-Data": initData() } : {}),
      ...(boardKey() ? { "X-Board-Key": boardKey() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new WalletApiError(
      data?.error?.name ?? "UNAVAILABLE",
      data?.detail ?? "Не удалось связаться с кошельком",
    );
  if (data === null)
    throw new WalletApiError(
      "INVALID_RESPONSE",
      "Сервис вернул некорректный ответ",
    );
  return data as T;
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
  balances: { asset: string; available: string; reserved: string }[];
  rates: { source: string; target: string; rate: string; is_valid: boolean }[];
  transactions: WalletTransaction[];
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
  address?: string | null;
  network: string;
  url?: string;
  mini_app_url?: string;
  amount?: string;
  requested?: string;
  expires_at?: string;
  claim_id?: number;
}
