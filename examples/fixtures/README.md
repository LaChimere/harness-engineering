# Schema fixtures

`manifest.json` is the fixture contract for schema validation.

The manifest includes JSON Schema valid/invalid fixtures and custom semantic checks for invariants that JSON Schema cannot express directly. Stage 8 uses shared manifest rules and stable error-code prefixes for plugin-capability matrix evidence-id references, tier thresholds, out-of-scope surface boundaries, and target-selection rules. Stage 9 adds adapter-scope custom checks for selected-host alignment, capability subset claims, CLI management modes, evidence references, write-class limits, and non-authoritative local state.

- `valid` entries point at canonical examples under `examples/`. These are both documentation examples and positive validation fixtures.
- `invalid` entries live under `examples/fixtures/invalid/` and include the intended failing JSON Schema keyword and instance path. Each schema-invalid fixture must produce exactly one schema error, and that error must match the manifest, so a fixture cannot pass the suite by failing for an unrelated or cascading reason.
- `custom_invalid` entries exercise semantic validators directly. Adapter-scope semantic fixtures may be compact documents focused on the invariant under test; schema-valid runtime behavior for `harness adapter validate` is covered separately by CLI tests that construct full adapter-scope artifacts.

Run validation without writing dependency state into the repository:

```bash
python3 -m pip install --target /tmp/harness-schema-validation -r examples/fixtures/requirements.txt
PYTHONPATH=/tmp/harness-schema-validation python3 examples/fixtures/validate.py
```
