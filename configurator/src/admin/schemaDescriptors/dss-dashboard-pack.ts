import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `dss.DashboardPack` - which KPI tiles a dashboard shows and where
 * (the employee dashboard and the public dashboard read the packs; `public: true`
 * marks the credential-free public dashboard's default pack).
 *
 * `tiles` and `layout` are arrays: without this descriptor the generic form skips
 * them, so a pack could be listed but its content never changed. `id` is the
 * x-unique key, hidden on edit (changing it would retarget another pack).
 */
export const dashboardPackDescriptor: SchemaDescriptor = {
  schema: 'dss.DashboardPack',
  groups: [
    { title: 'Identity', fields: ['id', 'description', 'public', 'requiredActionUrl'] },
    { title: 'Tiles', fields: ['tiles', 'layout'] },
  ],
  fields: [
    { path: 'id', label: 'Pack id', required: true, hidden: 'edit',
      help: 'Permanent key of this pack (x-unique), e.g. "public-default". Cannot be changed after create.' },
    { path: 'description', label: 'Description', widget: 'textarea' },
    { path: 'public', label: 'Public default', widget: 'boolean',
      help: 'On: this pack is the public (no sign-in) dashboard\'s default. Off/absent: not a public pack.' },
    { path: 'requiredActionUrl', label: 'Required action URL',
      help: 'The access-control action a caller must be granted for this pack to apply to them. Empty: no restriction.' },
    { path: 'tiles', label: 'Tiles (KPI ids)', widget: 'chip-array', required: true, listWidget: 'badges',
      help: 'KPI definition ids in this pack, in reading order. Each must be a published KPI definition.' },
    { path: 'layout', label: 'Layout', widget: 'json', required: true,
      help: 'One {kpiId, x, y, w, h} per tile: grid position and size (x, y from 0; w, h at least 1).' },
  ],
};
