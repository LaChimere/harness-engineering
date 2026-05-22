#!/usr/bin/env python3
"""Validate schemas and fixtures with an offline JSON Schema registry."""

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


def validate_referenced_evidence(manifest: dict[str, Any]) -> None:
    for item in manifest.get("referenced_evidence", []):
        path = ROOT / item["path"]
        if not path.is_file():
            print(f"REFERENCED evidence is missing: {item['path']}", file=sys.stderr)
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


def taxonomy_codes(document: Any) -> set[str]:
    return {entry["code"] for entry in document["codes"]}


def validate_custom_checks(manifest: dict[str, Any]) -> None:
    for item in manifest.get("custom_valid", []):
        errors = run_custom_check(
            item["check"],
            load_document(ROOT / item["path"]),
            manifest,
            item,
        )
        if errors:
            print(f"CUSTOM valid fixture failed: {item['path']}", file=sys.stderr)
            for error in errors[:10]:
                print(f"  {error}", file=sys.stderr)
            sys.exit(1)

    for item in manifest.get("custom_invalid", []):
        errors = run_custom_check(
            item["check"],
            load_document(ROOT / item["path"]),
            manifest,
            item,
        )
        if not errors:
            print(
                f"CUSTOM invalid fixture unexpectedly passed: {item['path']}",
                file=sys.stderr,
            )
            sys.exit(1)

        expected_message = item.get("expected_message_contains")
        if expected_message is not None and not any(
            expected_message in error for error in errors
        ):
            print(
                f"CUSTOM invalid fixture failed for the wrong reason: {item['path']}",
                file=sys.stderr,
            )
            print(f"  expected message containing: {expected_message}", file=sys.stderr)
            for error in errors[:10]:
                print(f"  actual: {error}", file=sys.stderr)
            sys.exit(1)

        expected_error_code = item.get("expected_error_code")
        if expected_error_code is not None and not any(
            error.startswith(f"[{expected_error_code}]") for error in errors
        ):
            print(
                f"CUSTOM invalid fixture failed for the wrong reason: {item['path']}",
                file=sys.stderr,
            )
            print(f"  expected error code: {expected_error_code}", file=sys.stderr)
            for error in errors[:10]:
                print(f"  actual: {error}", file=sys.stderr)
            sys.exit(1)

        expected_missing_code = item.get("expected_missing_code")
        if expected_missing_code is not None and errors != [
            f"missing starter code: {expected_missing_code}"
        ]:
            print(
                f"CUSTOM invalid fixture failed for the wrong reason: {item['path']}",
                file=sys.stderr,
            )
            print(f"  expected missing code: {expected_missing_code}", file=sys.stderr)
            print(f"  actual errors: {errors}", file=sys.stderr)
            sys.exit(1)


def run_custom_check(
    check: str, document: Any, manifest: dict[str, Any], item: dict[str, Any]
) -> list[str]:
    if check == "failure_taxonomy_required_codes":
        required_codes = set(manifest["failure_taxonomy_required_codes"])
        missing = sorted(required_codes - taxonomy_codes(document))
        return [f"missing starter code: {code}" for code in missing]
    if check == "plugin_capability_matrix_invariants":
        return validate_plugin_capability_matrix(
            document,
            manifest["plugin_capability_matrix_invariants"],
        )
    if check == "adapter_scope_matrix_subset":
        matrix_path = item.get("matrix")
        if not isinstance(matrix_path, str) and isinstance(document, dict):
            matrix_path = document.get("matrix_ref")
        if not isinstance(matrix_path, str):
            print("adapter_scope_matrix_subset requires a matrix path", file=sys.stderr)
            sys.exit(1)
        return validate_adapter_scope_against_matrix(
            document,
            load_document(ROOT / matrix_path),
        )
    print(f"Unknown custom check: {check}", file=sys.stderr)
    sys.exit(1)


def matrix_error(code: str, message: str) -> str:
    return f"[{code}] {message}"


