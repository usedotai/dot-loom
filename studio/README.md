# Dot Loom Studio

Dot Loom Studio is the local visualization surface for Dot Loom.

It is not a hosted dashboard. It is a developer tool for inspecting how a multi-model run moves through router, drafter, critic, and finalizer roles.

## Run

From the repository root:

```bash
npm run studio:install
npm run studio
```

Default URL:

```txt
http://localhost:3955
```

## Modes

- `DEMO`: deterministic visual run, no provider calls.
- `CLI-MOCK`: real CLI execution with mock provider.
- `CLI-DOT`: real CLI execution with `DOT_API_KEY`.
- `CLI-BYOK`: real CLI execution with a provider configured from the UI.

## BYOK Handling

BYOK mode accepts:

- Dot API keys.
- OpenRouter keys.
- OpenAI-compatible gateway keys.
- Ollama local endpoints.
- Mock provider configs.

The local bridge writes a temporary config under the OS temp directory and deletes it after the run exits. Pasted keys are not stored in this repository.

## Scope

The Studio intentionally explains orchestration rather than hiding it. It surfaces:

- role selection
- provider and model IDs
- live token trace
- adaptive plan steps
- access-list boundaries
- final answer synthesis
- rough timing and token counts
