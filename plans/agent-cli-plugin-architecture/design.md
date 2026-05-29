# Design: Agent CLI plugin architecture

## Status

Draft design for review. This slug defines how Harness Engineering becomes a CLI-first product that will ship canonical shared agent skills and thin host plugin/extension manifests for the major agent CLIs (Claude Code, OpenAI Codex, GitHub Copilot CLI, Gemini CLI) after implementation workstreams remove agent-runtime debt, harden the CLI JSON contract, and prove host-native installation paths.

## Problem

Harness Engineering needs agent-native UX without turning host plugins, skill packs, hooks, CI recipes, MCP tools, model profiles, or agent runners into sources of truth. The current product already has the canonical pieces: root `harness.yaml`, versioned schemas, deterministic `harness` CLI behavior, editable `.harness/**` support files, and generated `.harness/outputs/**` evidence.

The researched agent CLI ecosystems confirm that plugins are passive packages and host agents invoke plugin-provided instructions, commands, hooks, or tools. For this product, the host agent should produce changes or candidate artifacts; the Harness CLI should validate configuration, run declared local checks, verify explicit evidence/candidates, and summarize evidence.

## Design thesis

Harness Engineering should be designed as:

```text
agent runtime cleanup first
CLI JSON inventory and contract hardening second
canonical shared skills third
thin host plugin/extension manifests fourth
host-native installation/distribution last
MCP explicitly out of scope
```

Formal design decision:

> Harness Engineering exposes a deterministic CLI with schema-backed JSON outputs as the primary machine API. Harness does not own model execution or agent runners. Host agents produce changes or candidate artifacts; Harness verifies, records, audits, and summarizes evidence. A single canonical shared skill set instructs host agents to call the CLI and interpret evidence. Host plugins/extensions are thin manifests that package those shared skills for each agent CLI; they must not fork workflow logic or define product semantics. MCP is out of scope and must not define product semantics.

## Scope

In scope:

- Rename existing TypeScript interfaces to satisfy the already-enforced Biome naming rules through rename-only cleanup slices.
- Remove or rename surfaces that imply Harness owns model execution or agent runners.
- Inventory current JSON outputs for agent-facing CLI commands.
- Derive a minimal shared JSON contract from the inventory and enforce it through schemas, golden fixtures, and shared TypeScript interfaces.
- Implement one canonical shared skill set under `skills/` at the repository root that instructs agents to call the CLI and interpret evidence.
- Implement thin host plugin/extension manifests under `plugins/<host>/` for Claude Code, OpenAI Codex, GitHub Copilot CLI, and Gemini CLI, packaging the same canonical shared skills.
- Provide a working host-native installation/distribution path for each adapter using only mechanisms already proven by the host (repo-local, local path, Git URL, or supported marketplace). Each adapter ships with installation evidence; nothing is promised without a working install path.
- Provide a parity check that every packaged host skill is generated from or references the canonical shared skill source.
- Provide minimal lifecycle hooks per host (detect/suggest only) where the host model supports them.

Out of scope:

- MCP server or MCP tool adapter.
- Forked or host-specific shared skill workflows (host packages must reference the canonical skill source).
- Marketplace listings on registries that the host project has not opened for self-serve publishing.
- Any `next_actions` engine or executable suggestion system.

MCP server configs may appear in host adapter manifests only as host-native metadata if a host requires them, but Harness must not depend on MCP for canonical behavior and this slug must not define MCP tools.

## Product boundary

The default user-facing substrate must not include:

- `model_profiles`
- `agent_runners`
- `.harness/model-profiles/**`
- `.harness/agent-runners/**`
- runner readiness configuration
- deterministic stub runner setup
- provider-backed live-runner setup

The cleanup must delete or rename these concepts; "advanced" or "future" paths are not retained for removed product semantics.

## Runner/model cleanup inventory

The implementation must start from an explicit inventory before edits. Initial known candidates:

