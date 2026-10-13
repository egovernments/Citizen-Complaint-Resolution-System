import type { SchemaDescriptor } from './types';

/**
 * Descriptor for the action mappings (`ACCESSCONTROL-ACTIONS-TEST.actions-test`). The generic form edits the
 * scalar fields and skips objects, so an action's `resource` policy could not be changed here: the masters a role
 * may see (`resource.masters.<schema>.condition`, on the MDMS search action) and the complaint search scope
 * (`resource.complaint.scope`, on the complaint search action). It is edited as JSON; empty leaves the action
 * without a policy.
 */
export const actionMappingDescriptor: SchemaDescriptor = {
  schema: 'ACCESSCONTROL-ACTIONS-TEST.actions-test',
  fields: [
    { path: 'resource', widget: 'json', label: 'Access policy (resource)',
      help: 'JSON. "masters": per MDMS schema, the condition under which a role may see and edit it in the configurator. "complaint.scope": the complaint search scope, i.e. "axes", "default" and per-role "roleScopes" (department / jurisdiction). Changes apply to every user holding the roles; the complaint scope is cached for up to 15 minutes.' },
  ],
};