def validate_plugin_capability_matrix(document: Any, rules: dict[str, Any]) -> list[str]:
    if not isinstance(document, dict):
        return [matrix_error("PCM_MATRIX_TYPE", "plugin capability matrix must be an object")]

    errors: list[str] = []
    dimensions = set(document.get("capability_dimensions", []))
    for dimension in rules["capability_dimensions"]:
        if dimension not in dimensions:
            errors.append(matrix_error("PCM_DIMENSION_MISSING", f"missing capability dimension: {dimension}"))

    hosts_by_id: dict[str, dict[str, Any]] = {}
    global_evidence_ids: set[str] = set()
    for index, host in enumerate(document.get("hosts", [])):
        if not isinstance(host, dict):
            errors.append(matrix_error("PCM_HOST_TYPE", f"hosts[{index}] must be an object"))
            continue
        host_id = host.get("host", {}).get("id")
        if not isinstance(host_id, str):
            errors.append(matrix_error("PCM_HOST_ID_MISSING", f"hosts[{index}] is missing host.id"))
            continue
        if host_id in hosts_by_id:
            errors.append(matrix_error("PCM_HOST_DUPLICATE", f"duplicate host id: {host_id}"))
        hosts_by_id[host_id] = host

        local_evidence_ids = collect_evidence_ids(host, host_id, global_evidence_ids, errors)
        validate_host_capabilities(host, host_id, local_evidence_ids, rules, errors)
        validate_host_tier(host, host_id, rules, errors)

    validate_matrix_decision(document, hosts_by_id, rules, errors)
    return errors


def collect_evidence_ids(
    host: dict[str, Any],
    host_id: str,
    global_evidence_ids: set[str],
    errors: list[str],
) -> set[str]:
    local_evidence_ids: set[str] = set()
    for index, evidence in enumerate(host.get("evidence", [])):
        if not isinstance(evidence, dict):
            errors.append(
                matrix_error("PCM_EVIDENCE_TYPE", f"{host_id}.evidence[{index}] must be an object")
            )
            continue
        evidence_id = evidence.get("evidence_id")
        if not isinstance(evidence_id, str):
            errors.append(
                matrix_error("PCM_EVIDENCE_ID_MISSING", f"{host_id}.evidence[{index}] missing evidence_id")
            )
            continue
        if evidence_id in global_evidence_ids:
            errors.append(matrix_error("PCM_EVIDENCE_DUPLICATE", f"duplicate evidence_id: {evidence_id}"))
        global_evidence_ids.add(evidence_id)
        local_evidence_ids.add(evidence_id)
    return local_evidence_ids


def validate_host_capabilities(
    host: dict[str, Any],
    host_id: str,
    local_evidence_ids: set[str],
    rules: dict[str, Any],
    errors: list[str],
) -> None:
    capabilities = host.get("capabilities")
    if not isinstance(capabilities, dict):
        errors.append(matrix_error("PCM_CAPABILITIES_MISSING", f"{host_id} is missing capabilities"))
        return

    for dimension in rules["capability_dimensions"]:
        capability = capabilities.get(dimension)
        if not isinstance(capability, dict):
            errors.append(matrix_error("PCM_CAPABILITY_MISSING", f"{host_id}.{dimension} is missing"))
            continue
        for evidence_id in capability.get("evidence_ids", []):
            if not isinstance(evidence_id, str):
                errors.append(
                    matrix_error(
                        "PCM_EVIDENCE_REFERENCE_TYPE",
                        f"{host_id}.{dimension} references a non-string evidence id",
                    )
                )
            elif evidence_id not in local_evidence_ids:
                errors.append(
                    matrix_error(
                        "PCM_EVIDENCE_DANGLING",
                        f"{host_id}.{dimension} references missing evidence_id: {evidence_id}",
                    )
                )


