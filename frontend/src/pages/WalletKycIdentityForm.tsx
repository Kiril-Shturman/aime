import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "konsta/react";
import { getUser } from "../lib/telegram";
import type { KycIdentityInput } from "../wallet/useAuraProfile";
import "./WalletKycIdentityForm.css";

type Props = {
  busy: boolean;
  disabled: boolean;
  error: string;
  submit: (identity: KycIdentityInput) => Promise<boolean>;
};

const cyrillicName = /^[А-Яа-яЁё -]+$/;
const today = () => new Date().toISOString().slice(0, 10);
const passportDigits = (value: string) => value.replace(/\D/g, "").slice(0, 10);
const formatPassport = (value: string) => {
  const digits = passportDigits(value);
  return digits.length > 4
    ? `${digits.slice(0, 4)} ${digits.slice(4)}`
    : digits;
};

export default function WalletKycIdentityForm({
  busy,
  disabled,
  error,
  submit,
}: Props) {
  const user = getUser();
  const initialFirstName = cyrillicName.test(user?.first_name || "")
    ? user?.first_name || ""
    : "";
  const initialLastName = cyrillicName.test(user?.last_name || "")
    ? user?.last_name || ""
    : "";
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [patronymic, setPatronymic] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [passport, setPassport] = useState("");
  const [passportIssueDate, setPassportIssueDate] = useState("");
  const [inn, setInn] = useState("");
  const [consent, setConsent] = useState(false);
  const [localError, setLocalError] = useState("");
  const maxDate = useMemo(today, []);

  const validate = () => {
    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();
    const cleanPatronymic = patronymic.trim();
    const cleanInn = inn.replace(/\D/g, "");
    if (!cyrillicName.test(cleanLastName) || cleanLastName.length > 100)
      return "Укажите фамилию кириллицей, как в паспорте.";
    if (!cyrillicName.test(cleanFirstName) || cleanFirstName.length > 100)
      return "Укажите имя кириллицей, как в паспорте.";
    if (
      cleanPatronymic &&
      (!cyrillicName.test(cleanPatronymic) || cleanPatronymic.length > 100)
    )
      return "Проверьте отчество.";
    if (!birthDate || birthDate >= maxDate)
      return "Укажите корректную дату рождения.";
    if (passportDigits(passport).length !== 10)
      return "Серия и номер паспорта должны содержать 10 цифр.";
    if (
      !passportIssueDate ||
      passportIssueDate <= birthDate ||
      passportIssueDate > maxDate
    )
      return "Проверьте дату выдачи паспорта.";
    if (cleanInn && cleanInn.length !== 12)
      return "ИНН физического лица должен содержать 12 цифр.";
    if (!consent)
      return "Подтвердите передачу данных в Aura для проверки личности.";
    return "";
  };

  const send = async () => {
    const problem = validate();
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError("");
    const identity: KycIdentityInput = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      birth_date: birthDate,
      passport: passportDigits(passport),
      passport_issue_date: passportIssueDate,
      country_of_passport_issue: "RUS",
    };
    if (patronymic.trim()) identity.patronymic = patronymic.trim();
    if (inn.replace(/\D/g, "")) identity.inn = inn.replace(/\D/g, "");
    if (await submit(identity)) {
      setPassport("");
      setInn("");
      setConsent(false);
    }
  };

  const blocked = disabled || busy;
  const shownError = localError || error;
  const input = (
    label: string,
    value: string,
    setValue: (value: string) => void,
    options: {
      type?: string;
      inputMode?: "text" | "numeric";
      placeholder?: string;
      maxLength?: number;
      required?: boolean;
      max?: string;
    } = {},
  ) => (
    <label className="wpay-kyc-field">
      <span>
        {label}
        {options.required && <b aria-hidden="true"> *</b>}
      </span>
      <input
        type={options.type || "text"}
        inputMode={options.inputMode}
        autoComplete="off"
        data-lpignore="true"
        placeholder={options.placeholder}
        maxLength={options.maxLength}
        max={options.max}
        value={value}
        disabled={blocked}
        required={options.required}
        onChange={(event) => {
          setValue(event.target.value);
          setLocalError("");
        }}
      />
    </label>
  );

  return (
    <form
      className="wpay-kyc-form"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className="wpay-kyc-section">
        <h3>Данные владельца</h3>
        {input("Фамилия", lastName, setLastName, {
          placeholder: "Иванов",
          maxLength: 100,
          required: true,
        })}
        {input("Имя", firstName, setFirstName, {
          placeholder: "Иван",
          maxLength: 100,
          required: true,
        })}
        {input("Отчество", patronymic, setPatronymic, {
          placeholder: "Иванович, если есть",
          maxLength: 100,
        })}
        {input("Дата рождения", birthDate, setBirthDate, {
          type: "date",
          required: true,
          max: maxDate,
        })}
      </div>

      <div className="wpay-kyc-section">
        <h3>Паспорт РФ</h3>
        <label className="wpay-kyc-field">
          <span>
            Серия и номер<b aria-hidden="true"> *</b>
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            data-lpignore="true"
            placeholder="4510 123456"
            maxLength={11}
            value={passport}
            disabled={blocked}
            required
            onChange={(event) => {
              setPassport(formatPassport(event.target.value));
              setLocalError("");
            }}
          />
        </label>
        {input("Дата выдачи", passportIssueDate, setPassportIssueDate, {
          type: "date",
          required: true,
          max: maxDate,
        })}
        <label className="wpay-kyc-field">
          <span>ИНН</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            data-lpignore="true"
            placeholder="12 цифр, если есть"
            maxLength={12}
            value={inn}
            disabled={blocked}
            onChange={(event) => {
              setInn(event.target.value.replace(/\D/g, "").slice(0, 12));
              setLocalError("");
            }}
          />
        </label>
      </div>

      <label className="wpay-kyc-consent">
        <input
          type="checkbox"
          checked={consent}
          disabled={blocked}
          onChange={(event) => {
            setConsent(event.target.checked);
            setLocalError("");
          }}
        />
        <span>
          Я подтверждаю корректность данных и согласен на их передачу в Aura для
          проверки личности.
        </span>
      </label>

      {shownError && (
        <p className="wpay-kyc-error" role="alert">
          {shownError}
        </p>
      )}

      <Button
        data-wpay-primary=""
        rounded
        large
        type="submit"
        disabled={blocked}
        className="!m-0 !w-full !rounded-[22px]"
      >
        {busy ? "Отправляем…" : "Отправить на проверку"}
      </Button>

      <p className="wpay-kyc-secure">
        <ShieldCheck size={16} />
        Паспортные данные передаются напрямую в Aura по защищённому API и не
        сохраняются в базе WPay.
      </p>
    </form>
  );
}
