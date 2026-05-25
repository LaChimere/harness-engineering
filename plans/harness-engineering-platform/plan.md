# Plan: Harness Engineering Platform

## Status

Approved by the user on 2026-05-20. This plan translates the Gate 1 research and design into the approved implementation sequence for `LaChimere/harness-engineering`.

The product target is a clean-slate **harness-as-code platform for AI coding agents**. External skills are source material for learning useful agent practices, not product namespaces or dependencies in this repo.

Stages 1 through 10 and Stages 12 through 18 are complete. Stage 11 optional CI adapters are deferred by user request. Stage 18 added non-executing runner readiness checks for future live runners while preserving the deterministic stub path. The next productization target is Stage 19: recurring maintenance profile substrate and entropy-auditor MVP.

## Goals

- Establish `harness.yaml` plus versioned schemas as the canonical substrate.
- Ship a deterministic `harness` CLI before relying on plugins or skills.
- Prove the platform can run a model through a harness via `harness run` and an end-to-end behavioral eval.
- Keep agent/CLI marketplace plugins as the north-star UX, but do not promise a plugin path until agent/CLI marketplace or install-surface feasibility and capability tier are proven.
- Learn from external agent-workflow skills in Stage 13, then record harness-native capability candidates; later adoption requires a separately approved substrate contract.
- Make GC, recurring profiles, and adapters evidence-driven rather than prompt-only.
- Turn the validated substrate into a deliverable product: easy to install, safe to run on real projects, credible in its evidence, and useful without repo-author handholding.
- Treat the CLI package as the v1 delivery surface. Plugins, CI, and agent adapters are post-v1 or optional UX/enforcement surfaces over the same CLI/schema artifacts, not prerequisites for the product core.

## Non-goals

- Do not import, vendor, or namespace external skills during practice mining; future native behavior must be justified by substrate-shaped evidence, not skill availability.
- Do not make external skill installation a default quickstart.
- Do not ship a plugin-first install path before Stage 8 proves a real agent/CLI marketplace path and capability tier.
- Do not implement subjective "AI slop" scoring as a doctor or GC category.
- Do not let plugins, CI adapters, or skills create a second source of truth outside the CLI/schema substrate.
- Do not block the CLI-first product on live-runner, plugin, CI, or recurring-profile availability; unsupported paths must be documented as planned or optional rather than silently implied.

## Execution principles

- Each stage must be independently reviewable, mergeable, and testable.
- Public docs must clearly distinguish what exists now from what is planned.
- Schemas come before commands that consume them.
- CLI/spec is canonical; plugin, skills, CI, and recurring profiles are adapters over the same artifacts.
- `doctor`, `verify`, and `eval` must remain distinct:
  - `doctor` inspects harness structure and deterministic repository-level checks.
  - `verify` records self-verification evidence against an explicit verification spec.
  - `eval` runs task/verifier suites and records behavioral outcomes.
- Real model execution must require credential references and cost/token/request budgets; no inline secrets or unbounded spend.
- The first behavioral eval must run with a deterministic stub or recorded runner so reviewers and CI do not need live model credentials.
- Behavioral improvements must cite holdout results before being promoted into durable rules/checks/templates/evals.

## Stage roadmap

