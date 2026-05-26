# Harness CI recipes

Harness CI support is optional. CI jobs should call the deterministic `harness` CLI and upload the schema-backed artifacts it produces; they must not reinterpret `harness.yaml`, maintain CI-only rules, or create a second source of truth.

`examples/ci/github-actions.yml` is a copyable GitHub Actions recipe, not the only supported CI contract. Other CI systems should run equivalent CLI commands and preserve the same `.harness/**` evidence artifacts.

## Recommended blocking checks

These checks are objective and safe for a default CI gate when the repository has reviewed the commands they execute:

```bash
bun install --frozen-lockfile
bun run build
node dist/index.js validate --file examples/harness.yaml
node dist/index.js doctor --file examples/harness.yaml --format json --output .harness/doctor/ci-doctor.json
node dist/index.js health --file examples/harness.yaml --accept-unsandboxed-execution --format json --output .harness/health/ci-health.json
node dist/index.js eval validate --file examples/harness.yaml --output .harness/verifier-results/ci-eval-validate.jsonl
node dist/index.js trace validate --file examples/harness.yaml --format json > .harness/reports/ci-trace-validation.json
```

The repository recipe points at `examples/harness.yaml` because this checkout keeps its canonical starter there rather than at the repository root. Downstream repositories that commit a root `harness.yaml` can omit `--file examples/harness.yaml` and use the default lookup. The health step executes declared local commands and therefore keeps the explicit `--accept-unsandboxed-execution` acknowledgement. Starter health checks do not require network or secrets. On `pull_request`, the workflow runs the harness files from the submitted change; review changes to `harness.yaml` or `examples/harness.yaml` health commands with the same care as `package.json` scripts.

## Advisory evidence

`harness gc audit`, `harness report`, and `harness assess` are useful CI evidence and summaries, but they should cite existing artifacts rather than replace the blocking commands above:

```bash
node dist/index.js gc audit --file examples/harness.yaml --format json --output .harness/gc/ci-gc.json
node dist/index.js assess --file examples/harness.yaml --format json --doctor-result .harness/doctor/ci-doctor.json --health-result .harness/health/ci-health.json > .harness/reports/ci-assessment.json
```

`harness gc audit` exits successfully even when it emits findings, so treat GC findings as review-required evidence unless a separate, explicit policy gate consumes the JSON. LLM judge results are blocking only when the referenced judge policy proves calibration, threshold, sample count, freshness, and policy digest consistency. Uncalibrated, stale, below-threshold, or policy-invalid judge results are advisory-only.

## Out of scope

The The CI recipe does not:

- install or enable a host plugin;
- provide CI-specific schemas or rule engines;
- run provider-backed live models;
- require secrets;
- apply cleanup or repairs;
- schedule recurring profiles.

CI remains a portable adapter over CLI/schema artifacts. If a CI platform needs different syntax, translate the shell commands but keep the same harness artifacts and exit semantics.
