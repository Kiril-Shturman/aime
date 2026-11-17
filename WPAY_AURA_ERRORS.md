# Aura Partner API errors

`aura_error_catalog.json` contains all 66 codes supplied for this integration.
It is the shared source for server recovery policies and Russian user messages.
`wallet_aura_errors.py` emits a bounded error envelope; `frontend/src/lib/aura-errors.ts`
keeps the code, HTTP status, details, param, request ID, error type, recovery, and
Retry-After on `WalletApiError`. Existing imports from wallet-api remain valid.

The public envelope only includes documented scalar details. It excludes provider
objects, customer IDs, passport fields, keys and arbitrary nested data. The
administrative console retains its separate diagnostic response handling.

Profiles, cards, SBP, QR, deposit and withdrawal screens consume the common wallet
transport. Profile and SBP handlers no longer replace Aura errors with generic
messages. Non-Aura errors retain their previous envelope and behavior.

## Recovery

- Fix: correct data, refresh state, or obtain and confirm a new quote.
- Support: no automatic retry. Terminal KYC closes the identity form. SBP terminal
  refusals stop creation in the current flow.
- Wait: await a state change; no new KYC submission while pending.
- Delay/later: honor Retry-After (delta seconds or HTTP date). Capacity exhaustion
  defaults to 60 seconds, unavailable to 5, stale rates to 60, paid QR limit to 3600.
  The pending-QR limit deliberately has no timer.
- Same request: a 500/503 does not establish failure of a monetary operation.
  Existing server intents and Idempotency-Key are preserved. This patch does not
  introduce automatic monetary POST retries. Repeated 500/503 refusals use
  increasing waits (5, 10, 20…60 seconds, never shorter than Retry-After). SBP retains its identical body/key
  after rate limiting and temporary failures. New quotes require fresh approval.

KYC session errors distinguish pending, terminal refusal, and the documented
phone-correction exception. Email errors return to editable contacts. Duplicate
passports and locked identity data require support rather than resubmission.

## Deployment

No schema migrations or environment changes. Both the JSON catalog and Python
helper must be present beside wallet_aura.py. Build the frontend after editing the
catalog. `scripts/apply_aura_error_handling.py` applies only the integration patch
to a cloned current release, checks its integration points, and breaks hardlinks
before writing. It must not be run against the active release. This preserves
concurrent admin/backend changes instead of deploying the older local backend.

Tests cover every catalog entry, metadata redaction, recovery classification,
Retry-After, duplicate/locked/pending KYC, rejected email, editable invalid fields,
SBP capacity/terminal/rate limits and identical monetary retries after a 503.
All provider responses in tests are synthetic; no real identity or money request
is needed to verify these paths.
