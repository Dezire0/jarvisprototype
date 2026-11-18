# Security Model

## What We Will Support

- user-approved desktop automation
- app launching and browser navigation
- reading the active screen with permission
- using existing logged-in browser sessions
- using the OS password manager or browser autofill where the user already approved it
- storing automation credentials only when the user explicitly saves them
- keeping credential metadata in `~/.friday-jarvis/credentials.json` and passwords in the OS keychain when available

## What We Will Not Do

- store raw website passwords in the assistant
- silently scrape credentials out of browsers
- claim unrestricted administrator control over the whole machine by default
- perform destructive or sensitive actions without clear user confirmation

## Shared Credential Model

- Electron and Python use the same normalized site key, for example `github.com`.
- Login metadata such as username and login URL is stored in `~/.friday-jarvis/credentials.json`.
- Passwords are stored in the OS keychain on macOS when available.
- Older Electron-only credential files are treated as migration input, not the long-term source of truth.

## Desktop Workspace Recall

The current desktop chat main frame supplies the account namespace over its process-scoped local Assistant connection. Each namespace has a separate transcript and recall database. The anonymous and temporary chat paths do not load persistent Assistant recall. The legacy command entry point uses its pre-existing device store. Account separation relies on the trusted desktop renderer and does not encrypt the on-device files or replace operating-system account isolation.

## Desktop Computer Control

The Electron main process stores a separate consent choice for each desktop profile and defaults to off. Only the current desktop settings main frame can change the choice. Direct tool calls and live previews require the owned app window. When consent is off, chat uses a direct model and the tool dispatcher admits only enumerated app functions such as sign-in and model settings. Local tools and explicit attachment review remain available. Saved settings survive desktop UI port changes. A saved change discards cached action continuations before a later request. Work already running and separate OS permissions are handled independently.

## Safe Alternative to "Auto Login Everywhere"

For websites and apps, the right pattern is:

1. Reuse the user's existing authenticated session when possible.
2. If a site needs login, open the real login page.
3. Let the browser or OS password manager fill credentials if the user already saved them, or use the assistant's shared secure local vault if the user explicitly entered them there.
4. For services with APIs, use OAuth or app-specific tokens instead of raw passwords.

This gives a Jarvis-like experience without turning the assistant into a credential harvester.

## Privilege Tiers

### Tier 1: Default

- chat
- voice
- open apps
- open URLs
- read visible UI state

### Tier 2: Trusted Automation

- controlled browser automation
- file access in approved folders
- screen OCR
- structured integrations like OBS

### Tier 3: Sensitive

- sending messages
- editing important files
- executing shell commands
- changing account settings

Tier 3 actions should require explicit confirmation and logging.

## Desktop account session

Electron keeps the active Jarvis account in main-process memory through UI reloads. “Auto login” stores the account and token together in an OS-encrypted record inside the desktop profile. Linux supports libsecret and KWallet here. With no supported backend, Jarvis offers sign-in for the current app session and discards it on quit. A failed persistent write can also fall back to that session mode when a previous record can be cleared. A failed sign-out is shown as an error so the user can retry.

The desktop workspace clears obsolete token and user keys from its current Web Storage origin when it restores, saves, or clears a session. It can migrate a decryptable legacy native session. Sign-out writes an inactive marker when a previous record exists to prevent legacy restoration. Earlier loopback origins and the legacy native file may retain historical data. This migration updates the current profile's active record. The standalone web origin keeps its existing storage behavior.

The browser and legacy planner return guidance to use the site's login form or Jarvis's saved-login flow when credentials are needed. The account session is handled by dedicated workspace IPC, outside the generic credential vault.
