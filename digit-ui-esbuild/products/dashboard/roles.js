// Roles allowed to open the supervisor dashboard. Checked tenant-agnostically
// (role CODE only, via Digit.UserService.hasAccess) because employee roles live
// at the state root tenant ("ke") while the working tenant may be a city tenant —
// Digit.Utils.didEmployeeHasAtleastOneRole filters by current tenant and would
// wrongly hide the dashboard there.
export const DASHBOARD_ROLES = ["SUPERVISOR", "PGR_SUPERVISOR", "GRO", "DGRO", "PGR_LME", "PGR_ADMIN", "SUPERUSER"];
