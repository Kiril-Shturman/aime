# Telegram Core

WPay keeps Telegram identity separate from wallet/business data so the same
foundation can be reused by future branded Mini Apps.

## Identity sources

- Signed Mini App `initData` is validated on the server and refreshes the
  Telegram profile plus Mini App activity time.
- Every private bot update refreshes the public Telegram profile and bot
  activity time.
- `getChat` backfills legacy accounts and can be run again by an administrator.
- Telegram ID is the stable external identifier. Username and names are mutable
  profile attributes and must never be used for authorization or ownership.

## Stored profile

`wallet_accounts` stores the Telegram ID, name, username, language, Premium
flag, photo URL, Mini App permissions, first/last acquisition parameter,
profile source and synchronization timestamps. App-controlled state (`role`,
`status`) remains separate from Telegram-controlled fields.

Phone, email, birth date and other private profile data are not available in
Telegram `initData`; future products must request them explicitly and record
the corresponding consent.

## Lifecycle

- New Mini App users receive `created_at`, `last_seen`, and
  `last_miniapp_at` on their first authenticated API request.
- Bot users receive `created_at`, `bot_started_at`, and `last_bot_at` when they
  interact with the bot.
- Legacy rows intentionally keep an unknown `created_at` instead of inventing
  a registration date. `profile_synced_at` shows when their identity was
  recovered.
- Telegram delivery failures with HTTP 403 set `bot_blocked_at`; a successful
  delivery or a new bot interaction clears it.

## Admin operations

The Users screen exposes current Telegram identity and activity. The
`admin-sync-users` action refreshes all Telegram accounts through `getChat` and
returns synchronized/failed counts.
