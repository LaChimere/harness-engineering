# Design: Harness Engineering Platform

## Feature summary

Establish `LaChimere/harness-engineering` as the canonical **harness-as-code platform for AI coding agents**.

The core deliverable is not a new skill. The core deliverable is a versioned harness substrate:

- `harness.yaml` as the repo-local source of truth.
- JSON schemas for spec, policy, agent invocation, trace, eval task, run result, doctor result, plugin capability, repair actions, and GC evidence.
- A deterministic `harness` CLI for init, validation, agent runs, doctor checks, project health checks, eval/trace validation, migrations, GC audits, and reports.
- Agent/CLI marketplace plugins as the default interactive product surface for users who want guided setup, dashboards, repairs, and trace/eval navigation, but only when a full-plugin capability tier is proven.
- Optional CI adapters that turn harness drift into objective change feedback for teams that want enforcement.
- Skills as portable agent-facing adapters over the same artifacts.

Portable skills remain useful source material because they encode real agent workflow practice, but they must not be the product center. This repository is clean-slate: it does not need an `agent-coding` product namespace, adapter path, or compatibility package. Existing skills can inform harness-native capabilities, examples, or substrate-backed replacements, but they are not constraints on this repository's target architecture.

## North-star design posture

Design from the desired Harness Engineering end state first, then map the current repo into that target.

This means:

- Optimize for durable harness properties: reproducibility, isolation, traceability, evalability, policy enforcement, continuity, and garbage collection.
- Prefer machine-checkable artifacts over prompt-only instructions.
- Prefer host-agnostic substrate over any single app, plugin, or skill installer.
- Prefer the best user entrypoint for each job: full plugin for rich interactive UX, limited adapter for host-native command/tool entrypoints, CLI/spec for guarantees, skills for portable agent orchestration, CI for optional enforcement.
- Treat compatibility as a migration concern, not a veto. Existing users should get a transition path only for paths this repo explicitly supports, but preserving any external skill graph is not a design goal.
- Allow breaking changes when they produce a materially stronger harness, as long as they are staged, documented, and backed by replacement paths.

## Design decision: best user entrypoint

Use a layered entrypoint strategy:

| Entrypoint | Role | Why |
|---|---|---|
| **Agent/CLI marketplace plugin** | Default guided user experience when Codex, Claude Code, GitHub Copilot CLI, or a comparable agent host exposes a mature marketplace surface | Meets users where they already run coding agents; can discover repos, initialize harnesses, show dashboards or report summaries, run checks/evals, surface repairs, and navigate traces/reports when the full-plugin tier is proven |
| **CLI + `harness.yaml`** | Canonical substrate and source of truth | Host-agnostic, deterministic, scriptable, usable without an agent or plugin |
| **Skills adapter** | Universal agent fallback | Works anywhere the skill pack can be installed; interprets artifacts and delegates implementation |
| **CI adapter** | Optional enforcement path | Prevents harness drift from depending on subjective agent behavior when a team wants blocking checks |

North-star default for most users after a supported agent/CLI marketplace full-plugin tier has been verified:

```text
Install Harness Engineering plugin from the coding-agent marketplace
Open repo
Initialize Harness
Review dashboard
Run doctor/eval/trace checks
Fix with agent
Optional: add CI enforcement
```

If Stage 8 finds only limited adapters, this north-star journey remains aspirational for this slug. The shipped Stage 9 surface must instead describe the exact command, hook, MCP, or skill-pack workflow it supports and label dashboards, annotations, background runs, repair UI, or trace navigation as unavailable unless those capabilities were proven.

Until Stage 8 verifies a real agent/CLI marketplace full-plugin tier and Stage 9 ships it, user-facing docs must lead with the CLI-first path and describe plugin-first as the intended UX, not as an available install path. If no proven adapter exists for the user's host, the universal fallback is the CLI path. This is not a lesser contract; it is the same substrate without the guided UI. Limited adapters may supplement the CLI path only with the specific host-native commands, hooks, MCP tools, or skills proven in Stage 8. The commands below are target CLI commands for Stage 3+ implementation; Stage 2 only defines the schemas and examples they will consume:

```text
npx @lachimere/harness-engineering init
npx @lachimere/harness-engineering doctor
npx @lachimere/harness-engineering health
npx @lachimere/harness-engineering run examples/evals/harness-self-test/v1.0.0/
npx @lachimere/harness-engineering eval run
npx @lachimere/harness-engineering report
```

Plugin selection should be explicit:

```text
Full agent/CLI marketplace plugin feasible -> use marketplace plugin-first guided setup.
Only limited agent/CLI adapter feasible -> use limited adapter for commands/hooks/MCP/skills over CLI; do not claim rich plugin UX.
No supported agent/CLI marketplace adapter -> use CLI-first setup.
No plugin but agent assistance wanted -> use CLI substrate plus a vetted native adapter or explicit CLI/schema-backed fallback guidance; do not assume external skills are installed.
Team wants blocking checks -> add optional CI adapter.
```

The full-plugin tier should be the best day-to-day UX where available, and the preferred install path should be the user's existing coding-agent marketplace rather than a separate manual bootstrap. Marketplace installation is the product-level default only after Stage 8 proves it can hide CLI setup, place harness reports next to the agent workflow, and expose **Initialize Harness** / **Fix with Agent** actions without requiring the user to understand schemas first. The CLI/spec must still remain canonical because plugins are host-specific and cannot be the only durable harness.

Adapters should bundle or auto-manage a pinned CLI dependency when the host permits it. Manual install guidance is only an acceptable fallback for constrained hosts, and the adapter must detect a missing or incompatible CLI before exposing actions such as **Initialize Harness**. CLI resolution order should be explicit: repo-pinned compatible CLI first, then adapter-bundled CLI, then user-installed CLI. If no compatible CLI is available, the adapter may bootstrap one through the host-approved package mechanism; otherwise it must refuse write actions and offer a migration or install path.

Stage 8 must classify each host into a capability tier before choosing Stage 9 scope. All tiers remain adapters over Tier 0-1 artifacts; "limited adapter" means the host cannot support the full rich UX, not that it may create its own contract.

| Tier | Meaning | Stage 9 consequence |
|---|---|---|
| Full plugin | Marketplace-distributed agent/CLI host plugin can manage the CLI and support the required report, annotation, background, repair, and trace UX as an adapter over CLI/schema artifacts. | Implement the full selected-host adapter. |
| Limited adapter | Agent/CLI host install or discovery surface can distribute commands, skills, hooks, MCP tools, or similar entrypoints that invoke the CLI, but cannot support the full rich plugin UX. | Implement only the proven limited adapter surface and label missing UX as unavailable. |
| CLI-first fallback | No agent/CLI marketplace target can safely distribute and run an adapter without violating source-of-truth or trust boundaries. | Skip or defer Stage 9 adapter implementation and keep CLI-first public docs. |
| Future adapter evidence | IDE-only or CI-only extension surfaces may support useful UX but are not the corrected Stage 8/9 target. | Record as out-of-scope evidence only; use a separate future planning slug before selection. |

Tier thresholds:

- **Candidate boundary:** an in-scope Stage 8 candidate must be a named coding-agent or CLI host surface that users install into the agent workflow, not a general IDE marketplace, CI system, or hosted review/checks surface. It must expose commands, hooks, tools, plugins, MCP servers, or equivalent agent-facing extension points that can operate with a repository workspace.
- **Capability status:** each matrix capability must be classified as `yes`, `partial`, `no`, or `unknown`, with an explicit fallback behavior of `supported`, `hide`, `disable`, `cli-redirect`, `advisory-only`, or `hard-error`.
- **Distribution evidence:** distribution may be a formal marketplace, built-in command/hook discovery, MCP server registry/package, skill-pack mechanism, or comparable agent/CLI install surface. General IDE extension stores do not satisfy the corrected Stage 8 boundary.
- **Full plugin threshold:** marketplace distribution, CLI bootstrap/resolution, repo filesystem discovery, CLI invocation or equivalent command execution, report/evidence rendering, annotation or session feedback, background run affordances, repair preview/approval affordances, trace/report deep links, and no authoritative host-only state are all classified `yes` and backed by official docs, source/release evidence, or reproducible host behavior.
- **Limited adapter core capabilities:** distribution or install discovery, repo discovery or explicit repo-root input, CLI bootstrap/resolution guidance, CLI invocation/tool execution, compatibility detection, and no authoritative host-only state.
- **Rich UX capabilities:** report/evidence rendering, annotation or session feedback, background run affordances, repair preview/approval affordances, and trace/report deep links.
- **Limited adapter threshold:** all limited-adapter core capabilities are classified `yes` or `partial` with safe fallbacks, but one or more rich UX capabilities are missing or advisory-only.
- **CLI-first fallback threshold:** distribution, repo access, CLI execution, or trust/approval boundaries are `no` or `unknown` in a way that makes even a limited adapter overpromise or violate the substrate boundary.

