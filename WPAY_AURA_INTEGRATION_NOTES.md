# WPay × Aura Partner API — living integration notes

Status: documentation intake in progress. This file is updated as the Aura
guides/OpenAPI are supplied. Facts marked **confirmed** come from the supplied
Aura documentation or Aura's public site; anything else remains an open item.

Do not store API keys, webhook secrets, PAN, CVV, 3DS codes, passport data or
other customer secrets in this document, source control, application logs or
ordinary support messages.

## Product scope confirmed so far

- Aura Partner API is centered on USDT in TRON (TRC-20).
- Partner-owned customers are registered under WPay identifiers.
- Customer lifecycle includes KYC and asynchronous KYC status updates.
- Cards support asynchronous issuance, recharge from the partner USDT balance,
  operations, 3DS/OTP and card details.
- SBP on-ramp lets a customer pay RUB and credits USDT to the partner balance.
- Crypto processing gives each customer a personal TRON deposit address;
  confirmed deposits credit the partner balance.
- Partner balance endpoints cover USDT balance and movement history. TRON
  withdrawal events exist, but automated API withdrawal is disputed by two
  conflicting parts of the supplied v3.17 documentation.
- Product capabilities enabled for a particular key are reported by `GET /me`.
- Product changes are reported by webhook.
- Public Aura material additionally advertises outbound SBP QR payment and AML
  screening, but their exact Partner API routes and payloads still need to be
  confirmed from the OpenAPI specification.

## Environments and authentication

| Environment | Base URL | Key prefix | Portal |
| --- | --- | --- | --- |
| Testnet | `https://testnet-api.aurawallet.co/v1/partner` | `ak_test_` | `testnet-partners.aurawallet.co` |
| Production | `https://api.aurawallet.co/v1/partner` | `ak_live_` | `partners.aurawallet.co` |

- Testnet uses Tron Nile and test USDT. Test and production data do not overlap.
- Authentication is server-to-server through `X-API-Key`; there is no OAuth or
  Bearer scheme.
- Keys identify both company and environment. WPay must validate the prefix and
  `GET /me` environment during startup and fail closed on mismatch.
- Keys may be restricted by source IP. Aura allows up to five simultaneously
  active keys for rotation.
- No API key may be shipped to the Mini App/browser.
- Production rollout is configuration-only (base URL + key), but WPay must not
  allow a test key with the production URL or a live key with the test URL.
- Production startup must verify the server's public IP allowlist and `GET /me`
  capabilities before exposing a product to users.

## Idempotency and error model

- Every money-moving request requires a durable `Idempotency-Key`.
- WPay must create and persist the key and canonical request body before the
  first provider call. Every retry after timeout/network failure reuses both.
- Reusing a key with a different body is an error.
- Keys are 1–200 characters, bind one operation forever, and must never be
  recycled even months later.
- The currently documented idempotent routes are `POST /cards`,
  `POST /cards/{card_id}/recharge`, `POST /events/{event_id}/redeliver`,
  `POST /orders`, `POST /qr-payments` and `POST /withdrawals`. The last three
  still require product/route availability confirmation described below.
- Same key + byte-equivalent canonical request returns the original result;
  same key + a different request returns `idempotency_key_reused`; missing key
  returns `idempotency_key_required` and executes nothing.
- Timeout, connection loss and 5xx are retried with exponential backoff and the
  same key/body. A non-retryable 4xx requires a corrected new operation and a
  new key; never mutate the body behind an existing key.
- Every non-2xx response uses the stable envelope `{error:{...}}`. The error
  contains stable machine fields `code` and `type`, mutable human text
  `message`, `request_id` matching `X-Request-Id`, `doc_url`, and may include
  request-field `param` and structured `details`.
- Application decisions branch on `code`, never on `message`. Human-readable
  text may be displayed or logged only after normal secret/PII redaction.
- Aura defines five retry policies in its error catalogue:
  - `no`: final/configuration failure; do not retry;
  - `wait`: retry only after an observed state change, never on a blind timer;
  - `after_delay`: wait for the provider delay and retry the identical request;
  - `later`: bounded exponential backoff with jitter for provider/internal
    failures;
  - `after_fix`: first correct the request or business state, then create a
    corrected attempt as appropriate.
- Known examples are `unauthenticated` -> `no`, `kyc_pending` -> `wait`,
  `rate_limited` -> `after_delay`, `internal`/`unavailable` -> `later`, and
  `insufficient_funds`/`invalid_argument` -> `after_fix`.
- Timeout, connection loss and 5xx do not prove whether a money operation ran.
  Retry the identical canonical request with its original `Idempotency-Key`.
  Attempts and elapsed time are bounded; exhaustion moves the operation to
  durable `needs_review`/manual reconciliation rather than declaring failure.
- New error codes may appear without a path-version change. Unknown codes must
  not crash decoding: classify conservatively by HTTP status and `type`, retain
  the raw code, log `request_id`, and expose the case in provider monitoring.
- The complete generated error catalogue is still required before coding
  route-specific behavior.
- Rate-limit handling must use `X-RateLimit-Limit` and related headers and wait
  exactly for `Retry-After`; do not invent an immediate retry loop.
