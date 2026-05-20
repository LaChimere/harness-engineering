#!/usr/bin/env python3
"""Validate Stage 2 schemas and fixtures with an offline JSON Schema registry."""

from __future__ import annotations

import json
import pathlib
import sys
from typing import Any

try:
    import yaml
    from jsonschema import Draft202012Validator, FormatChecker
    from referencing import Registry, Resource
except ImportError as error:
    sys.exit(
        "Missing validation dependency: "
        f"{error.name}. Install with: "
        "python3 -m pip install --target /tmp/harness-schema-validation "
        "-r examples/fixtures/requirements.txt"
    )


ROOT = pathlib.Path(__file__).resolve().parents[2]


def load_document(path: pathlib.Path) -> Any:
    text = path.read_text()
    if path.suffix == ".json":
        return json.loads(text)
    return yaml.safe_load(text)


def load_schemas() -> tuple[dict[pathlib.Path, dict[str, Any]], Registry]:
    schemas: dict[pathlib.Path, dict[str, Any]] = {}
    resources = []
    for path in sorted((ROOT / "schemas").glob("*.schema.json")):
        schema = json.loads(path.read_text())
        schemas[path] = schema
        resources.append((schema["$id"], Resource.from_contents(schema)))
    registry = Registry().with_resources(resources)
    for schema in schemas.values():
        Draft202012Validator.check_schema(schema)
    return schemas, registry


def validate_valid_fixtures(
    manifest: dict[str, Any],
    schemas: dict[pathlib.Path, dict[str, Any]],
    registry: Registry,
) -> None:
    for item in manifest["valid"]:
        validator = Draft202012Validator(
            schemas[ROOT / item["schema"]],
            registry=registry,
            format_checker=FormatChecker(),
        )
        errors = sorted(
            validator.iter_errors(load_document(ROOT / item["path"])),
            key=lambda error: list(error.path),
        )
        if errors:
            print(f"VALID fixture failed: {item['path']}", file=sys.stderr)
            for error in errors[:10]:
                print(
                    f"  path={list(error.path)} keyword={error.validator}: {error.message}",
                    file=sys.stderr,
                )
            sys.exit(1)


def validate_invalid_fixtures(
    manifest: dict[str, Any],
    schemas: dict[pathlib.Path, dict[str, Any]],
    registry: Registry,
) -> None:
    for item in manifest["invalid"]:
        validator = Draft202012Validator(
            schemas[ROOT / item["schema"]],
            registry=registry,
            format_checker=FormatChecker(),
        )
        errors = list(validator.iter_errors(load_document(ROOT / item["path"])))
        if not errors:
            print(
                f"INVALID fixture unexpectedly passed: {item['path']}",
                file=sys.stderr,
            )
            sys.exit(1)

        expected_keyword = item["expected_keyword"]
        expected_path = item["expected_path"]
        expected_message_contains = item.get("expected_message_contains")
        matching_errors = [
            error
            for error in errors
            if (
                error.validator == expected_keyword
                and list(error.path) == expected_path
                and (
                    expected_message_contains is None
                    or expected_message_contains in error.message
                )
            )
        ]
        if len(errors) != 1 or len(matching_errors) != 1:
            print(
                "INVALID fixture must fail with exactly one expected schema error: "
                f"{item['path']}",
                file=sys.stderr,
            )
            print(
                "  expected "
                f"path={expected_path} keyword={expected_keyword}"
                + (
                    f" message~={expected_message_contains!r}"
                    if expected_message_contains is not None
                    else ""
                ),
                file=sys.stderr,
            )
            for error in errors[:10]:
                print(
                    f"  actual path={list(error.path)} keyword={error.validator}: {error.message}",
                    file=sys.stderr,
                )
            sys.exit(1)


def taxonomy_codes(path: pathlib.Path) -> set[str]:
    document = load_document(path)
    return {entry["code"] for entry in document["codes"]}


def validate_custom_checks(manifest: dict[str, Any]) -> None:
    required_codes = set(manifest["failure_taxonomy_required_codes"])
    example_codes = taxonomy_codes(ROOT / "examples/failure-taxonomy.yaml")
    missing_from_example = sorted(required_codes - example_codes)
    if missing_from_example:
        print(
            "Canonical failure taxonomy is missing starter codes: "
            + ", ".join(missing_from_example),
            file=sys.stderr,
        )
        sys.exit(1)

    for item in manifest.get("custom_invalid", []):
        if item["check"] != "failure_taxonomy_required_codes":
            print(f"Unknown custom check: {item['check']}", file=sys.stderr)
            sys.exit(1)
        codes = taxonomy_codes(ROOT / item["path"])
        missing = required_codes - codes
        if missing != {item["expected_missing_code"]}:
            print(
                f"CUSTOM invalid fixture failed for the wrong reason: {item['path']}",
                file=sys.stderr,
            )
            print(
                f"  expected missing code: {item['expected_missing_code']}",
                file=sys.stderr,
            )
            print(f"  actual missing codes: {sorted(missing)}", file=sys.stderr)
            sys.exit(1)


def main() -> None:
    schemas, registry = load_schemas()
    manifest = json.loads((ROOT / "examples/fixtures/manifest.json").read_text())
    validate_valid_fixtures(manifest, schemas, registry)
    validate_invalid_fixtures(manifest, schemas, registry)
    validate_custom_checks(manifest)
    print(
        "stage2 validation ok: "
        f"{len(schemas)} schemas, "
        f"{len(manifest['valid'])} valid fixtures, "
        f"{len(manifest['invalid'])} schema-invalid fixtures, "
        f"{len(manifest.get('custom_invalid', []))} custom-invalid fixtures"
    )


if __name__ == "__main__":
    main()