The first adapter target should be chosen only after confirming that an agent/CLI marketplace or install model can distribute the adapter and that its runtime APIs can discover repo-local specs, run or display CLI reports, attach review/session annotations, trigger repair actions, and manage the CLI at the claimed tier. If Codex, Claude Code, GitHub Copilot CLI, and named comparable agent/CLI surfaces are not ready, Stage 8 should choose the CLI-first fallback for Stage 9 instead of redirecting to an IDE-specific adapter. IDE extension hosts remain out-of-scope future evidence for this roadmap stage, not fallback Stage 9 targets.

## Distribution decision

Use a TypeScript 6 CLI distributed through Node/npm as the first substrate distribution path because it matches the existing `npx` install habit and keeps cross-platform adoption simple. Repo development should use Bun as the package manager/test runner/bundler where appropriate, with Biome and Lefthook added when implementation begins using the user-provided configuration. The public CLI must remain Node-compatible and must not require end users or host adapters to install Bun first. For most users, the intended product installation is through the relevant coding-agent marketplace only after Stage 8 proves a full-plugin tier; a limited adapter may add host-native commands or tools but must remain labeled limited. Any adapter should bundle, pin, or bootstrap the CLI behind the scenes when the host permits it.

Proposed package shape:

```text
@lachimere/harness-engineering
  language: TypeScript 6
  package manager: Bun for repo development
  lint/format: Biome with user-provided configuration
  git hooks: Lefthook with user-provided configuration
  runtime target: Node-compatible public CLI
  bin: harness
  commands: init, validate, migrate, run, doctor, health, eval, trace, verify, gc, report
```

The repository should commit Bun's text lockfile and keep TypeScript checks explicit with `tsc --noEmit`; Bun's transpiler/bundler is not the type checker. Biome and Lefthook are required toolchain components, but their concrete rules/hooks should come from the user's configuration rather than being invented during planning.

`harness.yaml` should pin a schema version and CLI version range so downstream repos can adopt upgrades deliberately.

Adapter packages should also pin the CLI/schema compatibility range they support. An adapter upgrade may expose a newer UI, but it must not silently rewrite `harness.yaml` or upgrade schema versions without an explicit `harness migrate` step that previews changes, records evidence, and can be reproduced without the adapter.

## Research-driven principles

The research report for this design lives in the repository at:

```text
plans/harness-engineering-platform/research.md
```

Design principles incorporated from the research:

- Treat **Agent = Model + Harness**. The harness includes prompts, skills, tools, filesystem, sandbox, trace, evals, approvals, middleware, handoff artifacts, and orchestration.
- Split controls into **feedforward** guidance versus **feedback** sensors, and **computational** deterministic checks versus **inferential** LLM-mediated review.
- Make trace/eval, approval/sandbox policy, self-verification, model profiles, and continuity state first-class contract concepts.
- Prefer declarative task specs, deterministic verifiers, run logs, holdouts, self-test fixtures, versioned schemas, and CI gates.
- Keep automated harness evolution human-reviewable: propose cleanup slices and rule/eval changes from evidence, do not silently mutate the harness.

## Target architecture

### Product identity

The repo should become:

> A harness-as-code platform for AI coding agents, with a canonical spec/CLI substrate, optional plugins for rich host UX, and portable skills as agent-facing adapters.

### Intended repository layout

```text
schemas/
  harness.schema.json
  approval-policy.schema.json
  environment.schema.json
  agent-runner.schema.json
  trace.schema.json
  eval-task.schema.json
  run-result.schema.json
  doctor-result.schema.json
  plugin-capability.schema.json
  repair-action.schema.json
  gc-evidence.schema.json
  sandbox-policy.schema.json
  continuity-state.schema.json
  self-verification.schema.json
  model-profile.schema.json
  failure-taxonomy.schema.json

tools/
  harness/
    init
    validate
    migrate
    run
    doctor
    eval
    trace
    verify
    gc
    report

examples/
  harness.yaml
  policies/
  evals/
  traces/
  run-results/
  reports/

plugins/
  <stage8-selected-agent-cli-host>/   # created only after Stage 8 selects a feasible target

skills/
  harness-engineering/        # optional native portable adapter after substrate exists

optional-adapters/
  github-actions/
  other-ci/
```

This does not require every directory to land in the first Stage. It defines the destination so early changes do not drift back into "skills plus prose".

### Illustrative `harness.yaml`

Stage 2 should refine this shape, but the design assumes a repo-local spec like:

```yaml
schema_version: "0.1.0"
harness:
  name: harness-engineering
  failure_taxonomy: examples/failure-taxonomy.yaml
engines:
  cli: ">=0.1 <0.2"
  schemas:
    harness: ">=0.1 <0.2"
    agent-runner: ">=0.1 <0.2"
    trace: ">=0.1 <0.2"
    eval-task: ">=0.1 <0.2"
context:
  maps:
    - AGENTS.md
    - README.md
environment: examples/environments/container.yaml
approval_policy: examples/policies/approval-policy.yaml
sandbox: examples/policies/sandbox-policy.yaml
model_profiles:
  default: examples/model-profiles/stub.yaml
agent_runners:
  default: examples/agent-runners/stub.yaml
traces:
  output_dir: .harness/traces
evals:
  suites:
    - id: harness-self-test
      version: "1.0.0"
      tasks: examples/evals/harness-self-test/v1.0.0/
  run_results: .harness/run-results.jsonl
doctor:
  checks:
    - builtin:schema-validity
    - builtin:reference-exists
    - id: local-doc-link-check
      path: examples/checks/doc-links.yaml
      trust_requirements:
        trust_level: sandboxed
        sandbox_required: process
        network_access: false
        secret_access: false
        host_file_access: false
        allowed_inputs:
          - README.md
          - AGENTS.md
        allowed_outputs:
          - .harness/doctor/doc-links.json
continuity:
  state_dir: .harness/continuity
  startup_smoke_test:
    command: harness validate
    timeout_seconds: 300
  handoff_dir: .harness/handoffs
  session_id_env: HARNESS_SESSION_ID
gc:
  evidence_dir: .harness/gc
```

The key point is composition: the spec points to policies, eval suites, trace locations, local checks, and continuity state rather than embedding all details in one giant file. Plugin and CI adapter sections are added only when their adapters ship; the default `harness init` output should not create GitHub Actions or plugin-specific keys before Stage 9 or Stage 11.

### Delivery tiers

| Tier | Surface | Purpose | Compatibility promise |
|---|---|---|---|
| 0 | Harness-as-code substrate | `harness.yaml`, JSON schemas, examples, versioning, artifact conventions | Source of truth; works without any agent |
| 1 | Deterministic CLI tooling | `init`, `validate`, `migrate`, `run`, `doctor`, `eval run`, `trace validate/import`, `verify`, `gc`, `report` | Mechanical guarantees for plugin, agent, automation, and CI adapters |
| 2 | Agent/CLI marketplace adapters | Rich host UX when the full-plugin tier is proven; otherwise limited commands, hooks, MCP tools, or skills over the CLI when feasible | Best UX where supported; always adapted over Tier 0-1 and labeled by proven capability tier |
| 3 | Portable skills | Agent-facing assessment, routing, planning, execution guidance | Universal fallback; consumes substrate evidence |
| 4 | CI adapters | Optional blocking or advisory checks in CI systems | Enforcement when teams want it; never required for local/plugin use |
| 5 | Recurring profiles | Entropy auditor, doc gardener, eval curator, trace reviewer | Optional maintenance loops over artifacts |

### User journeys

1. **Marketplace plugin guided setup (north-star after full-plugin host feasibility)**
   - User installs the Harness Engineering plugin from a supported coding-agent marketplace.
   - The plugin detects whether `harness.yaml` exists.
   - If missing, the plugin offers **Initialize Harness** and calls the CLI substrate to create the baseline.
   - The plugin shows harness health only for capabilities proven by Stage 8: schema validity, doctor findings, eval status, trace coverage, policy/sandbox gaps, or GC suggestions.
   - The plugin offers **Fix with Agent** only when the selected host proves repair preview/approval support; those actions must use the repair-action contract.

