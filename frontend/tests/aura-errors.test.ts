import { test } from "node:test";
import assert from "node:assert/strict";
import catalog from "../../aura_error_catalog.json" with { type: "json" };
import {
  auraBackoff,
  WalletApiError,
  auraErrorMessage,
  auraRecovery,
  auraRetryAfter,
} from "../src/lib/aura-errors.ts";

test("every supplied Aura code has a user message and a recovery rule", () => {
  assert.equal(Object.keys(catalog).length, 66);
  for (const code of Object.keys(catalog)) {
    assert.ok(auraErrorMessage(code), code);
    assert.ok(auraRecovery(code), code);
  }
});
test("KYC terminal cases never offer a timed retry; session state controls recovery", () => {
  for (const code of [
    "kyc_rejected",
    "kyc_identity_locked",
    "kyc_passport_already_used",
  ])
    assert.equal(auraRetryAfter(code, "5"), null);
  assert.equal(
    auraRecovery("kyc_session_unavailable", { status: "pending" }),
    "wait",
  );
  assert.equal(
    auraRecovery("kyc_session_unavailable", {
      reason: "access_locked_contact_manager",
    }),
    "fix",
  );
  assert.equal(
    auraRecovery("kyc_session_unavailable", {
      reason: "access_locked_contact_manager",
      terminal: true,
    }),
    "support",
  );
  assert.equal(auraRecovery("kyc_email_rejected"), "fix");
});
test("capacity and rate limits preserve real Retry-After; pending QR never retries", () => {
  assert.equal(auraRetryAfter("resource_exhausted", null), "60");
  assert.equal(auraRetryAfter("resource_exhausted", "125"), "125");
  assert.equal(
    auraRetryAfter("rate_limited", "Wed, 18 Nov 2026 10:00:00 GMT"),
    "Wed, 18 Nov 2026 10:00:00 GMT",
  );
  assert.equal(auraRetryAfter("sbp_buy_pending_qr_limit", "5"), null);
  assert.equal(auraRecovery("unavailable"), "same_request");
  assert.equal(auraRecovery("internal"), "same_request");
  assert.equal(auraRecovery("card_frozen"), "fix");
});
test("errors preserve metadata, limits and request IDs without exposing arbitrary fields", () => {
  const error = new WalletApiError(
    "amount_out_of_range",
    "English",
    null,
    400,
    {
      param: "amount",
      request_id: "req-1",
      type: "invalid_request_error",
      details: { min: "1", max: "100" },
    },
  );
  assert.match(error.message, /Поле: Сумма/);
  assert.match(error.message, /Минимум: 1/);
  assert.equal(error.httpStatus, 400);
  assert.equal(error.requestId, "req-1");
  const support = new WalletApiError(
    "kyc_identity_locked",
    "English",
    null,
    422,
    {
      request_id: "req-2",
      details: { reason: "identity_locked:rejected", terminal: true },
    },
  );
  assert.match(support.message, /req-2/);
  assert.match(support.message, /identity_locked:rejected/);
  const limit = auraErrorMessage("sbp_buy_fiat_daily_limit", {
    details: {
      limit: "10000",
      remaining: "500",
      resets_at: "2026-11-18T00:00:00Z",
    },
  });
  assert.match(limit!, /Осталось: 500/);
  assert.match(limit!, /Восстановится:/);
  assert.equal(auraErrorMessage("future_code"), undefined);
});
test("daily QR provider instruction is only shown when prescribed code is present", () => {
  assert.equal(
    auraErrorMessage(
      "sbp_buy_daily_qr_limit",
      { details: { code: "limit" } },
      "Предписанный текст",
    ),
    "Предписанный текст",
  );
  assert.notEqual(
    auraErrorMessage("sbp_buy_daily_qr_limit", {}, "English internal"),
    "English internal",
  );
});

test("unknown monetary outcomes use increasing waits without replacing a longer provider delay", () => {
  assert.equal(auraBackoff("unavailable", null, 1), "5");
  assert.equal(auraBackoff("unavailable", null, 2), "10");
  assert.equal(auraBackoff("internal", null, 3), "20");
  assert.equal(auraBackoff("unavailable", "120", 2), "120");
  assert.equal(auraBackoff("rate_limited", "90", 1), "90");
});
