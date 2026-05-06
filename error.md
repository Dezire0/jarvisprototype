# 2026-05-06 Latest Errors

- No reproducible browser follow-up or login regression remains in the current automated cycle.
- Validation gap: the logged-in chat surface could not be visually exercised end-to-end today because the current `Jarvis Ui/templates/cloud/app/onboarding-gate.tsx` flow auto-wipes local auth state on version change and the dev session stops at the login gate without a fresh authenticated session.
