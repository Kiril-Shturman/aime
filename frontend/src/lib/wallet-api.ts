import { boardKey, initData } from "./telegram";

export class WalletApiError extends Error {
  code: string;
  retryAfter: string | null;
  httpStatus: number;
  constructor(code: string, message: string, retryAfter: string | null = null, httpStatus = 0) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
    this.httpStatus = httpStatus;
  }
}
const cooldowns = new Map<string, number>();
async function requestOnce<T>(
  action: string,
  body?: unknown,
  signal?: AbortSignal,
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
      ...(initData() ? { "X-Telegram-Init-Data": initData() } : {}),
      ...(boardKey() ? { "X-Board-Key": boardKey() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const retryAfter = response.headers.get("Retry-After");
  if (!response.ok && retryAfter) {
    const seconds = Number(retryAfter);
    const until = Number.isFinite(seconds)
      ? Date.now() + seconds * 1000
      : Date.parse(retryAfter);
    if (Number.isFinite(until)) cooldowns.set(cooldownKey, until);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new WalletApiError(
      data?.error?.name ?? "UNAVAILABLE",
      data?.detail ?? "Не удалось связаться с кошельком",
      response.headers.get("Retry-After"),
      response.status,
    );
  if (data === null)
    throw new WalletApiError(
      "INVALID_RESPONSE",
      "Сервис вернул некорректный ответ",
    );
  return data as T;
}
export async function walletRequest<T>(action:string,body?:unknown,signal?:AbortSignal):Promise<T>{
  for(let attempt=0;attempt<3;attempt++){
    try{return await requestOnce<T>(action,body,signal)}
    catch(error){
      if(!(error instanceof WalletApiError)||action!=='address'||attempt===2||!error.retryAfter||(error.httpStatus!==503&&error.code!=='RETRY_LATER'))throw error
      const seconds=Number(error.retryAfter)
      const delay=Number.isFinite(seconds)?seconds*1000:Date.parse(error.retryAfter)-Date.now()
      if(!Number.isFinite(delay)||delay<=0)throw error
      await new Promise<void>((resolve,reject)=>{
        if(signal?.aborted){reject(new DOMException('Cancelled','AbortError'));return}
        const abort=()=>{window.clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new DOMException('Cancelled','AbortError'))}
        const timer=window.setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},delay)
        signal?.addEventListener('abort',abort,{once:true})
      })
    }
  }
  throw new WalletApiError('PROVIDER_UNAVAILABLE','Не удалось получить адрес')
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
