# Project Overrides

These instructions apply to the entire `codex-memory-fix` workspace in addition to any folder-local `AGENTS.md` files.

## Jarvis / OpenClaw

- Use the configured Jarvis runtime and the user's OpenClaw skill surfaces first when they already cover the task.
- Do not replace a Jarvis or OpenClaw path with ad-hoc browser scraping or one-off selector hacks unless there is no safer supported route.
- Prefer stable semantic automation: provider APIs, accessibility roles, visible labels, or Jarvis-tagged DOM ids over service-specific DOM ids, classes, and test ids.

## Issue Workflow

- Every non-trivial bug fix, automation change, or regression investigation must be tracked through an issue workflow first.
- If OpenClaw is available, create or update the related `/issue` entry before implementation and keep it current while the work changes.
- If the issue id is missing, call that out explicitly before proceeding instead of silently skipping issue tracking.

## Validation Logs

- Use `error.md` only for the latest observed errors.
- Use `errorarchive.md` only for fix history, validation notes, and what changed.
