# Plan: Harness Engineering Platform

## Status

Approved by the user on 2026-05-20. This plan translates the Gate 1 research and design into the approved implementation sequence for `LaChimere/harness-engineering`.

The product target is a clean-slate **harness-as-code platform for AI coding agents**. `agent-coding` is migration-source evidence and a possible compatibility path, not the product center and not assumed to be present in this repo.

Stages 1, 2, 3, and 4 are complete. The next implementation target is Stage 5: Eval task contract and deterministic verifier runner.

## Goals

- Establish `harness.yaml` plus versioned schemas as the canonical substrate.
- Ship a deterministic `harness` CLI before relying on plugins or skills.
- Prove the platform can run a model through a harness via `harness run` and an end-to-end behavioral eval.
- Keep marketplace plugins as the north-star UX, but do not promise a plugin path until host marketplace/API feasibility is proven.
- Treat `agent-coding` skills as external behavior to audit, adapt, extract, or replace after the substrate exists.
- Make GC, recurring profiles, and adapters evidence-driven rather than prompt-only.

## Non-goals

- Do not import or vendor `agent-coding` skills before the compatibility inventory decides their disposition.
- Do not make `npx skills add https://github.com/LaChimere/agent-coding` the default quickstart.
- Do not ship a plugin-first install path before Stage 8 proves a real host marketplace/extension path.
- Do not implement subjective "AI slop" scoring as a doctor or GC category.
- Do not let plugins, CI adapters, or skills create a second source of truth outside the CLI/schema substrate.

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
| 8 | Plugin marketplace/API feasibility and target selection | Stage 3, Stage 4, Stage 5, Stage 6 | Per-host capability matrix decides whether a plugin MVP is feasible and prevents unavailable plugin promises |
| 9 | Conditional plugin adapter MVP | Stage 8 | If feasible, first plugin renders CLI artifacts and supports safe repair actions without a second source of truth |
| 10 | Native execution loop and continuity adapter | Stage 2, Stage 3, Stage 4, Stage 5, Stage 6 | Native implementation loop consumes substrate evidence and enforces completion/startup gates |
| 11 | Optional CI adapters | Stage 3, Stage 4, Stage 5, Stage 6, Stage 7 | Teams can opt into portable CI enforcement; uncalibrated judges remain advisory |
| 12 | Native agent-facing harness-engineering adapter | Stage 10 | Portable agent UX reads substrate evidence and produces assessment/rollout plans |
| 13 | `agent-coding` compatibility inventory and migration | Stage 1 to start research; Stage 10/12 before binding decisions | External skills are classified as native-adapter candidates, external compatibility helpers, optional utilities, deprecation candidates, or extraction candidates |
| 14 | GC framework and first deterministic categories | Stage 4, Stage 6 | `harness gc audit/validate` produces append-only evidence and reviewable cleanup slices for mechanical categories |
| 15 | Evidence-driven GC expansion | Stage 5, Stage 7, Stage 14 | GC can promote/retire rules, checks, templates, and evals using evidence and holdout results |
| 16 | Skill-adapter GC and migration cleanup | Stage 13, Stage 15 | Skill-adapter entropy checks operate only on supported adapter paths with replacement evidence |
| 17 | Recurring profiles and scheduled maintenance | Stage 12, Stage 16 | Entropy auditor, doc gardener, eval curator, and trace reviewer consume substrate artifacts with measurable stop conditions |

## Stage acceptance criteria

### Stage 1: Product identity, entrypoints, and distribution decisions

- README includes a host/path quickstart matrix: current documented CLI-first path, planned marketplace plugin paths, audited skill compatibility status, and optional CI.
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

### Stage 8: Plugin marketplace/API feasibility and target selection

- The review produces a per-host capability matrix covering marketplace distribution, CLI bundling/bootstrap, filesystem access, report rendering, annotation APIs, background runs, repair-action UI, and trace deep-links.
- The capability matrix has a durable format that Stage 9 can consume or cite.
- The provisional plugin-capability and repair-action schemas from Stage 2 are revalidated against the host capability matrix.
- The chosen plugin target has documented marketplace/extension distribution evidence and API evidence for the required UX.
- If a plugin target is feasible, proceed to Stage 9.
- If no rich plugin target is feasible, skip Stage 9, update docs to make CLI-first the default until a plugin exists, and do not promise an unavailable plugin.

### Stage 9: Conditional plugin adapter MVP

- A user can install from the selected host marketplace/extension surface and follow plugin-first setup without separately guessing CLI prerequisites.
- The plugin bundles or auto-manages a pinned CLI dependency unless the host forbids it; constrained-host manual guidance includes missing/incompatible CLI detection and repair prompts.
- The plugin resolves CLI versions in this order: repo-pinned compatible CLI, plugin-bundled CLI, then user-installed CLI.
- The plugin refuses write actions when no compatible CLI/schema version exists.
- Repair actions show preview diffs, use the approval policy, declare risk class, and emit equivalent CLI commands so the same repair is reproducible without the plugin.
- The plugin does not create a second source of truth; any plugin-local cache is non-authoritative, reconstructible, and excluded from CLI/CI behavior.

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
- The adapter does not assume `agent-coding` skills are installed or vendored in this repo.
- The adapter demonstrates routing implementation requests to available repair actions, native execution-loop adapters, documented external skills, or a clear fallback when no implementation route is configured.