| Stage | Title | Depends on | Primary outcome |
|---:|---|---|---|
| 1 | Product identity, entrypoints, and distribution decisions | None | README/AGENTS define this repo as the canonical platform, with CLI-first current path and marketplace plugin as north-star after feasibility |
| 2 | Harness schema substrate | Stage 1 | `harness.yaml` and all minimum schemas exist with versioning, trust/sandbox requirements, and examples |
| 3 | CLI skeleton: init, validate, migrate, verify, report | Stage 1, Stage 2 | Users can bootstrap and validate a minimal harness baseline from the terminal |
| 4 | Harness doctor MVP | Stage 2, Stage 3 | Deterministic structural checks emit schema-valid JSON/Markdown with fixtures |
| 5 | Eval task contract and deterministic verifier runner | Stage 2, Stage 3 | Verifier-only eval path proves oracle pass and broken twin fail deterministically |
| 6 | Agent runner, first behavioral eval, and trace normalization | Stage 2, Stage 3, Stage 5 | `harness run` and `harness eval run` produce trace, run-result, verifier result, and scoreboard artifacts |
| 7 | LLM-judge and inferential-review policy | Stage 5, Stage 6 | LLM judge outputs are calibrated or advisory-only; blocking semantics are explicit |
| 8 | Agent/CLI marketplace feasibility and tiered target selection | Stage 3, Stage 4, Stage 5, Stage 6 | Per-host capability matrix decides whether a full plugin, limited adapter, or CLI-first fallback is feasible and prevents unavailable plugin promises |
| 9 | Conditional adapter MVP | Stage 8 | If feasible, first adapter implements only capabilities proven by Stage 8 without a second source of truth |
| 10 | Native execution loop and continuity adapter | Stage 2, Stage 3, Stage 4, Stage 5, Stage 6 | Native implementation loop consumes substrate evidence and enforces completion/startup gates |
| 11 | Optional CI adapters | Stage 3, Stage 4, Stage 5, Stage 6, Stage 7 | Teams can opt into portable CI enforcement; uncalibrated judges remain advisory |
| 12 | Native agent-facing harness-engineering adapter | Stage 10 | Portable agent UX reads substrate evidence and produces assessment/rollout plans |
| 13 | Agent-practice mining for harness-native capabilities | Stage 1 to start research; Stage 10/12 before binding decisions | External workflow skills are mined into `plans/harness-engineering-platform/capability-ledger.yaml` records with candidate substrate surfaces, evidence requirements, future owner stages, and non-core boundaries |
| 14 | GC framework and first deterministic categories | Stage 4, Stage 6 | `harness gc audit/validate` produces append-only evidence and reviewable cleanup slices for mechanical categories |
| 15 | Evidence-driven GC expansion | Stage 5, Stage 7, Stage 14 | GC records evidence-backed findings and citation hooks for future rule lifecycle decisions without automatic promotion or cleanup |
| 16 | Productization gate and cleanup eligibility | Stage 13, Stage 15 | Decide whether any capability was actually adopted or superseded; if not, explicitly keep cleanup dormant and update the maturity gaps |
| 17 | Local project health checks | Stage 2, Stage 4, Stage 10, Stage 15 | `harness health` safely executes declared local checks such as lint, test, typecheck, and doc checks with trust/sandbox evidence |
| 18 | Real runner readiness | Stage 6, Stage 7, Stage 17 | Prepare non-stub live agent/model runs with explicit credential references, budgets, sandbox requirements, trace redaction, and refusal modes |
| 19 | Recurring maintenance profile substrate and MVP | Stage 12, Stage 15, Stage 17 | Define recurring-profile contracts and ship one evidence-backed MVP profile before expanding the full profile set |
| 20 | Delivery surface and adoption packaging | Stage 3, Stage 17; Stage 18/19 only for advertised live-runner/profile paths | External users can install, initialize, run health checks, and understand current support through package, quickstart, examples, and adapter/CI guidance |

## Stage acceptance criteria

### Stage 1: Product identity, entrypoints, and distribution decisions

- README includes a host/path quickstart matrix: current documented CLI-first path, planned marketplace plugin paths, external agent-practice mining status, and optional CI.
- Docs state which paths exist now versus which are planned.
- Package, binary, Bun package-manager choice, TypeScript 6 requirement, Biome/Lefthook requirement with user-provided configuration, Node-compatible runtime target, schema distribution, compatibility policy, and `harness migrate` posture are explicit enough for Stage 2 and Stage 3 to implement.

### Stage 2: Harness schema substrate

- External tools can validate artifacts against published or locally vendored schemas.
- Every machine-readable artifact has `schema_version` and clear compatibility semantics, using per-schema semantic versions plus the `engines.schemas` range in `harness.yaml`.
- The example `harness.yaml` validates and composes references rather than embedding all details.
- `continuity-state.schema.json` and `self-verification.schema.json` are complete enough for Stage 10 to consume startup verification, progress, evidence, and handoff state without inventing new artifact shapes.
- `agent-runner.schema.json` is complete enough for Stage 6 to enforce model invocation, credential references, cost/token/request budgets, sandbox, approval policy, trace output, and verifier binding without inventing new artifact shapes.
- Local doctor checks, eval verifiers, and repair actions have declared trust/sandbox requirements.

