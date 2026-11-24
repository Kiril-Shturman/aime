# Owner key export (Ethereum and BSC)

In the owned address details, Export private key opens an explicit risk
acknowledgement. Each request needs a freshly verified Telegram launch (at most
120 seconds old); admin/board credentials cannot export another user's wallet.
The user may need to close and reopen the miniapp from Telegram.

The browser creates a non-extractable ephemeral RSA-OAEP/SHA-256 keypair (3072
bits). Only its public SPKI key is sent to the web API. The separate recovery
process verifies ownership and the wallet's sealed derivation recipe, derives
the account private key locally and encrypts the result to that browser public
key. The recovery private key and plaintext account private key are never sent
to, or stored on, the web server.

The browser consumes the encrypted result once, decrypts it in memory, checks
job/wallet/network/address binding and displays the hexadecimal private key. It
is not placed in localStorage/sessionStorage or downloaded automatically. Copy
is an explicit action; copied text remains in the user's system clipboard.
The displayed key clears after 30 seconds, on close, on unmount or on document
visibility loss. JavaScript garbage collection cannot guarantee memory erasure.

Table `custody_key_exports` records owner, wallet, ephemeral public key, short
lease, expiry, state and ciphertext. Ciphertext and public key clear on
consumption or expiry (90 seconds). Cleanup runs in the signer cycle and API.
No key goes into the audit log; `custody_activity` records only request and
successful delivery events. Limit: three attempts per owner in ten minutes.
Private table names stay outside the generic wallet/admin table browser.

Authenticated API: POST `custody-export-prepare` (wallet_id, public_key,
acknowledged=true), GET `custody-export-status?job_id=...`, POST
`custody-export-reveal` (job_id). All responses are no-store. Reveal is a single
SQLite BEGIN IMMEDIATE consume; a lost response requires starting a new export,
never a plaintext recovery endpoint. Web-side support uses only existing runtime
dependencies. RSA encryption lives in the isolated signer runtime.

Import as an individual account private key in MetaMask, then choose the network.
This exports precisely one independently generated address, not a seed phrase
or all of the user's addresses. Ethereum and BSC were generated independently and
need their own exports. SOL/TRON/BTC/TON exports are not included in this release.
External imports do not remove WPay's custody access. Automatic funding jobs use
that source too; customers should not concurrently send from both apps.

Validation uses disposable wallets and ephemeral keys only. It verifies recovered
address identity, encrypted-only server data, one-shot consumption, ownership,
fresh session rejection, network restrictions, rate limits, expiry, browser RSA
compatibility, acknowledgement and clearing on visibility loss. Deployment
checks never request a real customer's private key.
