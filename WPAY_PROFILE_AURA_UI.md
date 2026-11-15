# Aura profile UI integration

Branch: `wpay/aura-ui-integration`, based on the preserved cards/UI snapshot
`ba6f13a`, merged with Aura foundation `2e28de8`.

The existing profile, Framework7 inputs, verification tile and navigation remain.
Personal data loads the authenticated user's contacts through `aura-customer`.
Saving normalizes a Russian phone number to +7 and validates email before POST;
only a successful server response is shown as saved. Contacts are not stored in
localStorage. Name editing retains the existing session-only behavior.

Verification reads the current KYC state, creates a hosted session through
`aura-kyc`, opens it through Telegram and offers a normal HTTPS continuation link.
An explicit refresh and returning to Telegram update the status. Session URLs
are transient and cleared when leaving the screen, never persisted. An unavailable
provider, rejected/terminal state and request failures are shown honestly.

Backend GET KYC does not register a new provider customer. Reads and session
creation do not clear saved contact hashes or unnecessarily upsert existing
customers. Contacts, KYC status and session responses use Cache-Control: no-store.
Ownership and provider credentials remain on the server.

The merge preserves FixedFloat, custody, mainnet balance reading and their
configuration/routes. This change does not switch production or the VSE preview,
install secrets, submit KYC documents or issue cards. Deployment is a separate step.