def validate_host_tier(
    host: dict[str, Any],
    host_id: str,
    rules: dict[str, Any],
    errors: list[str],
) -> None:
    tier = host.get("tier")
    candidate_status = host.get("candidate_status")
    stage9_consequence = host.get("stage9_consequence")
    surface_kind = host.get("surface_kind")
    distribution_surface = host.get("distribution_surface")
    capabilities = host.get("capabilities")
    if not isinstance(capabilities, dict):
        return

    if (
        surface_kind in rules["out_of_scope_surface_kinds"]
        and candidate_status != "out-of-scope-future-evidence"
    ):
        errors.append(
            matrix_error(
                "PCM_OUT_OF_SCOPE_SURFACE",
                f"{host_id} {surface_kind} surface must be out-of-scope future evidence",
            )
        )

    if (
        distribution_surface in rules["out_of_scope_distribution_surfaces"]
        and candidate_status != "out-of-scope-future-evidence"
    ):
        errors.append(
            matrix_error(
                "PCM_OUT_OF_SCOPE_DISTRIBUTION",
                f"{host_id} {distribution_surface} distribution must be out-of-scope future evidence",
            )
        )

    expected_consequence = rules["tier_stage9_consequences"].get(tier)
    if expected_consequence is not None and stage9_consequence != expected_consequence:
        errors.append(
            matrix_error(
                "PCM_TIER_CONSEQUENCE",
                f"{host_id} {tier} tier must use {expected_consequence} consequence",
            )
        )

    if tier == "future-adapter-evidence" and candidate_status != "out-of-scope-future-evidence":
        errors.append(
            matrix_error(
                "PCM_FUTURE_TIER_CANDIDATE",
                f"{host_id} future-adapter-evidence tier must be out-of-scope future evidence",
            )
        )

    if candidate_status == "out-of-scope-future-evidence":
        if tier != "future-adapter-evidence":
            errors.append(
                matrix_error(
                    "PCM_FUTURE_CANDIDATE_TIER",
                    f"{host_id} future evidence must use future-adapter-evidence tier",
                )
            )
        if stage9_consequence != "future-evidence-only":
            errors.append(
                matrix_error(
                    "PCM_FUTURE_CANDIDATE_CONSEQUENCE",
                    f"{host_id} future evidence must use future-evidence-only consequence",
                )
            )

    if tier == "full-plugin":
        for dimension in rules["capability_dimensions"]:
            capability = capabilities.get(dimension)
            if isinstance(capability, dict) and (
                capability.get("status") != "yes"
                or capability.get("fallback") != "supported"
            ):
                errors.append(
                    matrix_error(
                        "PCM_FULL_PLUGIN_CAPABILITY",
                        f"{host_id} full-plugin tier requires {dimension} to be fully supported",
                    )
                )

    if tier == "limited-adapter":
        for dimension in rules["limited_adapter_core_capabilities"]:
            capability = capabilities.get(dimension)
            status = capability.get("status") if isinstance(capability, dict) else None
            fallback = capability.get("fallback") if isinstance(capability, dict) else None
            if status != "yes" or fallback != "supported":
                errors.append(
                    matrix_error(
                        "PCM_CORE_CAPABILITY",
                        f"{host_id} limited-adapter tier requires supported core capability {dimension}",
                    )
                )

        missing_rich_ux = any(
            not isinstance(capabilities.get(dimension), dict)
            or capabilities[dimension].get("status") != "yes"
            or capabilities[dimension].get("fallback") != "supported"
            for dimension in rules["rich_ux_capabilities"]
        )
        if not missing_rich_ux:
            errors.append(
                matrix_error(
                    "PCM_LIMITED_RICH_UX",
                    f"{host_id} limited-adapter tier must be missing at least one rich UX capability",
                )
            )

    if tier == "cli-first-fallback":
        missing_core_capability = any(
            not isinstance(capabilities.get(dimension), dict)
            or capabilities[dimension].get("status") != "yes"
            or capabilities[dimension].get("fallback") != "supported"
            for dimension in rules["limited_adapter_core_capabilities"]
        )
        if not missing_core_capability:
            errors.append(
                matrix_error(
                    "PCM_CLI_FALLBACK_CORE_SUPPORTED",
                    f"{host_id} cli-first-fallback tier must be missing at least one core capability",
                )
            )


