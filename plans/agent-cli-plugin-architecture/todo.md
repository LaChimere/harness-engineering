# Todo: Agent CLI plugin architecture implementation

## Status

Gate 2 pending. These todos describe execution after the approved design; do not start executable implementation work until Gate 2 is approved.

## Legend

- `[ ]` pending
- `[~]` in progress
- `[x]` done
- `[!]` blocked

## Gate 2

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [ ] | `gate-2-approval` | Gate 1 design approval | Review `plan.md` and `todo.md` for alignment with `design.md`. | User approves Gate 2 and implementation may begin. |

## PR 1: Interface naming cleanup plan and rename-only slices

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [ ] | `pr1-interface-inventory` | `gate-2-approval` | Run `bun biome lint --reporter=json` and extract `useNamingConvention` interface violations. | Every non-`I` interface violation is captured with current name, target name, affected files, and proposed slice. |
| [ ] | `pr1-interface-plan` | `pr1-interface-inventory` | Create `plans/agent-cli-plugin-architecture/interface-rename-plan.md`. | The plan has a table with current interface, target interface, affected files, slice ID, grouping rationale, and verification checklist. |
| [ ] | `pr1-interface-slices` | `pr1-interface-plan` | Apply rename-only slices by domain. | Each slice changes only interface names/imports/type references and preserves runtime behavior. |
| [ ] | `pr1-verify` | `pr1-interface-slices` | Validate PR 1. | `bun run check`, `bun run test:unit`, and `git diff --check` pass; rerunning `bun biome lint --reporter=json` shows no remaining interface-declaration `useNamingConvention` diagnostics. |

## PR 2: Runner/model cleanup inventory and removal

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [ ] | `pr2-cleanup-inventory` | `pr1-verify` | Expand the runner/model cleanup inventory in `design.md`. | Every runner/model command, lib, schema, fixture, example, doc, and test path has current purpose and explicit target fate; edits are limited to the cleanup inventory table and do not reopen approved scope/principles/architecture decisions. |
| [ ] | `pr2-remove-runner-commands` | `pr2-cleanup-inventory` | Remove `harness run` and `harness runner` model-execution semantics. | Commands are deleted or renamed out of Harness-owned model execution, with usage/tests updated. |
| [ ] | `pr2-remove-runner-libs` | `pr2-cleanup-inventory` | Remove `src/lib/agent-runner.ts`, `src/lib/runner-readiness.ts`, and dependent code. | No runtime import or test references deleted runner/model libraries. |
| [ ] | `pr2-remove-runner-schemas-config` | `pr2-cleanup-inventory` | Remove runner/model schema and default config surfaces. | `model_profiles`, `agent_runners`, model profile schemas, agent runner schemas, and readiness schema are gone from default user substrate. |
| [ ] | `pr2-update-init-examples-docs` | `pr2-cleanup-inventory` | Update `harness init`, examples, fixtures, and docs. | Initialized projects no longer emit runner/model files; public docs use host-agent-produced evidence language. |
| [ ] | `pr2-update-trace-profile-provenance` | `pr2-cleanup-inventory` | Update trace/profile schema field descriptions. | `environment_snapshot.runner` and `environment_snapshot.model_profile` are documented as read-only imported provenance. |
| [ ] | `pr2-verify` | PR 2 tasks | Validate PR 2. | `bun run check`, `bun run test:unit`, `bun run build`, `bun run test:e2e`, `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`, runner/model stale search over `README.md AGENTS.md docs src schemas examples tests`, public-doc boundary search, and `git diff --check` pass; any remaining matches are approved exceptions recorded in the cleanup inventory; `harness verify` and `harness eval` behavior remain unchanged except inventory-required import/type fixups. |

## PR 3: CLI JSON migration plan and shared contract base

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [ ] | `pr3-rerun-json-inventory` | `pr2-verify` | Rerun agent-facing commands with `--format json` against fixtures/test configs. | Current output shapes for `doctor`, `health`, `assess`, `gc audit`, `trace validate`, and `profile run` are confirmed or recorded in the `design.md` current-state inventory table only; approved scope/principles/architecture decisions are not reopened. |
| [ ] | `pr3-write-migration-plan` | `pr3-rerun-json-inventory` | Create `plans/agent-cli-plugin-architecture/cli-json-migration.md`. | Each schema has field additions/renames/moves, schema version bump, status semantics, and a clean pre-release migration strategy that updates first-party code, fixtures, tests, and docs without dual-field compatibility shims. |
| [ ] | `pr3-add-contract-base` | `pr3-write-migration-plan` | Add shared contract scaffolding if non-behavioral. | `ICliJsonContract`, `ICliJsonIssue`, and `ICliJsonArtifact` scaffolding exists only if it does not change command outputs prematurely. |
| [ ] | `pr3-verify` | `pr3-add-contract-base` | Validate PR 3. | `bun run check`, `bun run test:unit`, and `git diff --check` pass. |