| Area | Known paths or concepts | Target fate |
|---|---|---|
| Deleted schemas | `schemas/model-profile.schema.json`, `schemas/agent-runner.schema.json`, `schemas/runner-readiness.schema.json` | Delete entirely. No reusable contract pieces exist after model/runner ownership is removed. |
| Retained evidence schemas | `schemas/run-result.schema.json`, `schemas/trace.schema.json`, `schemas/scoreboard.schema.json`, `schemas/profile-run.schema.json`, `schemas/common.schema.json` | Keep as evidence-consumer contracts. `run-result` remains for verifier-only eval validation and externally produced records, but removes obsolete `agent-run` and `ad-hoc` vocabulary because those modes had no supported producer after this cleanup; `trace` keeps `environment_snapshot.runner` and `environment_snapshot.model_profile` only as read-only imported provenance; `scoreboard` remains imported/calibration evidence consumed by assess/report/GC, not a CLI-generated runner artifact; `profile-run` is unchanged because it consumes evidence and emits handoff artifacts. `common` drops stub credential/usage sources because deterministic stub execution is no longer a product surface. |
| Harness config schema | `schemas/harness.schema.json` required/properties/engine requirements for `model_profiles`, `agent_runners`, `model-profile`, `agent-runner`, `runner-readiness` | Remove the default substrate fields and required schema-range entries. Unknown removed schema ranges are rejected by engine compatibility because the schema files are deleted. |
| Harness reference resolver | `src/lib/harness.ts` `collectHarnessReferences` entries for `model_profiles` and `agent_runners` | Delete reference collection for removed root config keys so validation no longer expects model/runner support files. |
| CLI command registry | `src/cli.ts`, `src/commands/run.ts`, `src/commands/runner.ts`, `src/commands/eval.ts` | Remove `harness run` and `harness runner`. Remove `harness eval run` because it depends on `agent-runner.ts` and represents Harness-owned agent execution. Keep `harness eval validate` as the verifier-only eval surface. |
| Runner libraries | `src/lib/agent-runner.ts`, `src/lib/runner-readiness.ts` | Delete entirely. No evidence-import/evidence-verification library surface is retained; host agents produce artifacts, and `harness verify`, `harness eval validate`, `harness trace validate`, `harness assess`, and `harness report` consume explicit evidence. |
| Init substrate | `src/commands/init.ts`, `examples/harness.yaml`, starter output directories and path replacements | Stop emitting `model_profiles`, `agent_runners`, `.harness/model-profiles/**`, `.harness/agent-runners/**`, and runner-only output directories. Keep verifier result, run-result, trace, scoreboard, report, GC, health, doctor, continuity, handoff, approval, profile-run, policy, eval, and judge starter surfaces. |
| Examples and fixtures | `examples/model-profiles/**`, `examples/agent-runners/**`, `examples/runner-readiness/**`, `examples/prompts/stub-task.md`, `examples/policies/live-sandbox-policy.yaml`, invalid fixtures for deleted runner/model schemas, harness fixtures copied from `examples/harness.yaml`, doctor result examples, trace/run-result/scoreboard examples | Delete runner/model schema fixtures and starter prompt/live-readiness fixtures. Update harness fixtures and doctor result examples to remove deleted references. Retain trace/run-result/scoreboard examples only as explicit evidence fixtures with imported, computed, or verifier-only provenance, and update paths/descriptions away from Harness-owned runner setup. |
| Public docs and contributor docs | `README.md`, `docs/guides/cli.md`, `docs/dev/architecture.md`, `schemas/README.md`, `AGENTS.md` | Remove supported `harness run`, `harness runner readiness`, deterministic stub runner, live-runner, and provider-backed runner language. Describe external agent/model fields as evidence provenance imported or produced outside the CLI. |
| Tests | `tests/cli/cli.test.ts`, `tests/e2e/cli-e2e.test.ts`, `tests/schemas/schema-fixtures.test.ts`, `tests/cli/fixtures/expected-report.txt` | Delete runner readiness, `harness run`, and `eval run` tests. Keep `eval validate`, trace validation, profile, GC, assess, report, and schema fixture tests; switch scoreboard/report/assessment paths to retained explicit examples instead of newly generated runner artifacts. |

The cleanup must not leave the codebase in a half-removed state: any module, command, fixture, schema, doc, or test that referenced runner/model surfaces must end the cleanup either deleted, renamed to evidence-import/evidence-verification, or updated to remove the reference.

`harness profile run` is distinct from `harness run`. Profile runs consume existing evidence and emit profile-run handoff artifacts; they remain in scope and are not affected by the cleanup. `harness trace validate` and `harness eval` also remain in scope; cleanup targets only agent-runner/model-profile semantics where "Harness owns execution." The trace and profile-run schemas' `environment_snapshot.runner` and `environment_snapshot.model_profile` fields become read-only provenance referencing whatever external agent/model produced the evidence; they are not deleted but their semantics shift from "Harness-configured execution" to "imported execution metadata."

## CLI JSON inventory before contract

Before changing JSON contracts, create an inventory of current machine-readable outputs.

Known command JSON inventory:

| Command | Agent-facing? | Schema or contract today | Status vocabulary today | Provenance shape today | Failure or issue shape today | Gaps to resolve |
|---|---|---|---|---|---|---|
| `harness validate` | No | No JSON output; human-facing sanity check only. | N/A | N/A | Human text / command failure. | Keep out of the agent contract. Skills and hooks must suggest `harness doctor --format json`; if doctor lacks any schema/reference coverage needed by agents, add that coverage to doctor instead of adding `validate --format json`. |
| `harness doctor --format json` | Yes | `schemas/doctor-result.schema.json` | Top-level `status`: `passed`, `failed`, `warning`; per-check `outcome`: `passed`, `failed`, `skipped`. | Top-level `schema_version`, `run_id`, `harness_version`, `generated_at`. | Optional top-level structured `issues[]` derived from failed checks; checks carry `severity`, `outcome`, `evidence`, `remediation`, fixtures, and trust metadata. | Implemented in PR 4A; keep detailed `checks` canonical and do not turn skipped/info checks into command issues. |
| `harness health --format json` | Yes | `schemas/health-result.schema.json` | Top-level `status`: `passed`, `failed`, `error`; per-check `status`: `passed`, `failed`, `error`, `skipped`. | Top-level `schema_version`, `run_id`, `harness_version`, `generated_at`, `source`, `sandbox_enforcement`, `runtime_enforced`. | Optional top-level structured `issues[]` derived from failed/error/skipped checks; per-check failures keep `failure_code`, `summary`, stdout/stderr fields, artifacts/evidence, and trust metadata. | Implemented in PR 4A; keep per-check details canonical for health-specific reasoning. |
| `harness assess --format json` | Yes | `schemas/assessment.schema.json` | Top-level `status`: `ready`, `needs-work`, `missing-harness`; nested scorecard/routing statuses. | Top-level `schema_version`, `assessment_id`, `harness_version`, `generated_at`; nested `source.root`, `source.harness`, `source.harness_version`. | Optional top-level structured `issues[]` is reserved for command/contract problems; `missing_primitives` and `recommendations` describe product gaps, not command failures. | Implemented in PR 4A; no `source.cli_version` dual-field compatibility shim exists. |
| `harness gc audit --format json` | Yes | `schemas/gc-evidence.schema.json` | Top-level `status`: `passed`, `findings`. | Top-level `schema_version`, `audit_id`, `generated_at`, `harness_version`. | `findings[]` are cleanup findings, not command failures; optional top-level `issues[]` is reserved for audit/contract problems. | Implemented in PR 4B; keep `findings` semantically separate from `issues`, and keep `audit_id` rather than inventing `run_id`. |
| `harness trace validate --format json` | Yes | `schemas/trace-validate-result.schema.json`; trace artifacts themselves use `schemas/trace.schema.json`. | Validation result `status`: `passed`, `failed`; per-trace `status`: `passed`, `failed`. Trace artifacts have `determinism_level`, not top-level status. | Validation result has `schema_version`; trace artifacts have `run_id`, `harness_version`, timestamps, environment snapshot, usage, budgets. | Validation result uses structured top-level `issues[]` summaries for failed traces and structured per-trace `issues[]`; trace artifacts retain action-local structured `errors[]`. | Implemented in PR 4B; do not treat `schemas/trace.schema.json` as the schema for the `trace validate` command output. |
| `harness profile run --format json` | Yes | `schemas/profile-run.schema.json` | Top-level `status`: `met`, `not_met`, `inconclusive`; `handoff.status` mirrors the same vocabulary. | Top-level `schema_version`, `run_id`, `harness_version`, `generated_at`, profile refs, and `evidence_inputs`. | Optional top-level structured `issues[]` for non-`met` profile outcomes; legacy command-result `errors[]` is removed. | Implemented in PR 4B; keep `handoff` canonical for profile-specific decisions. |