2. **CLI-first mechanical baseline (available before plugins after the relevant CLI stages land)**
   - User runs `harness init` after Stage 3 implements the initial CLI.
   - The tool creates `harness.yaml`, starter policies, example evals, and trace examples without creating CI or plugin adapter keys before those adapters exist.
   - After the relevant stages land, users run `harness validate`, `harness doctor`, `harness run`, `harness eval run`, `harness trace validate`, `harness verify`, and `harness report`.
   - The CLI can produce run-result and report artifacts without an agent by executing deterministic verifiers and configured local commands once Stages 4-6 provide those capabilities.

3. **Agent-assisted rollout**
   - User asks for harness engineering through a plugin chat surface when supported, through a native portable adapter when available, or through a future adapter path backed by a separately approved substrate contract.
   - The `harness-engineering` adapter reads `harness.yaml`, doctor output, eval plans, traces, and reports.
   - It produces a rollout plan and delegates implementation to configured repair actions, native agent adapters, or explicit CLI/schema-backed fallback guidance rather than assuming external skills are present in this repo.

4. **Optional CI-enforced harness**
   - CI validates schemas and runs selected doctor/eval/trace checks.
   - CI checks fail on objective drift, missing evidence, invalid policy, stale eval fixtures, or broken harness self-tests.

5. **Long-running maintenance**
   - Recurring profiles consume append-only run results, doctor output, traces, eval outcomes, and review comments.
   - They propose atomic cleanup slices and evidence-backed rule/eval promotion or retirement decisions for human review.

The v1 delivery surface is the CLI package. Agent/CLI plugins, CI integrations, and portable skills can improve UX or enforcement after the core is useful, but they must remain projections over the same CLI/schema artifacts.

## Cross-tier primitives

These primitives should be schema-backed where possible and reused by CLI, CI, plugins, skills, and recurring agents.

| Primitive | Meaning | First owner |
|---|---|---|
| Harness spec | Repo-local `harness.yaml` describing goals, surfaces, policies, eval suites, traces, GC, and adapters | Tier 0 substrate |
| Schema package | Versioned JSON schemas and examples for every machine-readable artifact | Tier 0 substrate |
| Context map | How agents discover repo knowledge without a giant instruction blob | harness spec + workflow contract |
| Execution environment | Local/worktree/container/cloud environment, pinned dependencies, resources, startup, health checks, teardown | harness spec |
| Tool and approval policy | Tool risk classes, approval modes, approve/modify/reject/escalate/terminate decisions | approval-policy schema |
| Sandbox policy | Isolation tier, enforcement mechanism, filesystem/process/network/container/secret boundaries | harness spec + policy schema |
| Agent runner | How a model/provider profile, prompt adapter, tool policy, sandbox, task, and verifier are composed into one executable run | agent-runner schema + `harness run` |
| Trace schema | `schema_version`, `session_id`, `run_id`, inputs, environment snapshot, actions, tool calls, errors, logs, timestamps, duration, exit code, evidence links | trace schema |
| Eval task schema | Instruction, environment, verifier, oracle solution, task version, dataset hash, optional solution, artifacts, timeout, reward/result | eval-task schema |
| Run-result log | Append-only run results with task/schema/model/harness versions for regression tracking and trend analysis | run-result schema |
| Doctor check registry | Deterministic checks, fixtures, severity, remediation, exit semantics | doctor CLI + schema |
| Project health evidence | Executed local lint/test/typecheck/doc checks with trust/sandbox declarations, status, failure class, and artifacts | health CLI + assessment |
| Continuity state | Feature list, progress log, init script, startup smoke test, git checkpoint, handoff | continuity schema + CLI validator |
| Self-verification evidence | Spec re-read result, acceptance comparison, checks run, artifacts, unresolved risks | verification schema + CLI validator |
| Model/provider profile | Model-specific tool format, prompt assumptions, context, reasoning budget, quirks | harness spec |
| Failure taxonomy | Stable failure codes for tool errors, timeouts, loops, verification failures, context loss, routing misses | schema package |
| Plugin capability | Host-specific declaration of supported actions such as init, report rendering, annotations, background runs, repair actions, and CLI management | plugin-capability schema |
| Repair action | Previewable, approval-gated, CLI-reproducible change proposal emitted by plugin or agent repair flows | repair-action schema + CLI |
| Entropy/GC evidence | Detect, classify, rank, slice, cleanup, and cite future rule/eval lifecycle decisions | GC schema + CLI |

## Schema minimums

Stage 2 should define the minimum viable shapes, not only file names.

- **Environment schema:** require an isolation kind, dependency source, resource limits, health check, and teardown. Reproducible evals should default to `container` or stronger; `process` and `worktree` are allowed for lightweight local checks but must be labeled lower-assurance.
- **Template expansion:** if `harness.yaml` supports interpolation, Stage 2 should start with environment variables using `${VAR}` syntax resolved from the process environment. Undefined values should fail validation unless a default is explicitly declared. Additional workflow-context interpolation can be added later only with an explicit allowed-variable set.
- **Sandbox schema:** define an isolation ladder (`none`, `process`, `worktree`, `container`, `vm`), concrete network modes, filesystem allow/deny lists, secret exposure rules, and enforcement notes.
- **Approval policy schema:** define risk classes, approval modes, decision state machine, escalation target, escalation timeout, at least one mandatory transport (`cli-interactive` plus file-drop fallback for non-interactive hosts), `modify` logging, and terminate behavior (`cleanup-and-exit`, `save-state-and-exit`, `abort-immediately`).
- **Agent-runner schema:** define model profile, prompt/tool adapter, task input, sandbox, approval policy, trace output, credential reference, timeout, cost/token/request budgets, and verifier binding so `harness run` can actually execute a model through a harness without inline secrets or unbounded spend.
- **Trace schema:** require `session_id`, `run_id`, `harness_version`, `schema_version`, inputs, environment snapshot, start/end time, duration, exit code, determinism level, action records, and artifact links.
- **Eval task schema:** require task versioning, dataset hash, verifier, timeout, oracle/baseline fields for harness self-tests, and confidence level (`validated-oracle`, `human-labeled`, `experimental`).
- **Run-result schema:** include suite/task version, dataset hash, model profile, harness version, status, failure code, trace link, and artifact links so trend comparisons can separate task drift from agent/harness changes.
- **Model profile schema:** include provider, model id, tool-call format (`openai-function`, `anthropic-tool-use`, `mcp`, `raw-json`), context window, reasoning budget, prompt/tool-result formatting, and known quirks.
- **Failure taxonomy schema:** include starter codes such as `tool-error`, `timeout`, `loop-detected`, `verification-failure`, `context-loss`, `routing-miss`, `premature-completion`, and `no-progress-edit-churn`.
- **Doctor check and verifier trust model:** local checks and verifiers must declare trust level, sandbox requirements, allowed inputs/outputs, and whether they may access network, secrets, or host files.
- **Plugin capability schema:** define host, surface kind, capability tier, distribution surface, CLI management mode, stable evidence ids, evidence links, supported actions, unsupported-action fallbacks, annotation support, background-run support, and repair-action support. Stage 2 may provide provisional minimum shapes, but Stage 8 must revalidate them against the host capability matrix before Stage 9 consumes them.
- **Adapter scope manifest:** Stage 9 must produce a schema-backed machine-readable manifest, or extend the selected adapter package metadata with the revalidated plugin-capability schema shape, declaring implemented capabilities, unavailable capabilities, fallback behavior, required Stage 8 matrix evidence ids, CLI/schema compatibility, and trust/write boundaries. This manifest is the source used to validate that the Stage 9 adapter scope is a subset of Stage 8-proven capabilities.
- **Repair-action schema:** define target files, risk class, preview diff, equivalent CLI command, approval state, sandbox requirement, rollback notes, and evidence links. Stage 2 may provide provisional minimum shapes, but Stage 8/9 must confirm host-specific repair UX before writes are enabled.
- **GC evidence schema:** include category, severity, confidence, evidence refs, proposed cleanup slice, blast radius, atomicity notes, and promotion/retirement decision refs.

## Module responsibilities

| Module | Responsibility |
|---|---|
| Harness substrate | Owns `harness.yaml`, schemas, examples, artifact conventions, and versioning |
| Harness CLI | Owns deterministic local operations: init, validate, migrate, adapter validate, assess, loop validate, run, doctor, health, eval run, trace validate/import, verify, GC audit/validate, report |
| CI adapters | Run CLI checks in stages and publish objective results |
| Agent/CLI marketplace plugins | Provide the best interactive UX by visualizing and acting on substrate artifacts when the full-plugin tier is proven; first target must be validated against agent/CLI marketplace distribution and host APIs |
| Native agent adapters | Optional portable agent UX over substrate evidence; added only after CLI/schema contracts exist |
| Harness-native practice mining | Distills external agent-workflow source material into harness-native capability decisions; source projects are not product namespaces or source-of-truth state |
| Behavioral eval suite | Task-level outcomes, holdouts, deterministic verifiers, LLM-judge calibration policy |
| GC loop | Evidence-backed entropy detection, cleanup slicing, and rule/eval lifecycle decision evidence |
| Recurring profiles | Scheduled or long-running maintenance roles over run logs, traces, evals, and doctor output |

