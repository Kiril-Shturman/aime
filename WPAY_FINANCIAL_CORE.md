# Financial core review — branch wpay/financial-core

Base: `af38034` from `wpay/full-source-2026-11-12`. This branch does not deploy
production or the public demo. Existing guarded GoSwap admin console is retained.

## Financial model

A client has one available/reserved balance per asset. Deposit addresses do not
hold independent spendable balances. Withdrawal selects asset, output network,
external recipient and amount; TRON needs no permanent deposit address.
`getMe.can_withdraw === true` is mandatory for the organization, independently
of `getCurrencies.can_withdraw` for the asset. `estimateWithdrawal` validates
the chosen pair, address and fee. Missing organization capability denies output. Withdrawal reserves amount + fee,
uses a server spend_id and accepted max_fee, and tracks provider versions.

Transfers use server-owned intents and spend_id, require getMe.can_transfer=true
and currency support, and reserve before submission. Pending transfers can be
revoked only after a fresh provider read. A completed/reverted transfer is not
submitted again. Timeout/503 keep the reservation. A retry uses the same spend_id;
a 4xx on a retry of an unknown submission does not release its reservation.

Invoices have a server payload and ownership mapping. Browser-provided invoice
IDs, spend_id, sender user_id and client_ref cannot select another client's
money. createInvoice has no provider idempotency key: after an unknown response,
search getInvoices by the persisted payload, never blindly repeat the POST.
Invoice paid/partial/extra status is synchronized separately from money.
Immutable getTransactions.net owns invoice credits, hold releases and refunds:
held payments with net=0 do not create spendable money. Ownership that is recovered
later also recovers previously stored journal rows. Legacy server-recorded invoice
history remains readable; new invoices use the ownership table.

## Tables and migrations

Schema additions use CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS. `double-entry-v1`
in finance_migrations imports legacy available/reserved/debt as opening postings,
within BEGIN IMMEDIATE; it runs once. It is an opening snapshot, not a historical
backfill of all old individual operations. Existing address migration is retained.

- finance_migrations: applied accounting migration markers.
- finance_accounts: owner, asset, bucket, unique account identity.
- finance_transactions: immutable event key, asset, kind, actor, reason, timestamp.
- finance_postings: immutable signed Decimal debit/credit amounts and account links.
- finance_reconciliation: provider available, client liabilities, confirmed in-flight
  reserves, difference, state and timestamp per asset.
- wallet_user_transfers: owned intent/spend_id, immutable request, state and outcome.
- wallet_user_invoices: owned intent/payload/invoice_id, request and provider outcome.
- wallet_invoice_scan: persisted pagination of unknown invoice creation recovery.
- finance_provider_effects: deduplication of journal money by immutable provider row ID.
- wallet_webhook_inbox: raw bytes, signature/result, type, entity, status/version,
  origin, processed_at, error, attempts and next retry time.
- finance_worker_state / finance_worker_lease: progress, errors and expiring worker lease.
- wallet_deposit_requests: clients with explicit deposit requests, including TRON.
- wallet_deposit_sync_cursor: restart-safe per-client deposit offsets.
- wallet_provider_journal / wallet_provider_cursor: retained organization rows and
  monotonic after/cursor (shared with the earlier provider audit implementation).

All money changes use Decimal and BEGIN IMMEDIATE (nested handlers use savepoints).
Every transaction has equal debit/credit totals in one asset. Available/reserved
are credit-normal liabilities; debt is a debit-normal receivable. Cache reads and
coverage verify projections against postings, including missing cache rows. Fee
entries and corrections are journaled; failed→completed can create debt, repaid
by later credits. Administrative corrections require an authenticated actor,
existing client and non-empty reason; they write events and immutable postings.

## Durable delivery and worker

Raw webhook receipt commits before handling. Signature failures are retained and
cannot occupy a valid event's deduplication key. Money, dedup records and the
processed marker commit together, or all roll back; error/backoff persists.
Withdrawal failures and transfer outcomes are checked against current GET state.

