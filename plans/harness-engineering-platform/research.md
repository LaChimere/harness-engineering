# Research: Harness Engineering Platform

## Request

The user wants to use this new repository, `LaChimere/harness-engineering`, as the home for the Harness Engineering platform rather than continuing to treat `LaChimere/agent-coding` as the product center.

The plan originated in `agent-coding`, where the user wanted to broaden the scope beyond adding one `harness-engineering` skill:

- The whole repository may be reshaped around harness engineering.
- Existing skills may be changed, merged, or deleted if that better serves the goal.
- Delivery does not need to be limited to `npx skills add`; plugin, CLI/tooling, agent profiles, or other delivery surfaces are allowed.
- The preferred user-facing installation path, when host support exists, should be a Harness Engineering plugin installed from the user's existing Codex/Claude/Copilot CLI/IDE marketplace or extension surface.

The user later confirmed the intended direction: the product should actively do harness engineering and examine how the current `agent-coding` skills can be combined into the new harness-engineering architecture. Existing practices should be retained only when they fit; better practices should replace them when evidence supports the change.

## Current repository evidence

- `LaChimere/harness-engineering` is currently a clean new repository containing a license and this copied planning directory.
- That blank state is an advantage: the target architecture can be designed around the harness substrate instead of migrating a skills-first repository in place.
- The first implementation stage should establish product identity, package/distribution choices, and the initial repository layout before adding schemas or CLI code.

## `agent-coding` migration-source evidence

- `agent-coding` presents itself as "a repository of reusable workflow skills for disciplined AI coding" and says it turns common AI coding-agent failure modes into reusable skills and a portable orchestration layer.
- Its current model has three layers: repo-local `AGENTS.md`, portable `workflow-orchestrator`, and specialized worker skills.
- Its public workflow is `Research -> Design -> Gate 1 -> Plan + Todo -> Gate 2 -> Execute -> Verify -> Gate 3 -> Lessons`, with "No evidence = not done" as a core principle.
- Current documented skills are `decompose-feature`, `plan-parallel-work`, `ensure-atomic-pr`, `workflow-orchestrator`, `execute-plan-loop`, `achieve-goal`, `refresh-related-docs`, and `scan-image-vulnerabilities`.
- The workflow contract maps worker skills but has no harness-engineering, tool/CLI, plugin, entropy, or recurring-agent delivery layer.
- `agent-coding` has no package manifest or obvious installable CLI/plugin package today; the file list is mostly Markdown skills plus one Trivy shell script under `scan-image-vulnerabilities`.
- These skills are evidence and possible adapters, not constraints on the `harness-engineering` repository.

## External research evidence

The earlier research report concluded that harness engineering is broader than a prompt or skill:

- A good harness is "a reproducible, isolated, observable, mechanically scored, continuously improving control system" rather than just a prompt set or eval script.
- It includes both agent harnesses and evaluation harnesses: tool/state/control-flow scaffolds plus task/environment/trace/grader/result infrastructure.
- Best practices include reproducible sandboxes, versioned data/tasks, trace/artifact capture, deterministic graders first, calibrated LLM judges, self-verification loops, tool-permission boundaries, CI gates, and continuous entropy/garbage-collection loops.
- OpenAI's article emphasizes repository knowledge as the system of record, agent-legible observability, mechanical architecture/taste rules, and continuous garbage collection for agent-generated entropy.

Saved report:

```text
/Users/lachimere/.copilot/workspaces/cc38a0ae-41bd-4f56-a970-7a3e1faa605f/artifacts/research/https-openai-com-index-harness-engineeri.md
```

The second research pass refined the design direction:

