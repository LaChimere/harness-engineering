export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getString(object: JsonObject, key: string): string | undefined {
  const value = object[key];
  return typeof value === 'string' ? value : undefined;
}

export function getObject(object: JsonObject, key: string): JsonObject | undefined {
  const value = object[key];
  return isObject(value) ? value : undefined;
}

export function getArray(object: JsonObject, key: string): JsonValue[] | undefined {
  const value = object[key];
  return Array.isArray(value) ? value : undefined;
}

export function getValue(object: JsonObject, key: string): JsonValue | undefined {
  return object[key];
}

export function objectEntries(object: JsonObject): Array<[string, JsonValue]> {
  return Object.entries(object);
}
