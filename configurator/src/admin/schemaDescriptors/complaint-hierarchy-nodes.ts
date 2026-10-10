import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `RAINMAKER-PGR.ComplaintHierarchy` on the generic "Complaint Hierarchy Nodes" screen - every node of
 * the complaint tree, INTERIOR ones included (complaint types / groups: the citizen picker's first levels). The
 * dedicated Complaint Categories screen lists only the fileable leaves; this is where a type is created, renamed,
 * re-ordered or switched off (root Active). `hierarchyType` + `code` are the x-unique key: hidden on edit.
 */
export const complaintHierarchyNodesDescriptor: SchemaDescriptor = {
  schema: 'RAINMAKER-PGR.ComplaintHierarchy',
  groups: [
    { title: 'Identity', fields: ['hierarchyType', 'code', 'levelCode', 'parentCode'] },
    { title: 'Shown as', fields: ['name', 'order', 'path', 'keywords'] },
    { title: 'Routing (leaves)', fields: ['department', 'departments', 'slaHours'] },
  ],
  fields: [
    { path: 'hierarchyType', label: 'Hierarchy', required: true, hidden: 'edit', help: 'The complaint hierarchy this node belongs to, e.g. PGR.' },
    { path: 'code', label: 'Code', required: true, hidden: 'edit', help: 'Permanent node code (a leaf\'s code is the serviceCode stored on complaints). Cannot be changed after create.' },
    { path: 'levelCode', label: 'Level', required: true, help: 'The hierarchy level of this node, e.g. CATEGORY or SUB_TYPE.' },
    { path: 'parentCode', label: 'Parent code', help: 'The node above this one; empty for a top-level node.' },
    { path: 'name', label: 'Name', required: true, help: 'The label the citizen and employee pickers show.' },
    { path: 'order', label: 'Display order', widget: 'integer', help: 'Position among its siblings in the pickers (ascending).' },
    { path: 'path', label: 'Path' },
    { path: 'keywords', label: 'Keywords' },
    { path: 'department', label: 'Department', help: 'Leaves only: the department complaints of this type are routed to.' },
    { path: 'departments', label: 'Departments', widget: 'chip-array' },
    { path: 'slaHours', label: 'SLA (hours)', widget: 'number' },
  ],
};
