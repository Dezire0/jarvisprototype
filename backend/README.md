# Jarvis account and chat Worker

Use Node 24. Install the assistant UI workspace and build its local streaming package before installing the Worker dependencies.

```sh
corepack pnpm --dir "Jarvis Ui" install --frozen-lockfile
corepack pnpm --dir "Jarvis Ui" --filter assistant-stream build
npm --prefix backend ci
npm --prefix backend run check
npm --prefix backend run test:auth
npm --prefix backend run test:google
npm --prefix backend run test:cloud
```

The auth test creates a disposable local D1 database and generates its own signing keys. It checks registration, duplicate requests, existing account sign-in, account-scoped history, protected routes, and reauthentication after a key change. No production settings are required.

## Session signing

Authentication and protected API routes require the `JARVIS_SESSION_SIGNING_KEY` Worker secret. Use 32 independently random bytes encoded as 64 hexadecimal characters. Supply this as a private binding through the deployment platform and use a different key in each environment. For local development, use an untracked `backend/.dev.vars` file. See [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

Provision the new secret before activating a Worker version that requires it. A missing or malformed binding leaves the root health endpoint available and returns HTTP 503 from sign-in and protected routes. Deployment invalidates existing sessions signed by the previous key. Users can sign in again to reach their existing account and conversation records. Session rotation and deployment do not require a password or user-table migration.

The application request log contains the method and response status.

`0002_restore_user_profile.sql` adds the name, plan and usage columns referenced by the Worker. Existing rows retain their IDs, emails, passwords and model configuration. New columns get the declared defaults. Before releasing to an existing deployment, compare its migration ledger and user-table columns with the checked-in schema. A database where these columns were added manually requires migration reconciliation before running the additive migration.

## Google sign-in

Google sign-in requires the Worker client ID and secret bindings and the registered HTTPS `/api/auth/google-callback` redirect URL. The Worker opens a short-lived attempt, binds the Google response to the starting browser, and issues the Jarvis session only when the original app or web window redeems it. Jarvis credentials are returned in the authenticated exchange response. Browser return pages contain a status only. Local regression tests mock the provider. [Google OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server)

Apply `0003_google_sign_in_attempts.sql` before activating the new Worker. It adds the attempt store and a unique nullable Google subject to users. Google-only legacy accounts with a verified authoritative Gmail or Workspace address retain their existing account after their first successful sign-in. Other existing email accounts require an explicit identity link. Sign in using the existing email credentials when available. [Google identity guidance](https://developers.google.com/identity/sign-in/web/backend-auth)

The Worker and the app's Google sign-in UI need to be released together. The new Worker expects the new attempt protocol. Existing password sign-in and account IDs are preserved. Unfinished attempts expire after ten minutes. A completed attempt can be redeemed once or canceled from the original window.


## Managed cloud chat

The authenticated `/api/ai/chat` endpoint selects the current account's tier. Free uses `gemini-3.5-flash-lite`, and Pro uses `gemini-3.5-flash`. The same model IDs appear in `/api/ai/usage`. Set `JARVIS_CLOUD_FREE_MODEL` or `JARVIS_CLOUD_PRO_MODEL` as a Worker variable to substitute plain Gemini model IDs that support text generation. Set `GEMINI_API_KEY` as a private Worker secret. The provider key travels in the `x-goog-api-key` header to the Gemini API. [Google model catalog](https://ai.google.dev/gemini-api/docs/models) · [Google text generation API](https://ai.google.dev/api/generate-content)

Free usage counts successful messages and Pro usage counts reported tokens. The UTC date resets the daily counts. Requests already in flight near the cap can finish concurrently. Each successful reply updates the account count atomically. Failed requests and empty provider responses leave usage unchanged. Errors expose service categories and status rather than provider bodies. The local tests use a mock provider and disposable D1 data.
