/**
 * Condition variables that are in the policy input document but not yet evaluated by BOTH engines. pgr-services'
 * PolicyInputBuilder and the OPA input will carry them once cms-access's change ships
 * (ChakshuGautam/ccrs-digit3, resource.complaint.status / assignedToCaller / user.roles). Until then the pickers show
 * them disabled. When that change is deployed, list them here.
 */
export const AVAILABLE_CONDITION_VARS = new Set<string>([]);
