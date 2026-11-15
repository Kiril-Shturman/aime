import { Button } from "konsta/react";
import {
  Flag,
  Check,
  LockKeyhole,
  ArrowUpRight,
  RefreshCw,
} from "lucide-react";
import type { useAuraProfile } from "../wallet/useAuraProfile";
import "./WalletVerification.css";

type Props = {
  aura: ReturnType<typeof useAuraProfile>;
  onPersonal: () => void;
};
export default function WalletVerification({ aura, onPersonal }: Props) {
  const verified = Boolean(aura.kyc?.verified);
  const pending = ["pending", "in_review"].includes(aura.kyc?.status || "");
  const rejected = aura.kyc?.status === "rejected";
  return (
    <section className="wpay-verification" aria-label="Проверка личности">
      <div className="wpay-verification-body">
        <div className="wpay-verification-scene" aria-hidden="true">
          <div className="wpay-verification-glow" />
          <span className="wpay-verification-currency wpay-verification-currency--dollar">
            $
          </span>
          <span className="wpay-verification-currency wpay-verification-currency--ruble">
            ₽
          </span>
          <span className="wpay-verification-currency wpay-verification-currency--euro">
            €
          </span>
          <img
            className="wpay-verification-passport"
            src="/verification/passport.png"
            alt=""
            draggable={false}
          />
          <img
            className="wpay-verification-card"
            src="/verification/wpay-card.png"
            alt=""
            draggable={false}
          />
          <span className="wpay-verification-seal">
            <Check strokeWidth={3.5} />
          </span>
          <span className="wpay-verification-spark wpay-verification-spark--one" />
          <span className="wpay-verification-spark wpay-verification-spark--two" />
        </div>
        <div className="wpay-verification-copy">
          <span className="wpay-verification-eyebrow">
            ВАША ЛИЧНОСТЬ. ВАШИ ВОЗМОЖНОСТИ.
          </span>
          <h2>
            {verified
              ? "Личность подтверждена"
              : "Больше доверия.\nБольше возможностей."}
          </h2>
          <p role="status">
            {aura.loading
              ? "Проверяем статус…"
              : verified
                ? "Проверка успешно пройдена. Всё готово к следующему шагу."
                : pending
                  ? "Документы на проверке. Мы обновим статус, когда проверка завершится."
                  : rejected
                    ? "Проверка не пройдена. Обратитесь в поддержку, если нужна помощь."
                    : "Подтвердите личность, чтобы пользоваться всеми доступными возможностями WPay."}
          </p>
          <span className="wpay-verification-trust">
            <LockKeyhole size={14} /> Защищённая форма проверки
          </span>
          {aura.error && (
            <p role="alert" className="wpay-verification-error">
              {aura.error}
            </p>
          )}
          {aura.sessionUrl && (
            <a
              className="wpay-verification-text-action"
              href={aura.sessionUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Продолжить проверку <ArrowUpRight size={16} />
            </a>
          )}
          <div className="wpay-verification-links">
            {!verified && (
              <button type="button" onClick={onPersonal}>
                Личные данные
              </button>
            )}
            {aura.available && (
              <button
                type="button"
                disabled={aura.loading || aura.busy}
                onClick={() => void aura.refresh()}
              >
                <RefreshCw size={13} /> Обновить статус
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="wpay-verification-footer">
        {!verified ? (
          <Button
            data-wpay-primary=""
            rounded
            disabled={
              !aura.available ||
              aura.loading ||
              aura.busy ||
              Boolean(aura.kyc?.terminal)
            }
            className="!m-0 !w-full"
            onClick={() => void aura.start()}
          >
            <span className="wpay-verification-button-content">
              <Flag size={20} fill="currentColor" strokeWidth={1.6} />
              <span>{aura.busy ? "Подготавливаем…" : "Пройти"}</span>
            </span>
          </Button>
        ) : (
          <span className="wpay-verification-complete">
            <Check size={20} /> Проверка пройдена
          </span>
        )}
      </div>
    </section>
  );
}