## PR 4A: Structural command JSON hardening

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [ ] | `pr4a-doctor-json` | `pr3-verify` | Apply the migration plan to `harness doctor --format json`. | Doctor output validates against schema, preserves `checks`, exposes structured `issues` only as planned, and replaces renamed legacy command-result fields cleanly without dual-field compatibility shims. |
| [ ] | `pr4a-health-json` | `pr3-verify` | Apply the migration plan to `harness health --format json`. | Health output validates against schema, preserves per-check details, exposes structured `issues` only as planned, and replaces renamed legacy command-result fields cleanly without dual-field compatibility shims. |
| [ ] | `pr4a-assess-json` | `pr3-verify` | Apply the migration plan to `harness assess --format json`. | Assessment output validates against schema, does not conflate recommendations with command failures, and replaces renamed legacy command-result fields cleanly without dual-field compatibility shims. |
| [ ] | `pr4a-fixtures-tests` | PR 4A command tasks | Add structural command golden fixtures and schema validation tests. | Each command has at least one success and one failure/non-passing fixture validated by tests. |
| [ ] | `pr4a-verify` | `pr4a-fixtures-tests` | Validate PR 4A. | `bun run check`, `bun run test:unit`, `bun run build`, `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`, and `git diff --check` pass. |

## PR 4B: Evidence command JSON hardening

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [ ] | `pr4b-gc-json` | `pr4a-verify` | Apply the migration plan to `harness gc audit --format json`. | GC output has planned top-level status/issues while keeping `findings` separate, and renamed legacy command-result fields are replaced cleanly without dual-field compatibility shims. |
| [ ] | `pr4b-trace-json` | `pr4a-verify` | Add `schemas/trace-validate-result.schema.json` for `harness trace validate --format json`. | Trace validation command output validates against `schemas/trace-validate-result.schema.json`, which is distinct from `schemas/trace.schema.json`, and string trace validation issues are replaced by structured `issues[]` without dual-field compatibility shims. |
| [ ] | `pr4b-profile-json` | `pr4a-verify` | Apply the migration plan to `harness profile run --format json`. | Profile output has planned top-level status/issues while keeping `handoff` canonical, and legacy command-result `profile-run.errors[]` is replaced by structured `issues[]` in the same pre-release migration. |
| [ ] | `pr4b-fixtures-tests` | PR 4B command tasks | Add evidence command golden fixtures and schema validation tests. | Each command has at least one success and one failure/non-passing fixture validated by tests. |
| [ ] | `pr4b-verify` | `pr4b-fixtures-tests` | Validate PR 4B. | `bun run check`, `bun run test:unit`, `bun run build`, `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`, and `git diff --check` pass. |

## PR 5: Canonical shared skills and skill lint

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [ ] | `pr5-skills-readme` | `pr4a-verify`, `pr4b-verify` | Add `skills/README.md`. | README documents canonical skill structure, invocation policies, safety rules, evidence citation, and review expectations. |
| [ ] | `pr5-author-skills` | `pr5-skills-readme` | Author seven canonical skills under `skills/`. | `harness-quickstart`, `harness-doctor`, `harness-health`, `harness-assess`, `harness-evidence-loop`, `harness-gc-review`, and `harness-profile` exist with required frontmatter and sections. |
| [ ] | `pr5-skill-safety-review` | `pr5-author-skills` | Check skill content against design boundaries. | Skills call CLI, parse JSON, cite evidence, never edit `.harness/outputs/**`, and require approval for consequential commands. |
| [ ] | `pr5-lint-skills` | `pr5-author-skills` | Implement `scripts/lint-skills.ts`. | High-confidence forbidden patterns, including `next_actions`, fail CI; narrow ignore markers require reasons. |
| [ ] | `pr5-verify` | `pr5-lint-skills` | Validate PR 5. | `bun run check`, `bun run test:unit`, `bun run build`, and `git diff --check` pass. |
| [ ] | `pr5-skills-freeze` | `pr5-verify` | Freeze canonical skills before adapter work. | All seven canonical skill bodies and `skills/README.md` are reviewed and stable; no further skill body changes are planned before adapter packaging except through a deliberate follow-up that refreshes every packaged copy and hash. |

