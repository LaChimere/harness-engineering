# Quickstart

Use this guide when you want to add Harness Engineering to a repository and inspect the first evidence artifacts.

## Current support

The supported path today is CLI-first. The package is shaped for npm publication, but it is not published to a registry yet. Build the CLI once from this checkout, then invoke it from the repository you want to harness:

```bash
# From this checkout:
bun install
bun run build
export HARNESS_BIN="$(pwd)/dist/index.js"

# From the repository you want to harness:
cd /path/to/target/repo
node "$HARNESS_BIN" init
node "$HARNESS_BIN" validate
```

For brevity, the rest of this guide writes commands as `harness <command>`. Substitute `node "$HARNESS_BIN" <command>` until the package is published. See the [CLI guide](cli.md) for the invocation convention.

### Prerequisites

- [Bun](https://bun.sh/) to build this checkout.
- Node.js 16 or newer to run the bundled CLI.

`harness init` creates the following in your target repository:

- `harness.yaml`
- editable harness support files under `.harness/`
- generated evidence directories under `.harness/outputs/`
- `.harness/.gitignore`, which ignores generated `outputs/` while leaving support files commit-ready
- starter `README.md` and `AGENTS.md` only when missing

## First health evidence

Run the starter health check after reviewing the commands declared in `harness.yaml`:

```bash
harness health --accept-unsandboxed-execution --format json --output .harness/outputs/health/quickstart-health.json
```

The explicit flag is intentional. Health checks execute local commands declared by the repository; the current runner records declarative trust and sandbox evidence rather than enforcing a runtime sandbox.

Inspect the result:

```bash
harness assess --format json --health-result .harness/outputs/health/quickstart-health.json
```

## Optional follow-up checks

```bash
harness doctor --format json --output .harness/outputs/doctor/doctor.json
harness gc audit --format json --output .harness/outputs/gc/gc.json
harness profile run .harness/profiles/gc-stability.yaml \
  --gc-evidence .harness/outputs/gc/gc.json \
  --health-result .harness/outputs/health/quickstart-health.json \
  --output .harness/outputs/profile-runs/gc-stability.json \
  --format json
```

`harness init` copies `.harness/profiles/gc-stability.yaml` into your target repository, so the path above works from your target repo. `gc audit` is evidence for review; it does not apply cleanup. `profile run` consumes evidence and emits a handoff; it does not schedule itself or mutate repository files beyond a requested output artifact.

Reruns will fail if an explicit `--output` path already exists. Choose a new path under `.harness/outputs/**` or remove the old artifact when iterating.

## Package-shaped smoke

To test the package contents before publication:

```bash
bun run build
bun pm pack --ignore-scripts
```

Unpack the tarball in a scratch directory and invoke the bundled `dist/index.js`. The e2e test suite covers this packed-content path.

## Not included yet

- published registry package
- public marketplace/global host plugin distribution (repo-local adapter packages exist under `plugins/`)
- CI enforcement package
- scheduler daemon
- model execution inside the Harness CLI

## Next steps

- [CLI guide](cli.md) — command-by-command reference.
- [Evidence and artifacts](evidence.md) — what each artifact means and how the adoption loop fits together.
- [CI recipes](ci.md) — opt-in CI integration.
