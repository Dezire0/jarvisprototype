# Latest error fixes

- Added verified missing-app recovery metadata for web-runnable apps and CLI-style tools.
- When a requested app is not installed, Jarvis now says it is missing and asks whether to open the official web app, open the install route, or show commands where applicable.
- Added OpenClaw-specific guidance from the official install/GitHub flow:
  - quick install via `curl -fsSL https://openclaw.ai/install.sh | bash`,
  - npm install via `npm install -g openclaw@latest && openclaw onboard --install-daemon`,
  - source install via `git clone https://github.com/openclaw/openclaw.git`, `pnpm install`, `pnpm ui:build`, `pnpm build`, `pnpm link --global`,
  - post-install checks via `openclaw doctor`, `openclaw status`, and `openclaw dashboard`.
- Changed missing app handling so Jarvis no longer auto-opens an install page from `[ACTION: OPEN_APP]`; it goes through the explicit recovery prompt.
- Added Playwright-first handling for official install/download/verification browser tasks.
- Updated browser ReAct prompts so configured API routing keeps the current conversation context, and local fallback receives the same context instead of behaving like a fresh session.
- Updated platform capability reporting from generic planned browser automation to `playwright + system-browser fallback`.
- Added regression tests for:
  - missing app official web fallback,
  - OpenClaw missing CLI command guidance,
  - Playwright preference for official install/verification browser pages.
