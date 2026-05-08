# Jarvis Prototype Codex Harness

This repository uses an issue-first workflow. Codex must follow this harness before starting any new feature, bug fix, refactor, or behavior change.

## Issue-First Rule

- Do not start implementation work for a feature or bug fix until there is a GitHub issue that describes the work.
- If the user asks for work without an issue, create a GitHub issue first when GitHub access is available.
- If GitHub access is not available, ask the user for permission to proceed without creating the issue and include the missing issue as a blocker in the final response.
- Use the issue number in the branch name, commit message, and PR body.
- Keep unrelated cleanup in a separate issue and branch.

## Required Issue Detail

Every feature or bug issue must include:

- Summary: What should change.
- Motivation or Problem: Why the change is needed.
- Current Behavior: What happens now.
- Expected Behavior: What should happen after the fix.
- Scope: Files, surfaces, or user flows likely affected.
- Acceptance Criteria: Concrete checks that prove the work is done.
- Verification Plan: Commands or manual checks to run.

For bug fixes, also include:

- Reproduction Steps.
- Actual Result.
- Expected Result.
- Environment, when relevant.

For new features, also include:

- User Flow.
- Non-goals.
- UX or settings expectations, when relevant.

## Branching

- Create one branch per issue.
- Branch names should be short and include the issue number.
- Preferred formats:
  - `issue-<number>-short-topic`
  - `fix-<number>-short-topic`
  - `feat-<number>-short-topic`

## Implementation

- Read the issue and confirm the intended behavior before editing.
- Keep edits scoped to the issue.
- Preserve existing project patterns unless the issue explicitly asks for a new architecture.
- Do not remove large copied/vendor/reference folders unless the issue is specifically about repository cleanup.

## Verification

Choose checks based on the files touched. Prefer the smallest meaningful set first, then broaden if the change crosses service boundaries.

- JavaScript syntax checks for changed CommonJS files:
  - `node --check path/to/file.cjs`
- Node tests:
  - `npm run test:node`
  - or targeted `node --test tests/node/<name>.test.cjs`
- Assistant UI TypeScript:
  - `corepack pnpm --dir "Jarvis Ui" --filter assistant-ui-starter-cloud exec tsc --noEmit`
- Full project check:
  - `npm run check`

Record the exact checks run in the PR body.

## Pull Requests

- PR title should summarize the issue outcome.
- PR body must include `Closes #<issue-number>`.
- Include summary, verification, and residual risks.
- Do not merge until verification is recorded.

## Merge Flow

- After solving the issue and completing verification, create a commit on the issue branch.
- Push the local issue branch to the remote repository.
- Open a PR from the issue branch into `dev` first.
- Review the PR for code conflicts, unexpected file changes, and missing verification before merging.
- Merge into `dev` only after the PR is clean and verification is recorded.
- After `dev` is confirmed healthy, open a second PR from the same remote issue branch into `main`.
- Review the issue-branch to `main` PR for conflicts and verification notes before merging.
- Merge into `main` only after `dev` has no known issue from the change.
- After the `main` merge is complete, delete the pushed remote issue branch.
- Keep the local repository on `main` or `dev` after cleanup, not on a deleted issue branch.
