import { useEffect, useRef, useState } from "react";
import { Button } from "konsta/react";
import { Preloader } from "framework7-react";
import { Copy, KeyRound, X } from "lucide-react";
import { walletRequest } from "../lib/wallet-api";

const toBase64 = (value: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(value)));
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export default function WalletKeyExport({
  walletId,
  address,
  network,
}: {
  walletId: string;
  address: string;
  network: string;
}) {
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const life = useRef<AbortController | null>(null);
  const running = useRef(false);
  const clear = () => {
    life.current?.abort();
    setSecret("");
    setError("");
    setBusy(false);
    setCopied(false);
    setOpen(false);
    setAcknowledged(false);
    running.current = false;
  };
  useEffect(() => {
    const hide = () => {
      if (document.hidden) clear();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      life.current?.abort();
      document.removeEventListener("visibilitychange", hide);
    };
  }, [walletId]);
  useEffect(() => {
    if (!secret) return;
    const timer = setTimeout(clear, 30_000);
    return () => clearTimeout(timer);
  }, [secret]);
  async function reveal() {
    if (running.current || !acknowledged) return;
    running.current = true;
    const abort = new AbortController();
    life.current = abort;
    setBusy(true);
    setError("");
    try {
      const keys = await crypto.subtle.generateKey(
        {
          name: "RSA-OAEP",
          modulusLength: 3072,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        false,
        ["encrypt", "decrypt"],
      );
      const publicKey = toBase64(
        await crypto.subtle.exportKey("spki", keys.publicKey),
      );
      const job = await walletRequest<{ job_id: string }>(
        "custody-export-prepare",
        { wallet_id: walletId, public_key: publicKey, acknowledged: true },
        abort.signal,
      );
      let ready = false;
      for (let i = 0; i < 35 && !abort.signal.aborted; i++) {
        const status = await walletRequest<{ state: string }>(
          `custody-export-status?job_id=${job.job_id}`,
          undefined,
          abort.signal,
        );
        if (status.state === "ready") {
          ready = true;
          break;
        }
        if (["failed", "expired", "consumed"].includes(status.state))
          throw new Error("Экспорт недоступен. Повторите запрос.");
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2000);
          abort.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
      if (abort.signal.aborted) return;
      if (!ready)
        throw new Error(
          "Подготовка заняла слишком много времени. Повторите запрос.",
        );
      const result = await walletRequest<{
        job_id: string;
        ciphertext: string;
      }>("custody-export-reveal", { job_id: job.job_id }, abort.signal);
      const plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "RSA-OAEP" },
          keys.privateKey,
          fromBase64(result.ciphertext),
        ),
      );
      try {
        const value = JSON.parse(new TextDecoder().decode(plaintext));
        if (
          result.job_id !== job.job_id ||
          value.job_id !== job.job_id ||
          value.wallet_id !== walletId ||
          value.network !== network ||
          value.address !== address ||
          !/^[a-f0-9]{64}$/.test(value.private_key)
        )
          throw new Error("Не удалось проверить экспорт ключа");
        if (!abort.signal.aborted) setSecret(value.private_key);
      } finally {
        plaintext.fill(0);
      }
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "Не удалось получить ключ");
    } finally {
      if (!abort.signal.aborted) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  if (!["ETH", "BSC"].includes(network)) return null;
  return (
    <section
      className="rounded-[28px] bg-white p-5 dark:bg-[#1c1c1e]"
      aria-label="Экспорт собственного кошелька"
    >
      {!open ? (
        <button
          type="button"
          className="flex min-h-11 w-full items-center gap-3 text-primary"
          onClick={() => setOpen(true)}
        >
          <KeyRound size={21} />
          Экспорт приватного ключа
        </button>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">Импорт в MetaMask</h3>
            <button
              aria-label="Закрыть экспорт ключа"
              onClick={clear}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 dark:bg-white/10"
            >
              <X size={18} />
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 opacity-60">
            Ключ даёт полный доступ к этому адресу. Никому его не передавайте.
            Он будет скрыт через 30 секунд или при сворачивании приложения.
          </p>
          {!secret && (
            <>
              <label className="mt-4 flex items-start gap-3 text-sm leading-5">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-blue-500"
                  checked={acknowledged}
                  disabled={busy}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                Я понимаю, что владелец ключа может распоряжаться всеми
                средствами этого адреса.
              </label>
              <Button
                large
                rounded
                data-wpay-primary=""
                className="!mt-4"
                disabled={!acknowledged || busy}
                onClick={() => void reveal()}
              >
                {busy ? <Preloader size={20} color="white" /> : "Показать ключ"}
              </Button>
              <p className="mt-3 text-xs leading-5 opacity-50">
                Для экспорта нужен вход через Telegram не старше двух минут. При
                необходимости закройте и заново откройте миниапку.
              </p>
            </>
          )}
          {secret && (
            <>
              <p
                className="mt-4 break-all rounded-2xl bg-black/5 p-4 font-mono text-sm select-text dark:bg-white/10"
                data-private-key=""
              >
                {secret}
              </p>
              <Button
                large
                rounded
                data-wpay-primary=""
                className="!mt-4"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(secret)
                    .then(() => setCopied(true))
                    .catch(() => setError("Не удалось скопировать ключ"));
                }}
              >
                <span className="flex items-center gap-2">
                  <Copy size={18} />
                  {copied ? "Скопировано" : "Скопировать ключ"}
                </span>
              </Button>
              <p className="mt-3 text-xs leading-5 opacity-60">
                MetaMask → Добавить аккаунт → Импортировать → Приватный ключ.
                Для BSC выберите сеть BNB Smart Chain.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-500">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
