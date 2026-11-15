import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "konsta/react";
import {
  walletIdempotentRequest,
  walletNullableRequest,
  walletRequest,
  WalletApiError,
} from "../lib/wallet-api";
import { useLiveWallet } from "./WalletLive";

type AuraCard = {
  card_id: string;
  kind: "virtual" | "physical";
  status: "processing" | "opened" | "failed_to_open" | "cancelled";
  frozen: boolean;
  masked_pan: string | null;
  delivery_status: string | null;
  provider_updated_at: string | null;
};
type CardFees = {
  currency: "USDT";
  minimum_recharge_amount: string;
  open_virtual_card_fee: string;
  open_physical_card_fee: string;
  recharge_fee_pct: string;
  physical_recharge_fee_pct: string;
};
type CardCredentials = {
  card_id: string;
  number: string;
  expiry: string;
  cvv: string;
};
type CardOtp = {
  card_id: string;
  card_number_masked: string | null;
  code: string;
  consumed_at: string | null;
  expires_at: string;
  id: string;
  received_at: string;
  subject: string | null;
};
type CardOperation = {
  operation_id: string;
  operation_type: string;
  status: string;
  asset: string;
  amount: string;
  fee: string | null;
  merchant: string | null;
  decline_message: string | null;
  provider_created_at: string;
};
type ShippingAddress = {
  full_name: string;
  phone: string;
  country: string;
  city: string;
  address_line: string;
  postal_code: string;
};