## Mining external skills into harness-native capabilities

The following external skills are source material only. Stage 13 should learn from their workflow practices, not represent the source project as a compatibility namespace in this repository. The output should identify which capabilities are worth bringing into harness-engineering, which substrate surface could eventually own them, and what proof is required before native adoption. The vulnerability-scanning utility is deliberately out of scope for Stage 13.

This table is illustrative; the canonical Stage 13 artifact is `plans/harness-engineering-platform/capability-ledger.yaml`.

| Source material | Practice to mine | Possible harness-native surface | Boundary |
|---|---|---|---|
| `workflow-orchestrator` | Workflow phases, gates, escalation, and role routing | Future workflow/profile guidance over plan, evidence, and approval artifacts | Do not import skill graph, triggers, templates, or `plans/{slug}` as source-of-truth state |
| `execute-plan-loop` | Atomic execution slices, status refresh, verification cadence, periodic review, completion gates | Stronger continuity/self-verification/run evidence protocol; possible future execution-loop command or profile | Keep prompt loop external until CLI/schema artifacts can validate the behavior |
| `decompose-feature` | Reviewable PR sequencing, dependencies, allowed/prohibited scope, acceptance criteria | Decomposition artifact or planning profile after substrate ownership is designed | Do not make narrative PR plans a harness contract without fixtures and validation |
| `plan-parallel-work` | Worktree/branch ownership, forbidden paths, merge order, convergence owner | Parallel-work topology artifact or adapter guidance after runner/worktree support exists | Do not enforce path ownership without deterministic conflict evidence |
| `ensure-atomic-pr` | Mixed-concern detection, split proposals, atomicity exceptions | Advisory GC/assessment evidence category with false-positive policy | Do not ship subjective atomicity scoring as a blocking check |
| `refresh-related-docs` | Doc freshness triggers, approval-before-editing, high-impact doc handling | Doc-gardener recurring profile or doc-freshness evidence after Stage 19 profile design | Do not add automatic doc rewrites or tone/style checks as doctor categories |
| `achieve-goal` | Goal lifecycle, pause/resume/blocker/budget states, completion audit | Goal/recurring-profile lifecycle schema or continuity extension after profile semantics exist | Do not make Markdown goal state a substrate primitive |

Stage 13 should not copy, vendor, rewrite, merge, or deprecate any skill. It should produce a durable harness capability ledger, not a skill backlog. Each row should start from an observed failure mode or substrate gap, then record the capability, source observations, candidate surface, deterministic/advisory/non-core disposition, owner stage or `deferred` rationale, required schema/CLI/profile/eval/GC proof, fixtures or evals required, trust/sandbox and false-positive requirements, and what remains outside harness core.

## Stage sequence

### Stage 1: Product identity, entrypoints, and distribution decisions

- **Goal:** Declare this repo as the canonical harness-as-code platform, with external skills treated as source material for harness-native capabilities rather than product surfaces, without claiming unavailable commands or plugins already work.
- **Likely files:** `README.md`, `AGENTS.md`, this design.
- **Allowed changes:**
  - Define marketplace plugin as the north-star guided UX, CLI/spec as the current canonical substrate and launch path, external skills as source material for capability mining, and CI as optional enforcement.
  - Explain that external skill installation is not the primary mechanical foundation or an endorsed default.
  - Choose canonical locations: proposed `schemas/`, `tools/harness/`, `examples/`, `plugins/`, and `skills/`.
  - Pin the initial CLI package name (`@lachimere/harness-engineering`), binary name (`harness`), schema publication mechanism, schema compatibility policy, and `harness migrate` posture.
  - Define marketplace plugin-support language: "agent/CLI marketplace plugin-first after a full-plugin tier is proven; limited adapter if only limited capability is proven; CLI-first until then."
  - Add a Gate 1 disposition for external skill source material: mine it for practices, keep source skills external by default, create adapter guidance only for supported paths, extract selected practices only after substrate contracts exist, or deprecate external guidance after replacement paths exist.
- **Acceptance criteria:**
  - README includes a host/path quickstart matrix: current documented CLI-first path, planned marketplace plugin paths, external agent-practice mining status, and optional CI.
  - The docs state which paths exist now versus which are planned.
  - The package/schema distribution choice is explicit enough for Stage 2 and Stage 3 to implement.

### Stage 2: Harness schema substrate

- **Goal:** Add machine-checkable contracts before tools, plugins, or skills depend on them.
- **Dependencies:** Stage 1.
- **Likely files:** `schemas/*.schema.json`, `examples/harness.yaml`, schema docs, valid/invalid examples.
- **Allowed changes:**
  - Define `harness.yaml` shape and schema publication/consumption rules.
  - Define schemas for approval policy, sandbox policy, environment, model profile, failure taxonomy, continuity state, self-verification evidence, doctor result, eval task, agent runner, trace, run result, plugin capability, repair action, and GC evidence.
  - Include schema versioning, deprecation policy, migration-note format, and external-validation examples.
  - Include valid and invalid examples for the highest-risk schemas.
- **Acceptance criteria:**
  - External tools can validate artifacts against published or locally vendored schemas.
  - Every machine-readable artifact has `schema_version` and clear compatibility semantics, using per-schema semantic versions plus the `engines.schemas` range in `harness.yaml`.
  - The example `harness.yaml` validates and composes references rather than embedding all details.
  - `continuity-state.schema.json` and `self-verification.schema.json` are complete enough for Stage 10 to consume startup verification, progress, evidence, and handoff state without inventing new artifact shapes.
  - `agent-runner.schema.json` is complete enough for Stage 6 to enforce model invocation, credential references, cost/token/request budgets, sandbox, approval policy, trace output, and verifier binding without inventing new artifact shapes.
  - Local doctor checks, eval verifiers, and repair actions have declared trust/sandbox requirements.

### Stage 3: Harness CLI skeleton, init, validate, migrate, verify, and report

- **Goal:** Provide a deterministic substrate entrypoint that works without an agent or plugin.
- **Dependencies:** Stage 1 and Stage 2.
- **Likely files:** `tools/harness/`, package metadata, README quickstart.
- **Allowed changes:**
  - Implement `harness init`, `harness validate`, `harness migrate`, `harness verify`, and `harness report`.
  - `init` creates a minimal `harness.yaml` and starter examples.
  - `validate` checks schemas, schema publication references, version compatibility, and only the composed reference files available at this stage.
  - `migrate` previews schema/CLI migrations and records machine-readable migration evidence; early versions may support no-op migrations only.
  - `verify` consumes explicit verification specs or acceptance checks and records self-verification evidence without needing an agent; it must not perform structural harness inspection that belongs to `doctor`.
  - `report` emits Markdown and JSON summaries.
- **Acceptance criteria:**
  - A user can bootstrap and validate a harness baseline from the terminal.
  - CLI exit semantics are documented for future plugin and CI adapters.
  - Reports cite the artifact paths they summarized.
  - `verify` documentation defines the verification spec or acceptance-check input format and includes an example that distinguishes self-verification from structural `doctor` checks and behavioral `eval` runs.
  - `verify` does not perform structural harness inspection that belongs to `doctor`.

### Stage 4: Harness doctor MVP

- **Goal:** Add trusted deterministic checks over the substrate.
- **Dependencies:** Stage 2 and Stage 3.
- **Allowed changes:**
  - Define check contract: `id`, `version`, `category`, `inputs`, `determinism`, `severity`, `evidence`, `remediation`, `fixtures`, `false_positive_policy`, `exit_semantics`.
  - Define downstream check registration through `harness.yaml`, including local check paths, versioning, and fixture expectations.
  - Add a small objective check set with fixtures.
  - Emit machine-readable and Markdown results.
- **Boundary:** `doctor` inspects harness structure, configuration, references, and deterministic repository-level checks; it must not claim task acceptance or self-verification status that belongs to `verify` or `eval`.
- **Prohibited changes:** No subjective "AI slop" scoring.
- **Acceptance criteria:**
  - Doctor output conforms to `doctor-result.schema.json`.
  - Passing and failing fixtures validate with zero schema errors.
  - Exit code semantics are documented for plugin and CI consumption.
  - Doctor checks remain deterministic structural checks and do not claim task acceptance, self-verification status, or subjective "AI slop" scores.

