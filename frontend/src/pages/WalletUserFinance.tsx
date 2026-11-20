import { useEffect, useState } from "react";
import { Button, Card } from "konsta/react";
import { WalletApiError, walletRequest } from "../lib/wallet-api";
import { useLiveWallet } from "./WalletLive";

const card = "!m-0 !rounded-[28px]";
const input =
  "mt-3 w-full bg-transparent text-[17px] text-black outline-none dark:text-white";
type Transfer = {
  intent_id?: string;
  status: string;
  claim_url?: string;
  spend_id?: string;
};
export function WalletTransfer() {
  const wallet = useLiveWallet();
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [recipient, setRecipient] = useState(""),
    [amount, setAmount] = useState(""),
    [intent, setIntent] = useState<string | null>(null),
    [result, setResult] = useState<Transfer | null>(null);
  useEffect(() => {
    let active = true;
    if (wallet.demo) {
      setEnabled(false);
      return;
    }
    walletRequest<{ can_transfer: boolean }>("financial-capabilities")
      .then((value) => {
        if (active) setEnabled(value.can_transfer === true);
      })
      .catch((error) => {
        if (active) {
          setEnabled(false);
          setError(
            error instanceof Error ? error.message : "Сервис недоступен",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [wallet.demo]);
  async function perform(action: string) {
    if (busy || enabled !== true) return;
    setBusy(true);
    setError("");
    try {
      if (!intent) {
        const quote = await walletRequest<{ intent_id: string }>(
          "transfer-prepare",
          {
            recipient_id: recipient,
            asset: "USDT",
            amount: amount.replace(",", "."),
          },
        );
        setIntent(quote.intent_id);
      } else {
        const row = await walletRequest<Transfer>(action, {
          intent_id: intent,
        });
        setResult(row);
        void wallet.refresh();
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Не удалось выполнить перевод",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-4">
      {enabled !== true ? (
        <p
          role="status"
          className="rounded-[28px] bg-white p-5 text-black/50 dark:bg-[#1c1c1e] dark:text-white/50"
        >
          {enabled === null
            ? "Проверяем доступность…"
            : "Переводы в Telegram недоступны"}
        </p>
      ) : (
        <>
          <Card className={card} contentWrapPadding="p-5">
            <label
              htmlFor="transfer-recipient"
              className="text-[14px] text-black/45 dark:text-white/45"
            >
              Telegram ID получателя
            </label>
            <input
              id="transfer-recipient"
              aria-label="Telegram ID получателя"
              className={input}
              inputMode="numeric"
              value={recipient}
              disabled={!!intent || busy}
              onChange={(event) =>
                setRecipient(event.target.value.replace(/\D/g, ""))
              }
            />
          </Card>
          <Card className={card} contentWrapPadding="p-5">
            <label
              htmlFor="transfer-amount"
              className="text-[14px] text-black/45 dark:text-white/45"
            >
              Сумма, USDT
            </label>
            <input
              id="transfer-amount"
              aria-label="Сумма перевода USDT"
              className={input}
              inputMode="decimal"
              value={amount}
              disabled={!!intent || busy}
              onChange={(event) =>
                setAmount(event.target.value.replace(/[^\d.,]/g, ""))
              }
            />
          </Card>
          {intent && !result && (
            <p className="px-2 text-[14px] text-black/50 dark:text-white/50">
              Проверьте получателя и сумму. Подтверждение зарезервирует средства
              на вашем балансе.
            </p>
          )}
          {!result && (
            <Button
              data-wpay-primary=""
              rounded
              large
              disabled={
                busy || !recipient || !(Number(amount.replace(",", ".")) > 0)
              }
              onClick={() => void perform("transfer-send")}
            >
              {busy
                ? "Подождите…"
                : intent
                  ? "Подтвердить перевод"
                  : "Проверить перевод"}
            </Button>
          )}
          {result && (
            <Card className={card} contentWrapPadding="p-5">
              <p role="status">
                {result.status === "completed"
                  ? "Перевод получен"
                  : result.status === "reverted"
                    ? "Перевод отозван, средства возвращены"
                    : "Перевод ждёт получателя"}
              </p>
              {result.claim_url?.startsWith("https://t.me/") && (
                <a
                  href={result.claim_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 block text-primary"
                >
                  Ссылка для получателя
                </a>
              )}
              {result.status === "pending" && (
                <Button
                  data-wpay-primary=""
                  rounded
                  tonal
                  disabled={busy}
                  onClick={() => void perform("transfer-revoke")}
                >
                  Отозвать перевод
                </Button>
              )}
            </Card>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-[14px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </main>
  );
}

export function WalletInvoiceCreate({ onCreated }: { onCreated?: () => void }) {
  const [asset, setAsset] = useState("USDT"),
    [amount, setAmount] = useState(""),
    [description, setDescription] = useState(""),
    [intent, setIntent] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Record<string, unknown> | null>(null);
  async function create() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let id = intent;
      if (!id) {
        const prepared = await walletRequest<{ intent_id: string }>(
          "invoice-prepare",
          { asset, amount: amount.replace(",", "."), description },
        );
        id = prepared.intent_id;
        setIntent(id);
      }
      setResult(await walletRequest("invoice-create", { intent_id: id }));
      onCreated?.();
    } catch (error) {
      if (error instanceof WalletApiError && error.code === "INVOICE_REJECTED")
        setIntent(null);
      setError(
        error instanceof Error ? error.message : "Не удалось создать счёт",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className={card} contentWrapPadding="p-5">
      <h3 className="text-[19px] font-semibold">Новый счёт</h3>
      <label className="mt-4 block text-[14px] text-black/45 dark:text-white/45">
        Валюта
        <select
          aria-label="Валюта счёта"
          className={input}
          disabled={!!intent || busy}
          value={asset}
          onChange={(event) => setAsset(event.target.value)}
        >
          {["USDT", "TRX", "ETH", "BNB"].map((code) => (
            <option key={code}>{code}</option>
          ))}
        </select>
      </label>
      <label className="mt-4 block text-[14px] text-black/45 dark:text-white/45">
        Сумма
        <input
          aria-label="Сумма счёта"
          inputMode="decimal"
          className={input}
          disabled={!!intent || busy}
          value={amount}
          onChange={(event) =>
            setAmount(event.target.value.replace(/[^\d.,]/g, ""))
          }
        />
      </label>
      <label className="mt-4 block text-[14px] text-black/45 dark:text-white/45">
        Описание
        <input
          aria-label="Описание счёта"
          maxLength={1024}
          className={input}
          disabled={!!intent || busy}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      {!result && (
        <Button
          data-wpay-primary=""
          rounded
          large
          disabled={busy || !(Number(amount.replace(",", ".")) > 0)}
          onClick={() => void create()}
        >
          {busy
            ? "Создаём…"
            : intent
              ? "Проверить созданный счёт"
              : "Создать счёт"}
        </Button>
      )}
      {result && (
        <>
          <p role="status" className="mt-4">
            Счёт № {String(result.invoice_id)} · {String(result.status)}
          </p>
          {["bot_invoice_url", "mini_app_invoice_url", "receipt_url"].map(
            (key) =>
              typeof result[key] === "string" &&
              String(result[key]).startsWith("https://t.me/") ? (
                <a
                  key={key}
                  href={String(result[key])}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 block text-primary"
                >
                  {key === "receipt_url"
                    ? "Чек"
                    : key === "bot_invoice_url"
                      ? "Оплатить в боте"
                      : "Открыть платёжное окно"}
                </a>
              ) : null,
          )}
          <Button
            rounded
            tonal
            onClick={() => {
              setIntent(null);
              setResult(null);
              setAmount("");
            }}
          >
            Новый счёт
          </Button>
        </>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 text-[14px] text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </Card>
  );
}

export function WalletFinanceReport() {
  const [report, setReport] = useState<{
      blocked: boolean;
      worker?: { health?: string; last_error?: string; last_success?: string };
      items: {
        provider: string;
        environment: string;
        asset: string;
        provider_available: string;
        liabilities: string;
        inflight: string;
        difference: string;
        state: string;
      }[];
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    walletRequest<NonNullable<typeof report>>("finance-reconciliation")
      .then((value) => {
        if (active) setReport(value);
      })
      .catch((error) => {
        if (active)
          setError(
            error instanceof Error ? error.message : "Сверка недоступна",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="wpay-admin-card">
      <h3>Обеспечение клиентских балансов</h3>
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <p role="status">
            {report.blocked
              ? "Расходы проблемного провайдера заблокированы: есть расхождение"
              : "Баланс организации покрывает обязательства"}
          </p>
          <p role="status">
            Worker:{" "}
            {report.worker?.health === "healthy"
              ? "Работает"
              : report.worker?.health === "degraded"
                ? "Требует внимания"
                : "Статус неизвестен"}
          </p>
          {report.worker?.last_error && (
            <p role="alert">{report.worker.last_error}</p>
          )}
          {report.items.map((row) => (
            <div
              key={row.asset}
              className="mt-3 rounded-2xl border border-black/10 p-3 dark:border-white/10"
            >
              <strong>
                {row.provider.toUpperCase()} · {row.environment.toUpperCase()} · {row.asset}
              </strong>
              <p>
                Организация: {row.provider_available} · Обязательства:{" "}
                {row.liabilities}
              </p>
              <p>
                В пути: {row.inflight} · Difference: {row.difference} ·{" "}
                {row.state}
              </p>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