### Stage 3: CLI skeleton: init, validate, migrate, verify, report

- A user can bootstrap and validate a harness baseline from the terminal.
- The CLI project uses TypeScript 6, Bun-managed dependencies, Biome, and Lefthook while producing a Node-compatible npm binary.
- CLI exit semantics are documented for future plugin and CI adapters.
- Reports cite the artifact paths they summarized.
- `verify` documentation defines the verification spec or acceptance-check input format and includes an example that distinguishes self-verification from structural `doctor` checks and behavioral `eval` runs.
- `verify` does not perform structural harness inspection that belongs to `doctor`.

### Stage 4: Harness doctor MVP

- Doctor output conforms to `doctor-result.schema.json`.
- Passing and failing fixtures validate with zero schema errors.
- Exit code semantics are documented for plugin and CI consumption.
- Doctor checks remain deterministic structural checks and do not claim task acceptance, self-verification status, or subjective "AI slop" scores.
- Stage 4 completion includes an entropy pass for stale docs, orphan doctor fixtures/artifacts, duplicate source-of-truth logic, and command-boundary drift before Stage 5 begins.

### Stage 5: Eval task contract and deterministic verifier runner

- The self-test proves the verifier can pass and fail deterministically.
- Run results include suite/task version and dataset hash.
- A reviewer can distinguish agent failure from harness/verifier failure.
- Verifiers declare trust level, sandbox requirements, allowed inputs/outputs, and network/secret/host-file access before execution.
- Eval task and run-result schemas support optimization/holdout split designation and record which split was used.

### Stage 6: Agent runner, first behavioral eval, and trace normalization

- A user can run a toy task through a configured model/harness and receive trace, run-result, verifier result, and report artifacts.
- The toy suite can run with the deterministic stub/recorded runner and does not require live credentials.
- The stub/recorded runner satisfies the credential-reference and budget contract with non-secret fixture values rather than bypassing it.
- Agent runs refuse to execute without explicit credential references and cost/token/request budgets, with fixtures or tests covering the refusal.
- Eval output distinguishes optimization and holdout splits.
- The first scoreboard distinguishes harness/verifier failure from agent/model failure.
- Trace examples validate against schema.
- A run result links to the trace and artifacts that produced it.
- Long-running continuity can associate multiple runs with one session.
- Review docs explain how to run the toy eval locally and in CI-safe mode without credentials.

### Stage 7: LLM-judge and inferential-review policy

- No LLM-judge result can be marked blocking unless the calibration policy is satisfied.
- The judge policy specifies rubric, labeled sample minimum, agreement metric, numeric blocking threshold, uncertainty notes, and below-threshold consequence.
- Fixtures demonstrate calibrated blocking, advisory-only, and below-threshold judge cases.
- Docs state how to treat low-agreement or stale judges.

### Stage 8: Agent/CLI marketplace adapter feasibility and target selection

