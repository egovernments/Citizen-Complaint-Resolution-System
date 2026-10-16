import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `dss.KpiDefinition` - one dashboard tile: what it queries and how it
 * is drawn (titles, format, accent, chart kind). The employee and public dashboards
 * render the published ones that a pack lists.
 *
 * `viz`, `query` and `params` are nested objects/arrays: without this descriptor the
 * generic form skips them, so only the status and version were editable. `id` is the
 * x-unique key (it matches the analytics engine's query key), hidden on edit.
 */
export const kpiDefinitionDescriptor: SchemaDescriptor = {
  schema: 'dss.KpiDefinition',
  groups: [
    { title: 'Identity', fields: ['id', 'version', 'status', 'public', 'requiredActionUrl'] },
    { title: 'Presentation', fields: ['viz'] },
    { title: 'Query', fields: ['query', 'params'] },
  ],
  fields: [
    { path: 'id', label: 'KPI id', required: true, hidden: 'edit',
      help: 'Stable snake_case key matching the analytics query key, e.g. cl_open_weekly. Cannot be changed after create.' },
    { path: 'version', label: 'Version', required: true },
    { path: 'status', label: 'Status', required: true,
      help: 'draft | published | archived. Only published KPIs are rendered.' },
    { path: 'public', label: 'Public', widget: 'boolean',
      help: 'On: also offered on the public (no sign-in) dashboard.' },
    { path: 'requiredActionUrl', label: 'Required action URL',
      help: 'The access-control action a caller must be granted to see this KPI. Empty: no restriction.' },
    { path: 'viz', label: 'Visualisation', widget: 'json', required: true,
      help: 'How the tile is drawn: kind, format, valueKey, accent, group, titleKey (and title, columns ... per kind).' },
    { path: 'query', label: 'Query', widget: 'json',
      help: 'The analytics query body; null for a tile composed from other KPIs.' },
    { path: 'params', label: 'Parameters', widget: 'json' },
  ],
};
