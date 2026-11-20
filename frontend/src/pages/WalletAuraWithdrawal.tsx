import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "konsta/react";
import { walletIdempotentRequest, walletRequest } from "../lib/wallet-api";
import { useLiveWallet } from "./WalletLive";

type Pending = { key: string; address: string; amount: string; fee: string };
type WithdrawalOptions = {
  available: string;
  fee: string;
  environment: string;
  pending: Pending | null;
};
const action = "aura-user-withdrawal";

export default function WalletAuraWithdrawal() {
  const wallet = useLiveWallet();
  const [options, setOptions] = useState<WithdrawalOptions>();
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const request = useRef<{ key: string; address: string; amount: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void walletRequest<WithdrawalOptions>(action, undefined, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setOptions(value); })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, []);

  const pending = options?.pending;
  const fee = pending?.fee ?? options?.fee;
  const recipient = pending?.address ?? address.trim();
  const sum = pending?.amount ?? amount.trim().replace(",", ".");
  const valid = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(recipient) && /^\d{1,12}(?:\.\d{1,6})?$/.test(sum) && Number(sum) > 0;
  const total = Number(sum) + Number(fee);
  const canPay = Boolean(options && (pending || (valid && total <= Number(options.available) + 1e-12)));

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
      const result = await walletIdempotentRequest<{ status: string }>(
        action, { address: recipient, amount: sum, fee }, pending?.key ?? request.current.key,
      );
      setStatus(result.status);
      void wallet.refresh();
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
      {options && (
        <p className="text-sm opacity-65">
          {options.environment === "test" ? "Тестовая сеть TRON Nile. " : "Сеть TRON TRC‑20. "}
          Доступно {options.available} USDT · комиссия {fee} USDT
        </p>
      )}
      <label className="grid gap-2 text-sm">
        Адрес получателя
        <input className="rounded-xl bg-black/5 p-3 dark:bg-white/10" autoCapitalize="none" spellCheck={false}
          value={pending?.address ?? address} disabled={busy || Boolean(pending || status)} onChange={(event) => setAddress(event.target.value)} />
      </label>
      <label className="grid gap-2 text-sm">
        Получатель получит, USDT
        <input className="rounded-xl bg-black/5 p-3 dark:bg-white/10" inputMode="decimal"
          value={pending?.amount ?? amount} disabled={busy || Boolean(pending || status)} onChange={(event) => setAmount(event.target.value)} />
      </label>
      {valid && fee && (
        <dl className="grid gap-2 rounded-[20px] bg-black/5 p-4 text-sm dark:bg-white/10">
          <div className="flex justify-between gap-3"><dt className="opacity-60">Получатель получит</dt><dd>{sum} USDT</dd></div>
          <div className="flex justify-between gap-3"><dt className="opacity-60">Комиссия</dt><dd>{fee} USDT</dd></div>
          <div className="flex justify-between gap-3 font-semibold"><dt>Всего к списанию</dt><dd>{total.toFixed(6).replace(/\.?0+$/, "")} USDT</dd></div>
        </dl>
      )}
      {options && !pending && Number(options.available) <= Number(fee) && <p>Доступного остатка не хватает на комиссию.</p>}
      {error && <p role="alert" className="text-red-500">{error}</p>}
      {status && <p role="status">{{ processing: "Вывод принят и проверяется", broadcast: "Перевод отправлен в сеть", completed: "Вывод подтверждён", failed: "Вывод отклонён, резерв возвращён" }[status] ?? "Заявка сохранена"}</p>}
      {!status && <Button type="submit" rounded data-wpay-primary="" disabled={!canPay || busy}>{busy ? "Проверяем…" : pending ? "Проверить заявку" : "Вывести USDT"}</Button>}
    </form>
  );
}
