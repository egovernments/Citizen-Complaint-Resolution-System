/**
 * JSON Schema → Commander.js option mapper.
 *
 * Converts a tool's inputSchema properties into Commander options,
 * handling type coercion, required/optional, enums, arrays, and nested objects.
 */
import { Command, Option } from 'commander';

interface SchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: SchemaProperty;
}

interface InputSchema {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

/** Convert snake_case to --kebab-case flag */
export function toFlag(name: string): string {
  return '--' + name.replace(/_/g, '-');
}

/** Convert --kebab-case flag back to snake_case arg key */
export function toArgKey(flag: string): string {
  return flag.replace(/^--/, '').replace(/-/g, '_');
}

/** Commander stores parsed options in camelCase keys. Convert kebab to camel. */
function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Parse a Commander opts object back to the snake_case args the tool handler expects.
 * Commander converts --tenant-id to opts.tenantId. We need args.tenant_id.
 */
export function optsToArgs(
  opts: Record<string, unknown>,
  schema: InputSchema,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const props = schema.properties || {};

  for (const propName of Object.keys(props)) {
    const camelKey = kebabToCamel(propName.replace(/_/g, '-'));
    if (camelKey in opts && opts[camelKey] !== undefined) {
      args[propName] = opts[camelKey];
    }
  }
  return args;
}

/**
 * Build a coercion function for a given JSON Schema property.
 * Returns undefined if no coercion needed (plain string).
 */
function coercionFor(prop: SchemaProperty): ((v: string) => unknown) | undefined {
  if (prop.type === 'number' || prop.type === 'integer') {
    return (v: string) => {
      const n = Number(v);
      if (Number.isNaN(n)) throw new Error(`Expected a number, got "${v}"`);
      return n;
    };
  }
  if (prop.type === 'boolean') {
    return (v: string) => v === 'true' || v === '1';
  }
  if (prop.type === 'object') {
    return (v: string) => {
      try {
        return JSON.parse(v);
      } catch {
        throw new Error(`Expected JSON object, got "${v}"`);
      }
    };
  }
  if (prop.type === 'array') {
    // If items are objects, expect JSON. If items are strings, commander variadic handles it.
    if (prop.items?.type === 'object') {
      return (v: string) => {
        try {
          return JSON.parse(v);
        } catch {
          throw new Error(`Expected JSON array, got "${v}"`);
        }
      };
    }
    // String arrays: accumulate via variadic
    return undefined;
  }
  return undefined;
}

/**
 * Add Commander options to a Command based on a tool's inputSchema.
 * Returns the list of property names that were mapped (for optsToArgs).
 */
export function addSchemaOptions(cmd: Command, schema: InputSchema): void {
  const props = schema.properties || {};
  const required = new Set(schema.required || []);

  for (const [name, prop] of Object.entries(props)) {
    const flag = toFlag(name);
    const desc = prop.description || '';
    const isRequired = required.has(name);
    const coerce = coercionFor(prop);

    // Boolean flags: no value argument
    if (prop.type === 'boolean') {
      const opt = new Option(flag, desc);
      if (prop.default !== undefined) opt.default(prop.default);
      cmd.addOption(opt);
      continue;
    }

    // Arrays of strings: variadic
    if (prop.type === 'array' && (!prop.items?.type || prop.items.type === 'string')) {
      const valueName = name.replace(/_/g, '-');
      const bracket = isRequired ? `<${valueName}...>` : `[${valueName}...]`;
      const opt = new Option(`${flag} ${bracket}`, desc);
      if (isRequired) opt.makeOptionMandatory();
      cmd.addOption(opt);
      continue;
    }

    // All other types: single value
    const valueName = name.replace(/_/g, '-');
    const bracket = isRequired ? `<${valueName}>` : `[${valueName}]`;
    const opt = new Option(`${flag} ${bracket}`, desc);
    if (isRequired) opt.makeOptionMandatory();
    if (coerce) opt.argParser(coerce as (value: string, previous: unknown) => unknown);
    if (prop.enum) opt.choices(prop.enum);
    if (prop.default !== undefined) opt.default(prop.default);
    cmd.addOption(opt);
  }
}
