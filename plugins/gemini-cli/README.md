# Gemini CLI adapter

This directory packages the canonical Harness skills for Gemini CLI extension
distribution. It is an adapter over `skills/`, schemas, and the deterministic
`harness` CLI; it is not a separate source of truth.

## Layout

- `gemini-extension.json` is the Gemini CLI extension manifest.
- `GEMINI.md` gives concise host-level routing guidance.
- `skills/<id>/SKILL.md` contains one Gemini metadata prelude followed by the
  canonical `skills/<id>/SKILL.md` body.
- `skill-hashes.json` records canonical and normalized packaged hashes.

No settings or environment variables are required. The extension does not ship
MCP servers, custom commands, or executable hooks.

Gemini CLI documents that extension skills are discovered from skills bundled
within installed extensions and that skills require a `SKILL.md` with `name` and
`description` frontmatter. Skill activation prompts for user consent before the
skill body and bundled resources are injected.

## Policy behavior

Gemini skill activation has a user consent prompt, but this adapter has not
validated a per-skill policy flag equivalent to Claude
`disable-model-invocation` or Codex `allow_implicit_invocation`. The
`harness-health` packaged skill description and `GEMINI.md` therefore preserve
the explicit-user-intent requirement, and user-facing readiness remains blocked
until Gemini CLI is available and an approved invocation smoke confirms the host
behavior.

## Validation

Run these checks before treating the package as ready:

```sh
bun run check:skill-parity
bun run check:hook-safety
bun run check:plugin-manifests
```

Gemini CLI was not available in the current validation environment, so the local
install/link command has not been verified. Manual smoke checklist:

1. Install or link `./plugins/gemini-cli` with Gemini CLI using the host's local
   extension installation path.
2. Verify the extension appears in `gemini extensions list` or `/extensions list`.
3. Verify the seven Harness skills appear in `/skills list`.
4. Invoke a read-only skill and capture host version, date, extension visibility,
   skill visibility, and invocation output.

Do not claim gallery availability until separate gallery evidence exists.

Observed local package environment:

- Check date: 2026-05-30
- Host CLI: unavailable (`gemini` was not found on `PATH`)
- Required settings/env vars: none
