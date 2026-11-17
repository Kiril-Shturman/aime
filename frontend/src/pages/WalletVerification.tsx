import { useKeyboardFormScroll } from "../wallet/useKeyboardFormScroll";
import WalletVerificationIdentity from "./WalletVerificationIdentity";
import telephoneArtwork from "../assets/verification/telephone.webp";
import mailboxArtwork from "../assets/verification/mailbox-envelope.webp";
import passportArtwork from "../assets/verification/passport.webp";
import cardArtwork from "../assets/verification/wpay-card.webp";
import { List, ListInput } from "framework7-react";
import { Button } from "konsta/react";
import {
  Check,
  RefreshCw,
  LockKeyhole,
  ArrowUpRight,
  Mail,
  AtSign,
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
  contacts: boolean;
  onContacts: () => void;
};
export default function WalletVerification({
  aura,
  onPersonal,
  contacts,
  onContacts,
}: Props) {
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
                    : "Подтвердите личность, чтобы пользоваться всеми возможностями wPay."}
          </p>
          {rejected && aura.kyc?.reason && (
            <p className="wpay-verification-guidance">Причина: {aura.kyc.reason}</p>
          )}
          {!verified && !pending && !rejected && (
            <p className="wpay-verification-guidance">
              Сохраните телефон и почту в личных данных, затем подтвердите
              документы в защищённой форме.
            </p>
          )}
          <span className="wpay-verification-trust">
            <LockKeyhole size={14} /> Защищённая форма проверки
          </span>
          {aura.error && (
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
