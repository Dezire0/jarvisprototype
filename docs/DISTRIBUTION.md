# Distribution And Updates

Jarvis Desktop can now be packaged as a real desktop application instead of only running as an Electron dev shell attached to a live Next.js dev server.

## What is included in the packaged app

- Electron main process
- popup window and desktop window
- local assistant transport server on `127.0.0.1:8010`
- bundled assistant-ui / Next frontend from `Jarvis Ui/templates/cloud` by default
- optional original local Jarvis desktop renderer fallback
- auto-update checks through `electron-updater`

Desktop UI mode is controlled with `JARVIS_DESKTOP_UI_MODE`:

- `next` launches the bundled Next standalone server from `resources/desktop-ui/templates/cloud/server.js`
- `local` loads the original desktop renderer from `src/renderer/index.html`

If you do not set anything, the desktop app now defaults to `next`.

## Build commands

From the repo root:

```bash
npm run build:desktop-ui
npm run package:dir
```

Useful release targets:

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

If you already configured a publish target and want builder to publish update metadata and artifacts:

```bash
npm run release
```

Artifacts are written to `release/`.

Important update rule:

- a GitHub commit by itself does not update apps that are already installed
- the installed app only updates when a new packaged release is published to the configured update feed
- in this repo that means a new version tag and a GitHub Release or generic HTTPS update host
- if a packaged app was built without a native update feed, Jarvis now also has an installer-release fallback that checks the latest GitHub Release and opens the matching installer for the current platform

## Website-first download flow

If you want users to visit a website, click `Download`, and install the desktop app directly, the current Electron setup already supports that path.

What to ship from this repo:

- Windows installer such as `.exe`
- macOS installer such as `.dmg`
- optional Linux build such as `.AppImage`

What to host on your website:

- a download landing page
- direct links to the latest platform installers

The bundled Next app now supports a public download landing mode.

## macOS launch note for unsigned builds

If you distribute the macOS app before Apple Developer signing and notarization are in place, Gatekeeper may block the downloaded app even when the bundle itself is valid.

Symptoms:

- the app appears to install correctly but does not open from `Applications`
- Finder says the app cannot be opened or silently refuses to launch
- `spctl --assess --type execute` reports the bundle as rejected

Immediate workaround on the target Mac:

```bash
cd "/Users/JYH/Desktop/Jarvis Prototype"
npm run fix:mac-launch
```

If the app is being opened from a shell session that has `ELECTRON_RUN_AS_NODE=1`, use this safer launcher instead:

```bash
cd "/Users/JYH/Desktop/Jarvis Prototype"
npm run open:app
```

You can also pass a custom app path:

```bash
npm run fix:mac-launch -- "/Applications/Jarvis Desktop.app"
```

This removes the `com.apple.quarantine` attribute and opens the app once. The permanent production fix is still Developer ID signing plus notarization.

Public site environment variables:

```bash
NEXT_PUBLIC_JARVIS_SITE_MODE=download
NEXT_PUBLIC_JARVIS_WINDOWS_DOWNLOAD_URL=
NEXT_PUBLIC_JARVIS_MAC_DOWNLOAD_URL=https://github.com/Dezire0/jarvisprototype/releases/download/v0.1.3/Jarvis-Desktop-0.1.3-mac-arm64.dmg
NEXT_PUBLIC_JARVIS_LINUX_DOWNLOAD_URL=
NEXT_PUBLIC_JARVIS_RELEASE_NOTES_URL=https://github.com/Dezire0/jarvisprototype/releases
```

Routes:

- `/` shows the download landing when `NEXT_PUBLIC_JARVIS_SITE_MODE=download`
- `/download` always shows the download landing
- `/` continues to show the assistant app when `NEXT_PUBLIC_JARVIS_SITE_MODE` is left as `app`

This means you can build the same codebase in two modes:

- desktop packaged app mode
- public download website mode

## Dedicated install website for Cloudflare Workers

This repo now also includes a separate static install website at `site/install-web`.

What it is for:

- Apple-style public landing page
- Apple-like light / dark theme toggle
- pre-install agreement / consent flow
- OS-specific install wizard
- explicit explanation of when auto-updates do and do not happen
- direct deployment to Cloudflare Pages with static assets
- real GitHub Release assets only, with pending platforms shown honestly

How it gets its public download URLs:

- `scripts/sync-install-site-config.cjs` reads the root `.env` / `.env.local`
- it inspects the GitHub Release for the current `package.json` version when `gh` is available
- it writes the public config into `site/install-web/public/config.js`