- Aura uses a replenishing request bucket per API key. Every authenticated
  response can contain `X-RateLimit-Limit` (bucket capacity),
  `X-RateLimit-Remaining` (whole requests remaining after this response) and
  `X-RateLimit-Reset` (seconds until full replenishment).
- The transport must observe these headers on successful and failed responses,
  coordinate one limiter for all Aura calls using the same key, and proactively
  slow background work before remaining reaches zero.
- `rate_limited` means the key's request bucket is empty: wait exactly
  `Retry-After`, then retry the identical request (and the identical
  idempotency key for monetary POSTs).
- `resource_exhausted` means a volume/state quota such as a daily allowance, not
  a transient request rate. Its catalogue policy is `wait`: do not schedule
  blind retries; wait for an explicit state change/new period and surface the
  condition to user/admin. A received `Retry-After` is a service hint (default
  60 seconds), not permission to turn this into a generic timed retry loop.
- `unavailable` (503) is transient and is documented with a default five-second
  `Retry-After`; retries still need bounded exponential backoff and the same
  idempotency key for monetary operations.
- The earlier rate-limit prose was internally inconsistent about Retry-After on
  `resource_exhausted`. The generated error catalogue resolves the operational
  behavior: keep the `wait` classification, never blindly retry, and record any
  suggested delay as operator/scheduler metadata only.
- `GET /cards/{card_id}/credentials` has a separate, much smaller bucket. It is
  never called by background sync/prefetch; only an authenticated owner action
  may consume this budget.
- Log `X-Request-Id` for failed calls (without request secrets) so Aura support
  can locate the provider request.
- List endpoints use cursor pagination: `limit` 1–100 (default 25), optional
  opaque `cursor`, response `data` and nullable `next_cursor`.
- A cursor is valid only for one uninterrupted traversal with the same filters
  and sort. Never parse it, mutate it, change filters mid-walk, or persist it as
  the durable synchronization checkpoint. Durable sync must store the last
  provider timestamp/ID and begin a new filtered traversal later.
- Invalid filters/sorts produce `invalid_argument`, not an empty result.
- Monetary values are decimal strings and must remain `Decimal`, never binary
  floating-point numbers.

## Webhooks

- Dedicated future endpoint: `/api/wallet/webhook/aura` (not shared with GoSwap).
- Common JSON envelope is `{event,event_id,occurred_at,partner_id,data}`.
- Headers include `X-Aura-Event`, `X-Aura-Event-Id`, `X-Aura-Attempt`,
  `X-Aura-Timestamp`, `X-Aura-Signature-V2` and legacy
  `X-Aura-Signature`. Route/dedupe using headers before decoding event-specific
  data, but verify V2 over the untouched raw body first.
- Signature header: `X-Aura-Signature-V2`.
- Signature input is `timestamp + "." + raw_body`, HMAC-SHA256 with the full
  `whsec_...` secret.
- Reject signatures outside the documented 300-second window.
- Accept any matching valid `v1` value if the header ever contains several;
  ignore unknown signature-header keys for forward compatibility.
- Do not use legacy `X-Aura-Signature`: it signs only the body and lacks replay
  protection.
- Deduplicate deliveries by `X-Aura-Event-Id`.
- After signature verification, require header event/event-ID to match the JSON
  envelope and verify `partner_id` is ours. Store attempt number and both Aura
  timestamps for audit; never trust routing headers without the verified body.
- Store raw bytes and verified metadata durably, answer 2xx quickly, and process
  through the existing inbox/worker. Provider event application and ledger
  mutation must be atomic and idempotent.
- Test signature failure, duplicate delivery, out-of-order delivery, 5xx retry,
  restart recovery and secret rotation.
- Retry schedule after timeout/connection failure/5xx is 1 minute, 5 minutes,
  15 minutes, 1 hour, 6 hours and 24 hours, then automatic attempts stop.
- Any 4xx is final and is not redelivered. Return 4xx only for a delivery that
  must be permanently rejected (for example an invalid signature); persist and
  return 2xx for unknown but authentic event types.
- Portal manual redelivery restarts the full retry cycle to the currently saved
  endpoint. `POST /events/{event_id}/redeliver` is also documented as an
  idempotent money-safe/admin operation.
- Secret rotation has no overlap or dual-signing grace period. New deliveries
  immediately use only the new secret. Deployment therefore needs a coordinated
  secret update window; a parser accepting multiple `v1` values does not solve
  old/new secret rotation by itself.

## Confirmed quick-start operations

- `GET /me` — key/environment/company/capabilities.
- `GET /customers`, `POST /customers`, `GET /customers/{customer_id}` — list,
  upsert and read partner-owned customers. WPay's stable user ID is the Aura ID;
  no separate internal Aura customer ID is required.
- `GET /customers/{customer_id}/kyc`,
  `POST /customers/{customer_id}/kyc`,
  `POST /customers/{customer_id}/kyc/identity` — KYC status, hosted session and
  import of a verification already performed by the partner.
- `POST /cards` — asynchronous card issuance; requires `Idempotency-Key`.
- `GET /cards`, `GET /cards/{card_id}` — card list/details without credentials.
- `GET /cards/{card_id}` — card status.
- `POST /cards/{card_id}/activate` — physical-card activation.
- `POST /cards/{card_id}/cancel` — cancel pending issuance.
- `POST /cards/{card_id}/recharge` — move USDT from partner balance to card;
  requires `Idempotency-Key`.
