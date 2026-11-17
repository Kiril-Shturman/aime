import catalog from "../../../aura_error_catalog.json" with { type: "json" };

export type AuraRecovery =
  "fix" | "support" | "wait" | "delay" | "later" | "same_request";
export type AuraErrorMetadata = {
  details?: Record<string, unknown>;
  param?: string;
  request_id?: string;
  type?: string;
};
const definitions: Record<
  string,
  { message: string; recovery: string; retrySeconds?: number }
> = catalog;
const fields: Record<string, string> = {
  passport: "Паспорт",
  email: "Электронная почта",
  phone: "Телефон",
  amount: "Сумма",
  address: "Адрес",
  memo: "Комментарий",
  birth_date: "Дата рождения",
  first_name: "Имя",
  last_name: "Фамилия",
  patronymic: "Отчество",
  passport_issue_date: "Дата выдачи паспорта",
  "shipping_address.city": "Город доставки",
  "shipping_address.country": "Страна доставки",
  "shipping_address.line1": "Адрес доставки",
  "shipping_address.postal_code": "Почтовый индекс",
};
function short(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .slice(0, 240)
    : "";
}
export function auraRecovery(
  code: string,
  details: Record<string, unknown> = {},
): AuraRecovery | undefined {
  if (code === "kyc_session_unavailable") {
    if (details.status === "pending" || details.status === "in_review")
      return "wait";
    if (
      details.reason === "access_locked_contact_manager" &&
      details.terminal !== true
    )
      return "fix";
  }
  return definitions[code]?.recovery as AuraRecovery | undefined;
}
export function auraRetryAfter(
  code: string,
  header: string | null,
): string | null {
  const recovery = auraRecovery(code);
  if (
    recovery === "support" ||
    recovery === "fix" ||
    code === "kyc_pending" ||
    code === "card_paused"
  )
    return null;
  if (
    header &&
    ((Number.isFinite(Number(header)) && Number(header) >= 0) ||
      Number.isFinite(Date.parse(header)))
  )
    return header;
  const seconds = definitions[code]?.retrySeconds;
  return seconds ? String(seconds) : null;
}
export function auraBackoff(
  code: string,
  header: string | null,
  attempt: number,
): string | null {
  if (auraRecovery(code) !== "same_request") return header;
  const first = auraRetryAfter(code, header);
  const seconds =
    first && Number.isFinite(Number(first))
      ? Number(first)
      : first
        ? Math.max(0, (Date.parse(first) - Date.now()) / 1000)
        : 5;
  return String(
    Math.ceil(
      Math.max(
        seconds,
        Math.min(60, 5 * 2 ** Math.max(0, Math.min(attempt - 1, 4))),
      ),
    ),
  );
}

export function auraErrorMessage(
  code: string,
  metadata: AuraErrorMetadata = {},
  providerMessage = "",
): string | undefined {
  const definition = definitions[code];
  if (!definition) return undefined;
  const d = metadata.details || {};
  let message = definition.message;
  if (code === "kyc_session_unavailable") {
    if (auraRecovery(code, d) === "wait")
      message =
        "Документы на проверке. Дождитесь результата, не открывайте проверку повторно.";
    else if (auraRecovery(code, d) === "fix")
      message = "Обновите телефон в личных данных, затем продолжите проверку.";
  }
  if (code === "sbp_buy_daily_qr_limit" && short(d.code) && providerMessage)
    message = providerMessage
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .slice(0, 500);
  const extras: string[] = [];
  if (
    code === "invalid_argument" &&
    providerMessage &&
    providerMessage !== "Не удалось связаться с кошельком"
  )
    extras.push(`Уточнение: ${short(providerMessage)}.`);
  if (metadata.param)
    extras.push(`Поле: ${fields[metadata.param] || short(metadata.param)}.`);
  if (d.min != null) extras.push(`Минимум: ${short(d.min)}.`);
  if (d.max != null) extras.push(`Максимум: ${short(d.max)}.`);
  if (d.limit != null) extras.push(`Лимит: ${short(d.limit)}.`);
  if (d.remaining != null) extras.push(`Осталось: ${short(d.remaining)}.`);
  if (d.resets_at) {
    const date = new Date(String(d.resets_at));
    if (Number.isFinite(date.getTime()))
      extras.push(`Восстановится: ${date.toLocaleString("ru-RU")}.`);
  }
  if (
    (code.startsWith("kyc_") ||
      code === "unavailable" ||
      code === "card_controls_unavailable") &&
    d.reason
  )
    extras.push(`Причина: ${short(d.reason)}.`);
  if (code === "qr_unsupported" && d.cause)
    extras.push(`Причина: ${short(d.cause)}.`);
  if (code === "payload_too_large" && d.max_bytes != null)
    extras.push(`Максимум: ${short(d.max_bytes)} байт.`);
  if (code === "card_not_activatable" && d.stage)
    extras.push(`Этап: ${short(d.stage)}.`);
  if (code === "insufficient_scope" && d.required_scope)
    extras.push(`Требуемое право: ${short(d.required_scope)}.`);
  if (
    (code === "rate_limited" || code === "pin_change_rate_limited") &&
    d.scope
  )
    extras.push(`Ограничение: ${short(d.scope)}.`);
  if (
    metadata.request_id &&
    (definition.recovery === "support" || code === "insufficient_scope")
  )
    extras.push(`Номер запроса: ${short(metadata.request_id)}.`);
  return [message, ...extras].join(" ");
}

export class WalletApiError extends Error {
  code: string;
  retryAfter: string | null;
  httpStatus: number;
  details: Record<string, unknown>;
  param: string;
  requestId: string;
  providerType: string;
  recovery: AuraRecovery | undefined;
  constructor(
    code: string,
    message: string,
    retryAfter: string | null = null,
    httpStatus = 0,
    metadata: AuraErrorMetadata = {},
  ) {
    const effectiveRetry = definitions[code]
      ? auraRetryAfter(code, retryAfter)
      : retryAfter;
    const description = auraErrorMessage(code, metadata, message) || message;
    const wait =
      effectiveRetry && Number.isFinite(Number(effectiveRetry))
        ? `${effectiveRetry} с`
        : effectiveRetry;
    super(
      description + (wait ? ` Повтор доступен после ожидания: ${wait}.` : ""),
    );
    this.name = "WalletApiError";
    this.code = code;
    this.retryAfter = effectiveRetry;
    this.httpStatus = httpStatus;
    this.details = metadata.details || {};
    this.param = metadata.param || "";
    this.requestId = metadata.request_id || "";
    this.providerType = metadata.type || "";
    this.recovery = auraRecovery(code, this.details);
  }
}