Useful commands from the repo root:

```bash
npm run site:install:sync
npm run site:install:dev
npm run site:install:deploy
```

Cloudflare Pages project files:

- `site/install-web/wrangler.toml`
- `site/install-web/public/index.html`
- `site/install-web/public/styles.css`
- `site/install-web/public/script.js`

Notes:

- `npm run site:install:deploy` requires `wrangler` login on the machine.
- the generated public site prefers actual GitHub Release assets for the current version and falls back to `NEXT_PUBLIC_JARVIS_*_DOWNLOAD_URL` only when needed.
- if you only want to refresh the public installer catalog, rerun `npm run site:install:sync`.
- current public URL: `https://dexproject.pages.dev`

## Production macOS signing and notarization

Jarvis Desktop now includes a production signing/notarization hook for macOS builds.

What the build now does:

- signs the app with hardened runtime enabled
- applies Electron-safe entitlements for JIT, native libraries, and microphone input
- runs an `afterSign` notarization step when Apple credentials are configured

The notarization hook supports three auth modes:

1. `APPLE_KEYCHAIN_PROFILE`
2. `APPLE_API_KEY` plus optional `APPLE_API_ISSUER`
3. `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`

Recommended setup on a Mac dev machine:

```bash
xcrun notarytool store-credentials "jarvis-notary" \
  --key "/absolute/path/AuthKey_ABC1234567.p8" \
  --key-id "ABC1234567" \
  --issuer "00000000-0000-0000-0000-000000000000"

export APPLE_KEYCHAIN_PROFILE=jarvis-notary
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
export JARVIS_REQUIRE_NOTARIZATION=1
```

Then build:

```bash
npm run doctor:mac-signing
npm run dist:mac
```

Manual validation after a successful notarized build:

```bash
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/Jarvis Desktop.app"
spctl -a -vvv --type exec "release/mac-arm64/Jarvis Desktop.app"
xcrun stapler validate "release/mac-arm64/Jarvis Desktop.app"
```

## Update provider options

`electron-builder.config.cjs` supports two release/update modes.

### 1. Generic HTTPS host

Use this when you want to host update files on any static HTTPS location such as Cloudflare R2, S3 + CloudFront, a VPS, or your own download domain.

Environment variables:

```bash
JARVIS_UPDATER_PROVIDER=generic
JARVIS_UPDATE_BASE_URL=https://downloads.example.com/jarvis/latest
JARVIS_UPDATE_CHANNEL=latest
```

For the generic provider, builder creates metadata files such as `latest.yml`, but you must upload the artifacts and metadata yourself.

Supabase Storage is optional here. It is not required for code signing, notarization, or auto updates. If you want, you can use Supabase only as a static file host, but GitHub Releases or any HTTPS bucket/CDN works just as well.

### 2. GitHub Releases

Use this when you want GitHub to be your release host.

Environment variables:

```bash
JARVIS_UPDATER_PROVIDER=github
JARVIS_GITHUB_OWNER=Dezire0
JARVIS_GITHUB_REPO=jarvisprototype
JARVIS_GITHUB_RELEASE_TYPE=release
JARVIS_GITHUB_PRIVATE=0
GH_TOKEN=...
```

This repo also includes a release workflow at `.github/workflows/release-desktop.yml`.

What it does:

- triggers on `v*` tags or manual dispatch
- checks that the tag matches `package.json` version
- builds macOS, Windows, and Linux artifacts
- runs `npm run release` so Electron Builder publishes installer files and update metadata to GitHub Releases

## Recommended release flow

1. Bump `version` in `package.json`.
2. Export your updater environment variables, or configure the matching GitHub Actions secrets.
3. Create a release tag such as `v0.1.1` and push it, or run `.github/workflows/release-desktop.yml` manually.
4. Let the workflow publish the generated installer files and update metadata to GitHub Releases, or run `npm run release` yourself if you are publishing locally.
5. If you are using the public website flow, deploy the install site so its download buttons point at the same real release assets.
6. Install the old version on another machine.
7. Publish the new version metadata and installer files.
8. In the installed app, use `Help -> Check for Updates...`, or wait for the startup check.

In short:

- commit only: source code changes, no installed app update
- tag + packaged release: installed app can detect and download the update

## Operational notes

- macOS auto-update requires a signed and notarized application build.
- Windows auto-update expects an installed Windows build such as the generated NSIS installer.
- If no publish target is configured, the packaged app still runs normally, but update checks remain disabled.
- Linux packaging is supported, but update behavior depends on the generated target and your delivery strategy.