For each command, record:

| Field | Purpose |
|---|---|
| command | Exact CLI command family and flags. |
| schema | Schema file that currently validates the output, if any. |
| statuses | Exact status vocabulary emitted today. |
| provenance | Existing `run_id`, `generated_at`, `cli_version`/`harness_version`, and input path fields. Note where naming is inconsistent (for example `cli_version` vs `harness_version`, top-level vs nested). |
| issues | How failures are represented today. Existing schemas already use mixed shapes (`errors: string[]` in some, structured `errors` objects in others, no top-level failure field at all in some); the inventory must call out which schemas need a retrofit. |
| evidence/artifacts | How input evidence and generated artifacts are referenced today. |
| gaps | Missing or inconsistent fields for agent parsing, and any normalization that would require a schema version bump. |

**Inventory completion workflow:** The table above is the initial current-state inventory. Before implementation changes any JSON contract, rerun each listed command with `--format json` against fixture data or test `harness.yaml` configs and update this table if actual output differs. Then create `cli-json-migration.md` with per-schema migration plans: for each schema, list which fields to rename/move/add, the schema version bump, and the clean pre-release migration strategy. Because this project has not had a formal release, do not add dual-field transitional support or compatibility shims for old command-result shapes; update first-party code, fixtures, and docs to the new contract in the same migration. This clean-break decision only removes old command-result compatibility shims; it does not bypass migration evidence. Command-result schema changes need `cli-json-migration.md`, golden fixtures, and schema validation, and any persisted harness/schema upgrade path still needs previewable `harness migrate` evidence. The design.md table is the current-state inventory; `cli-json-migration.md` is the migration plan derived from that inventory.

This inventory is the source for the shared contract. Do not design a universal envelope before this audit.

## CLI JSON contract principles

Versioned JSON Schemas remain canonical. TypeScript interfaces should be generated from schemas where practical, or validated against schemas and golden fixtures when generation is not practical. The shared contract should be minimal:

- Require `schema_version` in all agent-facing JSON outputs. Every command output must either be validated by its artifact schema or by a dedicated command-result schema whose version is explicit.
- Use one canonical structured `issues` field for machine-readable command or contract failures. Existing command-specific detail remains canonical for command reasoning: doctor keeps `checks`, health keeps per-check details, assessment keeps `missing_primitives` / `recommendations`, GC keeps `findings`, trace keeps trace action history, and profile keeps `handoff`. `issues` summarizes problems that an agent can present consistently; it must not collapse domain findings into generic errors.
- For schemas with existing command-result `errors` fields or string issue arrays, document an explicit mapping in `cli-json-migration.md` before implementation and replace them with structured `issues[]` in the same pre-release migration. `trace` action-local `errors[].failure_code` maps to `issues[].code` only when surfaced at the command-result layer; action-local trace errors may remain domain detail inside trace artifacts. `profile-run.errors[]` maps to `issues[]` with a stable code chosen in the migration plan, and `harness trace validate` command-result `traces[].issues: string[]` maps to structured `ICliJsonIssue` objects. Do not add dual-field transitional support for old command-result shapes.
- Keep `status` defined by each command's own schema, not by the shared TypeScript envelope. The shared interface treats status as an opaque string and trusts schema validation to enforce the closed vocabulary per command. Do not add a universal `success: boolean` to the envelope. Instead, `cli-json-migration.md` must include a per-command status semantics table used by skills (for example doctor `passed` vs `warning`/`failed`, health `passed` vs `failed`/`error`, GC `passed` vs `findings`). This avoids a lowest-common-denominator flag while preventing each skill from inventing its own mapping.
- Standardize provenance to top-level `run_id`, `harness_version`, and `generated_at` for commands that produce run-scoped evidence. Rename `cli_version` to `harness_version` where present. Provenance fields remain optional in the shared envelope because not every command output is run-scoped (for example GC audit evidence has an `audit_id`, while trace validation validates existing artifacts). Pre-release breaking schema changes are acceptable when they produce a cleaner agent contract; defer provenance normalization only for domain-clarity reasons, not compatibility.
- Separate input evidence from generated output artifacts when a command needs both.

