import { useEffect, useState, type FormEvent } from "react";
import { Button, Card } from "konsta/react";
import { walletRequest } from "../lib/wallet-api";
import { isRecipientAddress, networkNames } from "../wallet/catalog";

type Job = {
  job_id: string;
  state: string;
  recipient: string;
  amount: string;
  tx_hash: string | null;
  detail: string | null;
  quote: { approval_id: string; max_fee: string; fee_currency: string; estimated_total?: string; expires_at: number; source_address: string } | null;
};
type Status = { enabled: boolean; job: Job | null };
const action = "custody-withdrawal";
const pending = new Set(["estimating", "confirmed", "signing", "signed", "broadcast", "unknown"]);
const statuses: Record<string, string> = {
  estimating: "Считаем комиссию сети…",
  confirmed: "Перевод подтверждён вами",
  signing: "Подписываем перевод…",
  signed: "Перевод подписан",
  broadcast: "Отправлен в сеть. Ждём подтверждения.",
  unknown: "Уточняем, прошёл ли перевод",
  done: "Перевод подтверждён сетью",
  failed: "Не удалось выполнить перевод",
  expired: "Расчёт комиссии истёк",
};
const inputClass = "rounded-xl bg-black/5 p-3 dark:bg-white/10";

export default function WalletCustodyWithdrawal({ asset, network }: { asset: string; network: string }) {
  const [status, setStatus] = useState<Status>();
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const job = status?.job;
  const jobId = job?.job_id;
  const polling = !job || pending.has(job.state) || job.state === "quoted";

  useEffect(() => {
    const controller = new AbortController();
    const route = `${action}?asset=${encodeURIComponent(asset)}${jobId ? "&job_id=" + encodeURIComponent(jobId) : ""}`;
    async function refresh() {
      try {
        const value = await walletRequest<Status>(route, undefined, controller.signal);
        if (!controller.signal.aborted) setStatus(value);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Статус недоступен");
      }
    }
    void refresh();
    const timer = polling ? window.setInterval(() => void refresh(), 4000) : undefined;
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [asset, jobId, polling]);

  const normalized = amount.trim().replace(",", ".");
  const precision = ({ TRX: 6, XAUT: 6, SOL: 9, BTC: 8, GRAM: 9 } as Record<string, number>)[asset] ?? 18;
  const validAmount = new RegExp(`^\\d{1,12}(?:\\.\\d{1,${precision}})?$`).test(normalized) && /[1-9]/.test(normalized);
  const validAddress = network === "BTC" ? /^bc1q[a-z0-9]{38}$/.test(address.trim()) : isRecipientAddress(network, address.trim());
  const valid = validAddress && validAmount;
  const quote = job?.state === "quoted" ? job.quote : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status?.enabled || busy || (!quote && (!valid || (job && pending.has(job.state))))) return;
    setBusy(true);
    setError("");
    try {
      const result = quote && job
        ? await walletRequest<Job>(action + "-confirm", { job_id: job.job_id, approval_id: quote.approval_id })
        : await walletRequest<Job>(action + "-prepare", { asset, address: address.trim(), amount: normalized });
      setStatus({ enabled: true, job: result });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось обновить заявку");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto grid w-full max-w-[560px] gap-4 px-4 py-6">
      <p className="text-sm opacity-60">{networkNames[network] ?? network} · Собственный кошелёк</p>
      {job ? (
        <Card className="!m-0 !rounded-[28px]">
          <p className="font-semibold">Получатель получит {job.amount} {asset}</p>
          <p className="break-all text-sm opacity-60">{job.recipient}</p>
          {quote && (
            <dl className="mt-3 grid gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="opacity-60">{network === "TON" || network === "TRON" ? "Резерв на комиссию" : "Максимальная комиссия"}</dt>
                <dd>{quote.max_fee} {quote.fee_currency}</dd>
              </div>
              <div className="flex justify-between gap-3 font-semibold">
                <dt>Сумма с учётом комиссии</dt>
                <dd className="text-right">{quote.estimated_total
                  ? `до ${quote.estimated_total} ${asset}`
                  : `${job.amount} ${asset} + до ${quote.max_fee} ${quote.fee_currency}`}</dd>
              </div>
            </dl>
          )}
          {statuses[job.state] && <p role="status" className="mt-2">{statuses[job.state]}</p>}
          {job.detail && <p className="mt-2 text-sm">{job.detail}</p>}
          {job.tx_hash && <p className="mt-2 break-all font-mono text-xs">{network === "TON" ? "Хеш сообщения: " : ""}{job.tx_hash}</p>}
        </Card>
      ) : (
        <>
          <label className="grid gap-2 text-sm">
            Адрес получателя
            <input className={inputClass} value={address} autoCapitalize="none" spellCheck={false}
              onChange={(event) => setAddress(event.target.value)} disabled={busy} />
          </label>
          <label className="grid gap-2 text-sm">
            Сумма {asset}
            <input className={inputClass} value={amount} inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)} disabled={busy} />
          </label>
        </>
      )}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {status && !status.enabled && <p role="status">Вывод {asset} сейчас недоступен.</p>}
      {(!job || quote) && (
        <Button type="submit" rounded data-wpay-primary=""
          disabled={busy || !status?.enabled || (!quote && !valid)}>
          {busy ? "Проверяем…" : quote ? `Подтвердить вывод ${asset}` : "Рассчитать комиссию"}
        </Button>
      )}
      {job && !quote && !pending.has(job.state) && (
        <Button type="button" rounded tonal onClick={() => {
          setAddress("");
          setAmount("");
          setStatus((current) => current && { ...current, job: null });
        }}>Новый вывод</Button>
      )}
    </form>
  );
}
