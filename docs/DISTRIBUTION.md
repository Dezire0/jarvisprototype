# Distribution And Updates

Jarvis Desktop can now be packaged as a real desktop application instead of only running as an Electron dev shell attached to a live Next.js dev server.

## What is included in the packaged app

- Electron main process
- popup window and desktop window
- local assistant transport server on `127.0.0.1:8010`
- bundled assistant-ui desktop frontend built from `Jarvis Ui/templates/cloud`
- auto-update checks through `electron-updater`

In packaged builds, the app launches its own bundled Next standalone server from `resources/desktop-ui/templates/cloud/server.js`, then points the desktop window at that local URL.

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

Public site environment variables:

```bash
NEXT_PUBLIC_JARVIS_SITE_MODE=download
NEXT_PUBLIC_JARVIS_WINDOWS_DOWNLOAD_URL=
NEXT_PUBLIC_JARVIS_MAC_DOWNLOAD_URL=https://github.com/Dezire0/jarvisprototype/releases/download/v0.1.0/Jarvis-Desktop-0.1.0-mac-arm64.dmg
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

## Recommended release flow

1. Bump `version` in `package.json`.
2. Export your updater environment variables.
3. Run the platform build you need, or `npm run release`.
4. Upload the generated installer files from `release/` to GitHub Releases or your HTTPS host.
5. If you are using the public website flow, update the `NEXT_PUBLIC_JARVIS_*_DOWNLOAD_URL` values and deploy the website build.
6. Install the old version on another machine.
7. Publish the new version metadata and installer files.
8. In the installed app, use `Help -> Check for Updates...`.

## Operational notes

- macOS auto-update requires a signed and notarized application build.
- Windows auto-update expects an installed Windows build such as the generated NSIS installer.
- If no publish target is configured, the packaged app still runs normally, but update checks remain disabled.
- Linux packaging is supported, but update behavior depends on the generated target and your delivery strategy.