- **Implementation result:** Stage 8 produced `examples/plugin-capabilities/stage8-agent-cli-capability-matrix.json`, classified Codex CLI, Claude Code, and GitHub Copilot CLI as limited-adapter tier, kept Gemini CLI as CLI-first fallback evidence, and selected GitHub Copilot CLI as the first limited-adapter target. No full-plugin target is proven.
- The review produces a per-host capability matrix focused on Codex, Claude Code, GitHub Copilot CLI, and named comparable coding-agent/CLI surfaces that satisfy the candidate boundary.
- IDE-only extension hosts may be recorded as future adapter evidence, but cannot be selected as the first Stage 9 target in this slug.
- The matrix assigns each host a capability tier: full plugin, limited adapter, CLI-first fallback, or future adapter evidence.
- The matrix defines in-scope candidates as coding-agent or CLI host surfaces with agent-facing extension points; IDE-only, CI-only, and hosted checks/review surfaces are out of scope for Stage 9 selection.
- The matrix records stable evidence ids, evidence links with source date, acceptable source type, positive/partial/negative finding, reproduction or inspection note, and `yes`/`partial`/`no`/`unknown` status for each capability.
- The capability matrix covers agent/CLI marketplace or install distribution, CLI bundling/bootstrap, filesystem access, CLI invocation, report rendering, annotation APIs, background runs, repair-action UI, and trace deep-links.
- The capability matrix has a durable format that Stage 9 can consume or cite, with fields for host, surface kind, candidate status, tier, capability statuses, CLI management modes, stable evidence ids, evidence entries, fallback behavior, and Stage 9 consequence.
- The provisional plugin-capability and repair-action schemas from Stage 2 are revalidated against the host capability matrix, including whether they need tier, surface-kind, evidence-id, evidence-link, fallback, or adapter-scope manifest fields before Stage 9 consumes them.
- If a target is chosen, it has documented agent/CLI marketplace distribution evidence and API evidence for the tier-specific supported capabilities proven by Stage 8.
- If a full-plugin target is feasible, proceed to full Stage 9 adapter implementation.
- If only a limited adapter is feasible, proceed to a limited Stage 9 adapter only if the docs and scope clearly label missing rich UX as unavailable.
- If no in-scope full-plugin or limited-adapter target is feasible, skip or defer Stage 9, update docs to make CLI-first the default until an adapter exists, and do not promise an unavailable plugin.
- If every named host only qualifies as a limited adapter, Stage 8 reconciles the user journey by either rewriting Stage 9 docs to the proven limited workflow or explicitly labeling the full-plugin journey aspirational.

### Stage 9: Conditional adapter MVP

- A user can install or enable the selected host surface at the capability tier proven by Stage 8 without separately guessing CLI prerequisites.
- A schema-backed machine-readable adapter scope manifest, or equivalent revalidated plugin-capability metadata, declares implemented capabilities, unavailable capabilities, fallback behavior, required Stage 8 matrix evidence ids, CLI/schema compatibility, and trust/write boundaries.
- Automated validation proves the adapter scope manifest or equivalent revalidated plugin-capability metadata is a subset of capabilities proven in the Stage 8 matrix.
- The adapter bundles or auto-manages a pinned CLI dependency unless the host forbids it; constrained-host manual guidance includes missing/incompatible CLI detection and repair prompts.
- The adapter resolves CLI versions in this order: repo-pinned compatible CLI, adapter-bundled CLI, then user-installed CLI.
- The adapter refuses write actions when no compatible CLI/schema version exists.
- Repair actions show preview diffs, use the approval policy, declare risk class, and emit equivalent CLI commands only when Stage 8 proves host preview and approval affordances; limited adapters without those affordances keep repairs advisory and redirect to CLI execution.
- The adapter does not create a second source of truth; any adapter-local cache is non-authoritative, reconstructible, and excluded from CLI/CI behavior.
- Any rich UX capability not proven in Stage 8 is absent or clearly labeled unavailable.

### Stage 10: Native execution loop and continuity adapter

- The execution loop cannot claim completion without substrate-aware verification evidence.
- Approval/sandbox policy decisions are read and either followed or explicitly escalated.
- Startup verification runs before work begins and records the result in continuity state.
- Fixtures demonstrate the execution loop refusing to start or complete when startup verification or completion-gate evidence fails.

### Stage 11: Optional CI adapters

- A downstream repo can opt into objective CI feedback without needing a plugin or agent.
- CI examples are clearly optional adapters.
- Blocking/advisory status is represented in shared CLI/schema/report artifacts so CI, plugin, and skill adapters use consistent policy.
- Uncalibrated LLM-judge results remain advisory-only by default.

### Stage 12: Native agent-facing harness-engineering adapter

- The adapter emits a maturity scorecard, missing primitives, rollout stage plan, and policy/eval/trace/continuity recommendations from substrate artifacts while preserving CLI/schema as source of truth.
- The adapter does not assume external workflow skills are installed or vendored in this repo.
- The adapter demonstrates routing implementation requests to trusted applicable repair actions, native execution-loop adapters, or a clear fallback when no implementation route is configured.

