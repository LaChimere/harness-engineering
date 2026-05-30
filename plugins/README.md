# Harness host adapters

Host adapters package canonical Harness skills and optional read-only host guardrails. They are adapters over `harness.yaml`, schemas, and deterministic CLI evidence; they are not a source of product truth.

## Packaging rules

- Canonical skill bodies live only under `skills/<id>/SKILL.md`.
- Packaged host skills must copy canonical skill bodies exactly after documented host metadata normalization.
- Packaged `SKILL.md` files intentionally contain two YAML frontmatter blocks: the first is host metadata, and the second is the canonical Harness skill frontmatter retained as part of the normalized canonical body.
- Packaged skills must not add host-specific product rules, CLI behavior, or evidence shapes.
- Symlinks are not a release or evidence format.

## Skill parity

Run `bun run check:skill-parity` after editing canonical skills or packaged copies.

Supported normalization contracts:

| Host | Normalization | Host metadata |
| --- | --- | --- |
| Claude Code | `claude-code-skill-prelude-v1` | `name`, `description`, optional `disable-model-invocation` for `harness-health` only |
| Codex | `agent-skill-prelude-v1` | `name`, `description`, plus per-skill `agents/openai.yaml` policy |
| Copilot CLI | `agent-skill-prelude-v1` | `name`, `description` |
| Gemini CLI | `agent-skill-prelude-v1` | `name`, `description` |

For every host, removing the first host prelude from
`plugins/<host>/skills/<id>/SKILL.md` must leave bytes identical to canonical
`skills/<id>/SKILL.md`. Each `skill-hashes.json` records canonical and
normalized packaged SHA-256 hashes for reviewable drift checks. Codex
additionally checks that `allow_implicit_invocation` matches the canonical skill
invocation policy. The parity check also rejects unreviewed host prelude
descriptions, host-specific policy flags outside their approved skill, malformed
frontmatter, symlinked skill paths, and symlink ancestors.

New host metadata prelude formats must be added through `scripts/check-skill-parity.ts`
before host adapter fan-out.

## Host policy status

| Host | Adapter policy status | Current gap |
| --- | --- | --- |
| Claude Code | `harness-health` uses `disable-model-invocation: true` in host metadata. | Full model-invoking skill smoke is blocked until explicitly approved. |
| Codex | Per-skill `agents/openai.yaml` declares canonical `invocation_policy` as `allow_implicit_invocation` through a repo-local adapter contract; repo-local marketplace install and live/model-backed explicit `harness-doctor` invocation smoke have evidence. | Host enforcement of `allow_implicit_invocation`, interactive `/skills` visibility, and negative `harness-health` implicit-invocation smoke remain unverified. |
| Copilot CLI | `harness-health` explicit-user-intent guidance is present in skill metadata and `agents/harness.agent.md`; installed-plugin `harness-doctor` live/model-backed invocation smoke and real-temp-project explicit/negative health smoke have evidence. | Marketplace evidence remains separate; no per-skill host policy flag is claimed. |
| Gemini CLI | Skill activation is documented as user-consent based, and `harness-health` explicit-user-intent guidance is present in skill metadata and `GEMINI.md`. | No validated per-skill host policy flag is available in this adapter yet, and Gemini CLI is unavailable in the current environment. |

## Hook safety

Run `bun run check:hook-safety` after editing plugin hooks. Executable hooks under `plugins/**/hooks/**` with `.ts`, `.js`, `.mjs`, `.cjs`, `.sh`, or `.py` extensions must not write files, reference `.harness/outputs/**`, execute child processes, use dynamic code execution, or make network calls. Inert docs and data files are not hook code.

## Install evidence

Each host README must distinguish package validation from host installation evidence. Do not claim marketplace installability unless the host path has real evidence with command output, host CLI version, check date, skill visibility, and one skill invocation smoke result.

`bun run check:plugin-manifests` validates adapter manifest paths, Codex
repo-local marketplace metadata, regular-file path safety, symlink ancestors, and
health guidance proximity so explicit-user-intent wording is not separated from
the command it gates or contradicted by automatic-run instructions.

Adapter directories are repo-local source packages. They are not included in the
published CLI package unless `package.json` explicitly adds `plugins/` to the
package file list.
