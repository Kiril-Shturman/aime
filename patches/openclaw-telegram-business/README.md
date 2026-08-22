# OpenClaw Telegram Business live patch

OpenClaw 2026.7.1-2 asks Telegram for Business update types, but has no handler for them. They are acknowledged and discarded.

`apply-live-patch.mjs` adds an observation-only, terminal middleware to the installed polling bundle. It archives all four Business update types to `memory/telegram-business.jsonl` with mode `0600` and never invokes ordinary inbound routing, preventing automatic replies to customers.

This is an interim patch tied to the current OpenClaw bundle filename. Reapply after OpenClaw upgrades only after reviewing the new Telegram source. The durable upstream design should expose an account-scoped Business observer API from the Telegram runtime.

## Outbound

`apply-outbound-patch.mjs` adds a local approved outbox. Each JSONL entry requires `approved: true`, a unique `id`, `chatId`, `businessConnectionId`, and `text`. Results are written to `memory/telegram-business-results.jsonl`; processed IDs are never retried automatically, preventing duplicate sends after ambiguous failures.

## Bot API 10.2 Rich drafts

`apply-rich-draft-10-2-patch.mjs` upgrades the normal Telegram DM progress path to the ephemeral Bot API 10.2 `sendRichMessageDraft` transport with an `InputRichBlockThinking` block. Progress Markdown is converted to Telegram `RichText` entities because Markdown is not parsed inside block HTML and a plain `text` string is not formatted. Final replies remain persistent `sendRichMessage` calls.

`apply-instant-dialog-settings-patch.mjs` intercepts Telegram's native `/start bizChat<id>` route before agent dispatch and immediately renders per-dialog Auto reply / Drafts / Off callback buttons; selections are appended to `memory/telegram-business-settings.jsonl`. `apply-auto-route-patch.mjs` routes only new human Business messages from chats whose latest mode is `auto` into OpenClaw's normal Telegram reply pipeline; owner messages, bot messages, disabled chats, and duplicate Telegram updates remain terminal/ignored. `apply-clean-rich-output-patch.mjs` suppresses the automatic post-response activity summary. `apply-thinking-lifecycle-patch.mjs` makes the native thinking draft appear immediately, keeps it ephemeral, and preserves the final native footer. `apply-thinking-emoji-set-patch.mjs` loads the public `tgiosicons` emoji set through `getStickerSet` and rotates its native `RichTextCustomEmoji` icons in thinking drafts, with a safe text fallback.

The script is idempotent, validates OpenClaw `2026.7.1-2`, discovers the relevant hashed bundles from unique function anchors, keeps backups, and fails closed if the installed layout differs. Re-review it after every OpenClaw upgrade.