### Stage 13: Agent-practice mining for harness-native capabilities

- External workflow skills are treated as learning material, not as a compatibility package to preserve by default.
- Stage 13 produces a durable capability ledger at `plans/harness-engineering-platform/capability-ledger.yaml`: each row follows the canonical field shape in `design.md`, has a stable kebab-case `capability_id`, and records source observations, practice, failure mode or substrate gap, candidate substrate surface, disposition, future owner stage or `deferred` rationale, required evidence, user-behavior-change category, rationale, and what stays outside harness core. Once committed, `capability_id` values are not reused; retired records remain as `status: retired`.
- No skill is copied, vendored, rewritten, merged, deprecated, or made the default quickstart during Stage 13.
- Every internalization candidate names the concrete proof required before it can become native: schema contract, CLI owner, fixtures or evals, trust/sandbox requirements, false-positive policy, and migration/adoption examples only when user behavior would change.
- The vulnerability-scanning skill is ignored for Stage 13 because domain-specific security tooling is not core harness capability evidence for this slice.
- Stage 13 starts by dogfooding `harness assess` on the repository and a more realistic downstream fixture so capability decisions cite actual assessment gaps, repair-action applicability, and trusted approval requirements rather than assumed adapter needs.
- Remaining Stage 12 assessment polish that does not block completion is resolved or explicitly deferred during Stage 13: selected-route Markdown readability, explicit empty/ephemeral repair-action fixture handling, and the production repair-action discovery/default-directory policy.

### Stage 14: GC framework and first deterministic categories

- Users can run a GC audit and get reviewable cleanup slices tied to evidence.
- GC evidence output is append-only and preserves historical audit runs.
- Cleanup slices include evidence refs, confidence, blast radius, and atomicity notes; they do not mix unrelated concerns.
- No GC category ships unless its inputs, algorithm, false-positive policy, and passing/failing fixtures are documented.
- Stage 13 capability candidates are considered for adoption only when they fit deterministic GC evidence; subjective agent-process scoring remains advisory or deferred.
- Any Stage 14 adoption of a Stage 13 capability records the adopted `capability_id` and whether cleanup eligibility is triggered.
- Repair-action routing polish from Stage 12 is revisited when GC/repair evidence exists, especially trusted approval provenance, duplicate action ids, risk/sandbox presentation, and review metadata, without turning assessment routes into executable commands.

### Stage 15: Evidence-driven GC expansion

- GC findings cite evidence artifacts and may carry promotion/retirement decision references.
- A single preference cannot become a durable rule because Stage 15 records findings only; it does not automatically promote or retire rules, checks, templates, or evals.
- LLM-judge GC findings stay limited to schema-valid calibration status; full policy digest, threshold, staleness, and blocking eligibility remain owned by `harness report`.
- Future behavioral rule/eval promotion must cite holdout results, not only optimization-suite improvement.
- Any future adoption of a Stage 13 capability records the adopted `capability_id` and whether cleanup eligibility is triggered.

### Stage 16: Productization gate and cleanup eligibility

- Confirm whether Stage 14 or Stage 15 actually adopted or superseded any Stage 13 capability candidate.
- If no adopted capability or substrate-backed replacement exists, record Stage 16 as dormant and produce no cleanup categories.
- If a capability is adopted later, cleanup findings must cite capability-ledger records, required evidence, replacement paths, and migration notes.
- No cleanup slice deletes user-facing behavior without a documented replacement path.
- Re-run Stage 16 before merging any future change that adopts or supersedes a capability, flips `cleanup_eligible` to true, or documents a substrate-backed replacement path.
- Stage 17 may proceed because Stage 16 found no cleanup-eligible capability; if Stage 17 changes adoption or replacement status, it must re-enter Stage 16 before cleanup work.

### Stage 17: Local project health checks

