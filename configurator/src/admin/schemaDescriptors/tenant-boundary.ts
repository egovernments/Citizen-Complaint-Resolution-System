import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `egov-location.TenantBoundary` — the legacy v1 boundary tree
 * consumed by HRMS's jurisdiction picker (hierarchyType: ADMIN, etc.).
 *
 * The `boundary` tree field is intentionally not exposed — editing it requires
 * a dedicated TreeEditor widget (deferred to Stage 3). The generic form's
 * fallback already skips unknown object fields, which is the correct behavior
 * here: we never want a text-dump of a deeply-nested County → SubCounty → Ward
 * tree in a plain input. Only the flat scalars on `hierarchyType` are editable
 * via this descriptor; the `boundary` subtree round-trips untouched.
 */
export const tenantBoundaryDescriptor: SchemaDescriptor = {
  schema: 'egov-location.TenantBoundary',
  groups: [
    { title: 'Identity', fields: ['hierarchyType.code', 'hierarchyType.name'] },
  ],
  fields: [
    { path: 'hierarchyType.code', widget: 'text', required: true,
      label: 'Hierarchy code',
      help: 'Unique identifier for the hierarchy (e.g. "ADMIN"). Used as the record\'s idField.' },
    { path: 'hierarchyType.name', widget: 'text', required: true,
      label: 'Hierarchy name',
      help: 'Human-readable label for the hierarchy. Typically matches the code.' },
  ],
};
