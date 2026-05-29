import type { JsonObject } from './json.ts';

export type CliJsonStatus = string;
export type CliJsonIssueSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface ICliJsonContract {
  readonly ['schema_version']: string;
  readonly status: CliJsonStatus;
  readonly issues?: ICliJsonIssue[];
}

export interface ICliJsonIssue {
  readonly code: string;
  readonly severity?: CliJsonIssueSeverity;
  readonly message: string;
  readonly path?: (string | number)[];
  readonly details?: JsonObject;
  readonly evidence?: ICliJsonArtifact[];
}

export interface ICliJsonArtifact {
  readonly path: string;
  readonly ['media_type']?: string;
  readonly description?: string;
}

export interface IDoctorJsonContract extends ICliJsonContract {
  readonly status: 'passed' | 'failed' | 'warning';
  readonly ['run_id']: string;
  readonly ['harness_version']: string;
  readonly ['generated_at']: string;
  readonly checks: JsonObject[];
}

export interface IHealthJsonContract extends ICliJsonContract {
  readonly status: 'passed' | 'failed' | 'error';
  readonly ['run_id']: string;
  readonly ['harness_version']: string;
  readonly ['generated_at']: string;
  readonly ['sandbox_enforcement']: 'declarative';
  readonly ['runtime_enforced']: false;
  readonly source: JsonObject;
  readonly checks: JsonObject[];
}

export interface IAssessmentJsonContract extends ICliJsonContract {
  readonly status: 'ready' | 'needs-work' | 'missing-harness';
  readonly ['x-stability']: 'provisional';
  readonly ['assessment_id']: string;
  readonly ['harness_version']: string;
  readonly ['generated_at']: string;
  readonly ['adapter_path']: JsonObject;
  readonly source: JsonObject;
  readonly maturity: JsonObject;
  readonly ['scorecard_version']: string;
  readonly scorecard: JsonObject[];
  readonly ['missing_primitives']: JsonObject[];
  readonly ['rollout_plan']: JsonObject[];
  readonly recommendations: JsonObject[];
  readonly ['implementation_routing']: JsonObject;
  readonly ['artifacts_read']: JsonObject[];
}

export interface IGcAuditJsonContract extends ICliJsonContract {
  readonly status: 'passed' | 'findings';
  readonly ['audit_id']: string;
  readonly ['generated_at']: string;
  readonly ['harness_version']: string;
  readonly findings: JsonObject[];
  readonly ['previous_audit_ref']?: string;
}

export interface ITraceValidateJsonContract extends ICliJsonContract {
  readonly status: 'passed' | 'failed';
  readonly traces: JsonObject[];
}

export interface IProfileRunJsonContract extends ICliJsonContract {
  readonly status: 'met' | 'not_met' | 'inconclusive';
  readonly ['run_id']: string;
  readonly ['harness_version']: string;
  readonly ['generated_at']: string;
  readonly ['profile_ref']: JsonObject;
  readonly ['profile_id']: string;
  readonly ['profile_version']: string;
  readonly ['declared_capability_id']: null;
  readonly ['previous_run_ref']?: JsonObject;
  readonly ['evidence_inputs']: JsonObject[];
  readonly ['trigger_evaluation']: JsonObject;
  readonly ['stop_condition_evaluation']: JsonObject;
  readonly ['actions_taken']: JsonObject[];
  readonly handoff: JsonObject;
}
