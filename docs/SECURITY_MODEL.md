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
