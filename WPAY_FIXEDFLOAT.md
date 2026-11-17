# FixedFloat: USDT network quote integration

Restored from `wpay/self-hosted-crypto`, commit `e47b0f7`, onto the current
WPay UI and backend. The existing application and custody routes are preserved
with `scripts/apply_fixedfloat.py`; quote credentials are kept server-side in
a private environment file.

## Scope

Adds authenticated, server-side FixedFloat quotes for USDT across TRON, Ethereum,
BNB Smart Chain, Solana and TON, with floating/fixed quote modes. Availability is
read from FixedFloat; listing a network in WPay does not imply that it is enabled.
TON was under maintenance during the live smoke check.

This is a quote integration, not a completed money-transfer integration. It never
creates an exchange order, signs/broadcasts an on-chain transaction, changes a
client balance, or reserves money. `execution_enabled` is always false. The
FixedFloat adapter explicitly permits only its read-only `ccies` and `price`
methods, even though both use HTTP POST. Existing GoSwap financial flows are
retained until the separate custody migration is designed and reviewed.

## Server configuration and routes

Put FIXEDFLOAT_API_KEY and FIXEDFLOAT_API_SECRET in the backend environment or
ignored `.env.wallet`. Neither key is returned by API responses or included in
frontend bundles. Existing credentials can be reused from the private operator configuration;
they are not committed. The example configuration contains empty placeholders.

- GET /api/wallet/exchange-status: configured flag and receive/send availability
  per network; requires normal Telegram/owner authentication.
- POST /api/wallet/exchange-quote: accepts only from_network, to_network, amount
  (decimal string, up to six decimal places) and rate_type (float/fixed).

The adapter signs the exact UTF-8 JSON bytes with HMAC-SHA256. The API origin is
server controlled, redirects are disabled, and browser parameters cannot select a
URL, contract, provider currency code or money endpoint. All returned asset and
network identities and the unchanged input amount are verified. Provider decimal
numbers are parsed as Decimal. Missing availability fails closed.

Currency metadata is cached for 30 seconds with a shared lock. Quotes are fresh
requests; provider maintenance/limit/liquidity errors never expose a usable payout.
The SQLite wallet_exchange_rate_limits table atomically bounds authenticated
exchange requests across backend processes sharing this database: 20/minute/user,
100/minute globally, using BEGIN IMMEDIATE. Each quote needs at most two provider
calls, leaving headroom under the documented 250-weight/minute account quota.
The adapter also limits its own process to 120 provider calls/minute. Independent
applications using the same key need separate account-level coordination. No key
rotation or provider-account settings were changed.

## Interface

Wallet → Exchange opens USDT network quotes by default for the home/USDT entry.
The same action on an owned USDT address preselects that address network without
reserving or sending its funds.
The existing other-currency page remains under “Другие валюты”. The new flow uses
the existing push-view shell, rounded cards, primary buttons, and both themes.

It displays the actual estimated payout and input-minus-output difference;
“difference” is not misrepresented as just the provider's service fee. The
provider payout already includes its quote-side charges. Sending funds from our
own source wallet still requires separate network resources. A quote is not a
locked order; prices are invalidated after 20 seconds and after changing inputs.
In-flight requests are cancelled/ignored when inputs change or the view closes.
Unavailable networks are disabled. A provider failure has no demo-price fallback.
There is no money-submission button.

## Validation

- 217 backend tests, including the 11 restored FixedFloat cases.
- 20 frontend unit tests.
- 34 relevant Playwright tests (wallet, owned addresses and exchange cases).
- TypeScript/Vite production build and frontend lint pass; existing repository
  lint warnings and bundle-size warning remain.
- Live read-only adapter check: 100 USDT TRC20 → BSC returned 99.193 USDT with
  available=true. This is a timestamped observation, not a guaranteed future rate.
- No real orders, on-chain transfers or charges. Server configuration enables
  read-only quotes only.

Regression cases cover exact HMAC signing, provider errors and 429, strict amount
and direction validation, currency-cache concurrency, auth, operation without a
GoSwap token, zero ledger changes, rejection of money methods, maintenance/limits,
light/dark UI, input invalidation, stale responses and closing/reopening mid-request.

## What remains for execution

Implement and review isolated custody/signing, TRON resource management, owned
order intents, authenticated withdrawal destinations, durable unknown-order
recovery, reservation/settlement postings, provider status reconciliation and
on-chain proof of both pay-in and payout. A successful price response alone is
not authorization to send funds, and a successful creation POST is not proof of
payout. This change deliberately does not simulate these missing execution steps.

Official API reference: https://ff.io/en/api