def validate_matrix_decision(
    document: dict[str, Any],
    hosts_by_id: dict[str, dict[str, Any]],
    rules: dict[str, Any],
    errors: list[str],
) -> None:
    decision = document.get("decision")
    if not isinstance(decision, dict):
        errors.append(matrix_error("PCM_DECISION_MISSING", "matrix decision is missing"))
        return

    selected_host_id = decision.get("selected_host_id")
    if selected_host_id is None:
        if decision.get("selected_tier") not in {"cli-first-fallback", "none"}:
            errors.append(
                matrix_error(
                    "PCM_DECISION_NULL_TIER",
                    "matrix without selected_host_id must use cli-first-fallback or none tier",
                )
            )
        expected_consequence = rules["null_decision_stage9_consequences"].get(
            decision.get("selected_tier")
        )
        if expected_consequence is not None and decision.get("stage9_consequence") != expected_consequence:
            errors.append(
                matrix_error(
                    "PCM_DECISION_NULL_CONSEQUENCE",
                    "matrix without selected_host_id and "
                    f"{decision.get('selected_tier')} tier must use {expected_consequence} consequence",
                )
            )
        return

    if not isinstance(selected_host_id, str):
        errors.append(
            matrix_error(
                "PCM_DECISION_SELECTED_TYPE",
                "matrix decision selected_host_id must be a string or null",
            )
        )
        return

    selected_host = hosts_by_id.get(selected_host_id)
    if selected_host is None:
        errors.append(
            matrix_error(
                "PCM_DECISION_UNKNOWN_HOST",
                f"matrix decision references unknown selected_host_id: {selected_host_id}",
            )
        )
        return

    selected_tier = selected_host.get("tier")
    if selected_tier not in rules["selectable_tiers"]:
        errors.append(
            matrix_error(
                "PCM_DECISION_UNSELECTABLE_TIER",
                f"matrix decision cannot select {selected_host_id} at tier {selected_tier}",
            )
        )
    if selected_host.get("candidate_status") != "in-scope-candidate":
        errors.append(
            matrix_error(
                "PCM_DECISION_OUT_OF_SCOPE",
                f"matrix decision cannot select out-of-scope host: {selected_host_id}",
            )
        )
    if decision.get("selected_tier") != selected_tier:
        errors.append(
            matrix_error(
                "PCM_DECISION_TIER_MISMATCH",
                f"matrix decision selected_tier must match selected host tier: {selected_tier}",
            )
        )

    host_consequence = selected_host.get("stage9_consequence")
    if decision.get("stage9_consequence") != host_consequence:
        errors.append(
            matrix_error(
                "PCM_DECISION_CONSEQUENCE_MISMATCH",
                "matrix decision stage9_consequence must match selected host "
                f"stage9_consequence: {host_consequence}",
            )
        )


CAPABILITY_DIMENSIONS = [
    "agent_cli_install_distribution",
    "cli_bundling_bootstrap",
    "filesystem_access",
    "cli_invocation",
    "cli_report_rendering",
    "annotation_apis",
    "background_runs",
    "repair_action_ui",
    "trace_deep_links",
]

REQUIRED_LIMITED_ADAPTER_CAPABILITIES = [
    "agent_cli_install_distribution",
    "cli_bundling_bootstrap",
    "filesystem_access",
    "cli_invocation",
    "cli_report_rendering",
]

FALLBACK_RANKS = {
    "supported": 0,
    "cli-redirect": 1,
    "advisory-only": 2,
    "disable": 3,
    "hide": 3,
    "hard-error": 4,
}


def adapter_error(code: str, message: str) -> str:
    return f"[{code}] {message}"