## PR 6: Adapter packaging base, parity checks, and Claude Code adapter

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [ ] | `pr6-parity-check` | `pr5-skills-freeze` | Implement copied skill parity checking. | `scripts/check-skill-parity.ts` validates canonical skill body hashes and `plugins/<host>/skill-hashes.json`, records the canonical SHA256 set, and documents the supported host metadata prelude normalization interface or the convergence-owner path for future prelude changes. |
| [ ] | `pr6-hook-safety-check` | `pr5-skills-freeze` | Implement hook safety checking. | Hook checks fail on mutating filesystem APIs, `.harness/outputs/**` writes, or child-process execution. |
| [ ] | `pr6-plugins-readme` | `pr6-parity-check` | Add shared plugin adapter documentation. | `plugins/README.md` documents parity, packaging, hook safety, and install evidence rules. |
| [ ] | `pr6-claude-adapter` | `pr6-parity-check`, `pr6-hook-safety-check` | Implement Claude Code adapter. | Claude manifest, packaged skills, `skill-hashes.json`, optional read-only agent/hook, and README exist. |
| [ ] | `pr6-claude-install-evidence` | `pr6-claude-adapter` | Capture Claude Code installation evidence. | README has install procedure, smoke check, check date, and host CLI version. |
| [ ] | `pr6-verify` | `pr6-claude-install-evidence` | Validate PR 6. | `bun run check`, `bun run test:unit`, `bun run build`, Claude smoke evidence with install output/skill visibility/invocation output/date/host CLI version, parity negative-control failure, hook-safety negative-control failure, and `git diff --check` pass; throwaway negative-control mutations are reverted before commit. |

## PR 7A: OpenAI Codex adapter

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [ ] | `pr7a-codex-adapter` | `pr6-verify` | Implement Codex plugin package under `plugins/codex/**`. | Codex manifest, `agents/openai.yaml`, copied skills, hash manifest, optional read-only hook, and README exist. |
| [ ] | `pr7a-codex-policy-map` | `pr7a-codex-adapter` | Map canonical invocation policies to Codex metadata. | Consequential skills are not implicitly model-invoked when Codex supports that control. |
| [ ] | `pr7a-codex-install-evidence` | `pr7a-codex-adapter` | Capture Codex installation evidence. | README documents repo/user-scoped install path, smoke check, check date, and host CLI version. |
| [ ] | `pr7a-verify` | `pr7a-codex-install-evidence` | Validate PR 7A. | `bun run check`, `bun run test:unit`, ownership diff check from the frozen PR 6 base, Codex smoke evidence or manual checklist with install output/skill visibility/invocation output/date/host CLI version, and `git diff --check` pass. |

## PR 7B: GitHub Copilot CLI adapter

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [ ] | `pr7b-copilot-adapter` | `pr6-verify` | Implement Copilot CLI plugin package under `plugins/copilot-cli/**`. | Copilot `plugin.json`, harness agent, copied skills, hash manifest, optional hooks, and README exist. |
| [ ] | `pr7b-copilot-policy-map` | `pr7b-copilot-adapter` | Map canonical invocation policies to Copilot CLI capabilities. | README documents any host limitation or manual enforcement gap. |
| [ ] | `pr7b-copilot-install-evidence` | `pr7b-copilot-adapter` | Capture Copilot CLI installation evidence. | README documents install command, smoke check, check date, and host CLI version. |
| [ ] | `pr7b-verify` | `pr7b-copilot-install-evidence` | Validate PR 7B. | `bun run check`, `bun run test:unit`, ownership diff check from the frozen PR 6 base, Copilot smoke evidence or manual checklist with install output/skill visibility/invocation output/date/host CLI version, and `git diff --check` pass. |

