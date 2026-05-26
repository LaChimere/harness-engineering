# CI recipes

Harness CI support is optional. CI jobs should call the deterministic `harness` CLI and upload schema-backed artifacts from `.harness/outputs/**`; they must not reinterpret `harness.yaml`, maintain CI-only rules, or create a second source of truth.

`examples/ci/github-actions.yml` is a copyable GitHub Actions recipe that runs against **this repository's** own substrate. It is not the only supported CI contract: other CI systems should run equivalent CLI commands and preserve the same `.harness/outputs/**` evidence artifacts.

## This repository's recipe

`examples/ci/github-actions.yml` builds the CLI from source (because the package is not yet published) and runs blocking and advisory checks against the bundled `examples/harness.yaml`. It is invoked on every pull request to this repository.

## Downstream repository CI (pre-publication)

Until the package is published to a registry, downstream CI must either check out this repository alongside the consuming repo and set `HARNESS_BIN` to the built `dist/index.js`, or install a pinned packed tarball produced from this repository.

Once published, replace `node "$HARNESS_BIN"` with `harness` and skip the build step.

## Recommended blocking checks

These checks are objective and safe for a default CI gate when the repository has reviewed the commands they execute:

```bash
# Build the CLI from a checkout of LaChimere/harness-engineering, then:
export HARNESS_BIN="/path/to/harness-engineering/dist/index.js"

# Prepare evidence directories so output-redirected commands succeed.
mkdir -p .harness/outputs/doctor .harness/outputs/health .harness/outputs/gc .harness/outputs/reports

node "$HARNESS_BIN" validate
node "$HARNESS_BIN" doctor --format json --output .harness/outputs/doctor/ci-doctor.json
node "$HARNESS_BIN" health --accept-unsandboxed-execution --format json --output .harness/outputs/health/ci-health.json
node "$HARNESS_BIN" eval validate --output .harness/outputs/run-results.jsonl
node "$HARNESS_BIN" trace validate --format json > .harness/outputs/reports/ci-trace-validation.json
```

`harness eval validate --output` appends to a run-result JSONL ledger (typically `.harness/outputs/run-results.jsonl`) and writes verifier artifacts under `.harness/outputs/verifier-results/`.

The repository recipe in `examples/ci/github-actions.yml` adds `--file examples/harness.yaml` to each command because this checkout keeps its canonical starter there rather than at the repository root. Downstream repositories that commit a root `harness.yaml` should omit `--file` and use the default lookup.

The health step executes declared local commands and therefore keeps the explicit `--accept-unsandboxed-execution` acknowledgement. On `pull_request`, review changes to health commands with the same care as `package.json` scripts.

## Advisory evidence

`harness gc audit` and `harness assess` are useful CI evidence and summaries, but they should cite existing artifacts rather than replace the blocking commands above:

```bash
node "$HARNESS_BIN" gc audit --format json --output .harness/outputs/gc/ci-gc.json
node "$HARNESS_BIN" assess --format json \
  --doctor-result .harness/outputs/doctor/ci-doctor.json \
  --health-result .harness/outputs/health/ci-health.json \
  > .harness/outputs/reports/ci-assessment.json
```

`harness gc audit` exits successfully even when it emits findings. Treat GC findings as review-required evidence unless a separate policy gate consumes the JSON. LLM judge results are blocking only when the referenced judge policy proves calibration, threshold, sample count, freshness, and policy digest consistency.

## Out of scope

The CI recipe does not:

- install or enable a host plugin;
- provide CI-specific schemas or rule engines;
- run provider-backed live models;
- require secrets;
- apply cleanup or repairs;
- schedule recurring profiles.

CI remains a portable adapter over CLI/schema artifacts. If a CI platform needs different syntax, translate the shell commands but keep the same harness artifacts and exit semantics.