def validate_adapter_scope_against_matrix(document: Any, matrix: Any) -> list[str]:
    if not isinstance(document, dict):
        return [adapter_error("ASM_SCOPE_TYPE", "adapter scope must be an object")]
    if not isinstance(matrix, dict):
        return [adapter_error("ASM_MATRIX_TYPE", "plugin capability matrix must be an object")]

    errors: list[str] = []
    selected_host_id = document.get("selected_host_id")
    decision = matrix.get("decision") if isinstance(matrix.get("decision"), dict) else None
    matrix_selected_host_id = decision.get("selected_host_id") if decision is not None else None
    if not isinstance(selected_host_id, str):
        errors.append(adapter_error("ASM_SELECTED_HOST_MISSING", "adapter scope is missing selected_host_id"))
    if not isinstance(matrix_selected_host_id, str):
        errors.append(
            adapter_error(
                "ASM_MATRIX_DECISION_UNSUPPORTED",
                "Stage 9 adapter validation requires a matrix decision with a selected host",
            )
        )
    elif isinstance(selected_host_id, str) and selected_host_id != matrix_selected_host_id:
        errors.append(
            adapter_error(
                "ASM_SELECTED_HOST_MISMATCH",
                f"adapter selected_host_id {selected_host_id} must match matrix decision {matrix_selected_host_id}",
            )
        )

    selected_host = find_adapter_matrix_host(matrix, selected_host_id) if isinstance(selected_host_id, str) else None
    if isinstance(selected_host_id, str) and selected_host is None:
        errors.append(
            adapter_error(
                "ASM_SELECTED_HOST_UNKNOWN",
                f"adapter selected_host_id {selected_host_id} is not present in matrix hosts",
            )
        )
    if selected_host is not None:
        validate_adapter_selected_host_fields(document, selected_host, decision, selected_host_id, errors)
        validate_adapter_cli_management(document, selected_host, selected_host_id, errors)
        validate_adapter_capabilities(document, matrix, selected_host, selected_host_id, errors)
        validate_adapter_write_classes(document, selected_host, selected_host_id, errors)
    validate_adapter_local_state(document, errors)
    return errors


def find_adapter_matrix_host(matrix: dict[str, Any], host_id: str) -> dict[str, Any] | None:
    for host in matrix.get("hosts", []):
        if not isinstance(host, dict):
            continue
        host_info = host.get("host")
        if isinstance(host_info, dict) and host_info.get("id") == host_id:
            return host
    return None


def validate_adapter_selected_host_fields(
    scope: dict[str, Any],
    host: dict[str, Any],
    decision: dict[str, Any] | None,
    host_id: str,
    errors: list[str],
) -> None:
    if decision is not None and decision.get("selected_tier") != "limited-adapter":
        errors.append(
            adapter_error(
                "ASM_MATRIX_TIER_UNSUPPORTED",
                "Stage 9 adapter validation currently requires a limited-adapter matrix decision",
            )
        )
    for scope_field, host_field in [
        ("capability_tier", "tier"),
        ("stage9_consequence", "stage9_consequence"),
        ("surface_kind", "surface_kind"),
        ("distribution_surface", "distribution_surface"),
    ]:
        scope_value = scope.get(scope_field)
        host_value = host.get(host_field)
        if isinstance(scope_value, str) and isinstance(host_value, str) and scope_value != host_value:
            errors.append(
                adapter_error(
                    "ASM_SELECTED_HOST_FIELD_MISMATCH",
                    f"{scope_field} {scope_value} must match {host_id}.{host_field} {host_value}",
                )
            )
    if host.get("candidate_status") != "in-scope-candidate":
        errors.append(adapter_error("ASM_HOST_OUT_OF_SCOPE", f"{host_id} is not an in-scope Stage 9 candidate"))
    if host.get("tier") != "limited-adapter":
        errors.append(
            adapter_error(
                "ASM_HOST_TIER_UNSUPPORTED",
                f"{host_id} must be selected at limited-adapter tier for this Stage 9 adapter scope",
            )
        )


def validate_adapter_cli_management(
    scope: dict[str, Any],
    host: dict[str, Any],
    host_id: str,
    errors: list[str],
) -> None:
    scope_modes = {mode for mode in scope.get("cli_management_modes", []) if isinstance(mode, str)}
    host_modes = {mode for mode in host.get("cli_management_modes", []) if isinstance(mode, str)}
    for field in ["cli_management_modes", "cli_resolution_order"]:
        for mode in scope.get(field, []):
            if isinstance(mode, str) and mode not in host_modes:
                errors.append(
                    adapter_error(
                        "ASM_CLI_MODE_UNSUPPORTED",
                        f"{field} includes {mode}, which is not proven for {host_id}",
                    )
                )
            if field == "cli_resolution_order" and isinstance(mode, str) and mode not in scope_modes:
                errors.append(
                    adapter_error(
                        "ASM_RESOLUTION_ORDER_UNMAPPED",
                        f"cli_resolution_order includes {mode}, which is not declared in cli_management_modes",
                    )
                )
    cli_compatibility = scope.get("cli_compatibility")
    host_cli = cli_compatibility.get("host_cli") if isinstance(cli_compatibility, dict) else None
    host_cli_id = host_cli.get("host_id") if isinstance(host_cli, dict) else None
    if isinstance(host_cli_id, str) and host_cli_id != host_id:
        errors.append(
            adapter_error(
                "ASM_HOST_CLI_MISMATCH",
                f"cli_compatibility.host_cli.host_id {host_cli_id} must match selected host {host_id}",
            )
        )


