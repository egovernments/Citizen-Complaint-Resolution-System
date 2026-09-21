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
  | 'reference-select' // dropdown fed from another resource (see FieldSpec.reference)
  | 'text'        // default; plain string input
  | 'textarea'    // multi-line string
  | 'integer'     // number input, step 1
  | 'number'      // number input, any
  | 'boolean'    // checkbox
  | 'color'      // hex input + swatch preview
  | 'regex'      // pattern field + live sample tester
  | 'chip-array' // string[] editor (add on Enter, remove on x)
  | 'duration-ms' // number input alongside d/h/m/s display
  | 'locale-list' // table editor for {label, value}[] arrays (e.g. StateInfo.languages)
  | 'json'        // raw-JSON textarea for object/array fields (parse-validated; blocks save while invalid)
  | 'channel-gateway'; // novu / a direct gateway, offered only for the channels that gateway carries

/**
 * How a field's LIST cell renders, when the generic one would be wrong.
 *
 * The generic list builds its columns from the JSON Schema alone, which gets two
 * things wrong on the notification masters. Arrays typed `["array","null"]` are
 * not recognised as complex, so they print `JSON.stringify(...)` — the event
 * catalogue's `placeholders` is ~1,700 characters, which made every row ~857px
 * tall. And an `enum` field is auto-made inline-editable, which puts a live
 * <select> in every cell of the column: the Channels list offered `smscountry`
 * on EMAIL and WHATSAPP rows, one click from writing a gateway that cannot
 * carry them.
 *
 * Like `customEditor`, these are STRING KEYS rather than component references,
 * so descriptors stay serializable data with no React import.
 *
 *  - `badges`            string[] as small chips.
 *  - `named-badges`      [{name, …}][] as chips of `name`.
 *  - `token-summary`     [{name, …}][] as "12 · {a} {b} {c} …", full list on hover.
 *  - `plain`             the value as read-only text — never an inline editor.
 */
export type ListWidgetKind = 'badges' | 'named-badges' | 'token-summary' | 'plain';

/** A single field override. `path` is dot-notation into the record (e.g. "rules.pattern"). */
export interface FieldSpec {
  path: string;
  label?: string;
  help?: string;
  widget?: WidgetKind;
  /** How this field's cell renders on the generic LIST page. Omit for the default. */
  listWidget?: ListWidgetKind;
  required?: boolean;
  /** Hide this field in create / edit / always. */
  hidden?: 'create' | 'edit' | 'always';
  /** For integer/number widgets. */
  min?: number;
  max?: number;
  /** For text/regex widgets — a static pattern to also enforce client-side. */
  pattern?: string;
  /** For `reference-select`: the resource whose records become the choices
   *  (e.g. 'notifications-event-catalogue'). */
  reference?: string;
  /** For `reference-select`: the referenced record's field to submit (default 'code'). */
  optionValue?: string;
  /** For `reference-select`: the referenced record's field to show (default 'name'). */
  optionText?: string;
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
  /** A short note rendered at the TOP of this schema's create and edit forms.
   *  For the raw notification masters it is the pointer to the guided screen —
   *  written here so it is actually on the page, not only in a code comment
   *  above the descriptor where no operator will ever meet it. */
  notice?: string;
  groups?: FieldGroup[];
  fields: FieldSpec[];
  /** Opt into a dedicated custom editor (registered in src/admin/themeEditor/
   *  or similar). When set, MdmsResourceEdit skips the generic form entirely
   *  and mounts the registered component instead. String key (not a component
   *  reference) keeps descriptors serializable and avoids circular imports. */
  customEditor?: string;
}
