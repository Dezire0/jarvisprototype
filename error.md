# 2026-05-06 Latest Errors

- The previous test branch was based on Jarvis `1.6.0` while the current upstream/release line is `1.8.9`. The updater correctly reported `1.8.9` as available, so the app under test was a stale code line.
- The stale `1.6.0` branch mixed new login patches with old UI/auth assumptions, which made login behavior hard to reason about.
- After moving to `1.8.9`, the current code still had two auth hazards:
  - Onboarding used `CURRENT_VERSION = "1.8.4"` and cleared `localStorage` plus Electron auth whenever the version marker changed.
  - Google OAuth still defaulted to `jarvis-desktop://auth`, which can hit stale macOS protocol registration instead of the running Jarvis Desktop.
- Runtime validation also revealed old stored tokens can fail against the current backend with `Unauthorized: Invalid session` / `signature mismatched`; these must be cleared through the unified auth-session path before asking the user to log in again.
