# Cards UI preview

Branch: wpay/cards-ui, based on 424c7f3. API reference is
wpay/aura-provider-foundation at 2e28de8. No Aura backend changes are merged here.

The cards tab keeps the card artwork at the top, including the existing classic
Green artwork, with mouse/touch/keyboard carousel navigation. Four compact
wallet-style actions open the existing Framework7 push popup. The popup covers
card details, top-up amount entry, virtual/physical selection, mobile-wallet
availability and limits/security. Light/dark layouts cover mobile and desktop;
desktop places the artwork beside management rows. Old fake card purchases and
invented transaction history are removed.

The previous cards implementation was extracted from WalletPage into
WalletCards, WalletCardArtwork and WalletCards.css. Shared wallet navigation and
Framework7 popup behavior remain unchanged.

## Data boundary

Only GET /api/wallet/aura-cards is requested, using the normal authenticated
wallet transport. The adapter validates the exact list contract: data[] with
card_id, kind, status, frozen, masked_pan, delivery_status, provider_updated_at.
Only the last four digits of masked_pan are displayed. Unknown status is shown
as pending clarification, not active. Frozen and processing have distinct labels.
The list contract has no card balance: the UI does not substitute zero or a
wallet/organization balance. It shows a missing balance explicitly.

The always-labeled artwork catalogue represents designs, not user-owned cards.
Successful empty lists remain empty. Missing/unconfigured card API gets a
connection hint; other errors remain load errors with retry. No fabricated
owned cards or payments are used as an error fallback.

No credentials/OTP/PIN endpoint is prefetched or called. No PAN, CVV or PIN is
stored in localStorage. No issuing, recharge, freezing, activation or other
provider POST is sent: those controls currently demonstrate the UI and explain
that the action requires connection. There is no success confirmation for an
unperformed monetary operation. Sample Visa/Amex artwork does not claim the
payment network of a future issued Aura card.

## Validation

48 Playwright scenarios (36 wallet regressions + 12 cards scenarios), 4 frontend
unit tests, TypeScript/Vite production build and lint. Existing lint warnings
remain. Cards tests cover 375/768/1440/2560 light/dark layouts, horizontal overflow,
keyboard/mouse carousel, original push popup, top-up and card-kind controls,
owned masked card status, provider failure, and no financial POST from previews.
Backend source and database schema are unchanged.
