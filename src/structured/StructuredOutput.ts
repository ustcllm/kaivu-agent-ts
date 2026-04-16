export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  description?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
}

export interface StructuredSchema {
  name: string;
  description: string;
  schema: JsonSchema;
}

export function schemaInstruction(schema: StructuredSchema): string {
  return [
    "Return valid JSON only. Do not wrap it in markdown fences.",
    `Schema name: ${schema.name}`,
    `Schema description: ${schema.description}`,
    "JSON schema:",
    JSON.stringify(schema.schema, null, 2),
  ].join("\n");
}

export function repairInstruction(schema: StructuredSchema, rawText: string, errorMessage: string): string {
  return [
    "The previous answer did not satisfy the required JSON schema.",
    "Rewrite it as valid JSON only. Do not add commentary, markdown fences, or explanations.",
    `Validation error: ${errorMessage}`,
    "",
    "Original answer:",
    rawText,
    "",
    "Required schema:",
    JSON.stringify(schema.schema, null, 2),
  ].join("\n");
}

export function parseStructuredOutput(text: string, schema: StructuredSchema): Record<string, unknown> {
  const candidate = extractJsonObject(text);
  const data = JSON.parse(candidate) as unknown;
  validateSchema(data, schema.schema, "$");
  return data as Record<string, unknown>;
}

export function salvageStructuredOutput(text: string, schema: StructuredSchema): Record<string, unknown> {
  const candidate = extractJsonObject(text);
  const data = JSON.parse(candidate) as unknown;
  const repaired = coerceToSchema(data, schema.schema);
  validateSchema(repaired, schema.schema, "$");
  return repaired as Record<string, unknown>;
}

function extractJsonObject(text: string): string {
  let stripped = text.trim();
  if (stripped.startsWith("```")) {
    const lines = stripped.split(/\r?\n/);
    if (lines.length >= 3) {
      stripped = lines.slice(1, -1).join("\n").trim();
    }
  }
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model output");
  }
  return stripped.slice(start, end + 1);
}

function validateSchema(value: unknown, schema: JsonSchema, path: string): void {
  const expected = schema.type;
  if (expected === "object") {
    if (!isRecord(value)) throw new Error(`${path} must be an object`);
    for (const key of schema.required ?? []) {
      if (!(key in value)) throw new Error(`${path}.${key} is required`);
    }
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties?.[key];
      if (child) validateSchema(item, child, `${path}.${key}`);
    }
    return;
  }
  if (expected === "array") {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    if (schema.items) {
      value.forEach((item, index) => validateSchema(item, schema.items!, `${path}[${index}]`));
    }
    return;
  }
  if (expected === "string" && typeof value !== "string") throw new Error(`${path} must be a string`);
  if (expected === "number" && (typeof value !== "number" || Number.isNaN(value))) throw new Error(`${path} must be a number`);
  if (expected === "integer" && (!Number.isInteger(value) || typeof value !== "number")) throw new Error(`${path} must be an integer`);
  if (expected === "boolean" && typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
}

function coerceToSchema(value: unknown, schema: JsonSchema): unknown {
  const expected = schema.type;
  if (expected === "object") {
    const source = isRecord(value) ? value : {};
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      output[key] = key in source ? coerceToSchema(source[key], child) : defaultForSchema(child);
    }
    return output;
  }
  if (expected === "array") {
    if (!Array.isArray(value)) return [];
    return value.map((item) => coerceToSchema(item, schema.items ?? {}));
  }
  if (expected === "string") return value === undefined || value === null ? "" : String(value);
  if (expected === "number") {
    if (typeof value === "number" && !Number.isNaN(value)) return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (expected === "integer") {
    if (Number.isInteger(value)) return value;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (expected === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return ["true", "1", "yes"].includes(value.trim().toLowerCase());
    return Boolean(value);
  }
  return value;
}

function defaultForSchema(schema: JsonSchema): unknown {
  if (schema.type === "object") return coerceToSchema({}, schema);
  if (schema.type === "array") return [];
  if (schema.type === "string") return "";
  if (schema.type === "number") return 0;
  if (schema.type === "integer") return 0;
  if (schema.type === "boolean") return false;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
