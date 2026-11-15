import { boardKey, initData } from './telegram'

export class WalletApiError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}
export async function walletRequest<T>(action: string, body?: unknown): Promise<T> {
  for (let attempt=0;attempt<3;attempt++) {
    const response = await fetch(`/api/wallet/${action}`, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(initData() ? { 'X-Telegram-Init-Data': initData() } : {}),
        ...(boardKey() ? { 'X-Board-Key': boardKey() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await response.json().catch(() => null)
    const retryAfter=Number(response.headers.get('Retry-After'))
    if(action==='address'&&response.status===503&&attempt<2&&Number.isFinite(retryAfter)&&retryAfter>0){
      await new Promise(resolve=>window.setTimeout(resolve,Math.min(retryAfter,60)*1000))
      continue
    }
    if (!response.ok) throw new WalletApiError(data?.error?.name ?? 'UNAVAILABLE', data?.detail ?? 'Не удалось связаться с кошельком')
    return data as T
  }
  throw new WalletApiError('PROVIDER_UNAVAILABLE','Не удалось получить адрес')
}
export interface WalletTransaction { event_id: string; asset: string; amount: string; type: string; created_at: string; detail: Record<string, unknown> }
export interface WalletOverview {
  balances: { asset: string; available: string; reserved: string }[]
  rates: { source: string; target: string; rate: string; is_valid: boolean }[]
  transactions: WalletTransaction[]
}
export interface QrQuote { quote_id: string; spend_id: string; amount_rub: string; merchant_name: string | null; amount: string; asset: string; rate: string; expires_at: string }
export interface QrPayment { spend_id: string; status: string; payment_id?: string }
export interface Deposit { address?: string | null; network: string; url?: string; mini_app_url?: string; amount?: string; requested?: string; expires_at?: string; claim_id?: number }
