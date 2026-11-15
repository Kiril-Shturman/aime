# Own wallet address generation

Branch: `wpay/self-hosted-crypto`. Implements the address-generation portion of
custody for BTC, Ethereum, BNB Smart Chain, TON and Solana. The separate VSE
preview now enables mainnet address generation; the working WPay service is unchanged.
Deposits, credits and withdrawals remain disabled.

## User-visible behavior

The “Кошелёк” tab → “Мои кошельки” section lists the five networks, below
the asset list. The former profile entry is removed. Creation is free; the API creates
one permanent wallet per authenticated user/network/environment. Repeating a POST,
including from concurrent processes, returns the existing address. Private keys
and recovery seeds are never returned to the browser. Copy copies only an address.

Defaults are disabled/testnet. Enabling generation does NOT enable deposits,
crediting, activation, sweeps, signing, withdrawal or FixedFloat order submission.
The API explicitly returns deposit_enabled=false and withdraw_enabled=false. The
UI states not to send real funds. Mainnet address generation is supported only by
operator-side configuration; the browser cannot choose environment or parameters.

GoSwap addresses and existing financial balances remain separate. Nothing inserts
our addresses into wallet_addresses or schedules GoSwap to monitor them. Existing
GoSwap address purchase UI is not reinterpreted as own custody. The new own-address
page has no $2 payment, balance debit, fake balance, or unsupported chain estimate.

## Generation and recovery recipes

Each wallet gets an independent 32-byte seed from secrets.token_bytes. Seeds are
not shared between users or networks (including ETH and BSC). Recipes are pinned
in public metadata and inside the encrypted recovery envelope:

- BTC: BIP84 native SegWit P2WPKH, m/84'/0'/0'/0/0 on mainnet or
  m/84'/1'/0'/0/0 on Bitcoin testnet4; bc1q or tb1q address.
- ETH: BIP44 m/44'/60'/0'/0/0, checksummed EOA. Chain ID 1 or Sepolia 11155111.
- BSC: same standard EVM path with an independent seed; chain ID 56 or 97.
- TON: raw 32-byte Ed25519 seed and Wallet V4R2 contract, workchain 0,
  wallet_id 698983191. Non-bounceable UQ mainnet or test-only 0Q form.
  No mnemonic is generated, and a binary recovery seed is not a Tonkeeper/BIP39
  recovery phrase. Future recovery/signing must use the recorded recipe.

- SOL: raw 32-byte Ed25519 seed, compatible with Solana Keypair.fromSeed;
  address is the Base58-encoded 32-byte public key. Recipe solana-ed25519-seed-v1.
  Test environment uses devnet, production metadata uses mainnet-beta. Solana
  addresses themselves have no cluster prefix; cluster is explicit metadata.
  Independent random seeds are generated per user/network/environment.

Pinned dependencies: bip-utils 2.12.3, PyNaCl 1.6.2, pytoniq-core-fork 0.1.48.
The BTC recipe matches the official BIP84 vector. The TON vector was also checked
independently with @ton/ton 16.3.0 WalletContractV4: identical raw public key gives
identical mainnet and test-only addresses. No custom cryptographic primitives or
handwritten TON contract serialization are used.

## Encryption boundary

The web application is configured with ONLY a Curve25519 public encryption key.
PyNaCl SealedBox encrypts each recovery envelope. The matching private recovery
key is for offline tools/the future isolated signer; it is not an API setting.
The envelope binds wallet ID, server-derived owner, network, environment, public
key, address, key fingerprint and recipe. Offline verification decrypts, checks
all bindings and re-derives the address. A corrupted or swapped envelope fails.

This is encryption at rest with a public-key-only web interface, not an HSM or
proof that a compromised generator cannot see newly generated seeds in memory.
Python does not guarantee secure memory zeroization. Sealed boxes do not prove
sender identity; protecting generator code, the public-key configuration, DB and
backups remains necessary. Immutable SQL rows protect normal application writes,
not an attacker who controls the database engine/files or runtime.

## Configuration and offline tools

Install dependencies with `python -m pip install -r requirements.txt`; CI does so.
Generate a recovery key pair OUTSIDE the checkout, preferably on the offline
recovery host:

```sh
python wallet_custody_tools.py init-key --directory /secure/wpay/vault-v1
```

The tool writes private.json and public.json with mode 0600, refuses overwrites,
and prints only paths/fingerprint. Copy only public.json to a read-only location
on the web host. Keep private.json outside the web service's filesystem/access.

```dotenv
WPAY_CUSTODY_ENABLED=1
WPAY_CUSTODY_CHAIN_ENV=testnet
WPAY_CUSTODY_PUBLIC_KEY_FILE=/secure/public/wpay-vault-v1.json
```

