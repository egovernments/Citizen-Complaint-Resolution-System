/**
 * The subset of JSON Schema (draft-07) that digit-ui's theme schema.json
 * uses: type, enum, pattern, required, properties, additionalProperties
 * (boolean), items, minItems, maxItems. digit-ui validates ThemeConfig with
 * Ajv before applying it; evaluating the same schema here keeps "which records
 * are rejected" identical without shipping Ajv in the login bundle. Any
 * keyword this evaluator does not know is ignored, as Ajv does with
 * `strict: false`.
 */
type Schema = {
    type?: string;
    enum?: unknown[];
    pattern?: string;
    required?: string[];
    properties?: Record<string, Schema>;
    additionalProperties?: boolean | Schema;
    items?: Schema;
    minItems?: number;
    maxItems?: number;
};

function typeMatches(type: string, value: unknown): boolean {
    switch (type) {
        case "object":
            return typeof value === "object" && value !== null && !Array.isArray(value);
        case "array":
            return Array.isArray(value);
        case "string":
            return typeof value === "string";
        case "number":
            return typeof value === "number";
        case "boolean":
            return typeof value === "boolean";
        default:
            return true;
    }
}

export function validateAgainstSchema(schema: Schema, value: unknown): boolean {
    if (schema.type !== undefined && !typeMatches(schema.type, value)) return false;
    if (schema.enum !== undefined && !schema.enum.includes(value)) return false;
    if (schema.pattern !== undefined && typeof value === "string" && !new RegExp(schema.pattern).test(value)) {
        return false;
    }
    if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) return false;
        if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
        if (schema.items !== undefined && !value.every(item => validateAgainstSchema(schema.items!, item))) {
            return false;
        }
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        for (const key of schema.required ?? []) {
            if (!(key in record)) return false;
        }
        for (const [key, child] of Object.entries(record)) {
            const childSchema = schema.properties?.[key];
            if (childSchema !== undefined) {
                if (!validateAgainstSchema(childSchema, child)) return false;
            } else if (schema.additionalProperties === false) {
                return false;
            } else if (typeof schema.additionalProperties === "object") {
                if (!validateAgainstSchema(schema.additionalProperties, child)) return false;
            }
        }
    }
    return true;
}
