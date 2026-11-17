import { useState } from "react";
import "framework7/components/preloader/css";
import { useKeyboardFormScroll } from "../wallet/useKeyboardFormScroll";
import WalletVerificationIdentity from "./WalletVerificationIdentity";
import telephoneArtwork from "../assets/verification/telephone.webp";
import mailboxArtwork from "../assets/verification/mailbox-envelope.webp";
import passportArtwork from "../assets/verification/passport.webp";
import cardArtwork from "../assets/verification/wpay-card.webp";
import { List, ListInput, Preloader } from "framework7-react";
import { Button } from "konsta/react";
import {
  Check,
  RefreshCw,
  LockKeyhole,
  ArrowUpRight,
  Mail,
  AtSign,
  Ban,
  MessageCircle,
} from "lucide-react";
import type { useAuraProfile } from "../wallet/useAuraProfile";
import "./WalletVerification.css";

export function preloadVerificationArtwork() {
  for (const src of [
    passportArtwork,
    cardArtwork,
    mailboxArtwork,
    telephoneArtwork,
  ]) {
    const image = new Image();
    image.src = src;
    void image.decode().catch(() => {});
  }
}

type Props = {
  aura: ReturnType<typeof useAuraProfile>;
  onPersonal: () => void;
  onSupport?: () => void;
  contacts: boolean;
  onContacts: () => void;
};
export default function WalletVerification({
  aura,
  onPersonal,
  onSupport,
  contacts,
  onContacts,
}: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const refreshStatus = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await aura.refresh();
    } finally {
      setRefreshing(false);
    }
  };
  const verified = Boolean(aura.kyc?.verified);
  const pending = ["pending", "in_review"].includes(aura.kyc?.status || "");
  const rejected = aura.kyc?.status === "rejected";
  const contactFormRef = useKeyboardFormScroll(
    contacts && !aura.sessionOpen && !verified && !pending && !rejected,
  );
  if (aura.sessionOpen && !verified)
    return <WalletVerificationIdentity aura={aura} />;
  if (contacts && !verified && !pending && !rejected)
    return (
      <section
        className="wpay-verification wpay-verification-contacts"
        aria-label="Контакты для верификации"
      >
        <form
          ref={contactFormRef}
          className="wpay-verification-contact-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await aura.save()) await aura.start();
          }}
        >
          <div className="wpay-verification-contact-body">
            <div className="wpay-contact-mail-scene" aria-hidden="true">
              <span className="wpay-contact-mail-glow" />
              <div className="wpay-contact-mailbox">
                <img
                  src={mailboxArtwork}
                  width={520}
                  height={620}
                  decoding="async"
                  fetchPriority="high"
                  alt=""
                />
                <img
                  className="wpay-contact-mailbox-logo"
                  src="/brands/wpay-wordmark.svg"
                  alt=""
                />
              </div>
              <img
                className="wpay-contact-telephone"
                src={telephoneArtwork}
                width={600}
                height={510}
                decoding="async"
                fetchPriority="high"
                alt=""
              />
              <span className="wpay-contact-letter wpay-contact-letter--one">
                <Mail />
              </span>
              <span className="wpay-contact-letter wpay-contact-letter--two">
                <Mail />
              </span>
              <span className="wpay-contact-letter wpay-contact-letter--three">
                <Mail />
              </span>
              <span className="wpay-contact-letter wpay-contact-letter--four">
                <Mail />
              </span>
              <span className="wpay-contact-letter wpay-contact-letter--five">
                <Mail />
              </span>
              <span className="wpay-contact-mail-at">
                <AtSign />
              </span>
            </div>
            <div className="wpay-verification-contact-copy">
              <h2>Ваши контакты</h2>
              <p>
                Добавьте номер телефона и электронную почту. Затем перейдём к
                проверке документов.
              </p>
            </div>
            <List
              strong
              inset
              dividers
              className="profile-input-list wpay-verification-contact-inputs"
            >
              <ListInput
                label="Номер телефона"
                inputId="verification-phone"
                type="tel"
                name="tel"
                autocomplete="tel"
                placeholder="+7 999 123-45-67"
                value={aura.phone || "+7"}
                maxlength={32}
                disabled={aura.busy}
                onInput={(event) => aura.setPhone(event.target.value)}
              />
              <ListInput
                label="Электронная почта"
                inputId="verification-email"
                type="email"
                name="email"
                autocomplete="email"
                placeholder="name@example.com"
                value={aura.email}
                maxlength={254}
                disabled={aura.busy}
                onInput={(event) => aura.setEmail(event.target.value)}
              />
            </List>
            <p className="wpay-verification-contact-note">
              <LockKeyhole size={16} /> Контакты сохранятся в вашем профиле.
            </p>
            {aura.error && (
              <p
                role="alert"
                className="px-6 text-sm text-red-600 dark:text-red-400"
              >
                {aura.error}
              </p>
            )}
            {aura.sessionUrl && (
              <button
                type="button"
                className="wpay-verification-text-action mx-6"
                onClick={aura.resumeSession}
              >
                Продолжить проверку <ArrowUpRight size={16} />
              </button>
            )}
          </div>
          {aura.email.trim().length <= 254 &&
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(aura.email.trim()) && (
              <div className="wpay-verification-footer">
                <Button
                  type="submit"
                  data-wpay-primary=""
                  rounded
                  disabled={aura.busy || aura.loading || !aura.available}
                  className="!m-0 !w-full"
                >
                  {aura.busy ? "Подготавливаем…" : "Продолжить"}
                </Button>
              </div>
            )}
        </form>
      </section>
    );
  return (
    <section
      className={`wpay-verification${rejected ? " wpay-verification--issue" : ""}`}
      aria-label="Проверка личности"
    >
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
            src={passportArtwork}
            width={600}
            height={833}
            decoding="async"
            fetchPriority="high"
            alt=""
            draggable={false}
          />
          <img
            className="wpay-verification-card"
            src={cardArtwork}
            width={1000}
            height={627}
            decoding="async"
            fetchPriority="high"
            alt=""
            draggable={false}
          />
          <span
            className={`wpay-verification-seal${rejected ? " wpay-verification-seal--rejected" : ""}`}
          >
            {rejected ? <Ban strokeWidth={3} /> : <Check strokeWidth={3.5} />}
          </span>
          <span className="wpay-verification-spark wpay-verification-spark--one" />
          <span className="wpay-verification-spark wpay-verification-spark--two" />
        </div>
        <div className="wpay-verification-copy">
          {!rejected && (
            <span className="wpay-verification-eyebrow">
              ВАША ЛИЧНОСТЬ. ВАШИ ВОЗМОЖНОСТИ.
            </span>
          )}
          <h2>
            {verified
              ? "Личность подтверждена"
              : rejected
                ? "Проверка не пройдена"
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
                    ? "Поможем разобраться в поддержке. Повторно отправлять документы не нужно."
                    : "Подтвердите личность, чтобы пользоваться всеми возможностями wPay."}
          </p>
          {rejected && (
            <VerificationIssue
              reason={aura.kyc?.reason}
              diagnostic={aura.error}
            />
          )}
          {!verified && !pending && !rejected && (
            <p className="wpay-verification-guidance">
              Сохраните телефон и почту в личных данных, затем подтвердите
              документы в защищённой форме.
            </p>
          )}
          {!rejected && (
            <span className="wpay-verification-trust">
              <LockKeyhole size={14} /> Защищённая форма проверки
            </span>
          )}
          {aura.error && !rejected && (
            <p role="alert" className="wpay-verification-error">
              {aura.error}
            </p>
          )}
          {aura.sessionUrl && (
            <button
              type="button"
              className="wpay-verification-text-action"
              onClick={aura.resumeSession}
            >
              Продолжить проверку <ArrowUpRight size={16} />
            </button>
          )}
          <div className="wpay-verification-links">
            {!verified && !rejected && (
              <button type="button" onClick={onPersonal}>
                Личные данные
              </button>
            )}
            {aura.available && (
              <button
                type="button"
                disabled={aura.loading || aura.busy || refreshing}
                aria-busy={refreshing}
                onClick={() => void refreshStatus()}
              >
                {refreshing ? <Preloader size={13} /> : <RefreshCw size={13} />}{" "}
                Обновить статус
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="wpay-verification-footer">
        {rejected ? (
          <Button
            data-wpay-primary=""
            rounded
            className="!m-0 !w-full"
            disabled={!onSupport && refreshing}
            aria-busy={!onSupport && refreshing}
            onClick={onSupport || (() => void refreshStatus())}
          >
            <span className="wpay-verification-button-content">
              {onSupport && <MessageCircle size={20} aria-hidden="true" />}
              {onSupport ? "Связаться с поддержкой" : "Обновить статус"}
            </span>
          </Button>
        ) : !verified ? (
          <Button
            data-wpay-primary=""
            rounded
            disabled={
              !aura.available ||
              aura.loading ||
              aura.busy ||
              pending ||
              Boolean(aura.kyc?.terminal)
            }
            className="!m-0 !w-full"
            onClick={onContacts}
          >
            <span className="wpay-verification-button-content">
              <span>
                {aura.busy
                  ? "Подготавливаем…"
                  : pending
                    ? "На проверке"
                    : "Начать"}
              </span>
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

function VerificationIssue({
  reason,
  diagnostic,
}: {
  reason?: string | null;
  diagnostic?: string;
}) {
  const passportFailed = /PassportFailed/i.test(reason || "");
  const alreadyUsed = /already_used|already_verified/i.test(reason || "");
  const locked = /identity_locked/i.test(reason || "");
  const title = alreadyUsed
    ? "Паспорт уже используется"
    : passportFailed
      ? "Паспорт не прошёл проверку"
      : locked
        ? "Данные нельзя изменить самостоятельно"
        : "Нужна помощь с проверкой";
  const description = alreadyUsed
    ? "Этот паспорт связан с другим профилем. Поддержка поможет разобраться."
    : locked
      ? "Паспортные данные уже переданы. Уточнить причину отказа и внести изменения можно через поддержку."
      : "Сервис проверки не подтвердил данные. Обратитесь в поддержку, чтобы уточнить причину и дальнейшие шаги.";
  return (
    <div className="wpay-verification-issue" role="alert">
      <div className="wpay-verification-issue-heading">
        <span className="wpay-verification-issue-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" clipRule="evenodd" d="M10.34 3.94c.77-1.333 2.55-1.333 3.32 0l7.82 13.55c.77 1.334-.192 3-1.731 3H4.25c-1.54 0-2.502-1.666-1.732-3l7.82-13.55ZM12 8a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 12 8Zm0 8.5a1 1 0 1 0 0-2a1 1 0 0 0 0 2Z" />
          </svg>
        </span>
        <h3>{title}</h3>
      </div>
      <p>{description}</p>
      {(reason || diagnostic) && (
        <details className="wpay-verification-diagnostics">
          <summary>Данные для поддержки</summary>
          {reason && (
            <p>
              <span>Код проверки</span>
              <code>{reason}</code>
            </p>
          )}
          {diagnostic && (
            <p className="wpay-verification-diagnostic-message">{diagnostic}</p>
          )}
        </details>
      )}
    </div>
  );
}
