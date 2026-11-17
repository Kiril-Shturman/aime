import { useState } from "react";
import { useKeyboardFormScroll } from "../wallet/useKeyboardFormScroll";
import { List, ListInput } from "framework7-react";
import { Button } from "konsta/react";
import { FileText, Fingerprint, ScanFace, ScanLine } from "lucide-react";
import type { useAuraProfile } from "../wallet/useAuraProfile";
import passportArtwork from "../assets/verification/passport.webp";
import kycArtwork from "../assets/verification/kyc-document.webp";

const fields = [
  ["last_name", "Фамилия", "text"],
  ["first_name", "Имя", "text"],
  ["patronymic", "Отчество (если есть)", "text"],
  ["birth_date", "Дата рождения", "date"],
  ["passport", "Серия и номер паспорта", "text"],
  ["passport_issue_date", "Дата выдачи паспорта", "date"],
] as const;

export default function WalletVerificationIdentity({
  aura,
}: {
  aura: ReturnType<typeof useAuraProfile>;
}) {
  const formRef = useKeyboardFormScroll();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const canSubmit =
    reviewed &&
    fields.every(
      ([name]) => name === "patronymic" || Boolean(values[name]?.trim()),
    );

  return (
    <section
      className="wpay-verification wpay-verification-contacts"
      aria-label="Документы для верификации"
    >
      <form
        ref={formRef}
        className="wpay-verification-contact-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!reviewed) return;
          const body = Object.fromEntries(
            Object.entries(values)
              .map(([k, v]) => [k, v.trim()])
              .filter(([, v]) => v),
          );
          body.passport = (body.passport || "").replace(/\s/g, "");
          if (!/^\d{10}$/.test(body.passport)) {
            setError("Укажите 4 цифры серии и 6 цифр номера паспорта.");
            return;
          }
          if (
            body.passport_issue_date <= body.birth_date ||
            body.passport_issue_date > new Date().toISOString().slice(0, 10)
          ) {
            setError("Проверьте дату рождения и дату выдачи паспорта.");
            return;
          }
          setError("");
          await aura.submitIdentity(body);
        }}
      >
        <div className="wpay-verification-contact-body wpay-verification-identity-body">
          <div className="wpay-passport-scene" aria-hidden="true">
            <span className="wpay-passport-halo" />
            <span className="wpay-passport-scan-frame" />
            <img
              className="wpay-passport-original"
              src={passportArtwork}
              width={600}
              height={833}
              alt=""
            />
            <img
              className="wpay-passport-kyc-document"
              src={kycArtwork}
              width={1086}
              height={1448}
              alt=""
            />
            <span className="wpay-passport-orbit wpay-passport-orbit--one">
              <ScanLine />
            </span>
            <span className="wpay-passport-orbit wpay-passport-orbit--two">
              <FileText />
            </span>
            <span className="wpay-passport-orbit wpay-passport-orbit--three">
              <Fingerprint />
            </span>
            <span className="wpay-passport-orbit wpay-passport-orbit--four">
              <ScanFace />
            </span>
            <span className="wpay-passport-orbit wpay-passport-orbit--five">
              <FileText />
            </span>
          </div>
          <div className="wpay-verification-contact-copy">
            <h2>Данные паспорта</h2>
            <p>Введите данные точно как в паспорте.</p>
          </div>
          <List
            strong
            inset
            dividers
            className="profile-input-list wpay-verification-contact-inputs"
          >
            {fields.map(([name, label, type]) => (
              <ListInput
                key={name}
                inputId={`identity-${name}`}
                label={label}
                name={name}
                type={type}
                value={values[name] || ""}
                required={name !== "patronymic"}
                autocomplete="off"
                disabled={aura.busy}
                maxlength={name === "passport" ? 16 : 100}
                pattern={
                  type === "text" && name !== "passport"
                    ? "[А-Яа-яЁё -]+"
                    : undefined
                }
                onInput={(event) => {
                  setReviewed(false);
                  setValues((current) => ({
                    ...current,
                    [name]: event.target.value,
                  }));
                }}
              />
            ))}
          </List>
          <label className="wpay-passport-confirm">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={aura.busy}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            <span>Я проверил(а) данные — всё совпадает с паспортом</span>
          </label>
          {(error || aura.error) && (
            <p
              role="alert"
              className="px-6 text-sm text-red-600 dark:text-red-400"
            >
              {error || aura.error}
            </p>
          )}
        </div>
        {canSubmit && (
          <div className="wpay-verification-footer">
            <Button
              type="submit"
              data-wpay-primary=""
              rounded
              className="!m-0 !w-full"
              disabled={aura.busy || !reviewed || !aura.available}
            >
              {aura.busy ? "Отправляем…" : "Отправить на проверку"}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}
