# Telegram Business ingress

OpenClaw plugin for Telegram Business Bot API updates. It authenticates Telegram's webhook secret header, normalizes business messages/edits/deletions/connection changes, appends JSONL with private permissions, and queues each event as untrusted context for aiMe's next turn.

## Setup

1. Enable Business Mode for the bot in BotFather and connect it in Telegram Business settings.
2. Install this directory as an OpenClaw plugin.
3. Configure `plugins.entries.telegram-business.config` with a strong `secretToken`; optionally set `sessionKey` and `archivePath`.
4. Register the Bot API webhook URL: `https://YOUR_GATEWAY/plugins/telegram-business/webhook`, using the same `secret_token`. Telegram requires public HTTPS.

The plugin intentionally does not send replies automatically. Analysis is separated from external actions until an explicit policy is approved.
