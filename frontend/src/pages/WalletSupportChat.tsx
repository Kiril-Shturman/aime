import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  f7,
  Messages,
  Message,
  MessagesTitle,
  Messagebar,
  MessagebarAttachments,
  MessagebarAttachment,
  Input,
  Link,
} from "framework7-react";
import ArrowUpCircleFill from "framework7-icons/react/esm/ArrowUpCircleFill.js";
import CameraFill from "framework7-icons/react/esm/CameraFill.js";
import QuestionCircleFill from "framework7-icons/react/esm/QuestionCircleFill.js";
import { PushViewShell } from "./WalletNavigation";
import { haptic, tg } from "../lib/telegram";
import "framework7/components/messagebar/css";
import "framework7/components/messages/css";
import "framework7/components/dialog/css";
import "./WalletSupportChat.css";

type Photo = { id: string; name: string; url: string };
type DraftMessage = { id: string; text: string; time: string; photos: Photo[] };
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export default function SupportChatPushView({
  open,
  onClose,
  inline = false,
}: {
  open: boolean;
  onClose: () => void;
  inline?: boolean;
}) {
  const [keyboardTest, setKeyboardTest] = useState<"html" | "react" | "framework7" | null>(null);
  const plainKeyboardTest = keyboardTest === "html";
  const titleTaps = useRef(0);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<DraftMessage[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoError, setPhotoError] = useState("");
  const fileInput = useRef<{ el: HTMLElement | null }>({ el: null });
  const telegram = tg();
  const nativeBack = Boolean(
    telegram?.platform && telegram.platform !== "unknown" &&
    telegram.BackButton && telegram.isVersionAtLeast?.("6.1"),
  );
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!open || inline || !nativeBack) return;
    const syncFullscreen = () => setFullscreen(Boolean(telegram?.isFullscreen));
    syncFullscreen();
    telegram?.onEvent?.("fullscreenChanged", syncFullscreen);
    return () => telegram?.offEvent?.("fullscreenChanged", syncFullscreen);
  }, [open, inline, nativeBack, telegram]);
  const objectUrls = useRef(new Set<string>());
  const canSend = Boolean(draft.trim() || photos.length);
  const messageRows = useMemo(
    () =>
      messages.flatMap((message) => {
        const rows: {
          id: string;
          photo?: Photo;
          text?: string;
          footer?: string;
        }[] = message.photos.map((photo) => ({
          id: `${message.id}:${photo.id}`,
          photo,
        }));
        if (message.text) rows.push({ id: message.id, text: message.text });
        if (rows.length)
          rows[rows.length - 1].footer = `${message.time} · Не отправлено`;
        return rows;
      }),
    [messages],
  );
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);
  const mainRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = mainRef.current;
    root
      ?.querySelectorAll<HTMLElement>(".messagebar-attachment")
      .forEach((node, index) => {
        const photo = photos[index];
        if (!photo) return;
        const image = node.querySelector("img");
        if (image) image.alt = photo.name;
        const remove = node.querySelector<HTMLElement>(
          ".messagebar-attachment-delete",
        );
        if (remove) {
          remove.setAttribute("role", "button");
          remove.setAttribute("aria-label", `Удалить фото ${photo.name}`);
          remove.tabIndex = 0;
        }
      });
    const photoRows = messageRows.filter((row) => row.photo);
    root
      ?.querySelectorAll<HTMLImageElement>(".messages .message-image img")
      .forEach((image, index) => {
        image.alt = photoRows[index]?.photo?.name || "Фото к обращению";
      });
    const send = root?.querySelector<HTMLElement>(
      ".messagebar .toolbar-pane:last-child .link",
    );
    if (send) {
      send.setAttribute("aria-label", "Отправить сообщение");
      send.setAttribute("aria-disabled", String(!canSend));
      send.tabIndex = canSend ? 0 : -1;
    }
  }, [photos, messageRows, canSend]);
  useLayoutEffect(() => {
    if (!open || inline || plainKeyboardTest) return;
    const viewport = window.visualViewport;
    const panel = mainRef.current?.closest("section");
    const composer = composerRef.current;
    if (!viewport || !panel || !composer) return;

    let layoutWidth = window.innerWidth;
    let layoutHeight = window.innerHeight;
    let frame: number | undefined;
    let keyboardOpened = false;
    const header = panel.querySelector<HTMLElement>(".wpay-support-native-header");
    const title = header?.querySelector("h1");
    const unlockHeader = () => {
      header?.style.removeProperty("--support-locked-header-top");
      header?.style.removeProperty("--support-locked-title-height");
      keyboardOpened = false;
    };
    const lockHeader = (event: Event) => {
      if (!(event.target instanceof HTMLTextAreaElement) || !header || !title ||
          header.style.getPropertyValue("--support-locked-header-top")) return;
      header.style.setProperty("--support-locked-header-top", getComputedStyle(header).paddingTop);
      header.style.setProperty("--support-locked-title-height", `${title.getBoundingClientRect().height}px`);
    };
    const releaseUnopenedHeader = () => {
      if (!keyboardOpened) unlockHeader();
    };
    panel.style.height = `${layoutHeight}px`;
    panel.setAttribute("data-support-keyboard-motion", "");
    const reserveComposerSpace = () => {
      panel.style.setProperty("--support-composer-height", `${composer.offsetHeight}px`);
    };
    reserveComposerSpace();
    const composerObserver = new ResizeObserver(reserveComposerSpace);
    composerObserver.observe(composer);

    function update() {
      frame = undefined;
      if (!viewport || !panel || viewport.scale !== 1) return;
      // Freeze the layout before focus. Only a width change starts a new layout.
      if (layoutWidth !== window.innerWidth) {
        unlockHeader();
        layoutWidth = window.innerWidth;
        layoutHeight = window.innerHeight;
        panel.style.height = `${layoutHeight}px`;
      }
      const visibleBottom = viewport.height + Math.max(0, viewport.offsetTop);
      const offset = Math.max(0, layoutHeight - visibleBottom);
      if (offset >= 80) keyboardOpened = true;
      if (offset <= 1 && keyboardOpened) unlockHeader();
      panel.style.setProperty("--support-keyboard-offset", `${offset}px`);
      panel.style.setProperty("--support-keyboard-progress", String(Math.min(1, offset / 100)));
    }

    const scheduleUpdate = () => {
      frame ??= window.requestAnimationFrame(update);
    };
    update();
    composer.addEventListener("pointerdown", lockHeader, true);
    composer.addEventListener("focusin", lockHeader);
    composer.addEventListener("focusout", releaseUnopenedHeader);
    window.addEventListener("resize", scheduleUpdate);
    viewport.addEventListener("resize", scheduleUpdate);
    viewport.addEventListener("scroll", scheduleUpdate);
    return () => {
      composer.removeEventListener("pointerdown", lockHeader, true);
      composer.removeEventListener("focusin", lockHeader);
      composer.removeEventListener("focusout", releaseUnopenedHeader);
      unlockHeader();
      window.removeEventListener("resize", scheduleUpdate);
      viewport.removeEventListener("resize", scheduleUpdate);
      viewport.removeEventListener("scroll", scheduleUpdate);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      composerObserver.disconnect();
      panel.removeAttribute("data-support-keyboard-motion");
      panel.style.removeProperty("--support-composer-height");
      panel.style.removeProperty("--support-keyboard-progress");
      panel.style.removeProperty("--support-keyboard-offset");
      panel.style.height = "";
    };
  }, [open, inline, plainKeyboardTest]);
  function selectPhotos(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length) return;
    const accepted: Photo[] = [];
    let error = "";
    for (const file of selected) {
      if (photos.length + accepted.length >= MAX_PHOTOS) {
        error = "Можно прикрепить до 5 фотографий к одному сообщению.";
        break;
      }
      const validType =
        /^image\/(jpeg|png|webp|gif|avif|heic|heif)$/i.test(file.type) ||
        (!file.type &&
          /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(file.name));
      if (!validType) {
        error =
          "Выберите фотографию в формате JPG, PNG, WebP, GIF, AVIF или HEIC.";
        continue;
      }
      if (!file.size || file.size > MAX_PHOTO_BYTES) {
        error = "Выберите непустую фотографию размером до 10 МБ.";
        continue;
      }
      const url = URL.createObjectURL(file);
      objectUrls.current.add(url);
      accepted.push({ id: crypto.randomUUID(), name: file.name, url });
    }
    setPhotos((previous) => [...previous, ...accepted]);
    setPhotoError(error);
  }
  function removePhoto(photo: Photo) {
    setPhotos((previous) => previous.filter((item) => item.id !== photo.id));
    URL.revokeObjectURL(photo.url);
    objectUrls.current.delete(photo.url);
    setPhotoError("");
  }
  function confirmRetry() {
    haptic("light");
    f7.dialog.create({
      title: "Отправить заново?",
      text: "Повторить отправку этого сообщения?",
      destroyOnClose: true,
      buttons: [
        { text: "Отмена", keyCodes: [27] },
        {
          text: "Отправить",
          strong: true,
          keyCodes: [13],
          onClick: () => f7.dialog.alert(
            "Операторы пока не подключены. Сообщение осталось неотправленным.",
            "Не удалось отправить",
          ),
        },
      ],
    }).open();
  }
  function saveDraft() {
    const text = draft.trim();
    if (!text && !photos.length) return;
    haptic("light");
    setMessages((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        text,
        photos,
        time: new Date().toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    ]);
    setDraft("");
    setPhotos([]);
    setPhotoError("");
  }
  const chat = (
      <main
        ref={mainRef}
        className={`wpay-support-chat ios mx-auto flex min-h-0 w-full max-w-[560px] flex-1 flex-col${inline ? " wpay-support-chat--inline wpay-desktop-card" : ""}`}
      >
        <div
          className="support-thread page-content min-h-0 flex-1 overflow-y-auto overscroll-contain"
          role="log"
          aria-label="Переписка с поддержкой"
          aria-live="polite"
        >
          <Messages
            scrollMessages
            scrollMessagesOnEdge
            aria-label="Сообщения поддержки"
          >
            <MessagesTitle>Сегодня</MessagesTitle>
            <Message
              type="received"
              first
              last
              tail
              name="Поддержка wPay"
              text="Опишите вопрос или прикрепите фото. Пока операторы не подключены, обращение останется черновиком."
              footer="Автоматическая подсказка"
            >
              <span
                slot="avatar"
                className="block h-full w-full text-[#007aff] dark:text-[#0a84ff]"
              >
                <QuestionCircleFill className="h-full w-full" />
              </span>
            </Message>
            {messageRows.map((row, index) => (
              <Message
                key={row.id}
                type="sent"
                image={row.photo?.url}
                text={row.text}
                first={index === 0}
                last={index === messageRows.length - 1}
                tail={index === messageRows.length - 1}
                footer={row.footer}
              >
                {row.footer && (
                  <button
                    slot="content-start"
                    type="button"
                    className="support-unsent-icon"
                    aria-label="Отправить сообщение заново"
                    onClick={confirmRetry}
                  >
                    i
                  </button>
                )}
              </Message>
            ))}
          </Messages>
          <div className="support-thread-end" />
        </div>
        <div
          ref={composerRef}
          className="support-compose shrink-0 px-4 pt-3"
          onKeyDown={(event) => {
            if (
              (event.key === "Enter" || event.key === " ") &&
              event.target instanceof HTMLElement &&
              event.target.matches(".messagebar-attachment-delete")
            ) {
              event.preventDefault();
              event.target.click();
            }
          }}
        >
          {keyboardTest === "react" ? (
            <textarea className="support-keyboard-test-input" aria-label="Тестовое поле React" placeholder="Проверка клавиатуры…" />
          ) : <>
          {photoError && (
            <p className="support-photo-error" role="alert">
              {photoError}
            </p>
          )}
          <label htmlFor="wpay-support-photo-file" className="sr-only">
            Выбрать фотографии
          </label>
          <Input
            ref={fileInput}
            inputId="wpay-support-photo-file"
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={selectPhotos}
          />
          <label htmlFor="wpay-support-message" className="sr-only">
            Сообщение поддержке
          </label>
          <Messagebar
            resizable
            resizePage={false}
            maxHeight={140}
            textareaId="wpay-support-message"
            value={draft}
            attachmentsVisible={photos.length > 0}
            data-can-send={String(canSend)}
            placeholder="Сообщение…"
            onInput={(event) => setDraft(event.target.value)}
          >
            <Link
              slot="inner-start"
              iconOnly
              aria-label="Прикрепить фото"
              className="support-attach"
              onClick={() => {
                mainRef.current?.querySelector("textarea")?.blur();
                fileInput.current?.el
                  ?.querySelector<HTMLInputElement>("input[type=file]")
                  ?.click();
              }}
            >
              <CameraFill className="text-[27px]" />
            </Link>
            <MessagebarAttachments
              {...{ role: "group" }}
              aria-label="Прикреплённые фотографии"
            >
              {photos.map((photo) => (
                <MessagebarAttachment
                  key={photo.id}
                  image={photo.url}
                  onAttachmentDelete={() => removePhoto(photo)}
                />
              ))}
            </MessagebarAttachments>
            {/* The 9.1.3 sendLink handler reads an unset unwrapped Input ref.
                Framework7's Link slot keeps the native control and avoids that bug. */}
            <Link
              slot="inner-end"
              iconOnly
              aria-label="Отправить сообщение"
              aria-disabled={!canSend}
              {...{ tabIndex: canSend ? 0 : -1 }}
              onClick={saveDraft}
            >
              <ArrowUpCircleFill className="text-[27px]" />
            </Link>
          </Messagebar>
          </>}
        </div>
      </main>
  );
  if (inline) return chat;
  return (
    <PushViewShell
      open={open}
      title="Поддержка"
      hideNavbar={nativeBack}
      nativeBack={nativeBack}
      scrollContent={false}
      assetSurface
      zClass="z-[12000]"
      onClose={onClose}
    >
      {nativeBack && (
        <header className="wpay-support-native-header" data-fullscreen={fullscreen}>
          <h1 onClick={() => {
            titleTaps.current += 1;
            if (titleTaps.current === 5) {
              titleTaps.current = 0;
              setKeyboardTest("html");
            }
          }}>Поддержка</h1>
        </header>
      )}
      {keyboardTest && (
        <div className="support-keyboard-test-controls" aria-label="Варианты проверки клавиатуры">
          {(["html", "react", "framework7"] as const).map((mode, index) => (
            <button key={mode} type="button" aria-pressed={mode === keyboardTest} onClick={() => setKeyboardTest(mode)}>
              {["1. HTML", "2. React", "3. Framework7"][index]}
            </button>
          ))}
          <button type="button" aria-label="Закрыть проверку" onClick={() => setKeyboardTest(null)}>×</button>
        </div>
      )}
      {plainKeyboardTest ? (
        <div className="support-keyboard-test-baseline">
          <a href="/assets/keyboard-check.html" className="text-[#007aff] underline">Открыть отдельный HTML-тест</a>
          <textarea className="support-keyboard-test-input" aria-label="Тестовое поле HTML" placeholder="Проверка клавиатуры…" />
        </div>
      ) : chat}
    </PushViewShell>
  );
}
