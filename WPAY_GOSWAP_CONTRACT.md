# GoSwap integration contract

Implemented against the API text supplied on 2026-11-15. Provider token remains server-only.

## Client deposits

- Permanent address identity is `(user_id, network)`. The asset-support list is metadata, not an independent address. Existing asset-keyed rows are migrated; alternatives remain in an audit archive.
- `POST /api/wallet/address` calls `getClientAddress` only after network selection. Portfolio reads never allocate addresses. The minimum USDT deposit is passed to the QR screen.
- `POST /api/wallet/deposit` calls asset-specific `createDeposit`, or `createExactDeposit` for USDT/TRON. TRON validates the 1 USDT minimum and six decimal places. The UI displays provider `amount`, not `requested`, and respects expiry.
- Provider `Retry-After` reaches the browser. Network-scoped cooldowns prevent early retries; no financial mutation is automatically replayed.
- `sync` pages until an empty `items`; batches persist their offset, so rate limits do not restart a large history. Returning to offset zero on completion picks up new head entries. Credits are deduplicated by `deposit_id` and use `credited`.

## Client withdrawals

- `withdrawal-estimate` validates provider rights/currency flags, network and external recipient, then calls `estimateWithdrawal`. It stores immutable recipient, memo, amount, fee ceiling and a server-generated intent and spend ID. Estimate lifetime is two minutes; it does not reserve funds.
- `withdrawal-create` accepts only the intent ID. SQLite atomically reserves amount plus fee from the authenticated client's ledger before calling `createWithdrawal` with the same persisted `spend_id` and `max_fee` on retries.
- Unknown submission outcomes retain the reservation. Definitive rejection releases it and requires a new estimate. No cancellation endpoint is offered.
- `withdrawal-history` and personal `operations-withdrawals` reconcile tracked IDs using `getWithdrawals?spend_id=...` even when new withdrawals are disabled.
- Outcomes require increasing integer `version`, matching identity and amounts. A failed webhook triggers a provider lookup before any refund. Duplicate/stale outcomes do not change balances.
- A late completed correction debits the refund again. A shortfall is recorded in `wallet_debts`, blocks new spending and is repaid by incoming deposits. Admin overview includes these debts.

GoSwap spends the organization's account. The client has one available balance per asset. Withdrawal network and external recipient are independent of deposit addresses; withdrawal code neither reads nor allocates deposit addresses. No source_address parameter is accepted. Reservations cover amount + fee against the authenticated client's total available asset balance.

## Webhooks and organization reconciliation

Raw-body HMAC is checked before JSON parsing. Deposit and QR handling retain their ledger idempotency. Withdrawal webhooks always reconcile provider state. Missing deposit notifications can be recovered by `sync`.

`provider-audit` is owner-only. It consumes immutable organization transactions with `after=0`, persists both rows and the last cursor, follows `has_more` even for empty pages, and compares summed Decimal `net` with organization balances. Organization journal rows never directly credit client balances.

## Still external / unsupported

API key, B2B status for exact TRON deposits/deposit webhooks and `can_withdraw` plus organization limits must be enabled by GoSwap. These settings are not granted by this code. BTC withdrawal is unavailable. Check issuance, username transfers and paid additional addresses are not implemented without their API contracts. The public Sites preview explicitly stays in demo mode; Python deployment is separate.

## Scope and release status

This correction is based on production commit `5278ec8`, including `8d335a7` and the guarded 20-method GoSwap console. It is a review branch, not a production deployment. Provider-facing writes are exercised against a fake provider in tests, not live funds. The Sites demo is not evidence that the Python financial backend works against production GoSwap.

Invoice lifecycle, username transfers and a complete double-entry accounting system are not implemented by this correction. Existing client balance/event tables are not a double-entry ledger. Further financial review and a controlled integration test on the real backend are required before enabling live client withdrawals.
