import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBusinessUpdate, safeEqual } from "../core.js";

test("constant-time secret comparison", () => {
  assert.equal(safeEqual("correct-secret-123", "correct-secret-123"), true);
  assert.equal(safeEqual("wrong", "correct-secret-123"), false);
});

test("normalizes business message", () => {
  const event = normalizeBusinessUpdate({ update_id: 7, business_message: {
    business_connection_id: "bc1", message_id: 11, date: 123,
    chat: { id: 42 }, from: { id: 9, first_name: "Ada", username: "ada" }, text: "hello"
  }});
  assert.deepEqual(event, { updateId: 7, kind: "business_message", connectionId: "bc1", chatId: 42,
    messageId: 11, timestamp: 123, sender: { id: 9, username: "ada", firstName: "Ada", lastName: undefined },
    text: "hello", mediaKind: null, outgoing: false });
});

test("ignores unrelated Telegram updates", () => assert.equal(normalizeBusinessUpdate({ update_id: 1, message: {} }), null));
