# Jarvis account and chat Worker

Use Node 24. Install the assistant UI workspace and build its local streaming package before installing the Worker dependencies.

```sh
corepack pnpm --dir "Jarvis Ui" install --frozen-lockfile
corepack pnpm --dir "Jarvis Ui" --filter assistant-stream build
npm --prefix backend ci
npm --prefix backend run check
npm --prefix backend run test:auth
```

The auth test creates a disposable local D1 database. It migrates the previous schema containing an existing account, then checks registration, concurrent duplicate requests, sign-in and the model-key presence flag without exposing key data.

`0002_restore_user_profile.sql` adds the name, plan and usage columns referenced by the Worker. Existing rows retain their IDs, emails, passwords and model configuration. New columns get the declared defaults. Before releasing to an existing deployment, compare its migration ledger and user-table columns with the checked-in schema. A database where these columns were added manually requires migration reconciliation before running the additive migration.

Google sign-in requires the corresponding Worker client ID and client secret bindings. Local regression tests do not contact Google.
