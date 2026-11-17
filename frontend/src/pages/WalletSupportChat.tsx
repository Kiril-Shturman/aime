import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Messages,
  Message,
  Messagebar,
  MessagebarAttachments,
  MessagebarAttachment,
  Link,
} from "framework7-react";
import QuestionCircleFill from "framework7-icons/react/esm/QuestionCircleFill.js";
import ArrowUpCircleFill from "framework7-icons/react/esm/ArrowUpCircleFill.js";
import Paperclip from "framework7-icons/react/esm/Paperclip.js";
import { PushViewShell } from "./WalletNavigation";
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
  const fileInput = useRef<HTMLInputElement | null>(null);
  const objectUrls = useRef(new Set<string>());
  const canSend = Boolean(draft.trim() || photos.length);
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
    if (open)
      endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, open]);
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
      zClass="z-[12000]"
      onClose={onClose}
    >
      <main
        ref={mainRef}
        className="wpay-support-chat ios mx-auto flex min-h-0 w-full max-w-[560px] flex-1 flex-col"
      >
        <div
          className="support-thread min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
          role="log"
          aria-label="Переписка с поддержкой"
          aria-live="polite"
        >
          <div className="support-contact mt-4 flex items-center gap-3 rounded-[24px] bg-white p-4 dark:bg-[#1c1c1e]">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[17px] bg-gradient-to-br from-blue-300 via-blue-500 to-indigo-600 text-white">
              <QuestionCircleFill className="text-[30px]" />
            </span>
            <div>
              <h2 className="text-[17px] font-semibold text-black dark:text-white">
                Команда WPay
              </h2>
              <p className="mt-0.5 text-[13px] leading-5 text-black/45 dark:text-white/45">
                Поможем разобраться с кошельком
              </p>
            </div>
          </div>
          {!messages.length && (
            <div className="support-welcome px-3 pb-5 pt-10">
              <h3 className="text-[26px] font-semibold tracking-tight text-black dark:text-white">
                Чем можем помочь?
              </h3>
              <p className="mt-2 max-w-[290px] text-[15px] leading-6 text-black/45 dark:text-white/45">
                Выберите тему или опишите вопрос своими словами.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {["Пополнение", "Оплата по QR", "Карты", "Другой вопрос"].map(
                  (topic) => (
                    <button
                      key={topic}
                      type="button"
                      className="rounded-full bg-white px-4 py-2.5 text-[14px] font-medium text-primary dark:bg-[#1c1c1e]"
                      onClick={() => {
                        setDraft(`Вопрос: ${topic.toLowerCase()}. `);
                        mainRef.current?.querySelector("textarea")?.focus();
                      }}
                    >
                      {topic}
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
          <Messages init={false} aria-label="Сообщения поддержки">
            {messages.length > 0 && (
              <div className="messages-title">
                <span>Сегодня</span>
              </div>
            )}
            {messages.map((message) => (
              <Message
                key={message.id}
                type="sent"
                text={message.text}
                first
                last
                tail
                footer={`${message.time} · Не отправлено`}
              >
                {message.photos.length > 0 && (
                  <div
                    slot="image"
                    className={`support-photo-grid${message.photos.length === 1 ? " support-photo-grid--single" : ""}`}
                  >
                    {message.photos.map((photo) => (
                      <img
                        key={photo.id}
                        src={photo.url}
                        alt={photo.name}
                        loading="lazy"
                        onLoad={() => {
                          if (open)
                            endRef.current?.scrollIntoView({
                              block: "nearest",
                            });
                        }}
                      />
                    ))}
                  </div>
                )}
              </Message>
            ))}
            <div ref={endRef} />
          </Messages>
        </div>
        <div className="support-compose shrink-0 px-4 pt-3">
          <p
            className="mb-3 text-center text-[12px] leading-4 text-black/45 dark:text-white/45"
            role="status"
          >
            Операторы пока не подключены · режим черновика
          </p>
          {photoError && (
            <p className="support-photo-error" role="alert">
              {photoError}
            </p>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            aria-label="Выбрать фотографии"
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
            placeholder="Сообщение…"
            onInput={(event) => setDraft(event.target.value)}
          >
            <Link
              slot="inner-start"
              iconOnly
              aria-label="Прикрепить фото"
              className="support-attach"
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip className="text-[25px]" />
            </Link>
            <MessagebarAttachments
              {...{ role: "group" }}
              aria-label="Прикреплённые фотографии"
            >
              {photos.map((photo) => (
                <MessagebarAttachment key={photo.id} deletable={false}>
                  <img src={photo.url} alt={photo.name} />
                  <button
                    type="button"
                    className="messagebar-attachment-delete"
                    aria-label={`Удалить фото ${photo.name}`}
                    onClick={() => removePhoto(photo)}
                  />
                </MessagebarAttachment>
              ))}
            </MessagebarAttachments>
            <Link
              slot="inner-end"
              iconOnly
              aria-label="Отправить сообщение"
              aria-disabled={!canSend}
              {...{ tabIndex: canSend ? 0 : -1 }}
              className={`support-send${!canSend ? " disabled" : ""}`}
              onClick={saveDraft}
            >
              <ArrowUpCircleFill className="text-[36px]" />
            </Link>
          </Messagebar>
        </div>
      </main>
    </PushViewShell>
  );
}
