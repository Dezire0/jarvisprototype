# 2026-05-06 Latest Errors

- Google OAuth completion still opened the bare/default Electron welcome screen instead of returning to the running Jarvis Desktop app.
- Root cause: the desktop OAuth return path depended on the OS-level `jarvis-desktop://auth` protocol association. In development, macOS can keep that protocol associated with Electron's default app shell or a stale app registration, so the callback can launch the wrong Electron surface.
- User impact: after clicking Google login, authentication could complete in a browser/popup but Jarvis Desktop would not receive the session reliably, leaving the user at the login/onboarding screen.
- Validation target: OAuth return must no longer rely on custom protocol registration. The callback should be delivered directly to the already-running Jarvis Desktop process.
