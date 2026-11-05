// which roles the employee's working context shows.
//
// The pill read "ke · 1 department · 2 roles" for a state admin holding 12 roles: it counted the payload's ROLE
// CONTEXTS (Resolver, Admin - groupings of roles) under the word "roles", and the panel listed those contexts under
// "Roles". Upstream's #2038 denylist also hid every admin role (ACCOUNT_ADMIN, MDMS_ADMIN, LOC_ADMIN, SUPERUSER), which
// for an administrator ARE the assignment. So:
//   - "roles" = every role the person holds here, except the three that are never a staff assignment (EMPLOYEE -
//     everyone has it, CITIZEN - the citizen-side counterpart, INTERNAL_MICROSERVICE_ROLE - a service identity);
//   - the role contexts are their own row ("Works as"), never counted as roles.

/** Never a staff assignment: every employee has EMPLOYEE; CITIZEN and the service role are not employee roles. */
export const NOT_AN_ASSIGNMENT = ["EMPLOYEE", "CITIZEN", "INTERNAL_MICROSERVICE_ROLE"];

/** The role codes the working context shows, once each, in the payload's order. */
export function heldRoleCodes(context) {
  const seen = new Set();
  const out = [];
  for (const r of context?.roles || []) {
    const code = String(r?.code || r || "").toUpperCase();
    if (!code || NOT_AN_ASSIGNMENT.includes(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

/** The role contexts ("Resolver", "Admin"), CITIZEN excluded: shown as their own row, never counted as roles. */
export function workingContexts(context) {
  return (context?.roleContexts || []).filter((c) => c && String(c).toUpperCase() !== "CITIZEN");
}
