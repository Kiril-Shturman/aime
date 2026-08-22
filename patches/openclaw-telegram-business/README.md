# OpenClaw Telegram Business live patch

OpenClaw 2026.7.1-2 asks Telegram for Business update types, but has no handler for them. They are acknowledged and discarded.

`apply-live-patch.mjs` adds an observation-only, terminal middleware to the installed polling bundle. It archives all four Business update types to `memory/telegram-business.jsonl` with mode `0600` and never invokes ordinary inbound routing, preventing automatic replies to customers.

This is an interim patch tied to the current OpenClaw bundle filename. Reapply after OpenClaw upgrades only after reviewing the new Telegram source. The durable upstream design should expose an account-scoped Business observer API from the Telegram runtime.

## Outbound

`apply-outbound-patch.mjs` adds a local approved outbox. Each JSONL entry requires `approved: true`, a unique `id`, `chatId`, `businessConnectionId`, and `text`. Results are written to `memory/telegram-business-results.jsonl`; processed IDs are never retried automatically, preventing duplicate sends after ambiguous failures.
