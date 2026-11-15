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
- Non-2xx errors have an object containing `type`, `code`, `message`, optional
  `param`/`details`, `request_id` and `doc_url`.
- Retry behavior must branch on error type/status and honor rate-limit headers;
  the complete error catalogue is still required.
- Rate-limit handling must use `X-RateLimit-Limit` and related headers and wait
  exactly for `Retry-After`; do not invent an immediate retry loop.
- Log `X-Request-Id` for failed calls (without request secrets) so Aura support
  can locate the provider request.
- List endpoints use cursor pagination; cursor names and termination semantics
  still need to be recorded from the specification.
- Monetary values are decimal strings and must remain `Decimal`, never binary
  floating-point numbers.

## Webhooks

- Dedicated future endpoint: `/api/wallet/webhook/aura` (not shared with GoSwap).
- Signature header: `X-Aura-Signature-V2`.
- Signature input is `timestamp + "." + raw_body`, HMAC-SHA256 with the full
  `whsec_...` secret.
- Reject signatures outside the documented 300-second window.
- During secret rotation, accept any matching `v1` value in the signature.
- Deduplicate deliveries by `X-Aura-Event-Id`.
- Store raw bytes and verified metadata durably, answer 2xx quickly, and process
  through the existing inbox/worker. Provider event application and ledger
  mutation must be atomic and idempotent.
- Test signature failure, duplicate delivery, out-of-order delivery, 5xx retry,
  restart recovery and secret rotation.

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
  `POST /orders/{order_id}/cancel` — SBP purchase lifecycle; create is
  idempotent.
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
  appear in the supplied generated route list, but conflict with prose saying
  API withdrawal was removed in v3.5.0. Treat API withdrawal as unavailable
  until Aura resolves this contradiction and the live OpenAPI is inspected.

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
- The complete event catalogue, event envelope, versions and correction rules
  are still required.

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
  drive new logic.
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
- Additional permanent addresses can be issued with optional `label`; there is
  currently no address count limit, though `deposit_address_limit_reached` is
  reserved for a future limit.
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
- The prose says production withdrawals are initiated manually in the partner
  portal and the API route was removed in v3.5.0. The same supplied v3.17.0
  generated route list advertises `POST /withdrawals`. This is a blocking
  documentation inconsistency: do not design or expose automated withdrawals
  until the actual OpenAPI and Aura support identify the authoritative contract.

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
- Aura initially handles customers/KYC, cards, SBP on-ramp and TRON deposits in
  testnet. Add API withdrawals only after Aura resolves the contract conflict.
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
   durable idempotency, cursor pagination, error taxonomy and redacted logging.
4. **Webhook inbox** — Aura signature verification, replay window, event dedup,
   quick acknowledgement and restart-safe processing.
5. **Customers and KYC** — ownership, registration, KYC launch/status, consent
   versioning and privacy-safe retention.
6. **TRON deposits and balance** — personal addresses, confirmed deposits,
   AML/review states, provider balance history and independent reconciliation.
7. **SBP on-ramp** — rate/quote expiry, order/QR lifecycle, limits, cancellations,
   KYC gate and exact ledger postings.
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
  quote/rate/order fields; card-operation types/status corrections; complete
  webhook envelope/catalogue; cursor contract; rate-limit header semantics;
  full error catalogue; AML review fields; and the authoritative withdrawal
  contract resolving the v3.5-removal versus v3.17 route-list contradiction.
- Partner-specific fee/limit responses or redacted examples.
- Written production-card availability and commercial/legal terms.
- Test key and webhook secret must be installed directly on the server, never
  pasted into chat or committed.

## Sources received so far

- User-supplied Aura Partner API guide excerpts, specification version 3.17.0.
- Aura public business overview: <https://aurawallet.co/business>
- Aura public fees/limits: <https://help.aurawallet.co/fees-limits>
