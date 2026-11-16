import { useEffect, useRef, useState } from "react";
import { tg } from "../lib/telegram";
import telephoneArtwork from "../assets/verification/telephone.webp";
import mailboxArtwork from "../assets/verification/mailbox-envelope.webp";
import passportArtwork from "../assets/verification/passport.webp";
import cardArtwork from "../assets/verification/wpay-card.webp";
import { List, ListInput } from "framework7-react";
import { Button } from "konsta/react";
import {
  Check,
  LockKeyhole,
  ArrowUpRight,
  RefreshCw,
  Mail,
  AtSign,
  Camera,
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
function EmbeddedVerification({
  aura,
}: {
  aura: ReturnType<typeof useAuraProfile>;
}) {
  const [loaded, setLoaded] = useState(false);
  const [browserOpened, setBrowserOpened] = useState(false);
  const [frameVersion, setFrameVersion] = useState(0);
  const preferBrowser =
    tg()?.platform === "ios" ||
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const [camera, setCamera] = useState<
    "idle" | "requesting" | "ready" | "denied"
  >("idle");
  const [cameraError, setCameraError] = useState("");
  const active = useRef(true),
    requesting = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function allowCamera() {
    if (requesting.current) return;
    requesting.current = true;
    setCamera("requesting");
    setCameraError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error("unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      // Check permission only. No frames are read, stored or sent by wPay.
      stream.getTracks().forEach((track) => track.stop());
      if (active.current) {
        setLoaded(false);
        setFrameVersion((value) => value + 1);
        setCamera("ready");
      }
    } catch (error) {
      if (active.current) {
        setCamera("denied");
        setCameraError(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Доступ к камере не разрешён. Проверьте разрешение камеры для Telegram в настройках телефона или продолжите проверку в браузере."
            : "Камеру не удалось открыть в этом окне. Попробуйте ещё раз или продолжите проверку в браузере.",
        );
      }
    } finally {
      requesting.current = false;
    }
  }
  function openBrowser() {
    if (tg()?.openLink) tg()?.openLink?.(aura.sessionUrl);
    else window.open(aura.sessionUrl, "_blank", "noopener,noreferrer");
    setBrowserOpened(true);
  }
  return (
    <section
      className="wpay-verification wpay-verification-embedded"
      aria-label="Форма проверки личности"
    >
      <header className="wpay-verification-frame-header">
        <span>
          <LockKeyhole size={15} /> Проверка личности
        </span>
        <span className="wpay-verification-frame-actions">
          {camera === "ready" && (
            <button
              type="button"
              aria-label="Перезапустить камеру"
              onClick={() => {
                setCamera("idle");
                setLoaded(false);
              }}
            >
              <RefreshCw size={15} />
            </button>
          )}
          <button type="button" onClick={openBrowser}>
            В браузере <ArrowUpRight size={14} />
          </button>
        </span>
      </header>
      <div className="wpay-verification-frame-body">
        {camera !== "ready" ? (
          <div className="wpay-verification-camera">
            <span className="wpay-verification-camera-icon">
              <Camera size={32} />
            </span>
            <h2>
              {preferBrowser
                ? "Проверка с доступом к камере"
                : "Для проверки нужна камера"}
            </h2>
            <p>
              {preferBrowser
                ? "В Telegram на iPhone камера во встроенной форме может блокироваться. Продолжите эту же проверку в браузере и разрешите доступ к камере."
                : "Разрешите доступ к фронтальной камере, чтобы сделать селфи в защищённой форме."}
            </p>
            {browserOpened && (
              <p role="status">
                Завершите проверку в браузере и вернитесь в wPay. Статус
                обновится автоматически.
              </p>
            )}
            {cameraError && (
              <p role="alert" className="wpay-verification-error">
                {cameraError}
              </p>
            )}
            <Button
              data-wpay-primary=""
              rounded
              disabled={camera === "requesting"}
              onClick={preferBrowser ? openBrowser : () => void allowCamera()}
            >
              {preferBrowser
                ? "Открыть проверку в браузере"
                : camera === "requesting"
                  ? "Ожидаем разрешение…"
                  : camera === "denied"
                    ? "Повторить запрос камеры"
                    : "Разрешить камеру"}
            </Button>
            <button
              type="button"
              className="wpay-verification-text-action"
              disabled={camera === "requesting"}
              onClick={preferBrowser ? () => void allowCamera() : openBrowser}
            >
              {preferBrowser
                ? camera === "requesting"
                  ? "Ожидаем разрешение…"
                  : "Попробовать внутри Telegram"
                : "Продолжить в браузере"}{" "}
              <ArrowUpRight size={16} />
            </button>
            <span className="wpay-verification-camera-note">
              Если камера не заработает внутри формы, используйте кнопку «В
              браузере» сверху.
            </span>
          </div>
        ) : (
          <>
            {!loaded && (
              <p className="wpay-verification-frame-loading" role="status">
                Загружаем защищённую форму…
              </p>
            )}
            <iframe
              key={frameVersion}
              title="Проверка личности Aura"
              src={aura.sessionUrl}
              allow="camera *; microphone *; fullscreen *"
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
            />
          </>
        )}
      </div>
    </section>
  );
}

export default function WalletVerification({
  aura,
  onPersonal,
  contacts,
  onContacts,
}: Props) {
  const verified = Boolean(aura.kyc?.verified);
  const pending = ["pending", "in_review"].includes(aura.kyc?.status || "");
  const rejected = aura.kyc?.status === "rejected";
  if (aura.sessionOpen && aura.sessionUrl)
    return <EmbeddedVerification key={aura.sessionUrl} aura={aura} />;
  if (contacts && !verified && !rejected)
    return (
      <section
        className="wpay-verification wpay-verification-contacts"
        aria-label="Контакты для верификации"
      >
        <form
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
              Boolean(aura.kyc?.terminal)
            }
            className="!m-0 !w-full"
            onClick={onContacts}
          >
            <span className="wpay-verification-button-content">
              <span>{aura.busy ? "Подготавливаем…" : "Начать"}</span>
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
