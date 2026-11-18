# Jarvis account and chat Worker

Use Node 24. Install the assistant UI workspace and build its local streaming package before installing the Worker dependencies.

```sh
corepack pnpm --dir "Jarvis Ui" install --frozen-lockfile
corepack pnpm --dir "Jarvis Ui" --filter assistant-stream build
npm --prefix backend ci
npm --prefix backend run check
npm --prefix backend run test:auth
```

The auth test creates a disposable local D1 database and generates its own signing keys. It checks registration, duplicate requests, existing account sign-in, account-scoped history, protected routes, and reauthentication after a key change. No production settings are required.

## Session signing

Authentication and protected API routes require the `JARVIS_SESSION_SIGNING_KEY` Worker secret. Use 32 independently random bytes encoded as 64 hexadecimal characters. Supply this as a private binding through the deployment platform and use a different key in each environment. For local development, use an untracked `backend/.dev.vars` file. See [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

Provision the new secret before activating a Worker version that requires it. A missing or malformed binding leaves the root health endpoint available and returns HTTP 503 from sign-in and protected routes. Deployment invalidates existing sessions signed by the previous key. Users can sign in again to reach their existing account and conversation records. Session rotation and deployment do not require a password or user-table migration.

The application request log contains the method and response status. For Google callback transport privacy, review any platform access logs and browser history independently.

`0002_restore_user_profile.sql` adds the name, plan and usage columns referenced by the Worker. Existing rows retain their IDs, emails, passwords and model configuration. New columns get the declared defaults. Before releasing to an existing deployment, compare its migration ledger and user-table columns with the checked-in schema. A database where these columns were added manually requires migration reconciliation before running the additive migration.

Google sign-in requires the corresponding Worker client ID and client secret bindings. Local regression tests do not contact Google.
