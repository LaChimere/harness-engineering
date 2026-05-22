# Schema fixtures

`manifest.json` is the fixture contract for schema validation.

The manifest includes JSON Schema valid/invalid fixtures and custom semantic checks for invariants that JSON Schema cannot express directly. Stage 8 uses shared manifest rules and stable error-code prefixes for plugin-capability matrix evidence-id references, tier thresholds, out-of-scope surface boundaries, and target-selection rules. Stage 9 adds adapter-scope custom checks for selected-host alignment, capability subset claims, CLI management modes, evidence references, write-class limits, and non-authoritative local state. Stage 10 adds schema-valid execution-loop negative fixtures under `examples/fixtures/execution-loop/`; the manifest proves their shape is valid, then `harness loop validate` CLI tests reject them because the failure is semantic rather than structural.

- `valid` entries point at canonical examples under `examples/`. These are both documentation examples and positive validation fixtures.
- `referenced_evidence` entries point at tracked examples that are intentionally not standalone schema fixtures, but must still stay owned by the fixture contract.
- `invalid` entries live under `examples/fixtures/invalid/` and include the intended failing JSON Schema keyword and instance path. Each schema-invalid fixture must produce exactly one schema error, and that error must match the manifest, so a fixture cannot pass the suite by failing for an unrelated or cascading reason.
- `custom_invalid` entries exercise semantic validators directly. Adapter-scope semantic fixtures may be compact documents focused on the invariant under test; schema-valid runtime behavior for `harness adapter validate` is covered separately by CLI tests that construct full adapter-scope artifacts.

Run validation without writing dependency state into the repository:

```bash
python3 -m pip install --target "${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" -r examples/fixtures/requirements.txt
PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py
```