- Harness executes declared local project checks through a distinct `harness health` surface so `doctor` remains structural by default.
- `harness health` can run only when trust and sandbox requirements are explicit.
- Local check output is recorded as evidence with command, timeout, status, artifact paths, and failure classification.
- Local health checks remain distinguishable from `doctor`, `verify`, and `eval` responsibilities.
- `harness assess` consumes health evidence through a scorecard version that adds a distinct `project-health` dimension, rather than folding executable checks into `doctor-evidence`.
- The starter and downstream fixtures demonstrate useful project health checks without network, secrets, or unbounded host access.
- A concrete downstream fixture must show pass and fail health checks, an overall health status, and machine-readable evidence beyond schema validity.

### Stage 18: Real runner readiness

- Live or non-stub runner paths require explicit credential references, cost/token/request budgets, sandbox and approval policy, and trace output.
- Credential references have a deterministic supported shape, such as typed environment-variable references or an explicitly declared future secret-manager indirection.
- Trace capture has a redaction and scoping policy so prompts, tool results, secrets, and customer data are not recorded accidentally.
- The CLI refuses live-model execution when credentials, budgets, or sandbox declarations are missing.
- The product preserves deterministic stub/recorded runners for CI-safe validation while adding a clear path to real runs.

### Stage 19: Recurring maintenance profile substrate and MVP

- Profiles consume substrate artifacts and add behavior beyond one-shot summaries.
- Stage 13 capability candidates owned by recurring profiles are promoted only when profile contracts express them as evidence-backed scheduled work with measurable stop conditions, not prompt-only habits.
- Any profile adoption of a Stage 13 capability records the adopted `capability_id` and whether cleanup eligibility is triggered.
- Stage 19 first ships the recurring-profile substrate and the entropy-auditor MVP profile with a measurable stop condition and handoff artifact.
- Additional profiles require their own trigger thresholds before shipping: doc-gardener needs Stage 17 doc-link or docs-health evidence, eval-curator needs holdout eval evidence, and trace-reviewer needs Stage 18 trace evidence.
- Fixtures or examples demonstrate the MVP profile stopping when its condition is met.
- Human-facing assessment/report polish, including richer Markdown or dashboard summaries, is deferred until recurring profile and adapter consumption patterns are concrete.

### Stage 20: Delivery surface and adoption packaging

- The CLI can be installed and run by external users without cloning implementation-only assumptions.
- Quickstart examples explain the current CLI-first path, expected artifacts, safe defaults, and unsupported paths.
- Package contents, schema distribution, examples, and docs are coherent enough for a downstream repository to adopt the harness.
- A sandboxed downstream smoke test runs install/invoke, `harness init`, `harness health`, evidence inspection, and `harness assess` with health evidence against the 8/10 maturity target.
- The minimum Stage 20 target is at least 8/10 on the scorecard version that adds `project-health`, improving on the Stage 13 downstream baseline of 5/9 without reinterpreting the old denominator, with no critical gaps for initialization, local health evidence, and basic assessment/report output.
- CI and adapter guidance remain optional projections over CLI/schema artifacts, not separate product sources of truth.

## Milestones

### Milestone A: Substrate exists

Includes Stage 1 through Stage 3.

At this point users can run the CLI-first path from a local checkout. After the package is published, the same command surface is intended to be available through `npx @lachimere/harness-engineering`:

```bash
bun run build
node dist/index.js init
node dist/index.js validate
node dist/index.js verify --spec examples/verification/stage3-self-verification.yaml
node dist/index.js report
```

The default `harness init` output must not create CI or plugin-specific keys before those adapters exist.

### Milestone B: Harness proof exists

Includes Stage 4 through Stage 6.

At this point the repo can demonstrate real harness engineering:

```bash
bun run build
node dist/index.js doctor --file examples/harness.yaml
node dist/index.js run examples/evals/harness-self-test/v1.0.0/task.yaml --file examples/harness.yaml
node dist/index.js eval run --file examples/harness.yaml
node dist/index.js trace validate --file examples/harness.yaml
```

Doctor output validates substrate health before eval runs. The run must produce trace, run-result, verifier result, and scoreboard artifacts. The toy suite must run without live model credentials via a deterministic stub or recorded-response runner.

### Milestone C: Optional UX/enforcement paths

Includes Stage 7 through Stage 11.