- `POST /cards/{card_id}/freeze`, `POST /cards/{card_id}/unfreeze` — idempotent
  card controls.
- `POST /cards/{card_id}/pin` — set the cardholder-provider account security PIN
  (not an ATM/POS card PIN); it can take 1–2 minutes.
- `GET /cards-fees` — partner-specific card fee/minimum data; never hard-code it.
- `GET /cards/operations`, `GET /cards/{card_id}/operations` — all/per-card
  operations.
- `GET /cards/{card_id}/credentials` — audited, separately rate-limited and
  ephemeral credentials response.
- `GET /cards/{card_id}/otp/latest` — latest test/3DS OTP behavior is documented.
- `GET /rate` — SBP on-ramp rate plus allowed minimum/maximum.
- `POST /quotes` — calculate an SBP purchase quote.
- `GET /orders`, `POST /orders`, `GET /orders/{order_id}`,
  `POST /orders/{order_id}/cancel` — generated REST surface for SBP purchase;
  create is idempotent. However, the supplied event catalogue explicitly says
  today's SBP integration uses gRPC `aura.api.SbpBuyService` and no current REST
  route creates an order. Treat these REST routes as not production-ready until
  Aura confirms activation for our key/version.
- `POST /qr-payments/quotes`, `POST /qr-payments`, `GET /qr-payments` and
  `GET /qr-payments/{payment_id}` implement outbound merchant-SBP-QR payment.
  Since 3.6 the authoritative cost fields are `amount_rub`, final `rate`, and
  `total_usdt`; older provider-rate/fee breakdown fields were removed.
- `GET /customers/{customer_id}/deposit-addresses`,
  `POST /customers/{customer_id}/deposit-addresses`,
  `GET /deposit-addresses/{address_id}` — default/additional persistent TRON
  addresses.
- `GET /deposits`, `GET /deposits/{deposit_id}`, `GET /deposits-fees` — deposit
  reconciliation and current partner-specific processing fee.
- `GET /balance`, `GET /balance/history`,
  `GET /balance/history/{operation_id}` — platform/card totals and movement
  history.
- `GET /withdrawals`, `POST /withdrawals`, `GET /withdrawals/{withdrawal_id}`
  are the current TRC-20 withdrawal surface added in 3.7. The 3.5 removal was
  for the older `/cards-platform/withdraw`, not this replacement route. Current
  fee is documented as fixed 2 USDT above the amount; POST is idempotent and
  production requires an IP allowlist.

## Known asynchronous states/events

- Cards: `card.opened`, `card.failed`, `card.cancelled`, `card.otp`,
  `card.operation`, `card.status_changed`, `card.delivery_updated`.
- SBP orders: `order.completed`, `order.failed`, `order.expired`,
  `order.cancelled`.
