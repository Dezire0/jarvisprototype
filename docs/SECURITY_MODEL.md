# Security Model

## What We Will Support

- user-approved desktop automation
- app launching and browser navigation
- reading the active screen with permission
- using existing logged-in browser sessions
- using the OS password manager or browser autofill where the user already approved it
- storing automation credentials in an OS-encrypted local vault when the user explicitly saves them

## What We Will Not Do

- store raw website passwords in the assistant
- silently scrape credentials out of browsers
- claim unrestricted administrator control over the whole machine by default
- perform destructive or sensitive actions without clear user confirmation

## Safe Alternative to "Auto Login Everywhere"

For websites and apps, the right pattern is:

1. Reuse the user's existing authenticated session when possible.
2. If a site needs login, open the real login page.
3. Let the browser or OS password manager fill credentials if the user already saved them, or use the assistant's secure local vault if the user explicitly entered them there.
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
