# Contributing to Dot Loom

Dot Loom welcomes provider adapters, evaluation suites, pipeline profiles, report improvements, and reproducible benchmark submissions.

## Local verification

```bash
npm --prefix studio install
npm run verify
```

The CLI has no runtime dependencies. Tests use Node's built-in test runner.

## Pull requests

- Keep changes focused and explain the user-visible outcome.
- Add tests for runtime, scoring, pricing, or report behavior.
- Do not commit API keys, `.env` files, private prompts, or provider payloads containing secrets.
- Preserve provider/model identifiers in benchmark receipts, but remove user and machine identifiers.
- Run `npm run verify` before requesting review.

## Benchmark submissions

A benchmark PR should include:

1. the public or redistributable JSONL dataset, or an exact retrieval script and revision;
2. the complete non-secret config and model map;
3. run date, iteration count, temperature, token caps, and concurrency;
4. pricing source/date or native provider payment receipts;
5. raw JSON plus generated Markdown/HTML/SVG artifacts;
6. judge model and rubric policy, if used;
7. a clear exploratory or confirmatory label;
8. limitations and cases where Loom lost.

Follow [docs/BENCHMARKING.md](docs/BENCHMARKING.md). Small smoke results are welcome when labeled honestly; they should not be presented as universal performance claims.

## Adding a dataset case

Each JSONL line requires `id` and `prompt`. Public suites should also provide task-specific `rubric` and deterministic `checks`:

```json
{"id":"example","pipeline":"code-review","prompt":"Review this endpoint.","rubric":"Identify the concrete invariant and test it.","checks":[{"type":"contains","value":"test"}]}
```

Supported check types are `contains`, `contains-any`, and `not-contains`.

## Reporting security issues

Do not open a public issue for credential, prompt, response, or temporary-config leakage. Follow [SECURITY.md](SECURITY.md).
