import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import Ajv2020, { type AnySchema, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { CliError } from './errors.ts';
import { ExitCode } from './exit-codes.ts';
import { loadDocument } from './files.ts';
import type { JsonObject, JsonValue } from './json.ts';
import { getString, isObject } from './json.ts';

export interface IValidationIssue {
  readonly path: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: JsonObject;
}

export interface ISchemaRegistry {
  readonly schemaVersion: string;
  readonly schemaNames: ReadonlySet<string>;
  validate(schemaName: string, document: JsonValue): readonly IValidationIssue[];
}

interface ILoadedSchema {
  readonly name: string;
  readonly id: string;
  readonly document: AnySchema;
}

export async function loadSchemaRegistry(packageRoot: string): Promise<ISchemaRegistry> {
  const schemasDirectory = join(packageRoot, 'schemas');
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    strictSchema: true,
  });
  addFormats(ajv);
  ajv.addKeyword('x-stability');

  const loadedSchemas: ILoadedSchema[] = [];
  const schemaFiles = (await readdir(schemasDirectory))
    .filter((file) => file.endsWith('.schema.json'))
    .sort();

  for (const file of schemaFiles) {
    const schemaPath = join(schemasDirectory, file);
    const document = await loadDocument(schemaPath);
    if (!isObject(document)) {
      throw new CliError(`Schema ${file} must contain a JSON object.`, ExitCode.internalError);
    }
    const id = getString(document, '$id');
    if (id === undefined) {
      throw new CliError(`Schema ${file} is missing $id.`, ExitCode.internalError);
    }
    loadedSchemas.push({
      name: basename(file, '.schema.json'),
      id,
      document: document as AnySchema,
    });
  }

  for (const schema of loadedSchemas) {
    ajv.addSchema(schema.document);
  }

  for (const schema of loadedSchemas) {
    const validator = ajv.getSchema(schema.id);
    if (validator === undefined) {
      throw new CliError(
        `Schema ${schema.name} did not register with AJV.`,
        ExitCode.internalError,
      );
    }
  }

  const schemaVersion = inferSchemaVersion(loadedSchemas);
  const validators = new Map<string, ValidateFunction<JsonValue>>();
  for (const schema of loadedSchemas) {
    const validator = ajv.getSchema<JsonValue>(schema.id);
    if (validator === undefined) {
      throw new CliError(`Schema ${schema.name} did not compile with AJV.`, ExitCode.internalError);
    }
    validators.set(schema.name, validator);
  }

  return {
    schemaVersion,
    schemaNames: new Set(validators.keys()),
    validate(schemaName: string, document: JsonValue): readonly IValidationIssue[] {
      const validator = validators.get(schemaName);
      if (validator === undefined) {
        throw new CliError(`No loaded schema named ${schemaName}.`, ExitCode.internalError);
      }
      const valid = validator(document);
      if (valid) {
        return [];
      }
      return (validator.errors ?? []).map(formatAjvError);
    },
  };
}

export function formatValidationIssue(issue: IValidationIssue): string {
  const path = issue.path.length === 0 ? '<root>' : issue.path;
  return `${path} ${issue.keyword}: ${issue.message}`;
}

function formatAjvError(error: ErrorObject): IValidationIssue {
  return {
    path: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? 'failed validation',
    params: jsonObjectFromAjvParams(error.params),
  };
}

function jsonObjectFromAjvParams(params: ErrorObject['params']): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(params)) {
    result[key] = jsonValueFromUnknown(value);
  }
  return result;
}

function jsonValueFromUnknown(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(jsonValueFromUnknown);
  }
  if (isObject(value)) {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = jsonValueFromUnknown(item);
    }
    return result;
  }
  throw new CliError('AJV validation issue params were not JSON values.', ExitCode.internalError);
}

function inferSchemaVersion(schemas: readonly ILoadedSchema[]): string {
  const harnessSchema = schemas.find((schema) => schema.name === 'harness');
  if (harnessSchema === undefined) {
    throw new CliError('Harness schema is missing from schemas/.', ExitCode.internalError);
  }
  const match = /\/schemas\/(\d+\.\d+)\//.exec(harnessSchema.id);
  if (match === null) {
    throw new CliError(
      'Harness schema $id does not include a schema family version.',
      ExitCode.internalError,
    );
  }
  return `${match[1]}.0`;
}
