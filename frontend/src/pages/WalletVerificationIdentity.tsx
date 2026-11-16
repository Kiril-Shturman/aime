import { useState } from "react";
import { List, ListInput } from "framework7-react";
import { Button } from "konsta/react";
import { LockKeyhole } from "lucide-react";
import type { useAuraProfile } from "../wallet/useAuraProfile";

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
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  return (
    <section
      className="wpay-verification wpay-verification-contacts"
      aria-label="Документы для верификации"
    >
      <form
        className="wpay-verification-contact-form"
        onSubmit={async (event) => {
          event.preventDefault();
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
          <div className="wpay-verification-contact-copy">
            <h2>Данные паспорта</h2>
            <p>
              Введите данные как в российском паспорте. Мы передадим их для
              проверки через защищённое API.
            </p>
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
                onInput={(event) =>
                  setValues((current) => ({
                    ...current,
                    [name]: event.target.value,
                  }))
                }
              />
            ))}
          </List>
          <p className="wpay-verification-contact-note">
            <LockKeyhole size={16} /> Данные используются для проверки личности.
          </p>
          {(error || aura.error) && (
            <p
              role="alert"
              className="px-6 text-sm text-red-600 dark:text-red-400"
            >
              {error || aura.error}
            </p>
          )}
        </div>
        <div className="wpay-verification-footer">
          <Button
            type="submit"
            data-wpay-primary=""
            rounded
            className="!m-0 !w-full"
            disabled={aura.busy || !aura.available}
          >
            {aura.busy ? "Отправляем…" : "Отправить на проверку"}
          </Button>
        </div>
      </form>
    </section>
  );
}
