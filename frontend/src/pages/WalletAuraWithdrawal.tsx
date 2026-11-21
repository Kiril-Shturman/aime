import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "konsta/react";
import { walletIdempotentRequest, walletRequest } from "../lib/wallet-api";
import { useLiveWallet } from "./WalletLive";

type Pending = { key: string; address: string; amount: string; fee: string };
type Withdrawal = {
  withdrawal_id: string;
  status: string;
  amount: string | null;
  fee: string | null;
  recipient: string | null;
  transaction_hash: string | null;
};
const activeWithdrawal = (status?: string) => status === "processing" || status === "broadcast";

type WithdrawalOptions = {
  available: string;
  fee: string;
  environment: string;
  frozen?: boolean;
  pending: Pending | null;
  withdrawal: Withdrawal | null;
};
export default function WalletAuraWithdrawal() {
  const wallet = useLiveWallet();
  return <AuraWithdrawalForm onSubmitted={() => void wallet.refresh()} />;
}

export function AuraWithdrawalForm({ adminScope, onSubmitted }: {
  adminScope?: { userId: string; environment: string };
  onSubmitted?: () => void;
}) {
  const action = adminScope
    ? "admin-aura-user-withdrawal?" + new URLSearchParams({ user_id: adminScope.userId, environment: adminScope.environment })
    : "aura-user-withdrawal";
  const [options, setOptions] = useState<WithdrawalOptions>();
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [withdrawal, setWithdrawal] = useState<Withdrawal | null>(null);
  const [statusError, setStatusError] = useState(false);
  const status = withdrawal?.status;
  const withdrawalId = withdrawal?.withdrawal_id;
  const tracking = activeWithdrawal(status);
  const request = useRef<{ key: string; address: string; amount: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void walletRequest<WithdrawalOptions>(action, undefined, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setOptions(value);
        setWithdrawal(value.pending ? null : value.withdrawal);
      })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [action]);

  useEffect(() => {
    if (!withdrawalId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ withdrawal_id: withdrawalId });
    const endpoint = action + (action.includes("?") ? "&" : "?") + params;
    let timer: ReturnType<typeof setTimeout>;
    async function refreshStatus() {
      try {
        const value = await walletRequest<WithdrawalOptions>(endpoint, undefined, controller.signal);
        if (controller.signal.aborted) return;
        setOptions(value);
        setWithdrawal(value.withdrawal);
        setStatusError(false);
        if (!activeWithdrawal(value.withdrawal?.status)) return;
      } catch {
        if (controller.signal.aborted) return;
        setStatusError(true);
      }
      timer = setTimeout(() => void refreshStatus(), 5000);
    }
    void refreshStatus();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [action, withdrawalId]);

  const pending = options?.pending;
  const fee = withdrawal?.fee ?? pending?.fee ?? options?.fee;
  const recipient = withdrawal?.recipient ?? pending?.address ?? address.trim();
  const sum = withdrawal?.amount ?? pending?.amount ?? amount.trim().replace(",", ".");
  const valid = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(recipient) && /^\d{1,12}(?:\.\d{1,6})?$/.test(sum) && Number(sum) > 0;
  const total = Number(sum) + Number(fee);
  const canPay = Boolean(options && (pending || (!options.frozen && valid && total <= Number(options.available) + 1e-12)));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || status || !canPay || !fee) return;
    if (!pending && !window.confirm(`Отправить ${sum} USDT? Комиссия ${fee} USDT.`)) return;
    if (request.current?.address !== recipient || request.current.amount !== sum) {
      request.current = { key: pending?.key ?? crypto.randomUUID(), address: recipient, amount: sum };
    }
    setBusy(true);
    setError("");
    try {
      const result = await walletIdempotentRequest<Withdrawal>(
        action, { address: recipient, amount: sum, fee }, pending?.key ?? request.current.key,
      );
      setOptions((previous) => previous && { ...previous, pending: null });
      setWithdrawal(result);
      onSubmitted?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось проверить вывод");
      try {
        setOptions(await walletRequest<WithdrawalOptions>(action));
      } catch {
        setOptions(undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-[560px] flex-col gap-4 px-4 py-6">
      {adminScope && <p className="text-sm opacity-60">Вывод из остатка Aura пользователя {adminScope.userId}.</p>}
      {options && (
        <p className="text-sm opacity-65">
          {options.environment === "test" ? "Тестовая сеть TRON Nile. " : "Сеть TRON TRC‑20. "}
          Доступно {options.available} USDT · комиссия {fee} USDT
        </p>
      )}
      <label className="grid gap-2 text-sm">
        Адрес получателя
        <input className="rounded-xl bg-black/5 p-3 dark:bg-white/10" autoCapitalize="none" spellCheck={false}
          value={withdrawal?.recipient ?? pending?.address ?? address} disabled={busy || Boolean(pending || status)} onChange={(event) => setAddress(event.target.value)} />
      </label>
      <label className="grid gap-2 text-sm">
        Получатель получит, USDT
        <input className="rounded-xl bg-black/5 p-3 dark:bg-white/10" inputMode="decimal"
          value={withdrawal?.amount ?? pending?.amount ?? amount} disabled={busy || Boolean(pending || status)} onChange={(event) => setAmount(event.target.value)} />
      </label>
      {valid && fee && (
        <dl className="grid gap-2 rounded-[20px] bg-black/5 p-4 text-sm dark:bg-white/10">
          <div className="flex justify-between gap-3"><dt className="opacity-60">Получатель получит</dt><dd>{sum} USDT</dd></div>
          <div className="flex justify-between gap-3"><dt className="opacity-60">Комиссия</dt><dd>{fee} USDT</dd></div>
          <div className="flex justify-between gap-3 font-semibold"><dt>Всего к списанию</dt><dd>{total.toFixed(6).replace(/\.?0+$/, "")} USDT</dd></div>
        </dl>
      )}
      {options && !pending && Number(options.available) <= Number(fee) && <p>Доступного остатка не хватает на комиссию.</p>}
      {options?.frozen && !pending && <p role="status">Новые выводы из Aura заморожены.</p>}
      {error && <p role="alert" className="text-red-500">{error}</p>}
      {status && <p role="status">{{ processing: "Вывод принят и проверяется", broadcast: "Перевод отправлен в сеть", completed: "Вывод подтверждён", failed: "Вывод отклонён, резерв возвращён" }[status] ?? "Заявка сохранена"}</p>}
      {statusError && tracking && <p role="status" className="text-sm opacity-65">Статус временно недоступен. Проверим снова автоматически.</p>}
      {withdrawal?.transaction_hash && <p className="break-all text-sm">Хеш транзакции {withdrawal.transaction_hash}</p>}
      {withdrawal && !tracking && <Button type="button" rounded data-wpay-primary="" onClick={() => {
        setWithdrawal(null);
        setAddress("");
        setAmount("");
        setError("");
        setStatusError(false);
        request.current = null;
      }}>Новый вывод</Button>}
      {!status && <Button type="submit" rounded data-wpay-primary="" disabled={!canPay || busy}>{busy ? "Проверяем…" : pending ? "Проверить заявку" : "Вывести USDT"}</Button>}
    </form>
  );
}
