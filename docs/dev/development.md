# Development and testing

This document is for contributors maintaining this repository.

## First-time setup

```bash
bun install
bun run check
bun run test:unit
bun run test:e2e
```

Optional: `bunx lefthook install` to enable the configured pre-commit hooks.

## Toolchain

- TypeScript 6
- Bun for package management and tests
- Biome for formatting/linting
- Lefthook for git hooks
- Node-compatible CLI bundle for users

Use the existing scripts:

```bash
bun run check
bun run test:unit
bun run test:e2e
bun run build
PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py
git diff --check
```

## Repository layout

- `src/commands/` — one module per CLI command.
- `src/lib/` — shared CLI primitives (schemas, evidence, paths, exit codes).
- `schemas/` — versioned JSON Schemas.
- `examples/` — packaged examples, fixtures, and this repository's CI recipe.
- `examples/fixtures/` — schema-valid and intentionally invalid fixtures, indexed by `manifest.json`.
- `tests/cli/`, `tests/schemas/`, `tests/ci-tests/`, `tests/e2e/`, `tests/unit-tests/` — corresponding test suites.
- `plans/harness-engineering-platform/` — roadmap, decisions, execution status, and capability ledger.

## Change checklist by area

| Change type | Required companion updates |
|---|---|
| Schema shape | schema, examples, fixtures, validation tests, evidence guide |
| CLI behavior | unit/e2e tests, CLI guide, evidence guide if artifacts change |
| Package contents | package smoke/e2e, distribution section of README |
| CI recipe (`examples/ci/*`) | `tests/ci-tests/`, CI guide |
| Judge policy | calibration evidence, thresholds, sample count, freshness, policy digest tests |
| Capability ledger | `plans/harness-engineering-platform/capability-ledger.yaml`, related plan/todo entries |

## Package smoke

The package is not published yet. The e2e suite validates package shape by running a dry pack and a packed-content smoke. To inspect the package manually:

```bash
bun run build
bun pm pack --dry-run --ignore-scripts
```

The package should include `dist`, `schemas`, `examples`, `skills`, `docs`, `README.md`, and `LICENSE`. It should not include source, tests, plans, or `.harness` runtime artifacts.

## Fixture validation

Schema fixtures are declared in `examples/fixtures/manifest.json` and validated by:

```bash
PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py
```

Keep invalid fixtures focused: each fixture should fail for the manifest-declared reason.

## Schema and migration policy

- Schema changes need matching example, fixture, and test updates landed together.
- Never silently bump a schema version — use `harness migrate` evidence. Migrations currently emit dry-run/no-op evidence; `--apply` is rejected until a real migration ships.
- New schema fields should be additive when possible; required shape changes need migration evidence and updated fixtures.

## Documentation rules

- `README.md` is user-facing.
- `docs/guides/` is user-facing.
- `docs/dev/` is contributor-facing.
- Planning and execution history live in `plans/harness-engineering-platform/`.
- Do not add roadmap phase wording outside the planning slug.

## Safe change process

When a change modifies user-visible behavior, update the relevant guide and tests in the same change. When a change modifies substrate semantics, update schemas, examples, fixtures, and docs together.

Do not commit secrets, hidden credential assumptions, or unbounded model-spend behavior. Live execution work must include explicit credential references, budget gates, trace policy, and sandbox/trust requirements.
