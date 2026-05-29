import type { JsonObject } from './json.ts';

export type CliJsonStatus = string;
export type CliJsonIssueSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface ICliJsonContract {
  readonly ['schema_version']: string;
  // Optional until command-specific migrations add top-level status everywhere.
  readonly status?: CliJsonStatus;
  readonly ['run_id']?: string;
  readonly ['harness_version']?: string;
  readonly ['generated_at']?: string;
  readonly issues?: readonly ICliJsonIssue[];
}

export interface ICliJsonIssue {
  readonly code: string;
  readonly severity?: CliJsonIssueSeverity;
  readonly message: string;
  readonly path?: readonly (string | number)[];
  readonly details?: JsonObject;
  readonly evidence?: readonly ICliJsonArtifact[];
}

export interface ICliJsonArtifact {
  readonly path: string;
  readonly ['media_type']?: string;
  readonly description?: string;
}
