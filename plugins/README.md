# Harness host adapters

Host adapters package canonical Harness skills and optional read-only host guardrails. They are adapters over `harness.yaml`, schemas, and deterministic CLI evidence; they are not a source of product truth.

## Packaging rules

- Canonical skill bodies live only under `skills/<id>/SKILL.md`.
- Packaged host skills must copy canonical skill bodies exactly after documented host metadata normalization.
- Packaged skills must not add host-specific product rules, CLI behavior, or evidence shapes.
- Symlinks are not a release or evidence format.

## Skill parity

Run `bun run check:skill-parity` after editing canonical skills or packaged copies. The current normalization contract is `claude-code-skill-prelude-v1`:

1. A packaged Claude skill starts with one Claude host prelude delimited by `---`.
2. The prelude may contain only host metadata needed by Claude Code, such as `name`, `description`, and `disable-model-invocation`.
3. Removing that first prelude must leave bytes identical to the canonical `skills/<id>/SKILL.md`.
4. `plugins/claude-code/skill-hashes.json` records the canonical and normalized packaged SHA-256 hashes for reviewable drift checks.

New host metadata prelude formats must be added through a shared parity-script change before host adapter fan-out.

## Hook safety

Run `bun run check:hook-safety` after editing plugin hooks. Executable hooks under `plugins/**/hooks/**` with `.ts`, `.js`, `.mjs`, `.cjs`, `.sh`, or `.py` extensions must not write files, reference `.harness/outputs/**`, execute child processes, use dynamic code execution, or make network calls. Inert docs and data files are not hook code.

## Install evidence

Each host README must distinguish package validation from host installation evidence. Do not claim marketplace installability unless the host path has real evidence with command output, host CLI version, check date, skill visibility, and one skill invocation smoke result.
