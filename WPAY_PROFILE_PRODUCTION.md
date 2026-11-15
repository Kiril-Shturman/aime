# Profile production rollout

Based on production commit `4575688` (Aura admin console). Transfers the profile
from `wpay/aura-ui-integration` without replacing current card UI, admin console,
exchange or custody pages.

Includes server-backed contact fields, hosted KYC and status refresh, native
Telegram biometric lock, lock-screen badge and mobile fullscreen request.
Preserves the deployed IPv4 fix in both Aura API transports. Contact/KYC responses
are no-store; reading KYC does not create a customer or clear contact hashes.
No provider credentials or user data are included in this commit.

Validation: 138 backend tests, 20 Playwright tests, 3 frontend unit tests,
production build, lint (warnings only), and git diff --check.

Deployment copies the existing production release, replaces only built static
assets plus wallet_backend.py/wallet_aura.py, preserves private configuration and
shared database path, and saves a SQLite backup and previous service unit.

Contact persistence: `wallet_profile_contacts` stores the last successfully saved
email and phone by authenticated user and Aura environment. Provider upsert must
succeed before local data changes; customer mapping and contacts commit together.
The profile GET returns these contacts with `private, no-store`, independent of
Aura's minimal customer response. Browser storage is not used. Legacy hashes
cannot restore previously entered contacts; existing users must save them once.

RUB deposits now use the Aura SBP flow instead of the generic crypto-address
placeholder: rate/limits and KYC, explicit quote review, idempotent order creation,
QR payment, owner-scoped recovery and status polling. Unknown creation outcomes
retain their original key and block replacement until reconciliation. Production
validation only reads rate/KYC; no live payment order is created by deployment.
