# WPay: operations and organization controls

UI: History → Operations. Invoices, Telegram-ID transfers, network withdrawals,
deposits and saved addresses. Owner sees GoSwap → reconciliation/account.
Provider reference: https://goswap.site/docs (checked 2026-11-13).

Backend requires the existing GoSwap token and wallet identity. No provider key
is sent to the browser. Organization balances never become a user's balance.

GET /api/wallet/access returns whether the authenticated identity is the owner.
GET /api/wallet/operations-{invoices,transfers,withdrawals,deposits} supports
count (1–100) and offset. Pagination is deduplicated in the UI. Client-supplied
IDs and client_ref are never used to select another user's history.

Invoices/transfers/withdrawals are organization-wide for the owner. Personal
history can only query IDs already recorded by server code in wallet_events.detail:
operation_kind = invoices/transfers/withdrawals and invoice_id/spend_id respectively.
This checkout has no invoice creation or outgoing transfer/withdrawal handlers;
these personal histories remain empty until those creation flows persist ownership.
Do not infer ownership by amount, Telegram recipient, arbitrary browser IDs or
untrusted invoice payload. Existing third-party-created organization operations
are visible only to the owner.

GET /api/wallet/operations-reconciliation is owner-only, with GoSwap before
cursor. GET /api/wallet/provider includes app permissions, organization balances
and currencies. GET /api/wallet/provider-audit sums net using Decimal across up
to 20 pages of 1000 records. It compares only a complete history with unchanged
balances before/after the fetch. A partial result is not declared reconciled.
Run another audit if operations occur during the check. No ledger mutations occur.

POST /api/wallet/revoke-transfer {spend_id} is owner-only. It rechecks pending
before calling revokeTransfer. The provider must enforce the final atomic status
check. A successful revoke credits the organization, not a client's WPay balance.
The UI requires an explicit confirmation and refreshes the affected row.

GET /api/wallet/addresses lists only the current user's cached permanent addresses.
POST /api/wallet/address {network} requests getClientAddress with server-owned
client_ref. Supports BSC/ETH/TON/SOL. createDeposit also caches returned permanent
addresses. TRON claims expire and are never saved as permanent addresses.
Deposit details include fee, credited, network, address, tx_hash and client_ref.
Explorer links use fixed network-specific HTTPS origins; receipt/payment links
allow only HTTPS t.me and goswap.site. No arbitrary provider URLs are rendered.

Validation:
python3 -m unittest discover -s tests -p test_wallet_backend.py -v
npm run build --prefix frontend

The public Sites deployment is a static frontend, and does not run this Python
backend. Its unconfigured state intentionally shows no organization or user data.