## PR 7C: Gemini CLI adapter

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [ ] | `pr7c-gemini-adapter` | `pr6-verify` | Implement Gemini extension package under `plugins/gemini-cli/**`. | Gemini manifest, `GEMINI.md`, copied skills, hash manifest, optional commands/policies, and README exist. |
| [ ] | `pr7c-gemini-policy-map` | `pr7c-gemini-adapter` | Map canonical invocation policies to Gemini policy behavior. | README documents policy behavior and any required explicit approval path. |
| [ ] | `pr7c-gemini-install-evidence` | `pr7c-gemini-adapter` | Capture Gemini installation evidence. | README documents install/link command, smoke check, check date, host CLI version, and required settings/env vars. |
| [ ] | `pr7c-verify` | `pr7c-gemini-install-evidence` | Validate PR 7C. | `bun run check`, `bun run test:unit`, ownership diff check from the frozen PR 6 base, Gemini smoke evidence or manual checklist with install/link output/skill visibility or equivalent/invocation output/date/host CLI version, and `git diff --check` pass. |

## PR 8: Adapter convergence and documentation cleanup

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [ ] | `pr8-reconcile-adapters` | `pr7a-verify`, `pr7b-verify`, `pr7c-verify` | Reconcile adapter READMEs, manifests, hash manifests, and smoke evidence. | Host docs use consistent terminology and every host passes parity/hook checks. |
| [ ] | `pr8-update-public-docs` | `pr8-reconcile-adapters` | Update public docs for shipped adapter paths only. | README and guides describe current capabilities directly and do not promise unverified marketplace installability. |
| [ ] | `pr8-stale-wording-search` | `pr8-update-public-docs` | Search for stale or forbidden wording. | `rg -n "(model_profiles|agent_runners|model-profile|agent-runner|runner-readiness|\\bharness runner\\b|\\bharness run\\b|live-runner|provider-backed|deterministic stub runner|MCP tool|MCP server|marketplace installability|Phase [0-9]|Stage [0-9])" README.md AGENTS.md docs src schemas examples tests` and `rg -n "(next_actions|\"success\"[[:space:]]*:)" src schemas examples tests skills plugins README.md AGENTS.md docs` return no unexpected matches; approved exceptions are recorded with rationale. |
| [ ] | `pr8-final-validation` | `pr8-stale-wording-search` | Run final validation. | `bun run check`, `bun run test:unit`, `bun run build`, `bun run test:e2e`, adapter checks, `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`, both PR 8 `rg` commands from `pr8-stale-wording-search`, and `git diff --check` pass. |

## Parallel execution checklist

Do not fan out before `pr6-verify` is complete.

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [ ] | `parallel-base-freeze` | `pr6-verify` | Freeze the base before fan-out. | Canonical skills, parity scripts, hook safety scripts, `plugins/README.md`, and Claude adapter pattern are stable; frozen PR 6 commit SHA and convergence owner are recorded in `plans/agent-cli-plugin-architecture/parallel-freeze.md`. |
| [ ] | `parallel-create-codex-worktree` | `parallel-base-freeze` | Create Codex branch/worktree. | Branch `agent-cli/codex-adapter` and worktree `../harness-agent-cli-codex` are based on the frozen base. |
| [ ] | `parallel-create-copilot-worktree` | `parallel-base-freeze` | Create Copilot branch/worktree. | Branch `agent-cli/copilot-adapter` and worktree `../harness-agent-cli-copilot` are based on the frozen base. |
| [ ] | `parallel-create-gemini-worktree` | `parallel-base-freeze` | Create Gemini branch/worktree. | Branch `agent-cli/gemini-adapter` and worktree `../harness-agent-cli-gemini` are based on the frozen base. |
| [ ] | `parallel-enforce-ownership` | Parallel worktrees | Keep each adapter inside its owned paths. | Each branch proves `git diff --name-only <frozen-base>...HEAD` only touches its owned `plugins/<host>/**` path; any shared-path edit has written convergence-owner approval before commit. If a frozen shared path must change, fan-out pauses, all packaged skill copies/hashes are refreshed when relevant, a new frozen SHA is recorded, and branches rebase before continuing. |
| [ ] | `parallel-merge-convergence` | PR 7A/7B/7C | Merge adapter branches and run convergence PR. | Host branches merge after ownership and smoke evidence checks; PR 8 then resolves shared docs/scripts and runs final validation. |

## Global guardrails

- Do not weaken `biome.json`.
- Do not add MCP tools or MCP product semantics.
- Do not add plugin-only, skill-only, CI-only, or profile-only source-of-truth state.
- Do not add live model/provider execution without a separately approved substrate contract, credentials, budgets, and trust boundaries.
- Do not manually edit `.harness/outputs/**`.
- Do not promise installability through a host marketplace without working host evidence.
- Do not copy roadmap/phase wording into public docs, code, schemas, examples, fixtures, or tests.
