// Citizen-side complaint location step.
//
// Previously rendered `<SelectAddress>` — a tenant radio + flat
// Ward-only locality dropdown. That broke on naipepea because:
//   1. Citizens shouldn't see a "tenant" picker (CCRS#433).
//   2. The inline boundary fetch was scoped to `boundaryType=Ward`,
//      so the locality dropdown returned only leaves with no parents,
//      collapsing the cascade and leaving the form's mandatory check
//      unsatisfiable on cities with no Ward rows (CCRS#428).
//
// Replace with `<PGRBoundaryComponent>` — the same component the
// employee Create Complaint form uses (PR #38). It reads the cascading
// hierarchy from `boundaryHierarchyOrder` in SessionStorage (populated
// by `usePGRInitialization` on module mount) and renders one Dropdown
// per level, e.g. County → Sub-County → Ward on Nairobi.

export const complaintsLocation = {
  head: "CS_ADDCOMPLAINT_COMPLAINT_LOCATION",
  body: [
    {
      type: "component",
      isMandatory: true,
      component: "PGRBoundaryComponent",
      key: "SelectedBoundary",
      label: "CS_COMPLAINT_LOCATION",
      populators: {
        name: "SelectedBoundary",
        error: "CORE_COMMON_REQUIRED_ERRMSG",
      },
    },
  ],
};
