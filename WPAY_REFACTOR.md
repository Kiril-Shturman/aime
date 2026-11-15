# WPay architecture and checks

The current source checkout is `wpay-git-export`, branch `wpay/refactor-wallet-flows`.
The production preview on Sites is a static demo; the Python server remains a separate deployment.

## Boundaries

- `frontend/src/wallet/catalog.ts`: asset/network display metadata, confirmed deposit capabilities, asset-scoped address filtering and recipient-format checks.
- `frontend/src/wallet/demo.ts`: preview fixtures. `VITE_WALLET_DEMO=true` explicitly enables these; missing configuration or a failed provider request never enables them.
- `WalletLive.tsx`: wallet state and market rates. Refresh aborts previous wallet requests and aborts when unmounted.
- `WalletCurrencyRow.tsx`, `WalletAssetAvatar.tsx`: shared rows, skeletons and network badges.
- `WalletNavigation.tsx`, `WalletScroll.tsx`: navbar/popover ownership, page shells and pull-to-refresh.
- `WalletWithdrawal.tsx`: withdrawal source selection and recipient entry. The selected source owns the network; changing the source resets the recipient.
- `WalletPrograms.tsx`: referral screen.
- `WalletPage.tsx`: page composition and remaining cards/profile features. These can be extracted incrementally after the current boundaries.

## Address contract

`GET /api/wallet/addresses` returns an explicit `asset` on every saved address.
The database key is `(user_id, network)`; asset support is metadata. See `WPAY_GOSWAP_CONTRACT.md` for the updated API contract and migration.
An asset-specific `createDeposit` persists the requested asset. `getClientAddress` remains USDT-only; callers cannot silently obtain USDT details as another asset.
TRON exact-amount, expiring deposits are not saved as permanent addresses.

Displayed assets do not imply working payment capabilities: live deposits currently expose USDT, ETH, BNB and SOL. Other asset screens remain available in the explicit demo. Live withdrawals now use server estimates, reservations and versioned reconciliation. Paid extra addresses remain demo-only.

## Verification

```sh
npm ci --prefix frontend
npm run lint --prefix frontend
npm test --prefix frontend
python3 -m unittest discover -s tests
npx --prefix frontend playwright install chromium
npm run test:e2e --prefix frontend
```

Browser tests build the real application and mock the provider boundary. On machines with an existing Chrome installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its absolute path.
GitHub Actions runs the same checks. Lint warnings inherited from existing code remain visible; they are not globally disabled. Only Framework7 plugin-registration calls receive local exceptions for the hook-name false positive.

## Deployment

Routes use lazy imports and Suspense; deploying must include **all** generated chunks, not only `index-*` files. Vite output remains `static/`; Sites packages the equivalent build in `dist/`.
Preview hosting defines `VITE_APP_MODE=wallet` and `VITE_WALLET_DEMO=true`. A real wallet must leave demo disabled and run the Python API.
