# Latest error fixes

- Changed routing policy so local fallback routes are no longer executed directly before the LLM router gets a chance to judge the command.
- Removed the router's `localOnly: true` path and model override, allowing the configured fast conversation provider, such as Gemini, to perform semantic intent routing.
- Expanded the router schema/prompt to include `open_targets`, `targets.apps`, and `targets.web`.
- Added installed-app names as router context so the LLM can return clean app names instead of full user sentences.
- Replaced launch-verb-based `extractAppName()` with known-app mention extraction:
  - quoted app names are preserved,
  - known app aliases return canonical app labels,
  - unknown app names are left empty for the LLM/router or clarification flow.
- Hardened `handleAppOpen()` so unresolved app names are not passed directly to `open -a`; Jarvis asks for clarification instead.
- Added regression tests for LLM-first/fallback behavior, known-app mention extraction, and unresolved full-sentence app-name safety.
