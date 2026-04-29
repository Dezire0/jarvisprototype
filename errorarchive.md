# Latest error fixes

- Merged `origin/main` into local `main`, then merged `origin/feat/windows-tts` with a merge commit.
- Added `src/main/browser-service.cjs` as a compatibility wrapper around `src/main/beta/browser-service-beta.cjs`, restoring legacy `loginWithStoredCredential()`, `executePlan()`, page snapshot, search, fill, and click helpers expected by existing tests/callers.
- Restored deterministic external-browser handling in `AssistantService.handleBrowser()` for simple open/search plans and manual-login continuation plans before falling through to the ReAct browser loop.
- Added `AssistantService.polishCommandReply()` fallback behavior so existing command handlers no longer throw when polishing is skipped or unavailable.
- Changed external browser open mode back to `system-browser` for compatibility with existing route results.
- Guarded `UpdaterService.updateStatus()` so Electron-free test runtimes do not crash when `BrowserWindow.getAllWindows()` is unavailable.
- Verification passed: `npm run check`, `npm run test:node` with 66/66 passing, and `npm run dev` reached Next ready state plus Electron login screen render.
- Release prep: bumped desktop app version metadata to `1.8.9` for the next GitHub Release workflow.