def validate_adapter_capabilities(
    scope: dict[str, Any],
    matrix: dict[str, Any],
    host: dict[str, Any],
    host_id: str,
    errors: list[str],
) -> None:
    matrix_dimensions = {dimension for dimension in matrix.get("capability_dimensions", []) if isinstance(dimension, str)}
    for dimension in CAPABILITY_DIMENSIONS:
        if dimension not in matrix_dimensions:
            errors.append(adapter_error("ASM_MATRIX_DIMENSION_MISSING", f"matrix is missing {dimension}"))

    host_evidence_ids = collect_adapter_host_evidence_ids(host)
    host_capabilities = host.get("capabilities") if isinstance(host.get("capabilities"), dict) else None
    coverage: dict[str, str] = {}
    validate_adapter_capability_entries(
        scope,
        "implemented_capabilities",
        "implemented",
        host_capabilities,
        host_evidence_ids,
        coverage,
        host_id,
        errors,
    )
    validate_adapter_capability_entries(
        scope,
        "unavailable_capabilities",
        "unavailable",
        host_capabilities,
        host_evidence_ids,
        coverage,
        host_id,
        errors,
    )

    for dimension in CAPABILITY_DIMENSIONS:
        if dimension not in coverage:
            errors.append(
                adapter_error(
                    "ASM_CAPABILITY_COVERAGE",
                    f"adapter scope must classify {dimension} as implemented or unavailable",
                )
            )
    for dimension in REQUIRED_LIMITED_ADAPTER_CAPABILITIES:
        if coverage.get(dimension) != "implemented":
            errors.append(
                adapter_error(
                    "ASM_REQUIRED_CAPABILITY_UNAVAILABLE",
                    f"limited adapter scope requires implemented capability {dimension}",
                )
            )


def validate_adapter_capability_entries(
    scope: dict[str, Any],
    field: str,
    classification: str,
    host_capabilities: dict[str, Any] | None,
    host_evidence_ids: set[str],
    coverage: dict[str, str],
    host_id: str,
    errors: list[str],
) -> None:
    for index, entry in enumerate(scope.get(field, [])):
        if not isinstance(entry, dict):
            continue
        capability = entry.get("capability")
        if not isinstance(capability, str):
            continue
        if capability in coverage:
            errors.append(adapter_error("ASM_CAPABILITY_DUPLICATE", f"{capability} is declared more than once"))
        coverage[capability] = classification
        matrix_capability = host_capabilities.get(capability) if host_capabilities is not None else None
        if not isinstance(matrix_capability, dict):
            errors.append(
                adapter_error(
                    "ASM_CAPABILITY_UNKNOWN",
                    f"{field}[{index}] references capability {capability}, which is not present for {host_id}",
                )
            )
            continue
        if (
            classification == "implemented"
            and (
                matrix_capability.get("status") != "yes"
                or matrix_capability.get("fallback") != "supported"
            )
        ):
            errors.append(
                adapter_error(
                    "ASM_CAPABILITY_OVERCLAIM",
                    f"{capability} cannot be implemented because {host_id} matrix status is "
                    f"{matrix_capability.get('status')} with {matrix_capability.get('fallback')} fallback",
                )
            )
        validate_adapter_fallback_conservatism(
            entry.get("fallback"),
            matrix_capability.get("fallback"),
            capability,
            errors,
        )
        validate_adapter_capability_evidence(entry, matrix_capability, host_evidence_ids, capability, errors)


