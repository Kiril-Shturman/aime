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
- Partner balance endpoints cover USDT balance, movement history and TRON
  withdrawals.
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

## Idempotency and error model

- Every money-moving request requires a durable `Idempotency-Key`.
- WPay must create and persist the key and canonical request body before the
  first provider call. Every retry after timeout/network failure reuses both.
- Reusing a key with a different body is an error.
- Non-2xx errors have an object containing `type`, `code`, `message`, optional
  `param`/`details`, `request_id` and `doc_url`.
- Retry behavior must branch on error type/status and honor rate-limit headers;
  the complete error catalogue is still required.
- List endpoints use cursor pagination; cursor names and termination semantics
  still need to be recorded from the specification.

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
- `POST /customers` — create a partner-owned customer. Same customer ID is safe
  to submit again according to the sandbox guide.
- `POST /cards` — asynchronous card issuance; requires `Idempotency-Key`.
- `GET /cards/{card_id}` — card status.
- `POST /cards/{card_id}/cancel` — cancel pending issuance.
- `POST /cards/{card_id}/recharge` — move USDT from partner balance to card;
  requires `Idempotency-Key`.
- `GET /cards-fees` — partner-specific card fee/minimum data; never hard-code it.
- `GET /cards/{card_id}/otp/latest` — latest test/3DS OTP behavior is documented.
- `GET /rate` — SBP on-ramp rate plus allowed minimum/maximum.
- `POST /orders` / `GET /orders/{order_id}` /
  `POST /orders/{order_id}/cancel` — SBP purchase lifecycle.
- `GET /balance` and `GET /balance/history` are referenced by the guides;
  exact response fields remain to be captured.
- TRON address/deposit and withdrawal route names remain to be captured from
  the OpenAPI specification.

## Known asynchronous states/events

- Cards: `card.opened`, `card.failed`, `card.cancelled`, `card.otp`.
- SBP orders: `order.completed`, `order.failed`, `order.expired`,
  `order.cancelled`.
- Customer KYC: `customer.kyc.updated` (from Aura's public Partner API material).
- Deposits: `deposit.confirmed` is confirmed by the test-balance guide.
- The complete event catalogue, event envelope, versions and correction rules
  are still required.

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
3DS behavior, chargebacks/disputes, freeze/close/refund behavior and SLA.

## Provider architecture for WPay

Aura must be added as a second provider, not implemented by renaming the current
GoSwap client.

- Existing rows are backfilled with `provider = "goswap"`.
- Every new external intent/event stores provider, provider entity ID,
  environment, idempotency key and provider status/version.
- Provider IDs are unique only inside their provider namespace.
- GoSwap remains responsible for its historical operations and for capabilities
  Aura does not cover (other assets/networks, invoices and internal transfers).
- Aura initially handles customers/KYC, cards, SBP on-ramp, TRON deposits and
  TRON withdrawals in testnet.
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
- `aura_customers`: WPay user, Aura customer ID and lifecycle state.
- `aura_kyc_cases`: status only plus provider references/audit metadata; avoid
  retaining identity documents unless contractually required.
- `aura_cards`: owner, provider card ID, kind, state, safe display metadata.
- `aura_card_intents`: issue/recharge/cancel intents and durable idempotency keys.
- `aura_card_operations`: cursor-synchronized operation metadata.
- `aura_sbp_orders`: quote/rate snapshot, RUB/USDT amounts and terminal state.
- `aura_deposit_addresses` / `aura_deposits`: customer TRON ownership and deposits.
- `aura_withdrawals`: recipient, fee quote, durable key and lifecycle.
- Existing webhook inbox should gain a provider namespace and unique
  `(provider, event_id)` constraint.
- Provider secrets remain environment files/secret storage, never database UI.

## Sensitive-card-data rule

Do not persist or log PAN, CVV, OTP/3DS codes or raw card-detail responses in the
ordinary WPay database. Card details must be retrieved only for the authenticated
owner through a short-lived server request, redacted from logs and responses,
and protected from admin/broadcast/support surfaces. The full Aura card-details
contract and PCI implications must be reviewed before implementation.

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
9. **TRON withdrawals** — fee/limits, reservation, address/AML state, safe retry
   and final/corrected outcome handling.
10. **Admin and UI** — provider health/capabilities/routing, customer-visible
    product screens and no direct arbitrary provider-money console.
11. **Testnet acceptance** — concurrency, timeout, duplicate/out-of-order webhook,
    restart, 429/backoff, terminal corrections and reconciliation invariants.
12. **Controlled production launch** — only after written card availability,
    commercial/legal approval, live credentials, backups and one minimum-value
    operation per enabled product.

## Inputs still needed

- Full OpenAPI JSON/YAML v3.17.0 and Postman collection if useful.
- Remaining guides: customers/KYC, full cards lifecycle/details/operations,
  SBP rate/order fields, crypto addresses/deposits/AML, balance/history/withdrawal,
  webhook catalogue, pagination, rate limits, errors/codes, versions and launch.
- Partner-specific fee/limit responses or redacted examples.
- Written production-card availability and commercial/legal terms.
- Test key and webhook secret must be installed directly on the server, never
  pasted into chat or committed.

## Sources received so far

- User-supplied Aura Partner API guide excerpts, specification version 3.17.0.
- Aura public business overview: <https://aurawallet.co/business>
- Aura public fees/limits: <https://help.aurawallet.co/fees-limits>

