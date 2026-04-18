# Jarvis Extensions

Jarvis now supports a lightweight extension registry so we do not have to depend on Claude-specific internals.

The goal is not to copy proprietary runtime code one-to-one. Instead, this project now has its own safe equivalent for the parts that matter most in desktop use:

- `webhooks`
  - Trigger external services from natural-language phrases
- `skills`
  - Inject app-specific planning hints into Jarvis app control
- `connectors`
  - Map aliases to real app names and add app-specific behavior hints

## Where Jarvis loads extensions from

Jarvis reads `.json` manifests from:

1. `extensions/` in the project root
2. the app user-data `extensions/` folder

Only top-level `.json` files are loaded. Example files can live under `extensions/examples/`.

## Manifest kinds

### Connector

Use connectors when users call the same app by many names and you want Jarvis to normalize them.

```json
{
  "kind": "connector",
  "name": "todoist",
  "connector": {
    "canonicalName": "Todoist",
    "aliases": ["투두이스트", "할일앱"],
    "planningHints": [
      "Use quick add when creating a task."
    ]
  }
}
```

### Skill

Use skills when a specific app needs extra planning instructions.

```json
{
  "kind": "skill",
  "name": "todoist-priority",
  "apps": ["Todoist"],
  "instructions": "Prefer concise task titles and due dates when the user mentions a deadline."
}
```

### Webhook

Use webhooks when a phrase should call an external service.

```json
{
  "kind": "webhook",
  "name": "deploy-runner",
  "match": {
    "phrases": ["배포 시작", "run deploy"]
  },
  "webhook": {
    "url": "https://example.com/webhook",
    "method": "POST",
    "responsePath": "reply"
  }
}
```

## How it works

- Connector aliases are applied before Jarvis resolves an app target.
- Skill hints are injected into the app-planning prompt.
- Matching webhooks run before normal intent routing.

## Notes

- Invalid manifests are skipped so one bad file does not break the app.
- You can reload manifests through the internal tool route `extensions:reload`.
- Environment variables can be interpolated with `${VAR_NAME}` inside webhook URLs and headers.
