# Owned wallet auto-creation and read-only chain balances

Opening a cryptocurrency page in custody mode POSTs only its asset ticker to
custody-asset. BTC/ETH/BNB/SOL/TRX create or restore the permanent wallet for their
network. TON is also supported in the own-wallet list. USDT creates/restores
BSC/ETH/TON/SOL/TRON wallets. XAUT reuses the ETH wallet. A network wallet holds
native coins and tokens at the same address; opening XAUT after ETH does not
create a new key. No creation happens on opening the main wallet tab or by GET.
Encrypted keys and existing addresses are retained. Reopening is idempotent.

GRAM remains unsupported until the intended jetton master is specified and
verified. No token is selected by symbol alone. Its UI explains the missing
contract instead of creating a misleading wallet/balance.

## API and storage

Authenticated, ownership checked server-side, independent of GoSwap:

- POST custody-asset `{asset}`: ensure supported addresses, return per-network
  observations and exact aggregate. Browser user_id/address/contract/network/RPC
  overrides are rejected.
- GET custody-asset-balances?asset=ETH: read existing wallets only. Does not
  create wallets or restore hidden ones. Aggregates include hidden holdings,
  while hidden address rows are excluded from the list.
- GET custody-balance?wallet_id=...&asset=...: read one owned wallet/asset;
  foreign and missing wallet IDs return the same 404 before any RPC call.
- GET custody-overview: read existing current-environment wallets and aggregate
  supported holdings. Missing network observations mark the whole asset unknown;
  they are never silently treated as zero. No address allocation.

Migration custody-chain-observations-v1 adds custody_balance_cache
(wallet_id, asset, payload, checked_at). Amounts are decimal strings. Conversion
from atomic integer amounts and aggregation use Decimal precision 100. Native
amount display formats strings directly, preserving even a single wei. Fiat
valuation is an estimate using market quotes; no quote means unknown fiat value.
No hard-coded dollar or ruble balance is substituted. Unavailable assets make
portfolio fiat total unknown. This cache is not a financial ledger.

30-second durable cache for both success/failure, per-wallet/asset single-flight,
six concurrent HTTP calls, 12-second request timeout and a 1 MiB response cap.
Browser refreshes visible balances every 30 seconds. Errors/timeouts produce
amount=null/status=unavailable; prior success is not relabeled fresh or zero.
No key/API token is required by the default public read endpoints. Outbound RPC
addresses, methods, contracts and parameters are selected by server code only.

## Readers and confirmation labels

- Bitcoin: mempool.space Esplora chain_stats funded minus spent, 8 decimals.
  Confirmed only; mempool amounts are not credited. Test environment: testnet4.
- Ethereum and BSC: publicnode (fallback Ethereum LlamaRPC/BSC Binance endpoint),
  validate eth_chainId, eth_getBalance or eth_call balanceOf, latest block.
- Solana: mainnet-beta public RPC with publicnode fallback; devnet for tests.
  getBalance and getTokenAccountsByOwner at finalized. SPL owner/mint/decimals
  verified; sum all matching accounts, empty successful result = zero.
- TON: toncenter v2 getAddressBalance and v3 jetton/wallets, indexed. Verify jetton
  owner/master. Successful empty jetton-wallet result = zero. Testnet host is
  separate, and mainnet token contracts are never queried on testnet.
- TRON: TronGrid walletsolidity/getaccount and triggerconstantcontract
  balanceOf(address), confirmed. Empty successful native account = unactivated
  zero balance. Calls only simulate reads; no signing, broadcasting or energy
  spending. Test environment: Nile.

Mainnet allowlist:

| Token/network | Contract/mint | Decimals |
|---|---|---|
| USDT Ethereum | 0xdac17f958d2ee523a2206206994597c13d831ec7 | 6 |
| Binance-Peg USDT BSC | 0x55d398326f99059ff775485246999027b3197955 | 18 |
| USDT Solana | Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB | 6 |
| USDT TON | EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs | 6 |
| USDT TRON | TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t | 6 |
| XAUT Ethereum | 0x68749665ff8d2d112fa859aa293f07a622782f38 | 6 |

BSC's existing Binance-Peg token is distinct from native Tether issuance on
other chains. A different token with the same ticker is not added automatically.

## Money boundary

Chain observations never credit/debit wallet_balances, accounts or postings.
They do not become available/reserved money or reconciliation coverage. No
GoSwap calls. No transaction history invented from snapshots. User-facing text
identifies chain balance and the still-unavailable withdrawal functionality.
A confirmation/reorg-aware indexer and isolated signer remain future work.

## Validation

127 backend tests (including 18 new chain/HTTP scenarios), 4 frontend unit tests,
38 Playwright scenarios and production build. Coverage includes exact decimals,
wrong EVM chain, empty ABI, wrong SPL/jetton identity, BTC mempool separation,
TRON read-only calls, zero vs failure, durable cache/restart, concurrent
single-flight, ownership, auto-creation, hidden-wallet read refresh, unchanged
financial postings and missing GRAM contract. The server also read all twelve
native/token pairs above against live public endpoints using public test vectors;
this did not send funds or create user wallets. SOL returned a nonzero public
fixture balance, demonstrating the reader is not a constant-zero implementation.

Primary references:
- https://ethereum.org/developers/docs/apis/json-rpc/
- https://solana.com/docs/rpc/http/gettokenaccountsbyowner
- https://docs.ton.org/api/v3/jettons/get-jetton-wallets
- https://github.com/Blockstream/esplora/blob/master/API.md
- https://developers.tron.network/docs/interacting-with-contracts
- https://tether.to/en/supported-protocols/