### Stage 5: Eval task contract and deterministic verifier runner

- **Goal:** Make behavioral feedback concrete without importing a full benchmark framework.
- **Dependencies:** Stage 2 and Stage 3.
- **Allowed changes:**
  - Define minimal eval task/run format inspired by Harbor, Terminal-Bench, SWE-bench, and OpenAI Evals.
  - Implement or specify deterministic verifier execution and run-result recording, including `harness eval validate` and a verifier-only mode.
  - Add task versioning, dataset hashes, holdout metadata, resource/time limits, and result semantics.
  - Add harness self-test fixture with oracle pass and broken twin fail.
  - Use `harness eval validate` to run oracle/baseline tasks and detect harness bugs.
- **Acceptance criteria:**
  - The self-test proves the verifier can pass and fail deterministically.
  - Run results include suite/task version and dataset hash.
  - A reviewer can distinguish agent failure from harness/verifier failure.
  - Verifiers declare trust level, sandbox requirements, allowed inputs/outputs, and network/secret/host-file access before execution.
  - Eval task and run-result schemas support optimization/holdout split designation and record which split was used.

### Stage 6: Agent runner, first end-to-end behavioral eval, and trace normalization

- **Goal:** Make the platform run a model through a harness on a task suite, not only validate schemas and verifiers.
- **Dependencies:** Stage 2, Stage 3, and Stage 5.
- **Allowed changes:**
  - Implement or specify `harness run <task>` using `agent-runner.schema.json`, model profile, credential reference, cost/token/request budgets, sandbox, approval policy, trace output, and verifier binding.
  - Include a deterministic stub or recorded-response runner so the first behavioral eval can run in CI and by reviewers without API keys. The stub path still uses explicit non-secret stub credential references and budgets, so it exercises the runner contract without live secrets.
  - Implement `harness eval run` as an end-to-end behavioral eval over at least one toy suite with baseline/oracle, optimization/holdout metadata, trace output, run-result recording, and a small scoreboard/trend report.
  - Implement or specify `harness trace validate/import`.
  - Require `session_id`, `run_id`, `harness_version`, environment snapshot, inputs, timestamps, duration, exit code, determinism level, action records, and artifact links.
  - Define how long-running sessions contain multiple runs.
  - Add examples for imported external agent traces and native CLI traces.
- **Acceptance criteria:**
  - A user can run a toy task through a configured model/harness and receive trace, run-result, verifier result, and report artifacts.
  - The toy suite can run with the deterministic stub/recorded runner and does not require live credentials.
  - The stub/recorded runner satisfies the credential-reference and budget contract with non-secret fixture values rather than bypassing it.
  - Agent runs refuse to execute without explicit credential references and cost/token/request budgets, with fixtures or tests covering the refusal.
  - Eval output distinguishes optimization and holdout splits.
  - The first scoreboard distinguishes harness/verifier failure from agent/model failure.
  - Trace examples validate against schema.
  - A run result can link to the trace and artifacts that produced it.
  - Long-running continuity can associate multiple runs with one session.
  - Review docs explain how to run the toy eval locally and in CI-safe mode without credentials.

### Stage 7: LLM-judge and inferential-review policy

- **Goal:** Keep inferential feedback useful without turning it into uncalibrated pass/fail.
- **Dependencies:** Stage 5 and Stage 6.
- **Allowed changes:**
  - Define LLM-judge policy: rubric, labeled sample minimum, agreement metric/threshold, uncertainty notes, and consequence below threshold.
  - Define how judge outputs are stored in run results and how they differ from deterministic verifier results.
  - Add meta-eval or labeled-example fixture for the judge policy.
  - Add eval runner or report validation that marks uncalibrated judge outputs advisory-only.
- **Acceptance criteria:**
  - No LLM-judge result can be marked blocking unless the calibration policy is satisfied.
  - The judge policy specifies rubric, labeled sample minimum, agreement metric, numeric blocking threshold, uncertainty notes, and below-threshold consequence.
  - Fixtures demonstrate calibrated blocking, advisory-only, and below-threshold judge cases.
  - The docs state how to treat low-agreement or stale judges.

### Stage 8: Agent/CLI marketplace adapter feasibility and target selection

- **Goal:** Verify the agent/CLI marketplace plugin-first UX before committing to a host-specific implementation.
- **Dependencies:** Stage 3, Stage 4, Stage 5, and Stage 6.
- **Allowed changes:**
  - Evaluate candidate agent/CLI marketplace hosts such as Codex, Claude Code, GitHub Copilot CLI, and named comparable coding-agent hosts with a real marketplace, command/hook discovery, MCP registry, skill-pack mechanism, or equivalent install path.
  - Classify each host as `full-plugin`, `limited-adapter`, `cli-first-fallback`, or `future-adapter-evidence` based on proven capabilities.
  - Treat IDE-only, CI-only, and hosted checks/review surfaces as out-of-scope future evidence rather than Stage 9 candidates.
  - Treat GitHub Checks/Actions primarily as optional CI adapters unless they expose an agent-host plugin surface.
  - Verify whether the agent/CLI marketplace can distribute the adapter and whether the runtime can discover repo-local specs, run or display CLI reports, attach review/session annotations, trigger agent repair, and manage or bundle the CLI.
  - Choose the first agent/CLI marketplace plugin or limited-adapter target only at the capability tier that evidence supports, or explicitly document why the first release must use CLI-first while plugin remains a target.
- **Acceptance criteria:**
  - The review assigns each host a capability tier and explains which Stage 9 scope, if any, that tier permits.
  - The matrix distinguishes in-scope candidates from out-of-scope future evidence; IDE-only, CI-only, and hosted checks/review surfaces cannot be selected for Stage 9 in this slug.
  - The review produces a per-host capability matrix covering agent/CLI marketplace or install distribution, CLI bundling/bootstrap, filesystem access, CLI invocation, report rendering, annotation APIs, background runs, repair-action UI, and trace deep-links.
  - Capability evidence entries include stable `evidence_id`, source date, source type, positive/partial/negative finding, and reproduction or inspection notes. Acceptable source types are official docs, source/release evidence, marketplace or registry metadata, maintainer statements, or local reproduction notes dated within the Stage 8 review unless intentionally marked historical.
  - The capability matrix has a durable format that Stage 9 can consume or cite, with fields for `host`, `surface_kind`, `candidate_status`, `tier`, `capabilities`, `evidence_ids`, `evidence`, `fallback`, and `stage9_consequence`.
  - Matrix completeness and cross-artifact invariants are validated with schema fixture tests or equivalent automated checks.
  - The provisional plugin-capability and repair-action schemas from Stage 2 are revalidated against the host capability matrix.
  - If a target is chosen, it has documented agent/CLI marketplace distribution evidence and API evidence for the tier-specific supported capabilities proven by Stage 8.
  - If only a limited adapter is feasible, Stage 9 scope is limited to that limited adapter and must not claim full plugin UX.
  - If a full-plugin target is feasible, proceed to full Stage 9 adapter implementation.
  - If no in-scope full-plugin or limited-adapter target is feasible, skip or defer Stage 9, update docs to make CLI-first the default until an adapter exists, and do not promise an unavailable plugin.
  - If every named host is classified as limited-adapter, the north-star journey is either rewritten to the proven limited workflow for Stage 9 or explicitly labeled aspirational until a full-plugin host exists.

### Stage 9: Conditional adapter MVP

- **Goal:** Provide the best guided user entrypoint for the selected and proven capability tier.
- **Dependencies:** Stage 8.
- **Likely files:** `plugins/<target>/` or `adapters/<target>/`, adapter docs, examples.
- **Allowed changes:**
  - Implement the selected full plugin or limited adapter, but only for capabilities proven by the Stage 8 matrix.
  - Add a schema-backed machine-readable adapter scope manifest, or equivalent revalidated plugin-capability metadata, declaring implemented capabilities, unavailable capabilities, fallback behavior, required Stage 8 matrix evidence ids, CLI/schema compatibility, and trust/write boundaries.
  - Discover `harness.yaml`, initialize through the CLI substrate, render doctor/eval/trace reports, create supported annotations, and offer "Fix with Agent" actions only where the selected tier supports them.
  - Publish or package through the selected agent/CLI marketplace mechanism when available and verified.
  - Bundle, pin, or clearly bootstrap the CLI dependency.
  - Keep adapter behavior as an adapter over CLI/schema artifacts.