- LangChain frames the field as **Agent = Model + Harness**: prompts, tools, skills, MCPs, filesystem, sandbox, orchestration, middleware, compaction, and checks are all harness surfaces (`https://blog.langchain.com/the-anatomy-of-an-agent-harness/`).
- LangChain reported a Terminal-Bench 2.0 improvement from 52.8 to 66.5 by changing only the harness around a fixed model. The highest-leverage changes were trace analysis, self-verification, environment context injection, loop detection, and time/reasoning-budget management (`https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering`).
- LangChain's Better-Harness loop treats evals as training data for agents: source and tag evals, split optimization and holdout sets, run baselines, diagnose traces, make one targeted harness change, validate regressions, and require human review (`https://www.langchain.com/blog/better-harness-a-recipe-for-harness-hill-climbing-with-evals`).
- Anthropic's long-running harness pattern uses an initializer agent plus coding agents, with durable state such as a feature list, progress file, `init.sh`, startup verification, and git commits to survive fresh context windows (`https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents`).
- Anthropic's follow-up planner/generator/evaluator harness shows that independent evaluators and sprint contracts can outperform a single self-evaluating agent, but also warns that harness complexity should be re-tested as models improve (`https://www.anthropic.com/engineering/harness-design-long-running-apps`).
- Inspect AI provides concrete production-grade primitives for sandboxing, approval policies, tracing, agents, deep agents, and external-agent evaluation. Its approval decisions include approve, modify, reject, escalate, and terminate; traces are JSONL action logs with anomaly tooling (`https://inspect.ai-safety-institute.org.uk/approval.html`, `https://inspect.ai-safety-institute.org.uk/tracing.html`, `https://inspect.ai-safety-institute.org.uk/sandboxing.html`).
- OpenAI Evals separates dataset formatting, registry naming, split/version conventions, and model-graded eval calibration. Model-graded evals should include human labels or meta-evals so judge quality is measurable (`https://github.com/openai/evals/blob/main/docs/build-eval.md`).
- OpenAI Agents SDK eval guidance shows traces as spans around agent runs, tool calls, and LLM calls, and recommends online/offline evaluation metrics such as cost, latency, user feedback, and LLM-as-judge scores (`https://cookbook.openai.com/examples/agents_sdk/evaluate_agents`).
- Harbor and Terminal-Bench show that behavioral evals need a task format, environment definition, verifier, logs, reward output, optional oracle solution, dataset registry, and versioning (`https://harborframework.com/docs/task-format`, `https://www.tbench.ai/docs/registry`).
- SWE-bench reinforces reproducible evaluation through Docker, named `run_id`s, separate build/eval logs, `gold` predictions to validate the harness itself, and explicit resource requirements (`https://github.com/princeton-nlp/SWE-bench`).
- Cursor's harness work highlights model-specific profiles, offline evals plus online telemetry, tool-error taxonomies, and recurring automation for harness bugs (`https://cursor.com/blog/continually-improving-agent-harness`).

Saved second report:

```text
/Users/lachimere/.copilot/workspaces/cc38a0ae-41bd-4f56-a970-7a3e1faa605f/artifacts/research/harness-engineering-harness-engineering.md
```

## Key constraints

1. **Product identity must be explicit.** `harness-engineering` is the canonical harness-as-code platform; `agent-coding` is a migration source and potential adapter package.
2. **Portability cannot silently break.** If users still install `agent-coding` skills with `npx skills add`, those skills should not start depending on a local CLI or plugin unless that dependency is declared as a compatibility tier.
3. **Mechanical checks need a contract.** A future `harness-doctor` cannot reliably scan "entropy" or "routing conflicts" until each check has a machine-checkable definition, inputs, severity, and expected output.
4. **Behavioral evals are not doctor checks.** Deterministic structural checks and Harbor/SWE-bench-style behavioral task evals need separate contracts even if both feed the same harness improvement loop.
5. **Agent invocation is a first-class primitive.** A harness platform must run a model through a configured harness on real tasks; schemas and verifier-only checks are not enough.
6. **Trace, approval, sandbox, and failure-taxonomy shapes must be pinned early.** Later skills, doctor checks, recurring agents, and plugins will drift if these remain only conceptual.
7. **Existing skills are an evidence base.** Deleting, migrating, or replacing `agent-coding` skills before defining the v-next harness contract risks removing behavior the new platform should preserve or supersede deliberately.
8. **Marketplace plugin-first is a north star, not a promise before feasibility.** Public docs should lead with CLI-first until a real host marketplace/extension distribution path and runtime capability are verified.
9. **`scan-image-vulnerabilities` is an outlier.** It is useful but domain-specific security tooling rather than core harness engineering; the design should explicitly keep, move, deprecate, or reframe it.
10. **This is large enough for Gate 1.** The change affects repository identity, delivery surfaces, workflow contract, and potentially all skills. Design approval should happen before plan/todo and implementation.

