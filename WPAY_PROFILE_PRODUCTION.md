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