This adds calibrated inferential review, verifies whether agent/CLI marketplace plugins or limited adapters are feasible, optionally ships an adapter MVP, and provides optional CI adapters. If no agent/CLI marketplace target is feasible, docs stay CLI-first and do not promise a plugin install path.

### Milestone D: Agent and migration adapters

Includes Stage 12 and Stage 13.

This adds a native agent-facing adapter and mines external workflow skills as learning material for harness-native capabilities, without making the source project a product namespace or dependency.

### Milestone E: Productization gate and real project health

Includes Stage 14 through Stage 17.

This makes entropy/GC operational, confirms cleanup is dormant unless a real replacement exists, and adds executable local project health checks so the harness becomes useful on real repositories instead of only fixture projects.

### Milestone F: Mature product path

Includes Stage 18 through Stage 20.

This prepares real runner paths, recurring maintenance profiles, and adoption packaging so external users can install the product, run it safely, trust the evidence, and understand the supported delivery surfaces. Stage 20 may package the CLI-first path before live runners or profiles are advertised, but any advertised path must have its Stage 18 or Stage 19 evidence first.

## Validation strategy

- Documentation-only stages must pass Markdown/link sanity checks where available and `git diff --check`.
- Schema stages must include valid and invalid fixtures for high-risk schemas.
- CLI stages must include command-level tests and machine-readable output fixtures.
- Doctor/GC checks must include explicit inputs, algorithms, false-positive policy, and passing/failing fixtures.
- Doctor stages must include an entropy pass confirming docs, examples, fixtures, and shared validation helpers still describe one coherent substrate.
- Eval stages must prove oracle pass and broken twin fail.
- Agent-runner stages must include deterministic stub/recorded execution for CI and reviewers without API keys.
- Plugin/adapter stages must prove the selected host surface is an adapter over CLI/schema artifacts and cannot create a second source of truth.
- Stage 8 must define and run automated matrix validation for completeness, enum validity, and evidence presence. Stage 9 must validate its adapter scope manifest or equivalent revalidated plugin-capability metadata against the Stage 8 matrix so implemented scope is a subset of proven capabilities.
- Practice-mining and migration stages must document before/after workflows only when an adopted, moved, extracted, deprecated, superseded, or unsupported capability path changes user behavior.
- Productization stages must prove external-user value: installability or documented invocation, real-project checks, safe refusal modes, and a clear distinction between current support and future paths.

## Stage 1 decisions to document

- Final public wording for "harness-as-code platform for AI coding agents".
- Schema publication mechanism and compatibility policy.
- Confirm `@lachimere/harness-engineering` and `harness` as final npm package/bin names.
- Confirm repository package management with Bun, TypeScript 6 for implementation, Biome/Lefthook using user-provided configuration, explicit `tsc --noEmit` type checking, and Node-compatible public CLI output.
- External skill practice-mining disposition options to document at Gate 1:
  - ignore source material that is not core harness evidence,
  - record capability as advisory evidence,
  - extract selected capability into future schema/CLI/profile/eval/GC substrate,
  - create adapter guidance only after a supported path exists,
  - deprecate external guidance only after replacement paths exist.
- Host/path quickstart matrix wording:
  - CLI-first documented as the current default path, with implementation planned for Stage 3,
  - agent/CLI marketplace plugins or limited adapters planned pending Stage 8,
  - external agent-practice mining pending Stage 13,
  - CI optional after Stage 11.

## Definition of done for this slug

- The repo has a documented, working CLI-first harness baseline.
- The platform can run at least one end-to-end behavioral eval through `harness run` / `harness eval run`.
- The platform can execute declared local project health checks with trust/sandbox evidence.
- Traces, run-results, verifier results, and reports are schema-backed and reproducible.
- Agent/CLI marketplace feasibility is either proven at a full-plugin or limited-adapter tier and followed by a matching MVP, or explicitly deferred with CLI-first docs.
- Optional CI enforcement is portable and does not assume GitHub as the only host.
- Native agent adapters and external agent-practice mining are clearly separated.
- GC and recurring profiles operate over real evidence artifacts, not subjective prose.
- Delivery docs, package contents, and quickstarts are coherent enough for a downstream project to adopt the current CLI-first product safely.
