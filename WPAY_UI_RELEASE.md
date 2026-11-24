# WPay UI integration baseline

This branch merges the complete UI through `3dc910f` with referral and notification backend work through `a0f9ea8`.

Future deployments must build from this combined history (or descendants), not from the older `wpay/profile-production` frontend. Deploying that frontend drops the current card carousel, subscription/travel/premium/Platinum offers, promo artwork, verification screens and biometrics fixes.

The UI restoration release preserves all Python files, private environment files and the shared database from the running `a0f9ea8-referrals` release. Only frontend sources and static build files are replaced. Referral endpoints, ownership protections, notification workers and referral records stay intact.

Validation: 54 Playwright tests, 5 frontend unit tests, 42 backend/bot tests, production build and lint (existing warnings only). The home promo regression checks the real referral link API, copy button and clipboard together with the restored carousel.