### No next_actions

The shared contract must not include `next_actions`. Harness does not own model execution or workflow decisions; skills and host adapters derive next steps from CLI evidence, not from a CLI-emitted action list.

## Contract enforcement

The shared CLI JSON contract is only useful if it is enforced. The contract hardening work must add at least:

- Schema validation of every agent-facing command's JSON output as part of the existing test suite, including dedicated schemas for command-result outputs that are not themselves persisted evidence artifacts.
- A small TypeScript module exporting the shared interfaces (`ICliJsonContract`, `ICliJsonIssue`, `ICliJsonArtifact`) and consumed by command handlers so that drift causes typecheck failures.
- Golden fixtures for at least the agent-facing commands listed in the inventory.

Without these enforcement points, the principles in this design are only guidelines and will drift again.

## Naming conventions and documentation (already enforced)

`biome.json` already enforces the project's naming conventions through `lint/style/useNamingConvention` and `lint/style/useFilenamingConvention`. The implementation must satisfy these rules and must not relax or remove them.

Active rules:

- TypeScript `interface` names must use an `I` prefix plus PascalCase (`I(.+)`).
- Generic type parameters must use a `T` prefix plus PascalCase (`T(.+)`).
- `enum` and `enumMember` names must use PascalCase.
- `private` class members must use a `_` prefix plus camelCase.
- Source file names must use kebab-case.

Documentation policy:

- **JSDoc is not mandatory for all public members.** TypeScript's type system already documents parameter types, return types, and interfaces. JSDoc comments should be added where they provide value beyond type signatures (e.g., explaining non-obvious behavior, usage examples, or design rationale).
- Agent-facing APIs (e.g., `ICliJsonContract`, `ICliJsonIssue`, `ICliJsonArtifact`) and canonical shared skills should have clear documentation, but the enforcement mechanism is code review, not linter rules.
- Prefer "code as documentation": clear naming, strong types, and well-structured interfaces over verbose JSDoc comments that duplicate type information.

Implementation expectations:

- All new interfaces, generics, enums, private members, and source files must satisfy these rules from creation.
- Existing names that violate these rules must be migrated through explicit, atomic rename-only cleanup slices, not mixed with behavioral changes.
- Each rename slice must include typecheck/test evidence and must not change runtime behavior.
- Do not edit `biome.json` to weaken or disable these rules.

Example interfaces and generics that satisfy the rules:

```ts
interface ICliJsonContract {}
interface ICliJsonIssue {}
interface ICliJsonArtifact {}
interface ICommandJsonContractInventory {}
```

Initial interface sketches should be derived after the JSON inventory. A likely minimal shape is:

```ts
interface ICliJsonContract {
  schema_version: string;
  status: string;
  run_id?: string;
  harness_version?: string;
  generated_at?: string;
  issues?: ICliJsonIssue[];
}

interface ICliJsonIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  path?: string;
  evidence?: ICliJsonArtifact[];
}

interface ICliJsonArtifact {
  path: string;
  media_type: string;
  role: 'input-evidence' | 'generated-output' | 'source-reference';
  description?: string;
  sha256?: string;
  schema_name?: string;
}
```

Notes on the sketches:

- `status` is intentionally an opaque string at the shared envelope level. Each command's schema defines its own closed status enum and is the source of truth for that vocabulary.
- `ICliJsonArtifact.role` is a required closed enum. Use `input-evidence` for evidence consumed by the command, `generated-output` for command-produced artifacts, `source-reference` for cited repo files. If a new role is needed, it must go through a documented schema version bump; do not leave `role` open. The TypeScript enum forces skill authors to handle all artifact types explicitly.
- The shared envelope deliberately has no `details` escape hatch on `ICliJsonIssue`. If a command needs structured command-specific issue metadata, define it in the command's schema as a structured extension; never add an unconstrained `Record<string, unknown>` or `details?: any`. If an escape hatch is unavoidable, it must be `details?: JsonObject` (structured, not primitive/array) and skill docs must warn that agents must not rely on `details` shape for core decisions.
- These are sketches, not approved final contracts. The inventory must validate or update them before any command is migrated.

## Canonical shared skills

Canonical shared skills live once at the repository root under `skills/` and are the only authored skill content in the repository. Host plugin/extension manifests reference or package them; nothing else may define its own copy of a skill workflow.

Initial skill set:

| Skill | Purpose | Invocation policy |
|---|---|---|
| `harness-quickstart` | Guide new repo setup and the first evidence run. | User or model. |
| `harness-doctor` | Run and interpret `harness doctor` structural inspection. | User or model. |
| `harness-health` | Run declared local checks. | Explicit user intent required because it executes local commands. |
| `harness-assess` | Summarize maturity and missing primitives. | User or model. |
| `harness-evidence-loop` | Run doctor / health / assess / gc / trace in safe order. | User or model; stop before unsafe execution. |
| `harness-gc-review` | Read GC audit output and summarize cleanup slices. | User or model; never apply cleanup. |
| `harness-profile` | Consume evidence and interpret `harness profile run` handoff artifacts. | User or model. |

Research reconciliation: earlier research sketches used `harness-validate` and `harness-evidence-import` as possible future skills. This design intentionally replaces `harness-validate` with `harness-doctor` because agent-facing structural inspection should use `doctor --format json`, while `validate` remains human-facing. `harness-evidence-import` is out of scope for this slug; candidate artifacts arrive through existing explicit surfaces, and any future batch-import workflow needs its own substrate contract.