- **Prohibited changes:** Do not reimplement doctor checks or eval verifiers in adapter code; do not store authoritative adapter-only state; do not write repo files except through CLI-backed init/migrate/repair actions.
- **Acceptance criteria:**
  - A user can install or enable the selected host surface at the capability tier proven in Stage 8 without separately guessing CLI prerequisites.
  - Automated validation proves the Stage 9 adapter scope manifest or equivalent revalidated plugin-capability metadata is a subset of capabilities proven in the Stage 8 matrix.
  - The adapter bundles or auto-manages a pinned CLI dependency unless the host forbids it; constrained-host manual guidance must include missing/incompatible CLI detection and repair prompts.
  - The adapter resolves CLI versions in this order: repo-pinned compatible CLI, adapter-bundled CLI, then user-installed CLI.
  - The adapter refuses write actions when no compatible CLI/schema version exists.
  - Repair actions show preview diffs, use the approval policy, declare risk class, and emit equivalent CLI commands only when Stage 8 proves the selected host has preview and approval affordances.
  - Limited adapters without proven preview and approval affordances keep repair actions advisory: show the equivalent CLI command, explain required approval/risk, and do not execute writes through the host surface.
  - The adapter does not create a second source of truth; any adapter-local cache is non-authoritative, reconstructible, and excluded from CLI/CI behavior.
  - Any UX capability not proven in Stage 8 is absent or clearly labeled unavailable, not implied by the package.

### Stage 10: Native execution loop and continuity adapter

- **Goal:** Define native implementation-loop behavior over the substrate without assuming `agent-coding` skills are present.
- **Dependencies:** Stage 2, Stage 3, Stage 4, Stage 5, and Stage 6.
- **Allowed changes:**
  - Define a native execution-loop contract or adapter that reads `harness.yaml`, approval policy, sandbox policy, continuity schema, and self-verification evidence schema.
  - Re-read original spec, compare acceptance criteria, run relevant CLI and doctor checks, capture evidence, and update continuity state before completion.
  - Define startup verification and handoff expectations for long-running work.
  - Document that any external producer of continuity and self-verification artifacts must conform to the same schema and CLI validation gates.
- **Acceptance criteria:**
  - The execution loop cannot claim completion without substrate-aware verification evidence.
  - Approval/sandbox policy decisions are read and either followed or explicitly escalated.
  - Startup verification runs before work begins and records the result in continuity state.
  - Fixtures demonstrate the execution loop refusing to start or complete when startup verification or completion-gate evidence fails.

### Stage 11: Optional CI adapters

- **Goal:** Make harness checks enforceable in CI for teams that want blocking or advisory gates.
- **Dependencies:** Stage 3, Stage 4, Stage 5, Stage 6, and Stage 7.
- **Allowed changes:**
  - Add generic CLI exit semantics plus CI examples for schema validation, doctor checks, eval/trace validation, and report artifact upload.
  - Include GitHub Actions as one example, not as the assumed user path.
  - Document which checks are blocking versus advisory; uncalibrated LLM-judge results are advisory-only by default.
- **Acceptance criteria:**
  - A downstream repo can opt into objective CI feedback without needing a plugin or agent.
  - CI examples are clearly optional adapters.
  - Blocking/advisory status is represented in shared CLI/schema/report artifacts so CI, plugin, and skill adapters use consistent policy.
  - Uncalibrated LLM-judge results remain advisory-only by default.

### Stage 12: Native agent-facing harness-engineering adapter

- **Goal:** Add portable agent UX after the substrate and execution loop exist.
- **Dependencies:** Stage 10. Stage 9 integration is optional because skills must remain usable when no adapter target is feasible.
- **Likely files:** `skills/harness-engineering/*` or another explicitly chosen adapter path, README.
- **Allowed changes:**
  - Add read-only assessment/design workflow for downstream repositories.
  - Read `harness.yaml`, doctor output, eval plans, traces, run results, and reports when available.
  - Output maturity scorecard, missing primitives, rollout stage plan, policy/eval/trace/continuity recommendations.
  - Route implementation to trusted applicable native repair actions, native execution-loop adapters, or clear CLI/schema-backed fallback guidance.
- **Prohibited changes:** Do not make the skill a separate contract or broad execution loop.
- **Acceptance criteria:**
  - The adapter emits a maturity scorecard, missing primitives, rollout stage plan, and policy/eval/trace/continuity recommendations from substrate artifacts while preserving CLI/schema as source of truth.
  - The adapter does not assume `agent-coding` skills are installed or vendored in this repo.
  - The adapter demonstrates routing implementation requests to trusted applicable repair actions, native execution-loop adapters, or a clear fallback when no implementation route is configured.

### Stage 13: Agent-practice mining for harness-native capabilities

- **Goal:** Learn from external agent-workflow skills and convert useful practices into harness-native capability decisions, without making the source project part of this repository's product surface.
- **Dependencies:** Stage 1 to start research; Stage 10 and Stage 12 before binding internalization or disposition decisions land.
- **Allowed changes:**
  - Start from `harness assess` dogfood gaps and explicit failure modes, then audit external workflow skills for practices, ideas, and countermeasures that may be worth preserving.
  - Write the durable ledger to `plans/harness-engineering-platform/capability-ledger.yaml`, with stable `capability_id` values so later stages can cite individual records.
  - Record each capability's possible harness-native surface: schema artifact, CLI command, recurring profile, GC/eval/verification rule, adapter guidance, or explicit non-core decision.
  - Classify each capability as deterministic candidate, advisory candidate, non-core, or reject/defer with rationale.
  - Record evidence required before internalization: artifact contract, CLI owner, trust/sandbox requirements, fixtures or evals, false-positive policy, and migration or adoption examples only when user behavior would change.
  - Add narrow references to substrate artifacts where useful inside this slug's capability ledger or existing design/plan docs.
  - Ignore the vulnerability-scanning skill for Stage 13; it is domain-specific security tooling, not core harness capability evidence for this slice.
  - Preserve `harness assess` dogfood evidence so internalization decisions cite actual substrate gaps and repair-action applicability.
- **Prohibited changes:**
  - Do not copy, vendor, rewrite, merge, or deprecate skills during Stage 13.
  - Do not add an `agent-coding` adapter path, compatibility package, default quickstart, or product namespace.
  - Do not add native commands, schemas, GC categories, or recurring profiles solely because a skill exists.
  - Do not define a security-tooling extension point or vulnerability-scanning capability in Stage 13.
- **Acceptance criteria:**
  - `plans/harness-engineering-platform/capability-ledger.yaml` exists with stable `capability_id` values.
  - Each mined capability record follows the canonical ledger fields below.
  - Every internalization candidate names the future stage, or explicitly uses `deferred` with rationale, plus the concrete evidence required before it can become harness-native.
  - Every rejected/deferred or non-core capability includes a rationale; migration timing and before/after workflow examples are required only when Stage 13 records that user behavior would later change.
  - Stage 13 docs do not imply this repository supports, depends on, or exposes `agent-coding` as a product surface.

Capability ledger records use this shape:

```yaml
- capability_id: execution-atomic-slices
  status: active # active | deferred | rejected | retired
  source_observations:
    - source: execute-plan-loop
      evidence: path-or-url
  practice: Atomic execution slices with per-slice verification.
  failure_mode_or_gap: Large unreviewable changes lose acceptance evidence.
  candidate_surface: continuity-state | self-verification | gc-evidence | recurring-profile | cli-command | planning-artifact | adapter-guidance | non-core
  disposition: deterministic-candidate | advisory-candidate | non-core | rejected | deferred
  owner_stage: Stage 14 # or deferred
  required_evidence:
    schema_contract: Describe the artifact contract required before adoption.
    cli_owner: Name the future command/profile owner, or explain why none is selected.
    fixtures_or_evals: Name required positive/negative fixtures or eval evidence.
    trust_sandbox: State trust, sandbox, approval, and credential requirements.
    false_positive_policy: State deterministic limits, advisory posture, or rejection rationale.
  user_behavior_change: none # none | future-adoption | supersede-existing-guidance
  boundary: What remains outside harness core.
  rationale: Why this disposition is appropriate.
```

`capability_id` values are stable kebab-case ids and are not reused after commit. Retired entries remain in the ledger with `status: retired`. User-behavior change means a future adopted capability changes how users accomplish a documented task, supersedes existing guidance, or removes a previously supported path; Stage 13 records the expected category but does not create migration requirements unless a later stage actually changes user behavior.

### Stage 14: GC framework and first deterministic categories

