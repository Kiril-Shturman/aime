# FixedFloat exchange

## Current funding model

The exchange page supports real, **externally funded** USDT swaps between TRON,
Ethereum, BNB Smart Chain, Solana and TON when the provider reports availability.
The user chooses a destination address, reviews a fresh estimate, explicitly
creates an order, then transfers USDT to that order's payment address. The UI
shows the exact amount, network, QR, required memo, deadline and status.

This does not spend the WPay ledger balance, sign a custody-wallet transfer, or
credit the internal wallet on completion. Users may explicitly select their own
mainnet WPay receiving address; that destination remains an on-chain wallet with
its existing limitations. The recovery private key stays off the web server.

## Routes

Existing authenticated routes remain:
- GET exchange-status: configuration, network availability, orders_enabled,
  funding_modes. execution_enabled remains false for automatic wallet spending.
- POST exchange-quote: read-only estimate.

New authenticated routes:
- POST exchange-prepare: from_network, to_network, decimal-string amount,
  rate_type, to_address and optional to_tag. Checks the address/network, obtains
  a fresh quote and persists a server intent valid for 20 seconds.
- POST exchange-create: only that server intent_id. Creates the provider order
  once and returns a public allowlisted projection; no API or order token.
- GET exchange-order?intent_id=...: own order snapshot, with bounded refresh.
- GET exchange-orders: latest 30 own intents, including pending/unknown outcomes.
- POST exchange-own-address: selected network only; ensures a permanent owned
  mainnet wallet without returning keys or enabling internal credits.

No browser user_id, provider token, provider currency code, callback URL or
API origin is accepted. Address checks cover EVM, TRON Base58Check, Solana and TON;
explicit test-only TON addresses are refused. The chosen asset, networks,
destination and memo are verified again against the authenticated order response.

## Durable creation and status

Private table fixedfloat_order_intents stores the authenticated owner, operation
parameters, quote, durable creation state, provider id, security token, public
snapshot, next poll time and backoff. Its name is deliberately outside the generic
wallet_/admin_ database browser allowlist. Database and backups must be private.
Existing financial postings are unchanged because funding occurs externally.

A BEGIN IMMEDIATE claim commits creating before the non-idempotent create POST.
Parallel/repeated calls cannot create the same intent twice. A process restart or
unknown network/5xx outcome never triggers another create automatically. If the
remote id and token were received, status can recover through read-only requests;
otherwise the intent stays unknown and needs support. Explicit provider 4xx/error
responses reject the intent. A definitive HTTP 429 records Retry-After and permits
retry only later; if its quote expired, a fresh reviewed quote is required.

The background worker resumes due known orders after restart, at most six per
cycle, with durable exponential backoff. Terminal DONE/refunded orders are not
polled; expired pay-ins are checked hourly for up to three days for late funds.
A database nonce and provider update timestamp reject stale concurrent responses.
DONE requires the provider's payout transaction hash; refunded completion requires
a refund transaction hash. This is provider-reported proof, not an independent
blockchain-finality verification or a reason to credit WPay's internal ledger.

Emergency/incorrect/late-payment states are shown with support instructions.
The implementation never automatically chooses a new rate, refund recipient or
emergency action. API keys and order security tokens never reach the browser.

## Configuration and request budget

FIXEDFLOAT_API_KEY / FIXEDFLOAT_API_SECRET are backend-only secrets. Set
WPAY_FIXEDFLOAT_ORDERS_ENABLED=1 explicitly to enable order creation and the status
worker. Existing private server configuration is reused; no credentials belong
in Git, VITE variables, logs, request URLs or browser storage.

The exact UTF-8 JSON bytes are signed with HMAC-SHA256, redirects are disabled,
and method/parameter allowlists are server controlled. The ordinary call method
still permits quotes only; gated create_order and fetch_order methods are explicit.

fixedfloat_call_budget shares weighted usage across processes on the same SQLite
DB: create costs 50, other methods 1, with a conservative 200-weight/minute cap
below the provider's documented 250. Other applications using the same key and a
different DB require separate coordination. Existing user quote throttles remain.

## Validation and deployment

243 backend tests, 20 frontend unit tests, existing wallet browser regressions and
four new exchange UI cases cover parallel prepare/create, unknown outcome/restart,
429, foreign ownership, destination mismatch, missing payout proof, stale status,
terminal reordering, network validation, weighted budget, explicit confirmation,
QR/requisites, completion and restoring an unknown order after reload. Monetary
scenarios run against local mocks; no real cryptocurrency was sent during testing.

scripts/apply_fixedfloat_orders.py adds lifecycle integration while preserving
current card/admin/custody code. The existing signed transport is updated as well.
Back up the database before migration and keep the database/backups mode 0600.

Official provider API: https://ff.io/en/api