- Customer KYC: `customer.kyc.updated` (from Aura's public Partner API material).
- Customer crypto deposits: `customer.deposit.pending`,
  `customer.deposit.confirmed`, `customer.deposit.rejected`.
- Platform balance/network events: `deposit.confirmed`, `withdraw.sent`,
  `withdraw.confirmed`, `withdraw.failed`.
- QR payments: `qr_payment.completed`, `qr_payment.failed`,
  `qr_payment.refunded`.
- The complete event catalogue, event envelope, versions and correction rules
  are still required.

### Event application rules confirmed so far

- Deduplicate transport delivery by `event_id`, but do not confuse that with the
  business entity ID.
- `card.operation` uses stable `operation_id` across status changes. Upsert the
  operation only when incoming `updated_at` is newer; manual retries and network
  delivery can arrive out of order.
- Card-operation transitions include `pending` → `completed` / `declined` /
  `cancelled`, and `completed` → `partially_refunded` / `refunded`. The first
  observed state may already be terminal with `previous_status = null`.
- A refund is both its own `type=refund` operation with a new operation ID and a
  later update of the original purchase's refund state. Account each provider
  movement exactly once; do not credit both representations blindly.
- Card-operation monetary/display fields include USDT amount, original amount
  and currency, merchant/MCC, refunded amount, before/after card balance,
  decline details and created/updated timestamps. Unknown future fields/statuses
  remain forward-compatible.
- `card.otp` expires after roughly two minutes. Production delivery is enabled
  separately and may not yet be active for every partner/card contour; the GET
  fallback remains required.
- `customer.deposit.confirmed` credits `net_amount = amount - fee`; pending and
  rejected events never credit.
- `deposit.confirmed` is a platform-balance deposit and is distinct from
  `customer.deposit.confirmed`; `source=sandbox` is test funding and
  `source=chain` has a transaction hash.
- `qr_payment.completed` debits `total_usdt`; `qr_payment.failed` releases the
  full hold; `qr_payment.refunded` reverses a previously completed payment and
  must create a compensating ledger entry.
- `withdraw.sent` is non-terminal; only confirmed/failed settles the reserve.

## Customers and KYC details

- `POST /customers` is an upsert and may safely be repeated after a network
  error or used to refresh customer data.
- Email and phone are required for the SBP purchase path. The bank associates
  the payment QR with the phone number.
- KYC is required for SBP purchases, not for cards or crypto processing under
  the supplied contract. Capability still depends on what Aura enables for the
  partner key.
- The hosted KYC route returns a short-lived browser session URL. WPay must not
  persist that URL; request a new session whenever the user resumes.
- Purchase access requires a fresh `verified` state check before every order;
  previous approval can be revoked.
- A terminal KYC outcome must lead to support, not an endless retry button.
- `POST .../kyc/identity` accepts passport data when the partner has performed
  its own KYC. WPay should not implement this initially: use Aura's hosted widget
  and avoid receiving/storing raw passport data unless a later legal/privacy
  review explicitly authorizes it.
- Webhook `customer.kyc.updated` is repeatable and must be reconciled with GET.

## Card lifecycle details

- `POST /cards` charges the issuance fee immediately and returns before issue is
  final. Reserve/expense accounting must follow `card.opened`, `card.failed` or
  `card.cancelled`; failed/cancelled issuance refunds the issue fee.
- A pending request can be cancelled only while Aura permits it;
  `card_request_not_cancelable` means issuance is already too far along.
- Virtual cards must not contain `shipping_address`.
- Physical cards use the same route with `kind=physical` and an all-ASCII
  `shipping_address`. The guide mentions a default 70 USDT price, but WPay must
  display the live partner fee from `GET /cards-fees`, not hard-code 70.
- Physical delivery state: `issuing` → `issued` → `out_for_delivery` →
  `activated`. `shipment_stage` is deprecated compatibility data and must not
  drive new logic. Compatibility decoding maps legacy `packing` to `issued` and
  `sent` to `out_for_delivery`, then stores only `delivery_status`.
- Tracking and address are returned for physical cards; activation codes are
  secrets and must never be stored/logged.
- Recharge moves funds from partner platform balance to an individual card and
  requires idempotency. `insufficient_funds` is terminal until balance changes.
- Card operations include purchases, refunds, fees and recharges. Their complete
  state/correction model is still needed before accounting implementation.
- `frozen` is separate from the main card `status`. Freeze/unfreeze are safe to
  repeat. Recharge of a frozen card returns `card_frozen`.
- `card_controls_unavailable` requires support rather than automatic retry;
  temporary `unavailable` honors `Retry-After` and logs `request_id`.
- Security-PIN change may run 1–2 minutes and must not be retried early. Provider
  rate limits include `pin_change`, `pin_change_partner` and
  `pin_change_rate_limited`; retry only as documented and never log/store PIN.

## Crypto-processing details

- Product is off by default and enabled per partner. Until `GET /me` contains
  `crypto_processing`, its routes fail with `crypto_processing_not_enabled`.
- The first `GET /customers/{id}/deposit-addresses` has a side effect: it creates
  the default permanent address. WPay must call it only after the customer asks
  to deposit, not during registration.
- Additional permanent addresses can be issued with optional `label`. An
  earlier guide section says there is currently no limit and the limit error is
  reserved, but the generated error catalogue says the maximum is 100. Treat
  100 as the conservative current cap, reuse an existing address on
  `deposit_address_limit_reached`, and confirm the authoritative schema before
  exposing unlimited address creation.
- Fee is either fixed USDT per deposit or percentage. `GET /deposits-fees` is the
  source of truth. A fixed fee can consume a small deposit entirely.
- Credit the user only after `confirmed`, using the provider's exact
  `net_amount`. Store `gross`, `fee` and `net_amount` separately and deduplicate
  by provider deposit ID.
- `pending` means confirmations and/or AML review are incomplete. Even enough
  confirmations do not imply credit if AML review holds the deposit.
- `rejected` is never credited and requires support using deposit ID and tx hash.
- Network is `nile` in testnet and `mainnet` in production. The UI must state
  USDT TRC-20 only; wrong tokens/networks are not credited.

## Balance and withdrawal details

- `GET /balance` returns the platform balance, total value on issued cards and
  the TRON address used to fund the partner platform balance.
- Platform balance pays issuance/recharge fees and receives SBP purchases and
  customer crypto deposits. Card balances are not equivalent to immediately
  spendable platform balance and must reconcile separately.
- `GET /balance/history` is newest-first, cursor-paginated and typed. Test grants
  and real network deposits are distinct types.
- A network-deposit history amount can change while confirming; reconcile only
  confirmed entries.
- `GET /balance/history/{operation_id}` supports targeted outcome polling.
- Current `POST /withdrawals` was added in 3.7 after the legacy
  `/cards-platform/withdraw` removal in 3.5. It sends platform USDT to a TRON
  recipient, charges a fixed 2 USDT above the amount, requires idempotency, and
  reports `sent` then `confirmed` or `failed`. WPay may implement the money path
  only after capturing the exact current request/response schema and must keep
  production IP allowlisting mandatory.

## SBP REST availability warning

The documentation currently describes `GET /rate`, `POST /quotes` and REST
`/orders`, yet its event catalogue says SBP purchases are integrated today over
gRPC `aura.api.SbpBuyService` and no current Partner REST route creates an order.
Therefore WPay must not expose RUB→USDT on the basis of the generated REST route
list alone. Ask Aura whether REST has been deployed after the documentation was
written, whether our key has it, and obtain a successful testnet `POST /orders`
before building the user flow. If gRPC is the only live interface, obtain its
protobuf/service contract and operational requirements first.

Aura's later clarification is stricter: partner SBP purchase is currently
disabled in production. `GET /me -> products.sbp_buy` is `false`, and production
calls to hosted-KYC start, `GET /rate`, `POST /quotes` and every `/orders*`
route return `403 sbp_buy_not_enabled`. WPay therefore treats the `GET /me`
capability as authoritative, caches it only briefly, and blocks KYC start/rate
locally when the product is disabled. The SBP flow remains testnet-only until
Aura changes the production capability.

## API evolution and deprecation

- OpenAPI document version is currently 3.17.0; `/v1/partner` changes only for a
  declared breaking API generation under the new policy.
- Minor releases may add fields, enum values, event types, endpoints and error
  codes without notice. Decoders must ignore unknown fields, preserve unknown
  enum/status values as `unknown`, answer 2xx to unknown webhook types after
  durable recording, and fall back to HTTP status/error type for unknown codes.
- Never implement exhaustive enum parsing that crashes on a future value.
- Breaking changes should move to a new path and v1 should remain for at least
  six months after announcement.
- Log and alert on `Deprecation`, `Sunset` and deprecation `Link` response
  headers. Monitor Aura's changelog and partner contact email.
- Historical 2.x releases did not follow this compatibility policy; WPay targets
  the current v3 contract and still remains defensive.

## Rate-limit implementation rules

- Maintain separate limiter state for test/live keys and a dedicated
  credentials limiter; never let testnet telemetry throttle production or vice
  versa.
- Interactive operations have priority over reconciliation/history scans, but
  must still fail closed when the provider explicitly reports no capacity.
- Spread background reconciliation across time, request maximum useful page
  sizes (up to 100), and avoid dense status polling when a webhook is expected.
- Persist `remaining`, reset deadline, last Retry-After, error type and request ID
  for admin health visibility. If WPay later runs multiple API processes, limiter
  coordination must move from process memory to SQLite/Redis or another shared
  atomic store.
- Bound all retries by attempt/time budget. A circuit breaker should mark Aura
  degraded after repeated 429/503/provider failures without blocking unrelated
  GoSwap products.
- Credentials requests must never be automatically retried by a browser refresh
  loop. If throttled, show the remaining wait and require an intentional later
  user action.

## Error-handling implementation rules

- Implement one typed Aura error decoder and retry classifier in the provider
  transport. Cards, KYC, deposits, SBP, QR and withdrawals must not duplicate
  their own conflicting retry tables.
- Persist provider `code`, `type`, HTTP status, `request_id`, retry policy,
  attempt count and next eligible time on durable external intents. Do not
  persist secrets or unredacted sensitive request/response bodies.
- `wait` conditions need a concrete wake-up source (webhook, reconciliation,
  user action or known period transition). They must not occupy a hot worker
  loop.
- For `after_fix`, a changed payload always requires a new intent/key and an
  audit link to the rejected intent. If only external state changes, follow the
  exact code-specific idempotency contract; do not guess whether Aura expects
  the old key or a new one until the generated catalogue confirms it.
- Retry exhaustion and ambiguous monetary outcomes are operational states, not
  user-visible terminal failures. Reconcile by provider ID, history and webhook
  before releasing a reservation or sending another money-moving request.
- Admin health should group failures by code/type and show request IDs so an
  operator can contact Aura without searching application logs.

## Error catalogue (66/66 received)

All 66 codes from the supplied generated catalogue are now captured. The
OpenAPI-generated catalogue remains authoritative if a later version changes a
status, type or retry policy.

- **Fix and retry (`after_fix`)**: `invalid_argument` (400), `amount_required`
  (400), `amount_out_of_range` (400; `details.min/max`), `insufficient_funds`
  (412), `kyc_required` (412), `card_fee_changed` (412), `card_frozen` (409),
  `address_invalid` (400), `customer_not_found` (404),
  `deposit_address_not_found` (404), `deposit_not_found` (404),
  `deposit_address_limit_reached` (409), `not_found` (404), `already_exists`
  (409), `failed_precondition` (412), `idempotency_key_required` (400),
  `idempotency_key_reused` (409), `payload_too_large` (413),
  `method_not_allowed` (405), `unsupported_media_type` (415),
  `feature_not_enabled` (400), `quote_expired` (400) and
  `sbp_buy_amount_unavailable` (412).
- **Wait for state (`wait`)**: `kyc_pending` (412), `card_paused` (412),
  `pin_change_rate_limited` (429; same PIN after Retry-After),
  `withdrawal_limit_exceeded` (412; rolling window details), and
  `resource_exhausted` (429; capacity/state quota, Retry-After is a hint).
- **Retry later (`later`)**: `card_float_exhausted` (412; nothing debited,
  retry later or use a smaller amount), `unavailable` (503; ambiguous outcome,
  same request/key after 5-second Retry-After then backoff), `internal` (500),
  `rate_unavailable` (503; retry after roughly one minute), and
  `sbp_buy_temporarily_unavailable` (503; honor Retry-After).
- **Retry after exact delay (`after_delay`)**: `rate_limited` (429), using the
  same request after Retry-After. Known `details.scope` values are
  `credentials_reveal` (5 credential reveals/minute/partner), `pin_change`
  (one successful change/card/60 seconds) and `pin_change_partner` (60 PIN
  attempts/minute/partner).
- **Do not retry (`no`)**: `kyc_rejected` (normally 412; identity import uses
  422 `kyc_error` with reason/terminal/status), `card_kind_unavailable` (412),
  `card_already_requested` (412), `card_request_not_cancelable` (409),
  `card_not_active` (409), `card_controls_unavailable` (409),
  `unauthenticated` (401) and `ip_not_allowed` (403).

The second catalogue fragment adds:

- **Fix and retry (`after_fix`)**: `sbp_buy_phone_required` (412),
  `kyc_email_required` (412), `kyc_email_rejected` (412), `qr_unresolvable`
  (400), `shipping_address_invalid` (400),
  `card_activation_code_invalid` (400), and `insufficient_scope` (403;
  `authentication_error`, create a key with `details.required_scope`).
- **Retry later (`later`)**: `sbp_buy_daily_qr_limit` (429; next day),
  `sbp_buy_daily_paid_qr_limit` (429; one hour),
  `sbp_buy_fiat_daily_limit` (429; rolling day) and
  `sbp_buy_fiat_monthly_limit` (429; rolling 31 days). Fiat-limit details carry
  `limit`, `remaining` and `resets_at`; schedule from provider data rather than
  local midnight assumptions.
- **Do not retry (`no`)**: `sbp_buy_blocked` (412), `sbp_buy_bank_not_found`
  (412), `sbp_buy_bank_unsupported` (412), `sbp_buy_pending_qr_limit` (429;
  deliberately no Retry-After), `kyc_passport_already_used` (412 or 422
  `kyc_error` on identity import), `qr_unsupported` (412),
  `card_not_activatable` (412), `kyc_identity_locked` (422 `kyc_error`),
  `kyc_session_unavailable` (409), `sbp_buy_not_enabled` (403),
  `cards_not_enabled` (403), `crypto_processing_not_enabled` (403), and
  `qr_pay_not_enabled` (403).

Route-specific actions captured from this fragment:

- `card_fee_changed` requires rereading `GET /cards-fees` and explicit user
  acceptance/recalculation before a new issuance request.
- `card_frozen` requires successful unfreeze before recharge. `card_not_active`
  includes `processing`, `failed_to_open` and `cancelled` in `details.status`.
- `card_controls_unavailable` is a support case with `request_id`; a temporary
  provider control failure is instead 503 `unavailable` with `details.reason`.
- `address_invalid` includes malformed TRON addresses and addresses owned by
  Aura itself; never bypass this validation locally.
- `customer_not_found` may be repaired by idempotent customer registration.
  Resource-not-found codes must still enforce partner ownership.
- Unknown paths/methods return 401 before routing when the API key is invalid,
  so authentication failures must not be misdiagnosed as missing endpoints.
- `quote_expired` requires a fresh quote and presentation of the changed price;
  never silently substitute a new quote into an accepted intent.
- `feature_not_enabled` applies to preview request fields, distinct from a
  product capability being unavailable for the partner key.
- SBP access is gated by a usable Russian mobile number and email/KYC. A missing
  phone/email is repairable through customer upsert; blocked customers and
  unsupported/unidentified banks go to support, not a retry loop.
- `sbp_buy_pending_qr_limit` is a hard stop without Retry-After. Do not create
  more QR codes or infer that waiting alone will help. The daily created/paid
  and rolling RUB limits have distinct reset behavior and separate UI messages.
- If an SBP limit provides `details.code`, display the provider-prescribed safe
  text through an allowlisted mapping/fallback; never render arbitrary provider
  content as trusted HTML.
- `kyc_passport_already_used` must not reveal which customer owns the passport.
  `details.terminal=true` routes to support. WPay's initial implementation still
  uses the hosted KYC widget and does not expose identity import.
- `kyc_identity_locked` cannot be repaired by starting another KYC session;
  only Aura support can change the identity. Preserve `customer_id` and
  `request_id` for the support case, without storing passport data.
- `kyc_session_unavailable` is catalogued as `no`, but its details determine UX:
  `pending` waits for `customer.kyc.updated`; `rejected` follows reason/terminal
  handling; no verdict is instead 503 `unavailable`. For
  `access_locked_contact_manager`, update the phone and create a deliberate new
  session attempt rather than replaying the rejected call unchanged.
- `qr_unresolvable` permits a fresh scan; `qr_unsupported` is terminal for that
  QR and exposes `details.cause`. QR input needs size/control-character checks
  before it reaches logs or Aura.
- Physical-card address validation is field-specific through `param` and must
  enforce printable Latin/ASCII rules. Activation-code rejection permits
  correction; `card_not_activatable` is terminal for the current card stage.
- Product capability errors map directly to `GET /me` products: `sbp_buy`,
  `cards`, `crypto_processing`, and `qr_pay`. WPay must hide/disable unavailable
  products before a user reaches the provider call, while still handling these
  403 codes as the authoritative race-safe check.
- `insufficient_scope` is distinct from a disabled product. It requires key
  rotation/provisioning in the portal and an admin alert naming only the
  required scope, never exposing the key.

## Sandbox facts

- Initial/additional test USDT is granted through the test portal, not the API.
- Card issuance is asynchronous; tests must cover open, fail and cancel.
- Sandbox 3DS codes are generated from the portal.
- SBP order result can be selected through documented RUB amount bands.
- Three unpaid/failed/expired/cancelled orders in a day can block new orders for
  that customer; a successful order resets the counter.
- Testnet allows up to 30 orders per customer/day; production limits are lower.
- Every money request must be replayed with the same idempotency key during QA.
- Webhook 5xx redelivery must be tested before production.

## Material launch constraint

The supplied guide says production cards are not yet enabled and card
integration should currently use testnet. This must be resolved in writing with
Aura before WPay advertises or sells a real card. Also request production
availability, BIN/issuer/country, supported regions, MCC restrictions, limits,
3DS behavior, chargebacks/disputes, freeze/close/refund behavior and SLA. Live
fees/minimums must be fetched with the live key; testnet values cannot be copied
to production.

## Provider architecture for WPay

Aura must be added as a second provider, not implemented by renaming the current
GoSwap client.

- Existing rows are backfilled with `provider = "goswap"`.
- Every new external intent/event stores provider, provider entity ID,
  environment, idempotency key and provider status/version.
- Provider IDs are unique only inside their provider namespace.
- GoSwap remains responsible for its historical operations and for capabilities
  Aura does not cover (other assets/networks, invoices and internal transfers).
- Aura handles customers/KYC, cards, SBP on-ramp, merchant QR pay, TRON deposits
  and current TRON withdrawals. Each remains independently capability-gated;
  production withdrawals additionally require an IP allowlist.
- Admin routing is per product/capability, not one global provider switch.
- Provider balances and reconciliation are independent. User liabilities may
  never be considered covered by combining unrelated assets or inaccessible
  balances across providers.

Suggested adapter boundary:

```text
WPay financial core / double-entry ledger
        |
        +-- provider router (product + asset + network + environment)
              +-- GoSwap adapter
              +-- Aura adapter
```

## Data model additions (preliminary)

- `wallet_provider_routes`: product/asset/network → provider and enabled state.
- `wallet_provider_entities`: local intent/entity → provider/environment/remote ID.
- `aura_customers`: WPay user ID (also used as Aura customer ID), safe contact
  metadata sync state and lifecycle state.
- `aura_kyc_cases`: status only plus provider references/audit metadata; avoid
  retaining identity documents unless contractually required.
- `aura_cards`: owner, provider card ID, kind, status, frozen state, physical
  delivery state and safe masked/display metadata.
- `aura_card_intents`: issue/recharge/cancel intents and durable idempotency keys.
- `aura_card_operations`: cursor-synchronized operation metadata.
- `aura_sbp_orders`: quote/rate snapshot, RUB/USDT amounts and terminal state.
- `aura_deposit_addresses` / `aura_deposits`: customer TRON ownership and deposits.
- `aura_withdrawals`: only if automated withdrawal is confirmed by Aura;
  recipient, fee quote, durable key and lifecycle.
- Existing webhook inbox should gain a provider namespace and unique
  `(provider, event_id)` constraint.
- Store provider business entities separately from delivery events: stable
  `operation_id`/deposit/order/payment IDs plus provider `updated_at`, so
  out-of-order deliveries cannot regress state.
- Provider secrets remain environment files/secret storage, never database UI.

## Sensitive-card-data rule

Do not persist or log PAN, CVV, OTP/3DS codes, activation codes, provider account
PINs or raw card-detail responses in the ordinary WPay database. Card details
must be retrieved only for the authenticated owner through a short-lived server
request, sent with `Cache-Control: no-store`, redacted from logs/responses, and
protected from admin/broadcast/support/analytics surfaces. The full Aura
card-details contract and PCI implications must be reviewed before implementation.

## Implementation plan (will be refined as docs arrive)

1. **Contract capture** — import OpenAPI v3.17.0, endpoint/event/error catalogue,
   pricing/limits and legal/KYC/card constraints into this document.
2. **Provider foundation** — add provider namespaces, product routing, separate
   reconciliation and admin capability display without changing live routing.
3. **Aura transport/testnet** — authenticated client, startup environment guard,
   durable idempotency, shared adaptive rate limiter, cursor pagination, error
   taxonomy, circuit breaking and redacted logging.
4. **Webhook inbox** — Aura signature verification, replay window, event dedup,
   quick acknowledgement and restart-safe processing.
5. **Customers and KYC** — ownership, registration, KYC launch/status, consent
   versioning and privacy-safe retention.
6. **TRON deposits and balance** — personal addresses, confirmed deposits,
   AML/review states, provider balance history and independent reconciliation.
7. **SBP on-ramp (blocked on transport confirmation)** — first resolve REST vs
   gRPC availability; then implement rate/quote expiry, order/QR lifecycle,
   limits, cancellations, KYC gate and exact ledger postings.
8. **Cards** — issue/cancel/recharge/status/operations/3DS/card details with fee
   snapshots, reservations and strict sensitive-data handling.
9. **TRON withdrawals (conditional)** — implement only after Aura confirms the
   route exists; then cover fee/limits, reservation, address/AML state, safe
   retry and final/corrected outcome handling.
10. **Admin and UI** — provider health/capabilities/routing, customer-visible
    product screens and no direct arbitrary provider-money console.
11. **Testnet acceptance** — concurrency, timeout, duplicate/out-of-order webhook,
    restart, 429/backoff, terminal corrections and reconciliation invariants.
12. **Controlled production launch** — only after written card availability,
    commercial/legal approval, live credentials, backups and one minimum-value
    operation per enabled product.

## Inputs still needed

- Full OpenAPI JSON/YAML v3.17.0 and Postman collection if useful.
- Remaining details: exact response schemas for every recorded route; SBP
  quote/rate/order fields and authoritative REST-versus-gRPC availability;
  complete card-operation schemas/types; QR-payment route schemas; rate-limit
  semantics for route-specific scopes; AML review fields; the authoritative
  deposit-address cap; and the
  authoritative withdrawal contract resolving the v3.5-removal versus v3.17
  route-list contradiction.
- Partner-specific fee/limit responses or redacted examples.
- Written production-card availability and commercial/legal terms.
- Test key and webhook secret must be installed directly on the server, never
  pasted into chat or committed.

## Sources received so far

- User-supplied Aura Partner API guide excerpts, specification version 3.17.0.
- Aura public business overview: <https://aurawallet.co/business>
- Aura public fees/limits: <https://help.aurawallet.co/fees-limits>

## Implemented foundation

Branch: `wpay/aura-provider-foundation`. This implementation is deliberately
disabled by default and does not change the active GoSwap production route.
No Aura credential is committed, and development can run entirely against the
local mock until Aura issues a test key.

Implemented:

- Provider/product/environment routing with existing operations pinned to their
  original provider and Aura TRON deposits behind an explicit admin switch.
- Aura HTTP client with test/live environment guards, decimal amounts,
  idempotency validation, rate-limit observation, typed error envelopes and the
  documented retry-policy classes.
- Durable Aura webhook inbox with V2 HMAC verification over raw bytes, replay
  window, multiple-signature support, partner/header consistency checks,
  deduplication and event-ID-reuse quarantine.
- Customer upsert and personal TRON deposit-address flow.
- Pending/rejected/confirmed deposit lifecycle. Only `confirmed` deposits credit
  the wallet, only `net_amount` is credited, and provider state cannot regress.
- Atomic wallet ledger posting, provider-position update and webhook completion,
  so a crash cannot leave a half-applied deposit.
- Provider balance reconciliation and admin health/processing endpoints.
- Local Aura mock for `/me`, customers, hosted KYC, deposit addresses, deposits,
  balance and signed webhook scenarios.
- Customer upsert/read/list transport, strict email and Russian `+7` phone
  validation, short-lived hosted KYC sessions, current KYC status and
  idempotent `customer.kyc.updated` processing. Session URLs are never persisted;
  only minimal status/verified/terminal/reason metadata is retained.
- Card fee/list/detail/operation read transport; owner-scoped local card and
  operation views; lifecycle processing for `card.opened`, `card.failed`,
  `card.cancelled`, `card.status_changed` and `card.operation`. Stored card data
  is recursively redacted. `card.otp` is signature-checked and deduplicated but
  its code is replaced by a payload hash before the durable inbox write.
- Full SBP rate/quote/order/cancel and merchant QR quote/pay transports with
  strict schemas, idempotency, owner association and terminal lifecycle
  handling. QR payloads, quote tokens and QR images are not retained. Both
  products now have per-user immutable settlement: merchant QR reserves the
  user's Aura-backed USDT before submission and consumes/releases/refunds it
  exactly once; completed SBP orders credit their exact `crypto_amount` once.
- Physical-card delivery updates and sanitized tracking metadata; expanded
  stable card-operation state for original/refunded amounts, balance after,
  country/MCC/category; deposit-fee reads including `fee_min`; and restart-safe
  read/event foundations for merchant QR payments and current TRON withdrawals.
  QR payloads and removed pre-3.6 fee-breakdown fields are not persisted.

Additional completed areas:

- Card issue/recharge/cancel/freeze/unfreeze/activate/PIN, ephemeral credentials
  and OTP, delivery tracking and all documented card webhooks.
- Event feed/get/redelivery, balance history, withdrawals, additional deposit
  addresses and one-shot KYC identity import without retaining identity data.
- Read-only worker recovery polls non-terminal QR payments, SBP orders and
  withdrawals, so a missed webhook does not leave them stuck. Monetary POSTs
  are never replayed by the worker.
- Aura-only deployments now report the wallet as configured, serve overview and
  sync without GoSwap, and route the generic USDT/TRON deposit screen through
  Aura when the explicit provider route is enabled.
- `/api/wallet/status` now publishes the cached Aura `/me.products` capability
  map and the selected QR provider. The live wallet hides unavailable cards,
  SBP and QR entry points. When Aura QR is enabled, the QR sheet uses Aura
  quote/pay directly with one stable idempotency key and authenticated status
  polling; Aura-only sync also performs read-only pending recovery.

Verification on this branch:

- 132 backend unit/integration tests passed, including duplicate delivery,
  pending-to-confirmed transition, invalid-signature recovery, event-ID reuse,
  environment guards, idempotent money mutations, QR reserve/release/refund,
  SBP credit settlement and read-only recovery.
- Frontend production build passed.
- Frontend unit tests and lint passed (lint retains existing warnings only).
- Python compilation and `git diff --check` passed.

Remaining before broad production rollout: run a controlled real Aura testnet
pilot with server-installed secrets, then replace the illustrative card catalog
with owner-scoped Aura card data before enabling the card UI. A live key may be
installed only in server secret storage; credentials pasted in chat must remain
revoked.