- **Goal:** Make entropy management operational without creating an unreviewable all-category GC stage.
- **Dependencies:** Stage 4 and Stage 6. Stage 13 may supply candidate ideas, but Stage 14 only considers those with deterministic inputs and false-positive policy.
- **Allowed changes:**
  - Implement `harness gc audit` and `harness gc validate`.
  - Add GC evidence append-only output.
  - Implement 2-3 low-risk deterministic categories, such as broken references, duplicate IDs, stale schema versions, or other mechanically defined forms of context/routing/doc entropy, with explicit algorithms and fixtures.
  - Optionally draw from Stage 13 capability candidates, such as atomicity or doc freshness, only when they can be expressed as deterministic evidence rather than subjective process scoring.
  - When adopting a Stage 13 capability, record the adopted `capability_id` and whether cleanup eligibility is triggered.
  - Produce ranked atomic cleanup slices with evidence refs and confidence.
- **Prohibited changes:** No fully automated cleanup without human review; no ad hoc taxonomy mutation without versioning and decision logs.
- **Acceptance criteria:**
  - Users can run a GC audit and get reviewable cleanup slices tied to evidence.
  - GC evidence output is append-only and preserves historical audit runs.
  - Cleanup slices include evidence refs, confidence, blast radius, and atomicity notes; they do not mix unrelated concerns.
  - No GC category ships unless its inputs, algorithm, false-positive policy, and passing/failing fixtures are documented.

### Stage 15: Evidence-driven GC expansion

- **Goal:** Extend GC from first deterministic categories to eval, trace, execution, verification, and tool/policy evidence.
- **Dependencies:** Stage 7 and Stage 14.
- **Allowed changes:**
  - Add tool/policy, verification, execution, eval, and trace entropy categories where evidence is available.
  - Revisit Stage 13 advisory capability candidates only after Stage 14 proves the relevant evidence shape and false-positive policy.
  - Record promotion/retirement citation hooks, but do not automatically promote or retire rules/checks/templates/evals in this slice.
  - When a future stage adopts a Stage 13 capability, record the adopted `capability_id` and whether cleanup eligibility is triggered.
  - Document that durable promotion needs repeated evidence and holdout evidence where behavioral evals are involved.
  - Document that retirement needs evidence showing a rule, template, or eval no longer adds value.
- **Acceptance criteria:**
  - GC findings cite evidence artifacts and preserve reviewable cleanup slices.
  - A single preference cannot become a durable rule because Stage 15 does not automatically promote rules.
  - LLM-judge GC findings remain bounded by schema-valid calibration status; full blocking policy remains in report validation.
  - Future behavioral rule/eval promotion must cite holdout results, not only optimization-suite improvement.

### Stage 16: Productization gate and cleanup eligibility

- **Goal:** Prevent roadmap drift by confirming whether cleanup is actually eligible before implementing any cleanup categories.
- **Dependencies:** Stage 13, Stage 15, and whichever later stage produced an actual substrate-backed replacement. If no adopted capability or replacement exists, Stage 16 remains dormant.
- **Allowed changes:**
  - Review `capability-ledger.yaml` and record which candidates remain advisory, adopted, superseded, or deferred.
  - Produce no cleanup implementation when no adopted capability or substrate-backed replacement exists.
  - Add cleanup categories only for capabilities this repo has actually adopted or superseded.
  - Connect superseded capability evidence to GC cleanup slices only when a replacement path is documented.
  - Remove or rewrite external-source references only after a documented substrate replacement exists.
- **Acceptance criteria:**
  - The stage records whether cleanup is active or dormant.
  - Capability-specific GC findings cite Stage 13 capability-ledger records, required evidence, and any supported-path migration notes.
  - No cleanup slice deletes user-facing behavior without a documented replacement path.

### Stage 17: Local project health checks

- **Goal:** Make the product immediately useful on real downstream repositories by executing declared local checks safely.
- **Dependencies:** Stage 2, Stage 4, Stage 10, and Stage 15.
- **Allowed changes:**
  - Add a distinct `harness health` command for executable local project checks; `doctor` remains the deterministic structural harness checker.
  - Define how harness-owned local health checks are declared, executed, timed out, and recorded as evidence.
  - Reuse existing trust requirements plus approval and sandbox policy artifacts for local health checks; do not introduce a second approval or sandbox source of truth.
  - Execute only checks with explicit trust and sandbox requirements; refuse network, secret, or host-file access unless the policy explicitly allows it.
  - Extend `harness assess` to consume health evidence by adding a scorecard version with a distinct `project-health` dimension, rather than folding executable checks into `doctor-evidence`.
  - Keep `doctor`, `health`, `verify`, and `eval` responsibilities separate: structural doctor checks, executable project health checks, explicit self-verification, and behavioral evals must not collapse into one generic test runner.
  - Add starter/downstream examples for lint, test, typecheck, or doc-link style checks that run without secrets or network access.
- **Acceptance criteria:**
  - A downstream fixture reports configured check statuses and an overall health status beyond schema validity.
  - Assessment output can cite health evidence and reflect it in the versioned maturity scorecard.
  - Local check evidence records command, timeout, status, failure class, trust/sandbox requirements, and artifacts.
  - Unsafe or undeclared checks are refused with clear errors.
  - Fixtures cover pass, failure, timeout, unsafe declaration, and missing artifact cases.
  - Fixtures cover policy-mismatch refusal, such as a check requiring process spawning when the selected sandbox policy denies it.
  - A downstream fixture demonstrates at least one passing and one failing health check with machine-readable evidence.

### Stage 18: Real runner readiness

- **Goal:** Prepare the runner layer for real model or agent execution without weakening the deterministic substrate.
- **Dependencies:** Stage 6, Stage 7, and Stage 17.
- **Allowed changes:**
  - Add non-stub live runner contracts or readiness checks only when credential references, budgets, approval policy, sandbox requirements, trace output, and trace redaction/scoping are explicit.
  - Define the supported credential-reference shape for this slice, such as typed environment-variable references, and refuse unsupported indirection.
  - Define trace redaction and scoping rules so secrets, credentials, and sensitive prompt/tool-result material are not captured accidentally. The minimum policy is field-level allowlisting for recorded trace content, refusal to record fields that reference credential environment variables, and negative fixtures for both rules.
  - Preserve deterministic stub/recorded runners as the CI-safe path.
  - Add refusal paths for missing credentials, missing budgets, unsupported sandbox, and unbounded live execution.
- **Acceptance criteria:**
  - The product can explain exactly what is needed before a real run is allowed.
  - No live model path can execute without explicit credentials, budgets, and trace capture.
  - Real-runner readiness does not make live credentials necessary for the starter or CI-safe tests.
  - Fixtures prove missing credential references and trace-redaction violations are refused.

### Stage 19: Recurring maintenance profile substrate and MVP

- **Goal:** Add a recurring-profile contract and one useful MVP profile after artifacts exist.
- **Dependencies:** Stage 12, Stage 13, Stage 15, and Stage 17. Stage 9 is needed for plugin-driven profiles; Stage 11 is only needed for CI-scheduled profiles. Cleanup eligibility may follow after profile adoption creates replacement evidence.
- **Allowed changes:**
  - Define the recurring-profile state contract, trigger, inputs, allowed actions, measurable stop condition, and handoff artifact.
  - Ship entropy-auditor as the MVP profile first because it can consume Stage 14/15 GC evidence plus Stage 17 health evidence without requiring live-runner support.
  - Additional profiles require separate trigger thresholds: doc-gardener needs Stage 17 doc-link or docs-health evidence, eval-curator needs holdout eval evidence, and trace-reviewer needs Stage 18 trace evidence.
  - Promote Stage 13 capability candidates owned by recurring profiles only when the recurring-profile contract can express them as evidence-backed scheduled work with measurable stop conditions, not prompt-only habits.
  - When adopting a Stage 13 capability, record the adopted `capability_id` and whether cleanup eligibility is triggered.
  - Add plugin- or scheduler-driven examples if useful.
- **Acceptance criteria:**
  - The MVP profile consumes substrate artifacts and adds behavior beyond one-shot summaries.
  - Each future profile has an objective trigger threshold before implementation begins.
  - The MVP profile has a measurable stop condition and handoff artifact.
  - Fixtures or examples demonstrate the MVP profile stopping when its condition is met.

### Stage 20: Delivery surface and adoption packaging

- **Goal:** Make the current product path deliverable to external users.
- **Dependencies:** Stage 3 and Stage 17 for CLI-first packaging; Stage 18 is required only for advertised live-runner support, and Stage 19 is required only for advertised recurring-profile support.
- **Allowed changes:**
  - Harden package contents, schema distribution, quickstart, examples, and downstream adoption docs.
  - Document supported current paths separately from planned adapter, CI, plugin, and live-runner paths.
  - Add a packaged/downstream smoke test for CLI usage.
