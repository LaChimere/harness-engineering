# Harness Engineering

`LaChimere/harness-engineering` is a harness-as-code platform for AI coding agents.

The product gives a repository a versioned `harness.yaml`, machine-checkable schemas, and a deterministic `harness` CLI so agent work can be validated, evaluated, traced, assessed, and maintained with evidence instead of chat-only claims.

## What works today

- Initialize a downstream repository with `harness init`.
- Validate `harness.yaml`, schema ranges, and local artifact references.
- Run structural doctor checks and declared local health checks.
- Run deterministic stub agent tasks, verifier-only evals, behavioral evals, trace validation, and reports.
- Import externally generated candidate output as evidence without pretending it was a live model call.
- Run GC audits and recurring GC-stability profiles over existing evidence.
- Use an optional GitHub Actions recipe that calls the same CLI and uploads `.harness/**` evidence.

Current limits are explicit: the package is not published to a registry, no host plugin or native skill package is shipped, no scheduler daemon is included, and provider-backed live model execution is not implemented.

## Prerequisites

- [Bun](https://bun.sh/) to build this checkout.
- Node.js 16 or newer to run the bundled CLI.

## Quickstart

The package is not yet published to a registry. Today you build the CLI from this checkout and invoke the bundled `dist/index.js` from the repository you want to harness:

```bash
# From this checkout:
bun install
bun run build
export HARNESS_BIN="$(pwd)/dist/index.js"

# From the repository you want to harness:
cd /path/to/target/repo
node "$HARNESS_BIN" init
node "$HARNESS_BIN" validate
node "$HARNESS_BIN" health --accept-unsandboxed-execution --format json --output .harness/health/quickstart-health.json
node "$HARNESS_BIN" assess --format json --health-result .harness/health/quickstart-health.json
```

`harness init` writes a starter `harness.yaml`, curated `examples/` artifacts, and local `.harness/` artifact directories. The starter path uses local validation, declared health checks, deterministic examples, GC evidence, and profile handoffs; it does not need secrets or live model credentials.

For a package-shaped smoke test, run `bun pm pack --ignore-scripts`, unpack the tarball in a scratch directory, and invoke the bundled `dist/index.js` from that unpacked package. The e2e suite covers this packed-content path without claiming registry publication.

### Invocation convention

For brevity, the guides write commands as `harness <command>`. Until the package is published, substitute one of:

| Where you run | Substitution |
|---|---|
| In this checkout after `bun run build` | `node dist/index.js <command>` |
| In a downstream repo (after `export HARNESS_BIN=…`) | `node "$HARNESS_BIN" <command>` |
| After registry publication (future) | `harness <command>` |

Behavior is identical in all three forms.

## Try the bundled examples

These commands run from this repository against the bundled `examples/` fixtures and are useful for exploring command output without `harness init`-ing a downstream repo:

```bash
node dist/index.js validate --file examples/harness.yaml
node dist/index.js doctor --file examples/harness.yaml
node dist/index.js health --file examples/harness.yaml --accept-unsandboxed-execution
node dist/index.js run examples/evals/harness-self-test/v1.0.0/task.yaml --file examples/harness.yaml
node dist/index.js eval validate --file examples/harness.yaml
node dist/index.js eval run --file examples/harness.yaml
node dist/index.js trace validate --file examples/harness.yaml
node dist/index.js gc audit --file examples/harness.yaml
node dist/index.js profile validate examples/profiles/gc-stability.yaml
node dist/index.js profile run examples/profiles/gc-stability.yaml --gc-evidence examples/gc/evidence.json --health-result examples/health/results/pass.json
node dist/index.js runner readiness --file examples/harness.yaml
node dist/index.js report --file examples/harness.yaml --doctor-result examples/doctor/results/pass.json
```

The `examples/gc/`, `examples/health/results/`, and `examples/doctor/results/` paths only exist in this repository. A downstream repo should run the equivalent commands against its own `.harness/` evidence produced by `doctor`, `health`, and `gc audit`.

## Documentation

User-facing guides:

- [Quickstart](docs/guides/quickstart.md)
- [CLI guide](docs/guides/cli.md)
- [Evidence and artifacts](docs/guides/evidence.md)
- [CI recipes](docs/guides/ci.md)

Project-development docs:

- [Architecture](docs/dev/architecture.md)
- [Development and testing](docs/dev/development.md)

Planning and execution status live under `plans/harness-engineering-platform/`.

## Product model

| Layer | Surface | Role |
|---|---|---|
| Substrate | `harness.yaml`, schemas, examples, artifact conventions | Source of truth |
| CLI | `harness` commands | Deterministic implementation surface |
| Adapters | CI recipes, plugins, skills, profiles | Consumers over CLI/schema artifacts |

Adapters must not create separate rule systems or source-of-truth state. CI recipes and future host integrations should call the CLI and preserve schema-backed artifacts.

## Distribution

- Package name: `@lachimere/harness-engineering`
- Binary name: `harness`
- Implementation: TypeScript 6
- Repository package manager: Bun
- Runtime target: Node-compatible CLI bundle
- Published package status: not published

Package metadata includes `dist`, `schemas`, `examples`, `docs`, `README.md`, and `LICENSE`. End users and adapters should not need Bun after a package is published, but this repository currently uses Bun for development, tests, and packaging smoke checks.

## If you came from external workflow skills

Harness Engineering does not install or run external skill packs such as `LaChimere/agent-coding`. Those workflows may inform future harness-native capabilities, but this repository currently provides only the CLI, schemas, examples, and evidence artifacts described above.

If you want to use an external agent workflow today, run it separately and import its output with `harness run --external-candidate` where appropriate. Adapter design rules for that path live in [docs/dev/architecture.md](docs/dev/architecture.md).