const operationKey = () =>
  globalThis.crypto?.randomUUID?.() ??
  `card-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const errorText = (error: unknown) =>
  error instanceof WalletApiError ? error.message : "Операция не выполнена";
const shortCard = (card: AuraCard) =>
  card.masked_pan || `•••• ${card.card_id.slice(-4).toUpperCase()}`;
const statusText: Record<string, string> = {
  processing: "Выпускается",
  opened: "Активна",
  failed_to_open: "Не выпущена",
  cancelled: "Отменена",
};
const deliveryText: Record<string, string> = {
  issuing: "Выпускается",
  issued: "Выпущена",
  out_for_delivery: "В доставке",
  activated: "Активирована",
};
const emptyShipping: ShippingAddress = {
  full_name: "",
  phone: "",
  country: "",
  city: "",
  address_line: "",
  postal_code: "",
};

export default function WalletAuraCards({
  showNotice,
}: {
  showNotice: (text: string) => void;
}) {
  const wallet = useLiveWallet();
  const [cards, setCards] = useState<AuraCard[]>([]);
  const [fees, setFees] = useState<CardFees | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [operations, setOperations] = useState<CardOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [issueKind, setIssueKind] = useState<"virtual" | "physical">("virtual");
  const [shipping, setShipping] = useState(emptyShipping);
  const [recharge, setRecharge] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [pin, setPin] = useState("");
  const [credentials, setCredentials] = useState<CardCredentials | null>(null);
  const [otp, setOtp] = useState<CardOtp | null | undefined>(undefined);
  const busyRef = useRef(false);
  const issueKey = useRef("");
  const rechargeKey = useRef("");

  const loadCards = useCallback(async () => {
    setError("");
    try {
      const [cardResult, feeResult] = await Promise.all([
        walletRequest<{ data: AuraCard[] }>("aura-cards"),
        walletRequest<CardFees>("aura-card-fees"),
      ]);
      setCards(cardResult.data);
      setFees(feeResult);
      setSelectedId((current) =>
        current && cardResult.data.some((card) => card.card_id === current)
          ? current
          : cardResult.data[0]?.card_id ?? null,
      );
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);
  useEffect(() => {
    if (!selectedId) {
      setOperations([]);
      return;
    }
    const controller = new AbortController();
    void walletRequest<{ data: CardOperation[] }>(
      `aura-card-operations?card_id=${encodeURIComponent(selectedId)}`,
      undefined,
      controller.signal,
    )
      .then((result) => setOperations(result.data))
      .catch((requestError) => {
        if (!(requestError instanceof DOMException)) setError(errorText(requestError));
      });
    return () => controller.abort();
  }, [selectedId]);
  useEffect(() => {
    if (!credentials) return;
    const timer = window.setTimeout(() => setCredentials(null), 60_000);
    return () => window.clearTimeout(timer);
  }, [credentials]);
  useEffect(() => {
    if (!otp) return;
    const delay = Math.max(0, Date.parse(otp.expires_at) - Date.now());
    const timer = window.setTimeout(() => setOtp(null), delay);
    return () => window.clearTimeout(timer);
  }, [otp]);

  const selected = useMemo(
    () => cards.find((card) => card.card_id === selectedId) ?? null,
    [cards, selectedId],
  );
  const mutate = async (name: string, task: () => Promise<unknown>, success: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(name);
    setError("");
    try {
      await task();
      await Promise.all([loadCards(), wallet.refresh()]);
      showNotice(success);
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  };
  const issue = () =>
    mutate(
      "issue",
      async () => {
        issueKey.current ||= operationKey();
        const result = await walletIdempotentRequest(
          "aura-cards",
          issueKind === "physical"
            ? { kind: issueKind, shipping_address: shipping }
            : { kind: issueKind },
          issueKey.current,
        );
        issueKey.current = "";
        return result;
      },
      "Заявка на карту отправлена",
    );
  const control = (action: string, body: Record<string, string>, success: string) =>
    mutate(action, () => walletRequest(action, body), success);

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 pb-28 pt-5">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="m-0 text-[28px] font-semibold tracking-tight">Карты Aura</h1>
          <p className="m-0 mt-1 text-[13px] text-black/45 dark:text-white/45">
            Выпуск и управление в реальном времени
          </p>
        </div>
        <button type="button" className="text-[14px] font-medium text-primary" onClick={() => void loadCards()}>
          Обновить
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-2xl bg-red-500/10 px-4 py-3 text-[14px] text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <Card className="!m-0 !rounded-[28px] p-5">Загружаем карты…</Card>
      ) : cards.length ? (
        <div className="grid gap-3">
          {cards.map((card) => (
            <button
              key={card.card_id}
              type="button"
              onClick={() => {
                setCredentials(null);
                setOtp(undefined);
                setActivationCode("");
                setPin("");
                setSelectedId(card.card_id);
              }}
              className={`w-full rounded-[28px] border p-5 text-left transition ${selectedId === card.card_id ? "border-primary bg-primary/10" : "border-black/5 bg-white dark:border-white/10 dark:bg-white/5"}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[18px] font-semibold">{shortCard(card)}</div>
                  <div className="mt-1 text-[13px] text-black/45 dark:text-white/45">
                    {card.kind === "physical" ? "Физическая" : "Виртуальная"} · {statusText[card.status] ?? card.status}
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1 text-[12px] font-medium ${card.frozen ? "bg-blue-500/10 text-blue-600" : "bg-emerald-500/10 text-emerald-600"}`}>
                  {card.frozen ? "Заморожена" : "Активна"}
                </span>
              </div>
              {card.delivery_status && (
                <div className="mt-4 text-[13px] text-black/55 dark:text-white/55">
                  Доставка: {deliveryText[card.delivery_status] ?? card.delivery_status}
                </div>
              )}
            </button>
          ))}
        </div>
      ) : (
        <Card className="!m-0 !rounded-[28px] p-5 text-[14px] text-black/55 dark:text-white/55">
          У вас пока нет карт Aura.
        </Card>
      )}

      {selected && (
        <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm dark:bg-white/5">
          <h2 className="m-0 text-[20px] font-semibold">Управление картой</h2>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {selected.status === "opened" && (
              <Button
                rounded
                disabled={Boolean(busy)}
                onClick={() => control(
                  selected.frozen ? "aura-card-unfreeze" : "aura-card-freeze",
                  { card_id: selected.card_id },
                  selected.frozen ? "Карта разморожена" : "Карта заморожена",
                )}
              >
                {selected.frozen ? "Разморозить" : "Заморозить"}
              </Button>
            )}
            {selected.status === "processing" && (
              <Button rounded disabled={Boolean(busy)} onClick={() => control("aura-card-cancel", { card_id: selected.card_id }, "Заявка отменена")}>
                Отменить выпуск
              </Button>
            )}
            <Button
              rounded
              outline
              disabled={Boolean(busy) || selected.status !== "opened"}
              onClick={async () => {
                setBusy("credentials");
                setError("");
                try {
                  setCredentials(await walletRequest<CardCredentials>(`aura-card-credentials?card_id=${encodeURIComponent(selected.card_id)}`));
                } catch (requestError) {
                  setError(errorText(requestError));
                } finally {
                  setBusy("");
                }
              }}
            >
              Реквизиты
            </Button>
            <Button
              rounded
              outline
              disabled={Boolean(busy) || selected.status !== "opened"}
              onClick={async () => {
                setBusy("otp");
                setError("");
                try {
                  setOtp(await walletNullableRequest<CardOtp>(`aura-card-otp-latest?card_id=${encodeURIComponent(selected.card_id)}`));
                } catch (requestError) {
                  setError(errorText(requestError));
                } finally {
                  setBusy("");
                }
              }}
            >
              Код 3DS
            </Button>
          </div>

          {credentials && credentials.card_id === selected.card_id && (
            <div className="mt-4 rounded-2xl bg-black/[0.04] p-4 font-mono dark:bg-white/[0.07]">
              <div className="break-all text-[18px] tracking-wide">{credentials.number}</div>
              <div className="mt-2 flex justify-between text-[14px]"><span>{credentials.expiry}</span><span>CVV {credentials.cvv}</span></div>
              <button type="button" className="mt-3 text-[13px] text-primary" onClick={() => setCredentials(null)}>Скрыть сейчас</button>
            </div>
          )}
          {otp !== undefined && (!otp || otp.card_id === selected.card_id) && (
            <div className="mt-4 rounded-2xl bg-black/[0.04] p-4 dark:bg-white/[0.07]">
              {otp ? (
                <><div className="text-[12px] uppercase tracking-wide text-black/40 dark:text-white/40">Действует до {new Date(otp.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div><div className="mt-1 font-mono text-[30px] font-semibold tracking-[0.2em]">{otp.code}</div></>
              ) : <div className="text-[14px]">Действующего 3DS-кода нет</div>}
            </div>
          )}

          {selected.status === "opened" && (
            <div className="mt-5 border-t border-black/5 pt-5 dark:border-white/10">
              <label className="text-[13px] font-medium">Пополнить карту, USDT</label>
              <div className="mt-2 flex gap-2">
                <input value={recharge} onChange={(event) => { rechargeKey.current = ""; setRecharge(event.target.value); }} inputMode="decimal" placeholder={fees?.minimum_recharge_amount ? `От ${fees.minimum_recharge_amount}` : "Сумма"} className="min-w-0 flex-1 rounded-2xl bg-black/5 px-4 py-3 outline-none dark:bg-white/10" />
                <Button rounded disabled={Boolean(busy) || !recharge} onClick={() => mutate("recharge", async () => { rechargeKey.current ||= operationKey(); const result = await walletIdempotentRequest("aura-card-recharge", { card_id: selected.card_id, amount: recharge }, rechargeKey.current); rechargeKey.current = ""; setRecharge(""); return result; }, "Карта пополнена")}>Пополнить</Button>
              </div>
            </div>
          )}

          {selected.kind === "physical" && selected.status === "opened" && selected.delivery_status !== "activated" && (
            <div className="mt-5 border-t border-black/5 pt-5 dark:border-white/10">
              <label className="text-[13px] font-medium">Код активации из конверта</label>
              <div className="mt-2 flex gap-2">
                <input value={activationCode} onChange={(event) => setActivationCode(event.target.value)} autoComplete="one-time-code" className="min-w-0 flex-1 rounded-2xl bg-black/5 px-4 py-3 outline-none dark:bg-white/10" />
                <Button rounded disabled={Boolean(busy) || !activationCode} onClick={() => mutate("aura-card-activate", async () => { const result = await walletRequest("aura-card-activate", { card_id: selected.card_id, activation_code: activationCode }); setActivationCode(""); return result; }, "Карта активирована")}>Активировать</Button>
              </div>
            </div>
          )}

          {selected.status === "opened" && (
            <div className="mt-5 border-t border-black/5 pt-5 dark:border-white/10">
              <label className="text-[13px] font-medium">PIN аккаунта держателя</label>
              <div className="mt-2 flex gap-2">
                <input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" type="password" autoComplete="new-password" placeholder="6 цифр" className="min-w-0 flex-1 rounded-2xl bg-black/5 px-4 py-3 outline-none dark:bg-white/10" />
                <Button rounded disabled={Boolean(busy) || pin.length !== 6} onClick={() => mutate("aura-card-pin", async () => { const result = await walletRequest("aura-card-pin", { card_id: selected.card_id, pin }); setPin(""); return result; }, "PIN установлен")}>Установить</Button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm dark:bg-white/5">
        <h2 className="m-0 text-[20px] font-semibold">Выпустить карту</h2>
        {fees && <p className="mt-1 text-[13px] text-black/45 dark:text-white/45">Виртуальная — {fees.open_virtual_card_fee} USDT{fees.open_physical_card_fee ? `, физическая — ${fees.open_physical_card_fee} USDT` : ""}</p>}
        <div className="mt-4 flex gap-2">
          {(["virtual", "physical"] as const).map((kind) => (
            <button key={kind} type="button" disabled={kind === "physical" && !fees?.open_physical_card_fee} onClick={() => { issueKey.current = ""; setIssueKind(kind); }} className={`flex-1 rounded-full px-3 py-2 text-[14px] ${issueKind === kind ? "bg-primary text-white" : "bg-black/5 dark:bg-white/10"} disabled:opacity-35`}>
              {kind === "virtual" ? "Виртуальная" : "Физическая"}
            </button>
          ))}
        </div>
        {issueKind === "physical" && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {(Object.keys(emptyShipping) as (keyof ShippingAddress)[]).map((field) => (
              <input key={field} value={shipping[field]} onChange={(event) => { issueKey.current = ""; setShipping((value) => ({ ...value, [field]: event.target.value })); }} placeholder={{ full_name: "Получатель", phone: "+79990000000", country: "RU", city: "Город", address_line: "Улица, дом, квартира", postal_code: "Индекс" }[field]} className={`${field === "address_line" ? "col-span-2" : ""} rounded-2xl bg-black/5 px-4 py-3 outline-none dark:bg-white/10`} />
            ))}
          </div>
        )}
        <Button large rounded className="!mt-4 !w-full" disabled={Boolean(busy) || (issueKind === "physical" && Object.values(shipping).some((value) => !value.trim()))} onClick={issue}>
          {busy === "issue" ? "Отправляем…" : "Выпустить"}
        </Button>
      </section>

      {selected && operations.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 px-1 text-[20px] font-semibold">Операции</h2>
          <div className="overflow-hidden rounded-[28px] bg-white dark:bg-white/5">
            {operations.slice(0, 20).map((operation) => (
              <div key={operation.operation_id} className="flex items-start justify-between gap-4 border-b border-black/5 px-4 py-3 last:border-0 dark:border-white/10">
                <div className="min-w-0"><div className="truncate text-[14px] font-medium">{operation.merchant || (operation.operation_type === "refund" ? "Возврат" : "Операция по карте")}</div><div className="mt-1 text-[12px] text-black/40 dark:text-white/40">{operation.status}{operation.decline_message ? ` · ${operation.decline_message}` : ""}</div></div>
                <div className="shrink-0 text-[14px] font-semibold">{operation.operation_type === "refund" ? "+" : "−"}{operation.amount} {operation.asset}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
