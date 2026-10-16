import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `CRS-ADMIN-CONSOLE.adminSchema` - the column definitions of the
 * admin-console data templates (e.g. CRS_BOUNDARY_DATA: boundary code, latitude,
 * longitude). `properties` is an object of {stringProperties, numberProperties}
 * arrays: without this descriptor the generic form skips it. `title` is the
 * x-unique key, hidden on edit.
 */
export const adminConsoleSchemaDescriptor: SchemaDescriptor = {
  schema: 'CRS-ADMIN-CONSOLE.adminSchema',
  groups: [
    { title: 'Identity', fields: ['title', 'campaignType'] },
    { title: 'Columns', fields: ['properties'] },
  ],
  fields: [
    { path: 'title', label: 'Template', required: true, hidden: 'edit',
      help: 'Template key, e.g. CRS_BOUNDARY_DATA. Cannot be changed after create.' },
    { path: 'campaignType', label: 'Campaign type', required: true },
    { path: 'properties', label: 'Columns', widget: 'json',
      help: '{"stringProperties": [...], "numberProperties": [...]}: each column {name, type, isRequired, description, orderNumber}.' },
  ],
};
