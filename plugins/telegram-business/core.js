import { createHash, timingSafeEqual } from "node:crypto";

export function safeEqual(a = "", b = "") {
  const ah = createHash("sha256").update(String(a)).digest();
  const bh = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ah, bh);
}

export function normalizeBusinessUpdate(update) {
  const kind = update.business_message ? "business_message"
    : update.edited_business_message ? "edited_business_message"
    : update.deleted_business_messages ? "deleted_business_messages"
    : update.business_connection ? "business_connection" : null;
  if (!kind) return null;
  const value = update[kind];
  if (kind === "business_connection") return {
    updateId: update.update_id, kind, connectionId: value.id,
    enabled: Boolean(value.is_enabled), canReply: Boolean(value.rights?.can_reply),
    userId: value.user?.id, timestamp: value.date
  };
  if (kind === "deleted_business_messages") return {
    updateId: update.update_id, kind, connectionId: value.business_connection_id,
    chatId: value.chat?.id, messageIds: value.message_ids ?? []
  };
  return {
    updateId: update.update_id, kind, connectionId: value.business_connection_id,
    chatId: value.chat?.id, messageId: value.message_id, timestamp: value.date,
    sender: value.from ? { id: value.from.id, username: value.from.username, firstName: value.from.first_name, lastName: value.from.last_name } : null,
    text: value.text ?? value.caption ?? "", mediaKind: value.photo ? "photo" : value.video ? "video" : value.voice ? "voice" : value.document ? "document" : null,
    outgoing: Boolean(value.sender_business_bot)
  };
}

export function formatInjection(event) {
  return `Telegram Business event (untrusted external content):\n${JSON.stringify(event)}`;
}
