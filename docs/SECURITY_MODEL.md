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

The conversation cleanup view applies to the active account's local transcript. It reviews selected threads, rechecks the stored snapshot, and commits the filtered snapshot before clearing the thread runtime. Cloud retention and saved Assistant memory have separate paths.

## Desktop Computer Control

The Electron main process stores a separate consent choice for each desktop profile and defaults to off. Only the current desktop settings main frame can change the choice. Direct tool calls and live previews require the owned app window. When consent is off, chat uses a direct model and the tool dispatcher admits only enumerated app functions such as sign-in and model settings. Local tools and explicit attachment review remain available. Saved settings survive desktop UI port changes. A saved change discards cached action continuations before a later request. Work already running and separate OS permissions are handled independently.

The workspace’s screen review opens without capturing. **Read text** starts the permission-checked OCR request. The captured pixels stay within the capture and OCR path. Users can edit the returned text before adding it as an attachment, and **Send** starts model review. Automatic progress previews display the workspace-managed browser when available.

The desktop web page review reads an already-open HTTP(S) document in the Jarvis browser. The desktop checks the active window, account and computer control across the read. The renderer receives bounded plain text, a title and an origin. The panel keeps this content in memory. Attaching and sending the reviewed text use the existing attachment flow.

The Open browser form requires a signed-in desktop workspace and Computer control. The desktop validates a credential-free HTTP(S) address or encodes a bounded query for Google, then hands the resulting URL to the default browser on submission. The tool keeps input outside conversation and model requests. The browser handles navigation and its own session.

The folder browser operates on the directory chosen in the system picker and keeps a local navigation scope. The desktop checks authorization, the current listing revision and directory or file identity. The renderer sends entry IDs. The browser skips symbolic links and returns bounded local listings and UTF-8 previews. Legacy file-pane previews stay out of the saved transcript.

The macOS app picker keeps a local catalog snapshot. Opening a result requires its current revision, ID and desktop authorization. The desktop checks the path and bundle metadata again before handing that exact path to macOS. The renderer provides a result ID.

The Spotify panel uses a bounded search term or a validated Spotify content ID to construct its web destination. The macOS transport accepts a fixed set of commands and a validated track URI. Apple Events require the user's macOS automation permission and a running Spotify app. The main app entitlement allows macOS to request consent in signed builds. The renderers still invoke the trusted desktop checks. The desktop keeps the player state and track details in the open panel. Model routes guide to that panel. [Apple hardened runtime resource access](https://developer.apple.com/documentation/xcode/configuring-the-hardened-runtime)

The Games panel reads launcher records locally and shows game names. It sends a name to the selected store when the user requests a lookup. Steam installation handoffs require an app ID selected from the current search in the same desktop permission revision. Store and launcher targets are constructed in the main process. Conversation routes guide users to the panel.

Coding project drafts contain bounded plain-text files and stay in the current desktop revision. The model receives only the project description and optional name entered for that draft. The main process keeps the reviewed copy and accepts it by ID for saving. Save requires a native folder choice and rechecks the active account and computer control. Portable relative paths, exclusive directory and file creation, and path conflict checks keep existing files outside the write. Opening the created folder or editor is a separate action.

OBS broadcast transitions require a trusted desktop window and a native confirmation. The desktop rechecks the account, computer-control revision, OBS connection, scene and output state before requesting the transition. Conversation routes direct users to the panel. Connection passwords are used for the live OBS handshake and are kept outside the conversation and configuration.

Direct file replacement requires the trusted desktop editor, active computer control, and a native confirmation tied to the resolved path and inspected file revision. The native handler checks the desktop/account context and file revision again before publishing. Automated file writes can only create a new destination. Publishing a new file uses an exclusive hard link on the destination filesystem. Replacement uses atomic rename after the revision check, so an external writer acting in the final check-to-rename interval is outside the revision guarantee.

## macOS Wake Word

The workspace starts native listening from a signed-in desktop main frame. Checking language support does not request permission or capture audio. Starting a session asks macOS for Speech Recognition and Microphone permission as needed. The helper requires Apple on-device speech recognition for every request and returns bounded text over a local process pipe. Ambient text is discarded by the wake parser. An accepted command follows the workspace's existing chat and local command paths. Browser speech recognition requires a separate selection.

The desktop limits native capture to one session in the current visible workspace. Hiding or minimizing the workspace, navigating away, signing out or quitting stops the helper. The desktop waits for the helper process to close before routing an accepted command. The helper's audio-input entitlement applies to that binary alone.

## Desktop Updates

The workspace and legacy main frames can request update checks and explicit installation handoffs. The macOS action opens the configured repository's GitHub releases page in the default browser. Native updates preserve the platform updater's signature-verification defaults. Installation starts when requested from the update controls.

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

Electron keeps the active Jarvis account in main-process memory through UI reloads. “Auto login” stores the account and token together in an OS-encrypted record inside the desktop profile. Linux supports libsecret and KWallet here. With no supported backend, Jarvis offers sign-in for the current app session and discards it on quit. Jarvis consults the OS key store when restoring an existing encrypted record or saving with Auto login. A failed persistent write can also fall back to that session mode when a previous record can be cleared. A failed sign-out is shown as an error so the user can retry.

The desktop workspace clears obsolete token and user keys from its current Web Storage origin when it restores, saves, or clears a session. It can migrate a decryptable legacy native session. Sign-out writes an inactive marker when a previous record exists to prevent legacy restoration. Earlier loopback origins and the legacy native file may retain historical data. This migration updates the current profile's active record. The standalone web origin keeps its existing storage behavior.

The browser and legacy planner return guidance to use the site's login form or Jarvis's saved-login flow when credentials are needed. The account session is handled by dedicated workspace IPC, outside the generic credential vault.
