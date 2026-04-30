# Latest error fixes

- Added deterministic direct-target parsing for mixed app and web open commands, including Chrome, Gmail, YouTube, GitHub, Notion, Discord, Slack, Spotify, Steam, Finder, Terminal, Notes, VS Code, and common Korean aliases.
- Added a new local `open_targets` route so chained commands like `크롬 켜고 Gmail 열어줘` no longer fall through to fake app-name extraction.
- Implemented `AssistantService.handleOpenTargets()` to open requested desktop apps and, when Chrome is part of the request, navigate Chrome directly to requested web targets.
- Narrowed workspace-app routing so bare commands like `디스코드 열어줘` use `app_open`, while workspace-specific commands with messages, DMs, channels, or `디스코드에서 ... 열어줘` still use `app_action`.
- Extended direct site URL handling so `Gmail 열어줘` maps to `https://mail.google.com/`.
- Fixed browser friendly-label inference so `mail.google.com` is labeled as Gmail/지메일 instead of Google/구글.
- Added regression tests for bare Discord opening, mixed Chrome + Gmail opening, direct Gmail browser labeling, and mixed-target command execution.
- Verified with `npm run check`, `npm run test:node`, `npm run dev`, direct transport curls, and a Playwright DOM submit smoke test.