The read-only worker starts with the backend if an API token is configured.
WPAY_FINANCE_WORKER=0 disables it; WPAY_FINANCE_INTERVAL defaults to 30 seconds.
It never replays money POSTs. It recovers invoices, transfers, withdrawals, QR
refunds, client deposits and organization journal rows. After/cursor, deposit
pagination, inbox retries and invoice scans survive restart. Empty journal pages
with has_more are followed. Unknown/unowned organization rows are retained without
crediting a random client. No addresses are allocated at registration.

Before a NEW QR payment, transfer or withdrawal reserve, obtain a fresh getBalance
and compare against client available + reserved. Add back confirmed provider
outgoing amounts still reserved locally, since provider available already excludes
them. Non-zero differences (including unexplained surplus), accounting errors and
provider failures block new spending. Existing unknown-intent reconciliation is
still permitted. Admin GoSwap screen includes the coverage report. This is strict
reconciliation, not proof of on-chain custody; unmatched organization capital and
legacy discrepancies require explicit audited allocation before spending resumes.

## Provider methods

Financial workflows use getMe, getCurrencies, getBalance, getExchangeRates,
getClientAddress, createDeposit, createExactDeposit, getDeposits,
estimateWithdrawal, createWithdrawal, getWithdrawals,
transfer, getTransfers, revokeTransfer, createInvoice, getInvoices,
createQrQuote, payQr, getQrPayments and getTransactions.
The guarded admin console's existing methods remain available under its existing
permissions/confirmation rules. Worker uses read methods only.

GoSwap must enable transfer rights (can_transfer=true), withdrawal rights and
limits, supported asset/network pairs and QR payments as applicable. B2B partner
status is required for exact TRON deposits and deposit_received notifications.
BTC network withdrawal is not available through this API. A server API token and
configured webhook URL are required; no key is shipped to the browser.

## Verification

- 72 backend tests: the previous 63 plus 9 audit regressions.
- 3 frontend unit tests.
- 15 Playwright tests: all previous 13 plus withdrawal permission denial and
  recovery after a definitive invoice rejection; the prior tests cover confirmation/retry
  of the same server intent, invoice creation/recovery UI.
- Production TypeScript/Vite build and frontend lint succeed. Existing lint
  warnings and the large Framework7 bundle warning remain.

Cases include concurrent same-intent submissions, insufficient funds, unknown
POST outcomes, 503 revoke, no refund after unknown retry 4xx, duplicate webhook,
invalid signatures, rollback on injected failure, restarting with pending inbox
and saved cursor, held invoice/release/refund, foreign ownership, TRON without
addresses, corrected withdrawal debt repayment and exact zero posting totals.
These tests use an in-process fake provider and intercepted browser API requests.
No real monetary GoSwap operations, live worker restart or production migration
have been performed. Review this commit before any deployment.

## Audit corrections after ae198c8

- `wallet_deposit_owners(deposit_id,user_id,asset)` persists original ownership in
  the same SQL transaction as credit; startup backfills from existing deposit
  events. Returns resolve by deposit_id, validate the asset, apply negative net,
  create debt when available is insufficient, and deduplicate by journal row ID.
- `wallet_poll_schedule(kind,entity,next_at)` persists fair polling rotation.
  Background transfers select reserved/pending only; invoices exclude paid,
  rejected and prepared. Active checks wait at least 60 seconds; expired invoices,
  failed withdrawals and completed QR payments are checked no more than hourly.
  Terminal transfer changes trigger a targeted provider GET from journal rows;
  invoice money corrections continue through immutable journal net.
- Each cycle permits at most 24 provider calls and 4 calls per method. Journal,
  inbox and coverage run before bulk polls. Method failures persist exponential
  backoff (60 seconds to one hour), honoring a larger Retry-After. One failed
  bulk method does not prevent independent priority phases. Unknown invoice
  discovery reads at most one page per background cycle and resumes its offset.
- An explicit 400/401/403/404/405/422 createInvoice rejection persists rejected;
  the UI unlocks its fields and starts a new server intent on retry. Ambiguous
  timeout/408/429/5xx remain creating and use payload-based discovery.

All earlier tests are retained; authorized withdrawal fixtures now explicitly
include the organization capability, with separate denial cases for missing and
false flags. The QR recovery test advances its polling schedule to exercise the
new hourly terminal sweep. No production/demo deployment was performed.
