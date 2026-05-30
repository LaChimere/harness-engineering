# Harness Engineering

This extension packages Harness skills that operate over `harness.yaml`,
versioned schemas, and deterministic `harness` CLI evidence.

Use the bundled skills for Harness adoption, inspection, health checks,
assessment, evidence loops, profile generation, and cleanup review. Preserve
each skill's invocation and safety policy. In particular, run
`harness health --accept-unsandboxed-execution --format json` only when the user
explicitly asks for declared local health checks.

Do not treat this extension as a source of product rules. The canonical source
is `harness.yaml`, schemas, and the `harness` CLI.
