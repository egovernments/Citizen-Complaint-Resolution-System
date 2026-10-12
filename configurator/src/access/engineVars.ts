/**
 * Condition variables both engines evaluate beyond the original document: pgr-services' PolicyInputBuilder and the
 * OPA input carry them since ChakshuGautam/ccrs-digit3#1424 (parity fixture: pgr-services
 * src/test/resources/opa-parity/condition-vars.json, copied here as condition-vars.fixture.json). Any build of this
 * screen ships in a release that also carries #1424. A variable listed in policyModel.BASE_VARS with `requires` and
 * missing here is shown disabled.
 */
export const AVAILABLE_CONDITION_VARS = new Set<string>([
  'resource.complaint.status',
  'resource.complaint.assignedToCaller',
  'user.roles',
]);