Skill content rules:

- Call the `harness` CLI; do not infer harness state from chat.
- Prefer JSON output and cite generated artifacts.
- Never edit `.harness/outputs/**` by hand.
- When host agents produce candidate evidence (for example via `--external-candidate` if that surface exists), treat it as imported provenance metadata; the harness did not execute the model. Skills must not instruct the agent to "run the model through harness"; skills guide agents to produce changes or candidates, then call `harness verify` or `harness eval` to validate those.
- `harness-evidence-loop` is a prompt-level orchestration skill over existing explicit commands. It sequences `doctor`, `health`, `assess`, `gc`, `trace`, `verify`, and `eval` as applicable, stopping before any command that needs explicit user approval. It may call existing `harness loop validate` only to validate continuity/self-verification evidence when the project declares those artifacts. This slug does not add or require a new aggregate `harness loop run` command; if such a command is designed later, the skill may delegate to it only after it has its own JSON contract and evidence.
- Require explicit user approval before running commands that execute local checks, mutate files, or trigger provider/model spend.
- Use host-specific "model invocation disabled" metadata for consequential operations when the host supports it (for example `disable-model-invocation: true` in Claude Code, `allow_implicit_invocation: false` in Codex).

### Canonical skill file structure

Each skill lives in `skills/<id>/SKILL.md` using this structure:

**Required YAML frontmatter:**
```yaml
---
id: harness-doctor
purpose: Run and interpret harness doctor structural inspection
invocation_policy: user-or-model  # or "explicit-user-intent"
version: 1.0.0
---
```

**Optional frontmatter:** `tags: string[]`, `requires_approval: boolean` (defaults to false for user-or-model, true for explicit-user-intent).

**Required Markdown sections:**
- `## Purpose` — Brief description of what the skill does and when to use it.
- `## Invocation` — When the skill should be triggered (user request, agent autonomy, specific conditions).
- `## Steps` — Step-by-step instructions for the agent, calling CLI commands and interpreting JSON outputs.
- `## Safety` — What the skill must never do (e.g., edit `.harness/outputs/**`, infer state from chat, execute without approval).

Additional sections such as `## Troubleshooting` are allowed when useful. The `version` frontmatter is the skill content contract version for adapters, not a substitute for Git history.

