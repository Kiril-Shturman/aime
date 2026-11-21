import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Mail, Phone, ShieldCheck } from "lucide-react";
import { Button } from "konsta/react";
import "./WalletContactOnboarding.css";

type ContactStep = "email" | "phone";

type Props = {
  email: string;
  phone: string;
  setEmail: (value: string) => void;
  setPhone: (value: string) => void;
  loading: boolean;
  busy: boolean;
  available: boolean;
  error: string;
  save: () => Promise<boolean>;
  onComplete: () => void;
};

const validEmail = (value: string) =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const cleanPhone = (value: string) => {
  const compact = value.replace(/[\s()\-]/g, "");
  return /^8\d{10}$/.test(compact) ? `+7${compact.slice(1)}` : compact;
};

function WPayMark() {
  return (
    <span className="wpay-contact-brand" aria-label="WPay">
      <img src="/brands/wpay-wordmark.svg" alt="" />
    </span>
  );
}

export default function WalletContactOnboarding({
  email,
  phone,
  setEmail,
  setPhone,
  loading,
  busy,
  available,
  error,
  save,
  onComplete,
}: Props) {
  const [step, setStep] = useState<ContactStep>("email");
  const [localError, setLocalError] = useState("");
  const normalizedPhone = useMemo(() => cleanPhone(phone), [phone]);

  useEffect(() => setLocalError(""), [step]);

  const next = () => {
    const value = email.trim();
    if (!validEmail(value)) {
      setLocalError("Проверь адрес — похоже, в нём есть опечатка.");
      return;
    }
    setEmail(value);
    setStep("phone");
  };

  const finish = async () => {
    if (!/^\+7\d{10}$/.test(normalizedPhone)) {
      setLocalError("Укажи российский номер в формате +7 999 123-45-67.");
      return;
    }
    setPhone(normalizedPhone);
    if (await save()) onComplete();
  };

  const blocked = loading || busy || !available;
  const message = localError || error;

  return (
    <section className={`wpay-contact-flow wpay-contact-flow--${step}`}>
      <header className="wpay-contact-topbar">
        {step === "phone" ? (
          <button
            type="button"
            className="wpay-contact-back"
            aria-label="Вернуться к почте"
            onClick={() => setStep("email")}
          >
            <ArrowLeft size={20} />
          </button>
        ) : (
          <span className="wpay-contact-back-spacer" />
        )}
        <WPayMark />
        <span className="wpay-contact-step">
          {step === "email" ? "1" : "2"}/2
        </span>
      </header>

      <div className="wpay-contact-visual" aria-hidden="true">
        <span className="wpay-contact-orbit wpay-contact-orbit--one" />
        <span className="wpay-contact-orbit wpay-contact-orbit--two" />
        <img
          src={
            step === "email"
              ? "/wallet/contact-mailbox.jpg"
              : "/wallet/contact-phone.jpg"
          }
          alt=""
          draggable={false}
        />
        {step === "email" ? (
          <>
            <span className="wpay-contact-fly wpay-contact-fly--mail-one">
              <Mail size={20} />
            </span>
            <span className="wpay-contact-fly wpay-contact-fly--mail-two">
              <Mail size={16} />
            </span>
            <span className="wpay-contact-fly wpay-contact-fly--mail-three">
              @
            </span>
          </>
        ) : (
          <>
            <span className="wpay-contact-fly wpay-contact-fly--phone-one">
              <Phone size={18} />
            </span>
            <span className="wpay-contact-fly wpay-contact-fly--phone-two">
              +7
            </span>
            <span className="wpay-contact-signal wpay-contact-signal--one" />
            <span className="wpay-contact-signal wpay-contact-signal--two" />
          </>
        )}
      </div>

      <div className="wpay-contact-copy">
        <span className="wpay-contact-kicker">
          {step === "email" ? <Mail size={15} /> : <Phone size={15} />}
          {step === "email" ? "Электронная почта" : "Номер телефона"}
        </span>
        <h2>
          {step === "email"
            ? "Куда отправлять важное?"
            : "На какой номер привязать СБП?"}
        </h2>
        <p>
          {step === "email"
            ? "Почта нужна для запуска проверки личности и важных уведомлений по кошельку."
            : "Укажи российский номер, с которого будешь оплачивать QR через СБП."}
        </p>
      </div>

      <div className="wpay-contact-form">
        {step === "email" ? (
          <label>
            <span>Почта</span>
            <span className="wpay-contact-input">
              <Mail size={20} />
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                maxLength={254}
                disabled={blocked}
                autoFocus
                onChange={(event) => {
                  setEmail(event.target.value);
                  setLocalError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") next();
                }}
              />
            </span>
          </label>
        ) : (
          <label>
            <span>Телефон</span>
            <span className="wpay-contact-input">
              <span className="wpay-contact-flag">🇷🇺</span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+7 999 123-45-67"
                value={phone}
                maxLength={32}
                disabled={blocked}
                autoFocus
                onChange={(event) => {
                  setPhone(event.target.value);
                  setLocalError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void finish();
                }}
              />
            </span>
          </label>
        )}

        {message && (
          <p className="wpay-contact-error" role="alert">
            {message}
          </p>
        )}

        <Button
          data-wpay-primary=""
          rounded
          large
          disabled={blocked}
          className="wpay-contact-continue !m-0 !w-full !rounded-[22px]"
          onClick={() => (step === "email" ? next() : void finish())}
        >
          {busy
            ? "Сохраняем…"
            : step === "email"
              ? "Продолжить"
              : "Сохранить и пройти проверку"}
          {!busy && <ArrowRight size={19} />}
        </Button>

        <p className="wpay-contact-secure">
          <ShieldCheck size={15} />
          Данные передаются по защищённому соединению
        </p>
      </div>
    </section>
  );
}