def collect_adapter_host_evidence_ids(host: dict[str, Any]) -> set[str]:
    ids: set[str] = set()
    for evidence in host.get("evidence", []):
        if isinstance(evidence, dict) and isinstance(evidence.get("evidence_id"), str):
            ids.add(evidence["evidence_id"])
    return ids


def validate_adapter_fallback_conservatism(
    adapter_fallback: Any,
    matrix_fallback: Any,
    capability: str,
    errors: list[str],
) -> None:
    adapter_rank = FALLBACK_RANKS.get(adapter_fallback)
    matrix_rank = FALLBACK_RANKS.get(matrix_fallback)
    if adapter_rank is not None and matrix_rank is not None and adapter_rank < matrix_rank:
        errors.append(
            adapter_error(
                "ASM_FALLBACK_OVERCLAIM",
                f"{capability} fallback {adapter_fallback} is less conservative than matrix fallback {matrix_fallback}",
            )
        )


def validate_adapter_capability_evidence(
    entry: dict[str, Any],
    matrix_capability: dict[str, Any],
    host_evidence_ids: set[str],
    capability: str,
    errors: list[str],
) -> None:
    capability_evidence_ids = {
        evidence_id for evidence_id in matrix_capability.get("evidence_ids", []) if isinstance(evidence_id, str)
    }
    for evidence_id in entry.get("evidence_ids", []):
        if not isinstance(evidence_id, str):
            continue
        if evidence_id not in host_evidence_ids:
            errors.append(
                adapter_error(
                    "ASM_EVIDENCE_DANGLING",
                    f"{capability} references missing selected-host evidence_id {evidence_id}",
                )
            )
        elif evidence_id not in capability_evidence_ids:
            errors.append(
                adapter_error(
                    "ASM_EVIDENCE_NOT_CAPABILITY",
                    f"{capability} references evidence_id {evidence_id} outside the matrix capability evidence",
                )
            )


def validate_adapter_write_classes(
    scope: dict[str, Any],
    host: dict[str, Any],
    host_id: str,
    errors: list[str],
) -> None:
    host_capabilities = host.get("capabilities") if isinstance(host.get("capabilities"), dict) else None
    repair_capability = host_capabilities.get("repair_action_ui") if host_capabilities is not None else None
    preview_backed_proven = (
        isinstance(repair_capability, dict)
        and repair_capability.get("status") == "yes"
        and repair_capability.get("fallback") == "supported"
    )
    write_classes = scope.get("write_classes")
    if not isinstance(write_classes, dict):
        return
    for write_class in ["init", "migrate", "repair"]:
        config = write_classes.get(write_class)
        if (
            isinstance(config, dict)
            and config.get("mode") == "preview-backed"
            and not preview_backed_proven
        ):
            errors.append(
                adapter_error(
                    "ASM_WRITE_MODE_OVERCLAIM",
                    f"{write_class} cannot be preview-backed because {host_id}.repair_action_ui is not fully supported",
                )
            )


def validate_adapter_local_state(scope: dict[str, Any], errors: list[str]) -> None:
    local_state = scope.get("local_state")
    if isinstance(local_state, dict) and local_state.get("authoritative") is True:
        errors.append(
            adapter_error(
                "ASM_LOCAL_STATE_AUTHORITATIVE",
                "adapter-local state must be non-authoritative and reconstructible",
            )
        )


def main() -> None:
    schemas, registry = load_schemas()
    manifest = json.loads((ROOT / "examples/fixtures/manifest.json").read_text())
    validate_valid_fixtures(manifest, schemas, registry)
    validate_referenced_evidence(manifest)
    validate_invalid_fixtures(manifest, schemas, registry)
    validate_custom_checks(manifest)
    print(
        "schema validation ok: "
        f"{len(schemas)} schemas, "
        f"{len(manifest['valid'])} valid fixtures, "
        f"{len(manifest.get('referenced_evidence', []))} referenced evidence artifacts, "
        f"{len(manifest['invalid'])} schema-invalid fixtures, "
        f"{len(manifest.get('custom_invalid', []))} custom-invalid fixtures"
    )


if __name__ == "__main__":
    main()