**Example minimal skill:**
```markdown
---
id: harness-doctor
purpose: Run and interpret harness doctor structural inspection
invocation_policy: user-or-model
version: 1.0.0
---

## Purpose
Runs `harness doctor --format json` and interprets structural issues in harness.yaml and schemas.

## Invocation
User requests "check my harness config" or agent detects configuration-related error messages.

## Steps
1. Run `harness doctor --format json`
2. Parse JSON output, check `status` field
3. If `status === "failed"`, cite `issues` array to user
4. Suggest fixes based on issue codes

## Safety
- Never edit `.harness/outputs/**` by hand
- Always call CLI; do not infer harness state from chat
```

The `skills/README.md` must repeat this structure with additional authoring guidelines (tone, error handling, citation format).

## Thin host plugin/extension manifests

Host adapters live under `plugins/<host>/` and are thin manifests/wrappers. They may include host-specific manifest metadata, a small host translation wrapper, specialist agent declarations, or lightweight hooks. They must not fork the skill body or reimplement the workflow.

Recommended repository shape:

```text
skills/
  harness-quickstart/SKILL.md
  harness-doctor/SKILL.md
  harness-health/SKILL.md
  harness-assess/SKILL.md
  harness-evidence-loop/SKILL.md
  harness-gc-review/SKILL.md
  harness-profile/SKILL.md

plugins/
  claude-code/
    .claude-plugin/plugin.json
    skills/        # generated/copied from /skills, parity-checked
  codex/
    .codex-plugin/plugin.json
    agents/openai.yaml
    skills/
  copilot-cli/
    plugin.json
    agents/harness.agent.md
    skills/
  gemini-cli/
    gemini-extension.json
    GEMINI.md
    skills/
    commands/      # optional user-triggered shortcuts
```

If a host cannot reference shared skills directly, the build/package step copies them. Copies are generated artifacts and must be checked against the canonical source by a parity check (see "Validation requirements").

Per-host adapter contents:

### Claude Code adapter

- `.claude-plugin/plugin.json`
- packaged canonical `skills/*/SKILL.md`
- optional read-only `agents/harness-reviewer.md`
- optional reminder hooks that suggest `harness doctor --format json` after `harness.yaml` edits

Destructive or command-executing skills must use `disable-model-invocation: true` so Claude does not auto-invoke them.

### OpenAI Codex adapter

- `.codex-plugin/plugin.json`
- packaged canonical `skills/*/SKILL.md`
- `agents/openai.yaml` invocation policy (`allow_implicit_invocation: false` for consequential skills)
- optional read-only `SessionStart` hook that detects `harness.yaml`

If Codex's public self-serve plugin publishing is not yet generally available at implementation time, distribution starts with repo-local marketplace evidence; no public marketplace listing is promised before the upstream path is open.

### GitHub Copilot CLI adapter

- root `plugin.json`
- `agents/harness.agent.md`
- packaged canonical `skills/*/SKILL.md`
- optional `hooks.json`

GitHub Actions remain complementary CI automation; they are not the in-agent plugin surface.

### Gemini CLI adapter

- `gemini-extension.json`
- `GEMINI.md` context file
- packaged canonical `skills/*/SKILL.md`
- optional `commands/` for user-triggered shortcuts
- optional policies for `allow` / `deny` / `ask_user` decisions

Environment variables required by the extension (if any) must be declared in extension settings, not assumed from the shell environment.

## Host installation and distribution

Each host adapter must ship a working installation path before public docs claim installability:

| Host | Installation path used |
|---|---|
| Claude Code | `/plugin marketplace add` from a repo-local or Git marketplace, plus `/plugin install` from that marketplace. |
| OpenAI Codex | Repo-scoped marketplace catalog (`$REPO_ROOT/.agents/plugins/marketplace.json`) or user-scoped catalog; public self-serve publishing only when upstream opens it. |
| GitHub Copilot CLI | Install from this repository via `OWNER/REPO:plugins/copilot-cli` or from a marketplace once published; both must have evidence. |
| Gemini CLI | `gemini extensions install <GitHub URL>` against the repo subdirectory, or `gemini extensions link` for local development. |

Marketplace listings on registries the host has not opened for self-serve publishing are out of scope for this slug.

## Parity between shared skills and packaged host skills

The implementation must include a parity check that runs in CI and fails the build on drift. The check ensures every packaged skill is derived from the canonical `skills/<id>/SKILL.md` content.

**Packaging mechanism decision:** Committed host adapters use copied skill files plus a committed `plugins/<host>/skill-hashes.json` manifest. Symlinks may be generated for local development, but they are not the release/evidence format because host marketplaces and Git-based installs do not consistently preserve symlinks. Host-specific invocation policy metadata belongs in host manifests, sidecars, or a clearly delimited host metadata prelude; the Markdown instruction body remains canonical.

The parity check validates:

1. Every skill in `plugins/<host>/skills/` has a matching `skills/<id>/` canonical source.
2. The skill body (Markdown instructions) in the packaged skill is byte-identical to the canonical source after removing only the declared host metadata prelude, if one exists.
3. No packaged skill exists without a canonical source (no host-forked workflows).

**Parity check implementation:** A Node script (e.g., `scripts/check-skill-parity.ts`) that:
- Enumerates all `plugins/*/skills/*/` directories.
- For each, computes SHA256 of the canonical `skills/<id>/SKILL.md` body (excluding frontmatter).
- Reads a committed `plugins/<host>/skill-hashes.json` manifest mapping skill IDs to expected hashes.
- Exits non-zero if any packaged skill's normalized body hash differs from the canonical hash recorded in `skill-hashes.json`, if any packaged skill is missing from the manifest, or if any manifest entry points at a missing canonical source.

If a canonical skill changes, the build fails until each adapter updates its copied skill and hash manifest. This is deliberate review friction that prevents host-forked workflows.

The parity check runs in `bun run test:unit` so CI fails before merge on drift. Document the check in `plugins/README.md`.

## Source-of-truth boundaries

| Surface | May define rules? | May produce evidence? | May hold state? |
|---|---:|---:|---:|
| `harness.yaml` + schemas | Yes | No | Yes, as canonical config. |
| CLI | Implements rules | Yes | Writes evidence only. |
| Canonical shared skills | No | No | No. |
| Host plugin/extension manifests | No | No | No, except host install metadata. |
| Hooks | No | No, except host logs/status | No. |
| CI recipes | No | Yes, by invoking CLI | No. |

## Hooks boundary

Hooks are guardrails, not engines.

Acceptable hook behavior:

- Detect `harness.yaml` at session start and surface that the repo is harness-enabled.
- After editing `harness.yaml` or `.harness/**` support files, suggest `harness doctor --format json`.
- Block obviously unsafe commands when the host supports `PreToolUse`.

Hooks must respect each host's trust and approval model and must remain strictly read-only guardrails. A hook must not run local checks, write evidence, or execute mutating commands under any circumstance. If a hook detects a condition requiring action (e.g., `harness.yaml` edited but not validated), it must surface a suggestion to the user or log a reminder; the user or agent invokes the CLI command explicitly. This restriction is intentional: allowing hooks to execute "when the workflow has requested that action" would blur the line between detect/suggest (hook) and execute (CLI command), reopening the source-of-truth boundary and risking hooks that become implicit execution engines.

**Hook enforcement verification:** A hook safety check (either `scripts/check-hook-safety.ts` or a hook mode in `scripts/check-skill-parity.ts`) must scan all hook files and fail on forbidden patterns: `fs.writeFileSync`, `fs.writeSync`, any `.harness/outputs/` write path, `child_process.exec`, `child_process.execSync`, `child_process.spawn`, and `child_process.spawnSync`. Hooks may use only read-only filesystem APIs (`fs.readFileSync`, `fs.readSync`, `fs.existsSync`, `fs.statSync`, `fs.lstatSync`, `fs.readdirSync`, `fs.accessSync` with read-only checks), path utilities, and logging APIs. No child process calls are allowed in hooks; if read-only command inspection is needed, implement it as an explicit user/agent CLI invocation outside the hook.

## Implementation ordering

The slug has multiple workstreams. Executable code changes must be sequenced because mixing them creates lint/test/behavior hazards; planning and inventory prep may overlap when it does not change source code:

1. **Biome interface rename (rename-only cleanup slices).** Bring all existing non-`I`-prefixed interfaces into compliance with the already-enforced `biome.json` rules. Each slice changes only names and imports; tests and typecheck must pass after each slice. Before code changes, check an interface rename plan (`interface-rename-plan.md`) into this planning slug listing every non-conforming interface, its target name (e.g., `DoctorDeclaration` → `IDoctorDeclaration`), the affected files, and the slice grouping (e.g., "doctor + health interfaces," "eval interfaces," etc.). Land this before runner/model deletion so the deletion does not have to fight lint failures unrelated to its purpose.

   **Interface rename plan structure:** The plan must use a markdown table with columns: `| Current Interface | Target Interface | Affected Files | Slice ID |`. Generate the initial list by running `bun biome lint --reporter=json` and parsing for `useNamingConvention` violations on `interface` declarations. Group violations into logical slices by schema domain (e.g., "doctor+health", "eval", "gc+trace", "profile") so each slice can be reviewed atomically. Each slice entry must include: (a) verification checklist (`bun run check` passes, `bun run test:unit` passes, no runtime behavior change), (b) rationale for grouping (e.g., "these interfaces are only used by doctor.ts and health.ts, no cross-domain imports"). Example structure:

   ```markdown
   ## Slice 1: doctor+health interfaces
   | Current Interface | Target Interface | Affected Files | Notes |
   |---|---|---|---|
   | DoctorDeclaration | IDoctorDeclaration | src/commands/doctor.ts, src/lib/doctor-config.ts | Used only in doctor domain |
   | HealthCheck | IHealthCheck | src/commands/health.ts, src/lib/health-runner.ts | ... |

   **Verification:** bun run check && bun run test:unit && git diff shows only import/type renames
   ```
2. **Runner/model cleanup.** Before code changes, complete the cleanup inventory table in this design doc by auditing every file matching `src/**/{agent-runner,runner-readiness,run}.ts` and `src/commands/runner*.ts`, and expanding the inventory with a row per file showing current purpose and explicit fate. Check the completed inventory into this slug (via commit to design.md), then execute it: delete or update modules, schemas, examples, config fields, docs, and tests. The cleanup must leave the codebase coherent; no half-removed surface may remain.
3. **CLI JSON inventory and contract hardening.** Complete the CLI JSON output inventory table in this design doc by filling the "current state" for each command (schema file, status vocabulary, provenance shape, issue shape, artifacts). Then create and commit a separate `cli-json-migration.md` artifact in this planning slug before implementation changes any JSON-producing command. The migration artifact documents the per-schema migration plan: which schemas need `errors` → `issues`, which need `cli_version` → `harness_version`, which need top-level provenance moves, which need `issues` field added, and what the schema version bump is for each. Then implement the shared interfaces, update command handlers to consume them (causing typecheck failures on drift), add schema validation to tests, add golden fixtures covering at least one success and one failure case per command, and apply the migrations per the documented plan.
4. **Canonical shared skills.** Author the skill set under `skills/` against the now-stable CLI JSON contract. Each skill lives in `skills/<id>/SKILL.md` and follows the content rules (call CLI, parse JSON, never edit `.harness/outputs/**` by hand, require explicit user approval for consequential commands). Use plain Markdown with optional YAML frontmatter for skill metadata (purpose, invocation policy, version). Skills cite CLI evidence and never duplicate CLI logic. Document the canonical skill content structure in `skills/README.md` before authoring individual skills.
5. **Thin host plugin/extension manifests and installation.** Implement the four host adapters under `plugins/<host>/`, package copied canonical shared skills with `skill-hashes.json` parity manifests, implement the parity check in `scripts/check-skill-parity.ts` and integrate it into `bun run test:unit`, and ship a working host-native installation path with evidence for each adapter. Installation evidence per host: a `plugins/<host>/README.md` documenting the install procedure (repo marketplace, Git URL, local link, or supported host marketplace), a working example command (e.g., `gh copilot extension install OWNER/REPO:plugins/copilot-cli`), and at minimum a manual verification checklist (install command succeeded, skills visible in host skill list, skill invocation smoke test succeeded). If CI can automate the smoke check for a given host, add it; otherwise document the manual steps. Implement Claude Code adapter first to validate the approach, then extend to the other three hosts in parallel. Before claiming marketplace installability for any host, re-verify the host's public plugin publishing status and document the verification date and source in the host README.

Executable work for a workstream must not start before the previous executable workstream is done and verified by typecheck and tests. Planning artifacts for later workstreams may be drafted earlier if they do not alter implementation code. Workstream 5 may overlap across hosts internally (for example Claude Code first, others in parallel) but every host adapter must respect the same shared skills, parity check, and installation evidence rules.

## Validation requirements for this slug

The implementation following this design should include, as concrete checklists:

- Biome interface rename evidence: passing typecheck and test runs after each rename-only slice.
- Runner/model removal inventory completed in the design doc's cleanup table before code removal: every file path under agent-runner/runner-readiness/runner commands, current purpose, target fate (delete/keep/rename), tests importing those modules, docs mentioning removed concepts, trace/profile-run schema field semantics shift.
- After runner/model cleanup: `harness run` and `harness runner` commands are deleted; `src/lib/agent-runner.ts` and `runner-readiness.ts` are deleted; no module, fixture, doc, or test references those surfaces; `harness init` no longer emits `model_profiles` or `agent_runners` config; trace/profile-run schemas retain `environment_snapshot.runner` and `environment_snapshot.model_profile` fields with updated comments clarifying they are read-only imported provenance, not Harness-configured execution.
- CLI JSON output inventory completed in the design doc's inventory table: per command, the schema file, status vocabulary, provenance fields (top-level vs nested, `cli_version` vs `harness_version`), current issue shape (`errors` vs `issues` vs none), artifact references, and gaps. Separate `cli-json-migration.md` checked into the planning slug documenting the per-schema migration plan (which fields to rename/move/add, which schema versions to bump, and how first-party code, fixtures, and docs move cleanly to the new pre-release contract without old-shape shims).
- Shared TypeScript interfaces (`ICliJsonContract`, `ICliJsonIssue`, `ICliJsonArtifact`) implemented and consumed by every agent-facing command handler so that drift causes typecheck failures.
- Schema validation of every agent-facing command's JSON output in the existing test suite.
- Golden fixtures for the agent-facing commands listed in the inventory (doctor, health, assess, gc, trace, profile), covering at least one success and one failure case per command. Fixtures use stable fake values (e.g., `run_id: "test-run-001"`, `generated_at: "2026-01-01T00:00:00Z"`, `harness_version: "1.0.0"`) and are validated against their schemas in the test suite. When a schema version bumps, update the fixture to match the new schema.
- Canonical shared skills at `skills/` covering the skill set above (quickstart, doctor, health, assess, evidence-loop, gc-review, profile), with skill rules enforced (no chat-inferred state, CLI-only behavior, no manual edits to `.harness/outputs/**`, explicit user approval for consequential commands). Each skill lives in `skills/<id>/SKILL.md` using plain Markdown with required YAML frontmatter (id, purpose, invocation_policy, version) and required sections (Purpose, Invocation, Steps, Safety) per the canonical skill file structure. A lint check (`scripts/lint-skills.ts`) runs in CI for high-confidence forbidden patterns and fails the build on violations. Broad semantic rules, such as whether a skill is inferring state from conversation instead of CLI evidence, are enforced by review to avoid brittle natural-language regex false positives. Document canonical skill structure in `skills/README.md`.

   **High-confidence forbidden patterns enumerated in `scripts/lint-skills.ts`:**
   - (a) Shell redirects or `tee` writes to `.harness/outputs/**` (patterns: `>\s*\.?\.harness/outputs/`, `tee\s+\.?\.harness/outputs/`; example violations: `harness doctor > .harness/outputs/doctor.json`, `tee .harness/outputs/log.txt`)
   - (b) Direct model execution keywords (patterns: `openai\.chat`, `anthropic\.messages`, `model\.generate`; example violations: `openai.chat.completions.create(...)`, `anthropic.messages.create(...)`)
   - (c) Manual file edits to generated evidence paths (patterns: `echo.*>.*\.harness/outputs/`, `cat.*>.*\.harness/outputs/`; example violations: `echo '{}' > .harness/outputs/profile-runs/run.json`, `cat tmp.json > .harness/outputs/gc/audit.json`)

   The lint script exits non-zero if any skill Markdown contains these patterns. If a future legitimate example needs one of these strings, the implementation must add a narrowly scoped lint-ignore marker with a reason rather than weakening the rule globally.
- Host plugin/extension manifests under `plugins/<host>/` for Claude Code, Codex, Copilot CLI, and Gemini CLI, each with copied shared skills (plus host-specific wrappers/frontmatter normalized by `skill-hashes.json`), a parity check (`scripts/check-skill-parity.ts`) integrated into `bun run test:unit` that fails on drift, and a translation table (in `plugins/<host>/README.md`) mapping canonical invocation policies ("user-or-model", "explicit-user-intent") to host-specific metadata.

   **Invocation policy translation table (example for `plugins/claude-code/README.md`):**
   | Canonical Policy | Claude Code Metadata |
   |---|---|
   | `user-or-model` | (no restriction; model may invoke) |
   | `explicit-user-intent` | `disable-model-invocation: true` in skill frontmatter |

   Each host README must include this table for its specific metadata vocabulary (Codex: `allow_implicit_invocation`, Gemini: policy engine rules, Copilot: documented manual enforcement if host lacks metadata).
- Hook safety verification integrated into CI: `scripts/check-hook-safety.ts` or `scripts/check-skill-parity.ts --hooks` scans all host hook files and fails on mutating filesystem APIs, `.harness/outputs/**` writes, or any child-process execution. Hook code review must also confirm hooks only detect, suggest, or block through host-native guardrail APIs and never run Harness commands implicitly.
- Installation evidence per host: a `plugins/<host>/README.md` with install procedure, working example command, and smoke check (install succeeds, skills visible, skill invocation works).

   **Minimum standard per host:** (1) Documented install procedure covering all supported paths with working example commands. (2) Smoke check evidence: either automated (CI script that installs + lists skills + invokes one skill) or manual (documented steps with successful output examples, dated). Manual checklist:
   - [a] Install command succeeds (show command + success output)
   - [b] Skills visible in host skill list (show command + output with harness skills)
   - [c] One skill invocation works (show command + expected behavior, not necessarily full success on dummy data, just doesn't crash)

   Document check date and host CLI version. CI automation preferred; manual documentation acceptable as initial evidence. Before claiming marketplace installability in public docs, re-verify host's public plugin publishing status and document verification date/source in host README.
- Docs that no longer mention removed runner/model concepts and that describe the supported install path for each host adapter.

## Recommended next step

All design decisions are resolved. Ready for implementation:

1. Create `interface-rename-plan.md` and `cli-json-migration.md` artifacts in this planning slug.
2. Begin the **Biome interface rename** workstream per the rename plan.
3. Complete the **runner/model cleanup** inventory table, then execute cleanup.
4. Execute **CLI JSON inventory and contract hardening** after runner/model cleanup has landed.
5. Author **canonical shared skills** under `skills/` after the CLI JSON contract is stable and documented in `skills/README.md`.
6. Implement **thin host plugin/extension manifests** by validating Claude Code first, then extending to Codex/Copilot/Gemini in parallel.

Do not start runner/model cleanup code changes before the rename plan and rename slices are reviewed and complete. Do not start canonical skill authoring before CLI JSON contract hardening is in place. Do not implement host adapters before canonical skills and parity rules exist.
