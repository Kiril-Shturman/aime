# Cards UI and backend integration

The four existing designs map to server-owned tariff plans:
subscriptions → card_subscriptions (virtual/silver), travel → card_travel
(virtual/navy), premium → card_premium (physical/ice), Platinum →
card_platinum (physical/graphite). The carousel and original menus remain.

`GET aura-card-fees` now includes plan prices from wallet_tariff_versions plus
Aura fees. An absent tariff version is explicitly unconfigured; the UI does not
silently sell the card at provider cost. A deliberately configured zero service
fee remains valid. Existing administrator tariff settings are not changed.

`POST card-quote` stores a two-minute owner/environment/operation-bound quote.
Issuance/recharge POSTs include quote_id and the existing Idempotency-Key. Quotes
bind to one operation key; the backend compares the actual tariff version and
reserve/issue price immediately before reserving funds. UI prices and plan kinds
are not trusted. Recharge quotes show the estimated total and the existing 0.01
USDT settlement cushion; the provider's exact response settles the transaction.

Unknown POST outcomes keep their reservations. A later matching quote recovers
the same pending server idempotency key and stored amounts, including after a UI
restart. A changed physical delivery body cannot replace the unknown request.
Definitive errors refresh the quote and permit correction. No automatic monetary
POST retries are introduced. Balance reads for reservations occur inside BEGIN
IMMEDIATE; existing postings and webhook settlement remain in use.

Owned card snapshots are refreshed with authenticated GETs, bounded per user and
with a shared process call budget. Returned owners/card IDs are checked before
projection. PAN/CVV are never fetched during refresh. Card balance is shown on the
card only if the provider supplied it; missing balances remain unknown. Refresh
failures preserve the last stored snapshot with a visible warning. The first
provider list page can recover cards for a known owner; older missing cards beyond
that page still require the operator's reconciliation tools.

No fake issued card is inserted when a real account has no cards. The four offers
remain. Explicit demo fixtures remain separate from real responses.

Existing real operations: issue, recharge, credentials reveal/hide, latest 3DS,
freeze/unfreeze with native confirmation, PIN, physical activation, delivery,
operations and cancellation of eligible pending requests. Withdrawal/closing an
already issued card are not present in the connected adapter; the UI directs the
user to support and never simulates success or changes a balance.

Deployment uses scripts/apply_card_ui.py to preserve concurrent backend/admin
work. Additive table: wallet_card_quotes. Existing wallet_tariffs and plan_id
changes from the deployed backend are included in source. No live card orders or
real topups were performed in verification; monetary scenarios use local mocks.
