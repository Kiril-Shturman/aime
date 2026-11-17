import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Messages,
  Message,
  MessagesTitle,
  Messagebar,
  MessagebarAttachments,
  MessagebarAttachment,
  MessagebarSheet,
  Input,
  Link,
} from "framework7-react";
import ArrowUpCircleFill from "framework7-icons/react/esm/ArrowUpCircleFill.js";
import CameraFill from "framework7-icons/react/esm/CameraFill.js";
import QuestionCircleFill from "framework7-icons/react/esm/QuestionCircleFill.js";
import { PushViewShell } from "./WalletNavigation";
import { haptic } from "../lib/telegram";
import "framework7/components/messagebar/css";
import "framework7/components/messages/css";
import "./WalletSupportChat.css";

type Photo = { id: string; name: string; url: string };
type DraftMessage = { id: string; text: string; time: string; photos: Photo[] };
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export default function SupportChatPushView({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<DraftMessage[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoError, setPhotoError] = useState("");
  const fileInput = useRef<{ el: HTMLElement | null }>({ el: null });
  const [photoSheet, setPhotoSheet] = useState(false);
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
  const endRef = useRef<HTMLDivElement | null>(null);
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
  useEffect(() => {
    if (open)
      endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const panel = mainRef.current?.closest("section");
    if (!viewport || !panel) return;
    const resize = () => {
      panel.style.height = `${viewport.height}px`;
      panel.style.top = `${viewport.offsetTop}px`;
      panel.style.bottom = "auto";
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
      panel.style.height = "";
      panel.style.top = "";
      panel.style.bottom = "";
    };
  }, [open]);
  function selectPhotos(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length) return;
    setPhotoSheet(false);
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
  return (
    <PushViewShell
      open={open}
      title="Поддержка"
      subtitle="WPay"
      scrollContent={false}
      assetSurface
      zClass="z-[12000]"
      onClose={onClose}
    >
      <main
        ref={mainRef}
        className="wpay-support-chat ios mx-auto flex min-h-0 w-full max-w-[560px] flex-1 flex-col"
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
              />
            ))}
          </Messages>
          <div ref={endRef} />
        </div>
        <div
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
            sheetVisible={photoSheet}
            data-can-send={String(canSend)}
            placeholder="Сообщение…"
            onInput={(event) => setDraft(event.target.value)}
            onFocus={() => setPhotoSheet(false)}
          >
            <Link
              slot="inner-start"
              iconOnly
              aria-label="Прикрепить фото"
              className="support-attach"
              aria-expanded={photoSheet}
              onClick={() => {
                mainRef.current?.querySelector("textarea")?.blur();
                setPhotoSheet((current) => !current);
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
            <MessagebarSheet aria-label="Выбор фотографий">
              <div className="support-photo-picker">
                <p>Фото к обращению</p>
                <Link
                  onClick={() =>
                    fileInput.current?.el
                      ?.querySelector<HTMLInputElement>("input[type=file]")
                      ?.click()
                  }
                  aria-label="Выбрать фото с устройства"
                >
                  <CameraFill className="text-[25px]" /> Выбрать фото
                </Link>
                <Link onClick={() => setPhotoSheet(false)}>Отмена</Link>
              </div>
            </MessagebarSheet>
          </Messagebar>
        </div>
      </main>
    </PushViewShell>
  );
}