## Resolved design direction

The design artifact resolves the main unknowns as follows:

- The canonical product should be this repo as a **harness-as-code platform**, not a skills-first package. Skills remain a portable adapter and migration path.
- The canonical source of truth should be `harness.yaml` plus versioned schemas.
- Host marketplace/extension plugin UX should be the preferred guided user experience when a supported host plugin exists; CLI/spec remains the current universal path and automation substrate until plugin feasibility is proven.
- CI should be an optional enforcement adapter, not the assumed user path.
- Deterministic tooling should live in a top-level harness toolkit path such as `tools/harness/`, implemented with TypeScript 6, managed with Bun for repository development, use Biome/Lefthook once the user provides configuration, and ship as a Node-compatible npm CLI.
- Existing `agent-coding` skills should be classified only after the substrate and execution loop exist; they may be kept, rewritten, merged, extracted, or deleted if the new substrate supersedes them.
- Recurring agents should be later maintenance profiles that consume traces, run results, doctor output, evals, and GC evidence.
- Doctor checks, behavioral evals, agent runners, traces, run results, model profiles, approval/sandbox policies, plugin capabilities, repair actions, continuity state, and GC evidence should have separate machine-checkable contracts.

## Recommended framing

Use a north-star layered model:

- **Tier 0: Harness-as-code substrate** — `harness.yaml`, schemas, examples, artifact conventions, and versioning.
- **Tier 1: Deterministic CLI tooling** — `init`, `validate`, `migrate`, `run`, `doctor`, `eval run`, `trace validate/import`, `verify`, `gc`, and `report`.
- **Tier 2: Host marketplace plugins** — preferred guided UX where a host marketplace/extension surface can distribute the plugin and host APIs support repo discovery, report rendering, annotations, and repair actions.
- **Tier 3: Portable skills** — fallback agent adapters that consume substrate evidence and delegate work.
- **Tier 4: Optional CI adapters** — blocking or advisory checks for teams that want enforcement.
- **Tier 5: Recurring profiles** — entropy auditor, doc gardener, eval curator, trace reviewer, and similar maintenance loops.

This lets the repo broaden beyond `npx skills add` without making the current install story a design constraint.

Within that layered model, separate these contracts:

- **Doctor checks** are deterministic structural checks with fixtures and low false-positive tolerance.
- **Behavioral eval suites** are task/run artifacts with versioning, environments, verifiers, holdouts, and result logs.
- **Agent runner contracts** define how a model/provider, task, sandbox, approval policy, trace output, and verifier compose into an executable harness run.
- **Trace/artifact schemas** describe what evidence agents and tools produce or consume; host runtimes may produce the trace, but this repo should define the expected shape.
- **Plugin capability and repair-action contracts** keep marketplace plugins thin, safe adapters over CLI artifacts rather than second sources of truth.
- **Agent profiles** are recurring or long-running roles that consume skills, doctor output, eval results, and traces; they are not just new skills with a different name.

## Rubber-duck critique incorporated

The critique raised three important blockers:

1. The primary product identity must be settled before touching code.
2. `harness-doctor` checks need a check contract before implementation.
3. Portability vs harness-specific tooling must be expressed as compatibility tiers.

It also recommended deferring deletion/merge of existing skills until the new contract proves it can absorb their behavior, and treating agent profiles as later optional deliverables rather than first-wave scope.
