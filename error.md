# Latest test errors

Current status: resolved. `npm run check`, `npm run test:node`, and `npm run dev` startup verification passed after fixes.

Historical errors from this automation:

- `npm run test:node` failed after merging `origin/feat/windows-tts` into `main`.
- `tests/node/browser-service.test.cjs` could not load `../../src/main/browser-service.cjs` because the browser service implementation now lives under `src/main/beta/browser-service-beta.cjs`.
- `tests/node/assistant-service.test.cjs` browser routing tests failed because `handleBrowser()` routed simple external browser plans through the ReAct browser path instead of the deterministic external-browser path.
- `handleBrowserLogin()` threw `TypeError: this.polishCommandReply is not a function` because multiple command handlers call the method but the class does not define it.
- `tests/node/updater-service.test.cjs` failed with `Cannot read properties of undefined (reading 'getAllWindows')` because `UpdaterService.updateStatus()` assumes Electron `BrowserWindow` exists in the test runtime.
- After the first fix pass, remaining failures were compatibility issues: `openBrowserTargetForUser()` returned `external-browser` where existing callers expect `system-browser`, and the new browser-service shim did not expose legacy `loginWithStoredCredential()` / `executePlan()` helpers.