### Stage 13: `agent-coding` compatibility inventory and migration

- Each audited skill is classified with the Stage 13 taxonomy: native-adapter candidate, external compatibility helper, optional utility, deprecation candidate, or extraction candidate.
- For every deprecated, moved, extracted, or unsupported skill path, docs include replacement path, breaking-change notice, migration timeline, and before/after workflow example.
- Existing `agent-coding` skill users have a documented adoption path if compatibility remains supported.
- README and skill docs do not imply optional utilities are core harness primitives.

### Stage 14: GC framework and first deterministic categories

- Users can run a GC audit and get reviewable cleanup slices tied to evidence.
- GC evidence output is append-only and preserves historical audit runs.
- Cleanup slices include evidence refs, confidence, blast radius, and atomicity notes; they do not mix unrelated concerns.
- No GC category ships unless its inputs, algorithm, false-positive policy, and passing/failing fixtures are documented.

### Stage 15: Evidence-driven GC expansion

- Promotion/retirement cites evidence artifacts.
- A single preference cannot become a durable rule.
- LLM-judge evidence follows Stage 7 calibration policy.
- Behavioral rule/eval promotion cites holdout results, not only optimization-suite improvement.

### Stage 16: Skill-adapter GC and migration cleanup

- Skill-specific GC findings cite Stage 13 classification or migration docs.
- No skill cleanup slice deletes user-facing behavior without a documented replacement path.

### Stage 17: Recurring profiles and scheduled maintenance

- Profiles consume substrate artifacts and add behavior beyond one-shot summaries.
- The initial shipped profile set includes entropy-auditor, doc-gardener, eval-curator, and trace-reviewer profiles.
- Each profile has a measurable stop condition and handoff artifact.
- Fixtures or examples demonstrate each profile stopping when its condition is met.

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
npx @lachimere/harness-engineering doctor
npx @lachimere/harness-engineering run examples/evals/harness-self-test/v1.0.0/
npx @lachimere/harness-engineering eval run
npx @lachimere/harness-engineering trace validate
```

Doctor output validates substrate health before eval runs. The run must produce trace, run-result, verifier result, and scoreboard artifacts. The toy suite must run without live model credentials via a deterministic stub or recorded-response runner.

### Milestone C: Optional UX/enforcement paths

Includes Stage 7 through Stage 11.

This adds calibrated inferential review, verifies whether marketplace plugins are feasible, optionally ships a plugin MVP, and provides optional CI adapters. If no plugin target is feasible, docs stay CLI-first and do not promise a plugin install path.

### Milestone D: Agent and migration adapters

Includes Stage 12 and Stage 13.

This adds a native agent-facing adapter and decides how external `agent-coding` skills relate to this platform: remain separate, become a compatibility package, get folded in selectively, get extracted, or deprecate after replacement paths exist.

### Milestone E: Continuous improvement loop

Includes Stage 14 through Stage 17.

This makes entropy/GC operational, expands evidence-driven rule promotion/retirement, and adds recurring maintenance profiles after enough artifacts exist to make those roles useful.

## Validation strategy

- Documentation-only stages must pass Markdown/link sanity checks where available and `git diff --check`.
- Schema stages must include valid and invalid fixtures for high-risk schemas.
- CLI stages must include command-level tests and machine-readable output fixtures.
- Doctor/GC checks must include explicit inputs, algorithms, false-positive policy, and passing/failing fixtures.
- Doctor stages must include an entropy pass confirming docs, examples, fixtures, and shared validation helpers still describe one coherent substrate.
- Eval stages must prove oracle pass and broken twin fail.
- Agent-runner stages must include deterministic stub/recorded execution for CI and reviewers without API keys.
- Plugin stages must prove the plugin is a thin adapter over CLI/schema artifacts and cannot create a second source of truth.
- Migration stages must document before/after workflows for any supported, moved, extracted, deprecated, or unsupported `agent-coding` skill path.

## Stage 1 decisions to document

- Final public wording for "harness-as-code platform for AI coding agents".
- Schema publication mechanism and compatibility policy.
- Confirm `@lachimere/harness-engineering` and `harness` as final npm package/bin names.
- Confirm repository package management with Bun, TypeScript 6 for implementation, Biome/Lefthook using user-provided configuration, explicit `tsc --noEmit` type checking, and Node-compatible public CLI output.
- `agent-coding` disposition options to document at Gate 1:
  - keep as separate skills distribution,
  - create compatibility package,
  - fold selected behavior into this repo,
  - extract selected behavior into separate extension points,
  - deprecate only after replacement paths exist.
- Host/path quickstart matrix wording:
  - CLI-first documented as the current default path, with implementation planned for Stage 3,
  - marketplace plugins planned pending Stage 8,
  - skills compatibility pending Stage 13,
  - CI optional after Stage 11.

## Definition of done for this slug

- The repo has a documented, working CLI-first harness baseline.
- The platform can run at least one end-to-end behavioral eval through `harness run` / `harness eval run`.
- Traces, run-results, verifier results, and reports are schema-backed and reproducible.
- Plugin feasibility is either proven and followed by a plugin MVP, or explicitly deferred with CLI-first docs.
- Optional CI enforcement is portable and does not assume GitHub as the only host.
- Native agent adapters and `agent-coding` compatibility are clearly separated.
- GC and recurring profiles operate over real evidence artifacts, not subjective prose.