- **Acceptance criteria:**
  - A downstream user can install or invoke the CLI, initialize a harness, run project health checks, and understand the generated evidence.
  - Package contents include the necessary dist, schemas, examples, and docs without implementation-only assumptions.
  - A sandboxed downstream fixture runs init -> health -> evidence inspection -> assessment with health evidence and reaches at least 8/10 on the scorecard version that adds the `project-health` dimension, improving on the Stage 13 downstream baseline of 5/9 without reinterpreting the old denominator.
  - Optional CI and adapter guidance remain projections over CLI/schema artifacts, not separate sources of truth.

## Parallelization readiness

- **Serial prerequisites:** Stage 1, Stage 2, and Stage 3 should be serial. Identity, distribution, schemas, and CLI bootstrap must stabilize first.
- **Can fan out after Stage 3:** Stage 4 doctor MVP and Stage 5 deterministic verifier runner can proceed in parallel.
- **Should wait for Stage 5:** Stage 6 agent runner and first end-to-end behavioral eval needs concrete eval task/verifier vocabulary.
- **Should wait for Stage 5 and Stage 6:** Stage 7 LLM-judge policy needs concrete eval/run-result vocabulary.
- **Should wait for Stage 4, Stage 5, and Stage 6:** Stage 8 plugin feasibility needs real artifacts to assess host APIs and marketplace UX.
- **Conditional after Stage 8:** Stage 9 adapter MVP starts only if Stage 8 verifies a feasible full-plugin or limited-adapter target; otherwise skip Stage 9 and keep CLI-first fallback until an agent/CLI marketplace target exists.
- **Can start after Stage 4, Stage 5, and Stage 6:** Stage 10 native execution-loop adapter can proceed once schemas, CLI, doctor, eval, and trace artifacts are available.
- **Should wait for Stage 4, Stage 5, Stage 6, and Stage 7:** Stage 11 optional CI adapters need concrete checks and artifacts plus judge-blocking policy; they should not block plugin feasibility or CLI-first UX.
- **Stage 13 gate:** Practice-mining research can start after Stage 1, but binding `plans/harness-engineering-platform/capability-ledger.yaml` records should wait until Stage 10 and Stage 12 provide enough substrate and assessment evidence to distinguish useful capabilities from prompt-only workflow habits.
- **Can start after Stage 4 and Stage 6:** Stage 14 substrate GC can begin with deterministic categories independent of Stage 13 capability mining.
- **Should wait for Stage 7 and Stage 14:** Stage 15 GC expansion can add non-skill evidence-driven categories after judge policy and first GC framework exist.
- **Should run after Stage 15:** Stage 16 is a productization gate that confirms cleanup eligibility and should normally produce no cleanup when no replacement exists.
- **Should follow Stage 16:** Stage 17 local project health checks are the next product-value slice because they make the harness useful on real repositories beyond examples.
- **Should follow Stage 17:** Stage 18 real runner readiness needs stronger local health evidence and refusal behavior before live execution expands.
- **Should follow Stage 17:** Stage 19 recurring-profile substrate can begin once local health evidence exists. Stage 18 runner evidence is required only if the MVP profile depends on live-runner or trace-reviewer behavior.
- **Should follow product proof:** Stage 20 CLI-first delivery packaging can happen after the CLI provides real project health value. Advertised live-runner or recurring-profile paths require their Stage 18 or Stage 19 evidence first.

Use `plan-parallel-work` after Gate 1 if multiple agents will implement the stages.

## Risks

- **Substrate overbuild:** Schemas and CLI can become too heavy if Stage 2-3 try to cover every future case. Keep the initial surface small and versioned.
- **Plugin feasibility:** Plugin UX is the desired product surface, but host APIs must be verified before promising install steps.
- **Plugin lock-in:** Plugin UX can be excellent but must not become the only path or define host-specific contract semantics.
- **Plugin/CLI version skew:** Plugin actions must resolve repo-pinned, bundled, and user-installed CLI versions deterministically and refuse unsafe writes on incompatibility.
- **False marketplace promises:** Until Stage 8 verifies a real agent/CLI marketplace path and capability tier, public docs should lead with CLI-first setup and mark plugin-first as planned.
- **Unsafe local checks/verifiers:** Local doctor checks and eval verifiers must run under declared sandbox/trust policy rather than inheriting host privileges silently.
- **CI lock-in:** GitHub Actions should be one optional example, not the CI contract; CLI exit semantics and artifacts must remain portable.
- **Skills drift:** Portable skills may drift from schemas if they duplicate contract text. Skills should reference substrate docs and consume artifacts.
- **False positives in doctor:** Subjective or underspecified checks can reduce trust quickly.
- **Doctor/eval conflation:** Structural checks and behavioral evals must remain separate.
- **Trace/eval overfitting:** Eval-driven improvement can overfit without holdouts, baseline runs, and human review.
- **Weak isolation:** Local process or worktree execution is convenient but must not be presented as equivalent to container/VM-backed reproducible evals.
- **Harness complexity rot:** Guardrails that are useful for today's models may become stale as models improve; rules and evals need retirement paths.
- **Premature cleanup:** Cleanup categories without real adopted replacements can delete useful guidance or create false confidence. Stage 16 must explicitly allow dormant outcome.
- **Productization gap:** A rich substrate without local project health checks, packaging, and quickstart polish can remain impressive but undeliverable.
- **Live-runner risk:** Adding real model execution before credential, budget, sandbox, and trace refusal paths are boring and deterministic would undermine trust.
- **Scope creep:** Adding schemas, CLI, plugins, CI, skills, agents, and deletions in one stage would be unreviewable.
- **Unplanned deletion:** Removing existing skills without replacement paths risks losing useful behavior, but deletion or extraction remains valid when the new harness substrate supersedes them.

## Gate 1 decision points

Status: approved by the user on 2026-05-20. Treat these decisions as the approved Gate 1 baseline unless a later planning update explicitly changes them.

Stage 8 correction note: later review supersedes any generic "host marketplace" reading of decisions 3, 5, 7, and 11. For this slug, the relevant Stage 8/9 targets are agent/CLI marketplace or install surfaces; IDE-only surfaces are future evidence only.

1. Primary identity: "harness-as-code platform for AI coding agents".
2. Canonical source of truth: `harness.yaml` plus versioned schemas.
3. Best user entry strategy: agent/CLI marketplace plugin-first guided UX after a supported full-plugin tier is verified; limited adapters are labeled as limited; CLI-first is the current universal path until then; external skills are practice evidence or explicitly supported fallback adapters; CI is optional enforcement.
4. CLI distribution and toolchain: first implementation via TypeScript 6, Bun for repository package management, Biome/Lefthook with user-provided configuration, and a Node-compatible npm CLI with package `@lachimere/harness-engineering`, binary `harness`, explicit schema publication mechanism, compatibility policy, and `harness migrate` strategy.
5. First plugin target: defer selection to Stage 8; no plugin install path or specific host target is promised as available at Gate 1 until agent/CLI marketplace distribution, host APIs, and capability tier are verified.
6. External skill source material: mine it for harness-native capability ideas, but do not create a product namespace, default quickstart, or compatibility package from the source project.
7. Canonical locations: `schemas/`, `tools/harness/`, `examples/`, selected-host paths under `plugins/` after Stage 8, native adapter paths such as `skills/`, and capability-mining records under the planning slug until a substrate-backed capability exists; optional enforcement examples live under adapter docs, not as a required `.github/workflows/` path.
8. Shared primitives: harness spec, schemas, context map, environment, approval/sandbox policy, agent runner, trace, eval task, run-result log, doctor result, plugin capability, repair action, continuity, self-verification evidence, model profile, failure taxonomy, and GC evidence.
9. Doctor/eval separation: deterministic doctor checks and behavioral eval suites have different contracts.
10. First behavioral proof: the roadmap must reach an end-to-end `harness run` / `harness eval run` milestone before GC expansion or recurring profiles.
11. Roadmap order: substrate -> CLI -> doctor/verifier -> agent-runner/eval/trace -> agent/CLI adapter feasibility and execution loop -> conditional adapter MVP -> optional CI -> native adapter -> external practice mining -> GC -> cleanup eligibility gate -> local project health checks -> real-runner readiness -> recurring maintenance -> delivery packaging.
12. Current repo state is not a design constraint: this clean-slate repo can choose native structure first and only import/adapt old skills deliberately.
13. External workflow skills are learning material only: do not copy, delete, merge, or expose them as product paths during Stage 13.
14. Domain-specific utility skills, including vulnerability scanning, are ignored for Stage 13 unless a future approved security-tooling harness contract exists.
15. Do not make external skill installation the primary mechanical foundation or default quickstart.
