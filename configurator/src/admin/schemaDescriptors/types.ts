/**
 * Schema descriptor: per-schema config telling the generic Edit/Create form
 * how to render fields the JSON Schema alone can't express richly (e.g. colors,
 * regex testers, chip arrays, nested object paths).
 *
 * Without a descriptor, forms fall back to JSON-Schema-driven rendering and
 * silently skip object/array fields. Adding a descriptor is additive and
 * cannot break existing forms — missing fields just use defaults.
 */

export type WidgetKind =
  | 'text'        // default; plain string input
  | 'textarea'    // multi-line string
  | 'integer'     // number input, step 1
  | 'number'      // number input, any
  | 'boolean'    // checkbox
  | 'color'      // hex input + swatch preview
  | 'regex'      // pattern field + live sample tester
  | 'chip-array' // string[] editor (add on Enter, remove on x)
  | 'duration-ms' // number input alongside d/h/m/s display
  | 'locale-list'; // table editor for {label, value}[] arrays (e.g. StateInfo.languages)

/** A single field override. `path` is dot-notation into the record (e.g. "rules.pattern"). */
export interface FieldSpec {
  path: string;
  label?: string;
  help?: string;
  widget?: WidgetKind;
  required?: boolean;
  /** Hide this field in create / edit / always. */
  hidden?: 'create' | 'edit' | 'always';
  /** For integer/number widgets. */
  min?: number;
  max?: number;
  /** For text/regex widgets — a static pattern to also enforce client-side. */
  pattern?: string;
}

/** A grouping of fields shown as a titled section in the form. */
export interface FieldGroup {
  title: string;
  /** Field paths in render order. Paths not listed in any group fall into an
   *  unnamed "Other" section after all named groups. */
  fields: string[];
}

export interface SchemaDescriptor {
  schema: string;
  groups?: FieldGroup[];
  fields: FieldSpec[];
  /** Opt into a dedicated custom editor (registered in src/admin/themeEditor/
   *  or similar). When set, MdmsResourceEdit skips the generic form entirely
   *  and mounts the registered component instead. String key (not a component
   *  reference) keeps descriptors serializable and avoids circular imports. */
  customEditor?: string;
}
