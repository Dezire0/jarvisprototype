---
"@assistant-ui/react": patch
"@assistant-ui/core": patch
---

Allow AssistantTransport converters to supply authoritative message repository snapshots and optionally require an explicit stream finish event.

Avoid walking ancestor chains when initially linking messages during repository imports. Preserve cycle checks when moving existing messages.
