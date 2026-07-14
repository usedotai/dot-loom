# Security

Dot Loom is a local orchestration framework. Treat provider keys and prompts as sensitive.

## Key Handling

- Prefer `env:NAME` in config files.
- Do not write real API keys into example configs.
- Do not commit `.env` files.
- Rotate any key that was pasted into chat logs, terminal history, screenshots, or public issues.

## Studio BYOK Mode

The Studio bridge accepts provider keys over localhost and creates a temporary config outside the repository. The temp config is deleted after the run exits.

The bridge binds to `127.0.0.1` by default. Setting `HOST` to a network interface exposes the bridge beyond localhost and should only be done on a trusted network with additional access controls.

This is suitable for local experimentation. It is not a hosted secret-management system.

## Reporting

If you find a bug that can leak provider keys, prompts, model responses, or temporary configs, open a private report with a minimal reproduction.
