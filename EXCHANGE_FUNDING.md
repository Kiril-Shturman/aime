# Owned-wallet funding for FixedFloat

Funding uses real mainnet USDT held at the customer's independently generated
custody address. It does not spend, reserve, or credit the Aura/test application
ledger. Fee currency must also be present at that source address.

Supported sources: TRON/TRC20, BSC/BEP20, Ethereum/ERC20. SOL and TON sources
remain externally funded. Destinations retain the networks supported by the
existing FixedFloat integration. This change is not a general-purpose withdrawal
API or an automated sweep.

## Trust boundary and approval

The web server retains only sealed recovery envelopes and the public recovery
key. A separate operator-side process owns the recovery private key. No signing
HTTP endpoint exists. Its root-only SSH bridge exchanges bounded JSON with the
existing server and never returns recovery data to the browser.

The signer independently reads FixedFloat's existing order with its private
order token, validates asset/network, destination, amount, payment address and
expiry, and refuses orders already being paid. Estimation does not sign. A sealed
quote binds the job, owner, source wallet, provider order, transaction and fee
ceiling. The authenticated user must explicitly confirm its approval id.

On confirmation the signer rechecks the provider, balance, nonce and fee. It
recovers and verifies the matching wallet locally. Canonical signed bytes and
transaction hash are persisted before broadcast. On a lost acknowledgement or
restart, the worker reads the persisted transaction: it cannot replace the nonce,
recipient, amount or signature with a new transfer. Unknown signed outcomes keep
the source wallet locked. Expired signed transactions require reconciliation;
they do not automatically unlock a potentially spendable EVM transaction.

Only a matching USDT Transfer log proves payment. EVM receipts must be in a
canonical finalized block; TRON uses the solidified receipt. Network rejection
can burn the network fee. A signed transfer is not cancelable through the UI.
The UI hides manual pay instructions while a funding job is active.

## Tables and API

- `custody_funding_jobs`: durable jobs, sealed quote, private signed payload/hash,
  state, ownership, lease and retry schedule. A partial unique index permits only
  one active job per source wallet.
- `custody_signer_status`: public heartbeat, key id and supported source networks.

Authenticated routes: GET `exchange-funding?intent_id=...`, POST
`exchange-funding-prepare`, `exchange-funding-confirm`, `exchange-funding-cancel`.
The server derives the owner/source; the browser cannot supply a destination,
private transaction, fee, spend id or user id to these routes.

`WPAY_WALLET_FUNDING_ENABLED=1` enables new preparations/confirmations. A recent
matching-key heartbeat is required. The separate signer uses
`requirements-signer.txt`; those packages and the recovery private key must not
be installed on the web server. Private operator config (0600 inside 0700 dir):
`worker_id`, `ssh_host`, `private_key_file`, `fixedfloat_key`, `fixedfloat_secret`.
Run `python wallet_signer_worker.py --config <private-config-path>` using that
isolated runtime. It opens no listener. The operator host must remain available;
otherwise the UI disables automatic payment until the heartbeat returns.

Disable the web flag to prevent new user approvals. Continue monitoring existing
signed jobs. Do not restore an older database over signed jobs: it could discard
the durable transaction record and permit a second payment.

## Validation

Run web/backend tests with the normal runtime. Run signer tests with the isolated
runtime: `python -m unittest discover -s tests`. All signer transaction tests are
offline and use disposable keys/fake RPC. They cover source ownership, matching
approval, fee/gas failures, parallel claims, signed-payload compare-and-set,
quote tampering, lost signed acknowledgement, timeout and worker restart.
Browser scenarios cover fee approval, no real funds despite a displayed test
balance, manual-payment suppression and retained exchange behavior.

No mainnet transfer is performed by tests or deployment. A live end-to-end money
transfer remains unverified until a funded source is explicitly confirmed by its
owner in the UI. No new FixedFloat order or transfer is created by health checks.
