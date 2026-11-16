import { useEffect, useRef, useState } from "react";
import { List, ListInput } from "framework7-react";
import { Button } from "konsta/react";
import {
  FileText,
  Fingerprint,
  ScanFace,
  LockKeyhole,
  ScanLine,
  X,
} from "lucide-react";
import CameraFill from "framework7-icons/react/esm/CameraFill.js";
import PhotoFill from "framework7-icons/react/esm/PhotoFill.js";
import type { useAuraProfile } from "../wallet/useAuraProfile";

import passportArtwork from "../assets/verification/passport.webp";
import { recognizePassport } from "../wallet/recognize-passport";

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
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const canSubmit =
    reviewed &&
    fields.every(
      ([name]) => name === "patronymic" || Boolean(values[name]?.trim()),
    );
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const job = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      job.current?.abort();
    },
    [],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const cancelScan = () => {
    job.current?.abort();
    job.current = null;
    setScanning(false);
    setNotice("Распознавание отменено. Можно заполнить данные вручную.");
  };
  async function selectPhoto(file?: File) {
    if (!file) return;
    if (
      !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) ||
      file.size > 15 * 1024 * 1024
    ) {
      setError("Выберите фото JPG, PNG или WebP размером до 15 МБ.");
      return;
    }
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    setPreview(URL.createObjectURL(file));
    setError("");
    setNotice("");
    setProgress(0);
    setScanning(true);
    setReviewed(false);
    const timeout = window.setTimeout(() => {
      if (job.current !== controller) return;
      controller.abort();
      job.current = null;
      setScanning(false);
      setNotice(
        "Распознавание заняло слишком много времени. Попробуйте другое фото или введите данные вручную.",
      );
    }, 90000);
    try {
      const found = await recognizePassport(
        file,
        controller.signal,
        setProgress,
      );
      if (controller.signal.aborted || job.current !== controller) return;
      // Preserve edits: a new photo only fills fields that are still empty.
      setValues((current) =>
        Object.fromEntries([
          ...Object.entries(found),
          ...Object.entries(current).filter(([, v]) => v.trim()),
        ]),
      );
      const count = Object.keys(found).length;
      setNotice(
        count
          ? `Найдено полей: ${count}. Сверьте все данные с паспортом и исправьте неточности.`
          : "Не удалось уверенно прочитать поля. Попробуйте фото без бликов или заполните их вручную.",
      );
    } catch {
      if (!controller.signal.aborted && job.current === controller)
        setNotice(
          "Не удалось прочитать фото. Попробуйте JPG или заполните поля вручную.",
        );
    } finally {
      clearTimeout(timeout);
      if (job.current === controller) {
        job.current = null;
        setScanning(false);
      }
    }
  }

  return (
    <section
      className="wpay-verification wpay-verification-contacts"
      aria-label="Документы для верификации"
    >
      <form
        className="wpay-verification-contact-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (scanning || !reviewed) return;
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
            <img src={passportArtwork} width={600} height={833} alt="" />
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
            <p>
              Сфотографируйте разворот с фото и данными. Мы поможем заполнить
              поля — останется проверить.
            </p>
          </div>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            aria-label="Сфотографировать паспорт"
            onChange={(event) => {
              void selectPhoto(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <input
            ref={uploadRef}
            type="file"
            accept="image/*"
            hidden
            aria-label="Загрузить фото паспорта"
            onChange={(event) => {
              void selectPhoto(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className="wpay-passport-photo-actions">
            {[
              {
                label: "Сфотографировать",
                icon: CameraFill,
                target: cameraRef,
              },
              { label: "Загрузить фото", icon: PhotoFill, target: uploadRef },
            ].map(({ label, icon: Icon, target }) => (
              <Button
                key={label}
                type="button"
                clear
                rounded
                disabled={scanning || aura.busy}
                className="!m-0 !h-[62px] !min-w-0 !rounded-[22px] !bg-black/[.055] !px-1 !text-primary active:!bg-black/10 dark:!bg-white/[.10] dark:active:!bg-white/[.16]"
                onClick={() => target.current?.click()}
              >
                <span className="flex min-w-0 flex-col items-center justify-center gap-1">
                  <Icon className="text-[22px]" />
                  <span className="w-full truncate text-[10px] font-medium leading-none normal-case">
                    {label}
                  </span>
                </span>
              </Button>
            ))}
          </div>
          <button
            type="button"
            className="wpay-passport-manual"
            onClick={() => {
              if (scanning) cancelScan();
              formRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
              document
                .getElementById("identity-last_name")
                ?.focus({ preventScroll: true });
            }}
          >
            Ввести вручную
          </button>
          {preview && (
            <div className="wpay-passport-photo-review">
              <img src={preview} alt="Выбранное фото паспорта" />
              <button
                type="button"
                aria-label="Удалить фото"
                onClick={() => {
                  if (scanning) cancelScan();
                  setPreview("");
                }}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {scanning && (
            <div className="wpay-passport-progress" role="status">
              <div>
                <span>Распознаём на устройстве…</span>
                <button type="button" onClick={cancelScan}>
                  Отмена
                </button>
              </div>
              <progress
                max={100}
                value={progress}
                aria-label="Распознавание паспорта"
              />
            </div>
          )}
          {notice && (
            <p className="wpay-passport-notice" role="status">
              {notice}
            </p>
          )}
          <div ref={formRef} className="wpay-passport-fields-heading">
            Проверьте данные
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
                disabled={aura.busy || scanning}
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
              disabled={scanning || aura.busy}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            <span>Я проверил(а) данные — всё совпадает с паспортом</span>
          </label>
          <p className="wpay-verification-contact-note">
            <LockKeyhole size={16} /> Фото распознаётся на устройстве. В API
            отправятся только проверенные вами поля.
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
        {canSubmit && (
          <div className="wpay-verification-footer">
            <Button
              type="submit"
              data-wpay-primary=""
              rounded
              className="!m-0 !w-full"
              disabled={aura.busy || scanning || !reviewed || !aura.available}
            >
              {aura.busy ? "Отправляем…" : "Отправить на проверку"}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}