Enabled with missing, malformed, private, mismatched or invalid public-key material
fails closed. Without configuration the application still starts, but generation
is unavailable. The environment defaults to testnet and cannot be changed via HTTP.

Offline recovery verification prints public metadata only:

```sh
python wallet_custody_tools.py verify-wallet \
  --database /backup/wpay.sqlite3 \
  --private-key /secure/wpay/vault-v1/private.json \
  --wallet-id WALLET_ID
```

Use a consistent SQLite backup including committed WAL state, not a raw copy of
only a live .sqlite3 file. Keep encrypted DB backups and private recovery-key
backups separately; test this command against a backup before enabling any real
fund flow. Losing the private key makes its encrypted seeds unrecoverable. Keep
old private keys when rotating to a new public key. Rotation affects new wallets;
existing addresses/envelopes/key IDs stay immutable. No re-encryption endpoint.

For this development checkout only, a testnet provisioning key pair was generated
outside the repository and only its public-file path was added to ignored local
.env.wallet. This is not an off-device production backup or deployment.

## Schema and authenticated API

`custody-addresses-v1` is recorded in finance_migrations. Additive CREATE IF NOT
EXISTS migration creates:

- custody_keys: public encryption-key registry by SHA-256 fingerprint.
- custody_wallets: owner, network/environment, address, public key, recipe, key ID,
  encrypted recovery envelope and timestamp. Unique owner/network/environment;
  unique network/environment/address. Wallet and key rows reject UPDATE/DELETE.
- custody_events: one audited creation event per wallet, with server-derived actor.

Creation, encryption, registry entry and audit commit under BEGIN IMMEDIATE in one
transaction. Crypto/DB failures roll back; there is no network I/O in creation.
No ledger postings or money are modified. Schema creation is restart-safe.

- GET /api/wallet/custody-status: supported networks and capability flags.
- GET /api/wallet/custody-wallets: only this authenticated user's public wallets.
- POST /api/wallet/custody-wallet with {"network":"BTC"}: create/get own wallet.

Ownership comes from existing validated Telegram/owner authentication. The browser
cannot supply user_id, seed, key, environment, derivation path or another owner's
filters. No decrypt/export endpoint, including for admins. Recovery tables are
excluded from the existing admin database browser. Routes work without GoSwap.

## Validation and remaining scope

109 backend tests (previous 85 plus 24 custody cases), 3 frontend unit tests and
29 Playwright tests pass. Production TypeScript/Vite build and frontend lint pass;
existing repository warnings remain. Tests cover recovery on all five networks,
known vectors, encrypted-only storage, wrong keys, swapped/tampered envelopes,
rotation, immutable rows, restart, two independent SQLite connections creating
concurrently, HTTP retries, ownership, no monetary changes, private-file
permissions, fail-closed configuration and light/dark UI. Browser tests intercept
APIs; no real blockchain funding, activation, deployment, signing or broadcasts.

Next execution work remains: chain indexers with confirmation/reorg handling,
asset-contract allowlists, idempotent deposit postings, gas funding, isolated
signer and withdrawal/sweep state machines with reconciliation. Address generation
alone does not make the service a working deposit/withdrawal processor.

References:
- https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki
- https://github.com/ebellocchia/bip_utils
- https://github.com/ton-org/ton/blob/master/src/wallets/v4/WalletContractV4.ts
- https://pynacl.readthedocs.io/en/latest/public/#nacl-public-sealedbox

Solana seed vector checked with the official SDK: https://solana-foundation.github.io/solana-web3.js/classes/Keypair.html#fromSeed

## Wallet actions and visibility

The own-wallet detail menu anchors below the ellipsis and includes Deposit,
Withdraw, Exchange and Delete. Deposit reveals the actual address/QR together
with the not-yet-enabled crediting notice. Withdrawal/exchange remain explicitly
unavailable until the signer/order state machines exist. Unknown chain balances
are shown as an em dash, never example holdings or fabricated fiat values.
Legacy address details no longer turn demo holdings into an address balance or
fake transaction history; the demo amount is not evidence of funds on chain.

`custody-visibility-v1` adds custody_hidden and custody_activity. POST
`custody-wallet-hide` accepts only wallet_id, verifies server-derived ownership,
and hides idempotently in one write transaction. Keys and immutable wallet rows
are retained; POST custody-wallet restores the same wallet/address. Activity
records distinguish hide and restore. Foreign/unknown IDs return the same 404.
Provider addresses in the legacy view can only be hidden on the current device;
they cannot be deleted from a blockchain or the upstream provider by this UI.
