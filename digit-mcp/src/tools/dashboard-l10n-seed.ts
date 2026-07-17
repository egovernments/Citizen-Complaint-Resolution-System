/**
 * Localization seed packs for the supervisor dashboard (module:
 * rainmaker-dashboard). One pack per locale (see DASHBOARD_L10N_PACKS at the
 * bottom); the en_IN pack is the reference set and every other locale carries
 * the same codes 1:1.
 *
 * GENERATED — do not hand-edit. Regenerate with scripts in the dashboard-l10n
 * workstream: every entry is either a two-arg t("KEY", "English") literal in
 * digit-ui-esbuild/products/dashboard/, a titleKey/subtitleKey/labelKey ↔
 * title/subtitle/label pair in ansible/nairobi-mdms/mdms/dss/KpiDefinition.json,
 * or a seam-implied dimensionLabel key. DASHBOARD_GEO_LEVEL_* keys ARE
 * seeded below with one canonical English message per level (#1111's
 * per-call-site English variants were canonicalised when they landed).
 */
export const DASHBOARD_L10N_MODULE = 'rainmaker-dashboard';
export const DASHBOARD_L10N_MESSAGES: { code: string; message: string; module: string }[] = [
  {
    "code": "DASHBOARD_BADGE_BOTTLENECK",
    "message": "BOTTLENECK",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_BADGE_LOW",
    "message": "LOW",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_BADGE_ON_TRACK",
    "message": "On track",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CARD_HEADER",
    "message": "Dashboard",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_CSC",
    "message": "Counter (CSC)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_EMAIL",
    "message": "Email",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_IVR",
    "message": "IVR",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_MOBILE",
    "message": "Mobile",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_OTHER",
    "message": "Other",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_SMS",
    "message": "SMS",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_WALK_IN",
    "message": "Walk-in",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_WEB",
    "message": "Web",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_WHATSAPP",
    "message": "WhatsApp",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_ASSIGNED",
    "message": "Assigned",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_AVG_RESOLUTION_TIME",
    "message": "Avg resolution time",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_BREACH_DURATION",
    "message": "Breach duration",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_CSAT",
    "message": "CSAT",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_DEPT",
    "message": "Dept",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_ESCALATION_RATE",
    "message": "Escalation rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_ID",
    "message": "ID",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_LOCALITY",
    "message": "Locality",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_NAME",
    "message": "Name",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_OLDEST_COMPLAINT",
    "message": "Oldest complaint",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_OPEN",
    "message": "Open",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_OWNER",
    "message": "Owner",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_OWNER_ROLE",
    "message": "Owner role",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_REOPEN_RATE",
    "message": "Reopen rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_RESOLVED",
    "message": "Resolved",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_RESOLVED_ON_TIME_RATE",
    "message": "Resolved on-time rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_ROLE",
    "message": "Role",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_SLA",
    "message": "SLA",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_SLA_STATUS",
    "message": "SLA status",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_STATUS",
    "message": "Status",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_SUBTYPE",
    "message": "Subtype",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_TYPE",
    "message": "Type",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_BATCH_FAILED",
    "message": "Batch query failed",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_CATALOG_UNAVAILABLE",
    "message": "Catalog unavailable",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_COUNT",
    "message": "Count",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_CREATED",
    "message": "created",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_DAYS",
    "message": "days",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_LOADING",
    "message": "Loading…",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_NO_DATA",
    "message": "No data",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_NO_TILES_FOR_ROLE",
    "message": "No tiles in the catalog pack for this role.",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_REMOVE",
    "message": "Remove",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_REMOVE_FROM_DASHBOARD",
    "message": "Remove from dashboard",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_RESOLVED",
    "message": "resolved",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_UNASSIGNED",
    "message": "Unassigned",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_UNKNOWN",
    "message": "Unknown",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_DOW_FRI",
    "message": "Fri",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_DOW_MON",
    "message": "Mon",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_DOW_SAT",
    "message": "Sat",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_DOW_SUN",
    "message": "Sun",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_DOW_THU",
    "message": "Thu",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_DOW_TUE",
    "message": "Tue",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_DOW_WED",
    "message": "Wed",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_EXPORT_COL_KPI",
    "message": "KPI",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_EXPORT_COL_TITLE",
    "message": "Title",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_EXPORT_COL_VALUE",
    "message": "Value",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_EXPORT_ROWS",
    "message": "rows",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_ALL_TYPES",
    "message": "All types",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_ALL_WARDS",
    "message": "All wards",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_CLEAR",
    "message": "Clear",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_COMPLAINT_TYPE",
    "message": "Complaint type",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_COMPLAINT_TYPE_FILTER",
    "message": "Complaint type filter",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_FROM",
    "message": "From",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_FROM_DATE",
    "message": "From date",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_GEOGRAPHY",
    "message": "Geography",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_TITLE",
    "message": "Filters",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_TO",
    "message": "To",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_TO_DATE",
    "message": "To date",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_WARD_FILTER",
    "message": "Ward filter",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GEO_LEVEL_0",
    "message": "District",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GEO_LEVEL_1",
    "message": "Subdistrict",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GEO_LEVEL_2",
    "message": "Locality",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GEO_LEVEL_3",
    "message": "Complaints",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GROUPBY_CHIP",
    "message": "Group",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GROUPBY_LABEL",
    "message": "Group by",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GROUPBY_LEAF",
    "message": "Leaf",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GROUPBY_LEVEL_CATEGORY",
    "message": "Category",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GROUPBY_LEVEL_SUB_TYPE",
    "message": "Sub-type",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_ADD",
    "message": "Add",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_ADD_KPI",
    "message": "Add KPI",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_ALL_KPIS_ON_DASHBOARD",
    "message": "All KPIs are on the dashboard",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_ALL_LOCALITIES",
    "message": "All Localities",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_AREA",
    "message": "Area",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_AREA_SCOPED",
    "message": "Area-scoped",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_AVAILABLE_KPIS",
    "message": "Available KPIs",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_EXPORT",
    "message": "Export",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_EXPORT_DASHBOARD",
    "message": "Export dashboard",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_KPIS_AVAILABLE",
    "message": "KPIs available to your role",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_LAST_7_DAYS",
    "message": "Last 7 days",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_OFFICER_KPIS_HIDDEN",
    "message": "Officer KPIs: hidden",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_OFFICER_KPIS_HIDDEN_TOOLTIP",
    "message": "Officer-level (per-employee) KPIs are hidden from your role",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_OFFICER_KPIS_VISIBLE",
    "message": "Officer KPIs: visible",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_OFFICER_KPIS_VISIBLE_TOOLTIP",
    "message": "Your role can see officer-level (per-employee) KPIs",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_OPERATIONS",
    "message": "Operations",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_PGR_OPERATIONS",
    "message": "PGR Operations",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_RESET",
    "message": "Reset",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_RESET_LAYOUT",
    "message": "Reset layout",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_ROLE_SCOPE_TOOLTIP",
    "message": "Dashboard tiles are scoped to your role by the analytics catalog",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_ROW_SCOPE_TOOLTIP",
    "message": "Dashboard data is row-scoped to your department(s)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_SCOPED_TO",
    "message": "Scoped to",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_SEARCH_PLACEHOLDER",
    "message": "Search complaints, wards, citizens.",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_SHOWING",
    "message": "Showing",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_TARGET",
    "message": "Target",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_TITLE",
    "message": "Complaint Resolution Operations",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_TYPE_CHART",
    "message": "CHART",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_TYPE_STAT",
    "message": "STAT",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_TYPE_TABLE",
    "message": "TABLE",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CE_METRIC_REOPEN_RATE",
    "message": "Reopen rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_AVG_RESOLUTION_TIME",
    "message": "Average resolution time",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_CREATED_TODAY",
    "message": "Complaints created today",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_CSAT",
    "message": "Citizen satisfaction",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_FIRST_ASSIGNMENT_RATE",
    "message": "First-assignment rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_NEW_CREATED",
    "message": "New complaints created",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_OLDEST_OPEN",
    "message": "Oldest complaint",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_REOPEN_RATE",
    "message": "Reopen rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_RESOLUTION_RATE",
    "message": "Resolution rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_RESOLVED_ON_TIME_RATE",
    "message": "Resolved on time rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_SLA_COMPLIANCE_RATE",
    "message": "SLA compliance rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_SLA_NON_COMPLIANCE_RATE",
    "message": "SLA non-compliance rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_TOTAL_OPEN",
    "message": "Open complaints",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_TOTAL_RESOLVED",
    "message": "Resolved complaints",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_RS_METRIC_BREACH_COUNT",
    "message": "Breached SLA (open)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_RS_METRIC_SLA_COMPLIANCE",
    "message": "On-time resolution rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_DEMO_HEALTH",
    "message": "Health officer",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_DEMO_HEALTH_HINT",
    "message": "Medical dept only",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_DEMO_LOGINS",
    "message": "Demo logins",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_DEMO_SUPERVISOR",
    "message": "Supervisor",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_DEMO_SUPERVISOR_HINT",
    "message": "all departments",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_DEMO_WATER",
    "message": "Water officer",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_DEMO_WATER_HINT",
    "message": "Water dept only",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_ENTER_CREDENTIALS",
    "message": "Enter a username and password.",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_FILL",
    "message": "Fill",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_PASSWORD",
    "message": "Password",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_SIGN_IN",
    "message": "Sign in",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_SIGN_IN_FAILED",
    "message": "Sign-in failed",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_SIGNING_IN",
    "message": "Signing in…",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_SUBTITLE",
    "message": "Sign in to the operations dashboard",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_TENANT",
    "message": "tenant",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_USERNAME",
    "message": "Username",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_USERNAME_PLACEHOLDER",
    "message": "e.g. DEMO_SUPERVISOR",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_AREA",
    "message": "Area",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_AREAS",
    "message": "areas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_BOUNDARIES_ERROR",
    "message": "Could not load ward boundaries",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_CLEAR",
    "message": "Clear",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_COMPLAINT_COUNT_PLURAL",
    "message": "complaints",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_COMPLAINT_COUNT_SINGULAR",
    "message": "complaint",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_EXIT_FULLSCREEN",
    "message": "Exit fullscreen",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_FILTER",
    "message": "Filter:",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_FULLSCREEN",
    "message": "Fullscreen",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_HOVER_CREATED",
    "message": "Created",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_HOVER_OPEN",
    "message": "Open",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_HOVER_PCT_OPEN",
    "message": "% Open",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_HOVER_PCT_RESOLVED",
    "message": "% Resolved",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_HOVER_RESOLVED",
    "message": "Resolved",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_HOVER_TOTAL_CREATED",
    "message": "Total created",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LAYER_CREATED",
    "message": "Created",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LAYER_OPEN",
    "message": "Open",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LAYER_RESOLVED",
    "message": "Resolved",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_COLLAPSE",
    "message": "Collapse legend",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_COUNT_1_3",
    "message": "1–3",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_COUNT_11_13",
    "message": "11–13",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_COUNT_14_15",
    "message": "14–15",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_COUNT_4_5",
    "message": "4–5",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_COUNT_6_8",
    "message": "6–8",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_COUNT_9_10",
    "message": "9–10",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_EXPAND",
    "message": "Expand legend",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_FOOTER_FOCUS",
    "message": " to focus",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_FOOTER_ZOOM",
    "message": "Zoom in to drill down · click a ",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_NO_COMPLAINTS",
    "message": "No complaints",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_PCT_0",
    "message": "0%",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_PCT_20_40",
    "message": "20–40%",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_PCT_40_60",
    "message": "40–60%",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_PCT_60_80",
    "message": "60–80%",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_PCT_GT_80",
    "message": "> 80%",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_PCT_LTE_20",
    "message": "≤ 20%",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_TITLE",
    "message": "Map legend",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_TITLE_CREATED",
    "message": "Created",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_TITLE_OPEN",
    "message": "% Open",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_TITLE_RESOLVED",
    "message": "% Resolved",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LOADING",
    "message": "Loading…",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LOADING_BOUNDARIES",
    "message": "Loading boundaries…",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LOCATE_ME",
    "message": "Locate me",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_NO_GEO_DATA",
    "message": "No geographic data",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_APPROXIMATE",
    "message": "Approximate location (ward centroid)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_CHANNEL",
    "message": "Channel",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_COMPLAINT",
    "message": "Complaint",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_FILED",
    "message": "Filed",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_ID",
    "message": "ID",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_SLA",
    "message": "SLA",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_STATUS",
    "message": "Status",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_WARD",
    "message": "Ward",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PINS_UNAVAILABLE",
    "message": "Complaint pins unavailable: analytics API must expose latitude, longitude, and service_request_id on the facts grain.",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_REGION",
    "message": "Region",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_RESET",
    "message": "Reset",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_RESET_VIEW",
    "message": "Reset view",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_TITLE",
    "message": "Complaint map",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_ZONE",
    "message": "Zone",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_ZOOM",
    "message": "zoom",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SERIES_CREATED",
    "message": "Created",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SERIES_FILED",
    "message": "Filed",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SERIES_OPEN",
    "message": "Open",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SERIES_RESOLUTION_RATE",
    "message": "Resolution rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SERIES_RESOLVED",
    "message": "Resolved",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SERIES_SLA_COMPLIANCE_RATE",
    "message": "SLA compliance rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SIDEBAR_DASHBOARD",
    "message": "Dashboard",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SIDEBAR_NOT_SIGNED_IN",
    "message": "Not signed in",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SIDEBAR_SIGN_OUT",
    "message": "Sign out",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SLA_APPROACHING",
    "message": "Nearing breach",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SLA_BREACHED",
    "message": "Breached",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SLA_NEARING",
    "message": "Nearing breach",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SLA_WITHIN",
    "message": "On track",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TABLE_EMPTY_AT_RISK",
    "message": "No complaints at risk",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TABLE_SORT_ASCENDING",
    "message": "ascending",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TABLE_SORT_BY",
    "message": "Sort by",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TABLE_SORT_DESCENDING",
    "message": "descending",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_ARIA_DONUT",
    "message": "Donut chart",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_CTX_ACROSS_RESOLVED",
    "message": "Across resolved",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_CTX_BREACHED_OPEN",
    "message": "Breached open",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_CTX_COMPLAINTS",
    "message": "complaints",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_CTX_CSAT",
    "message": "CSAT",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_CTX_OPEN_COMPLAINTS",
    "message": "open complaints",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_CTX_OUT_OF",
    "message": "Out of",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_ERR_FAILED_TO_LOAD",
    "message": "Failed to load",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_ERR_GENERIC",
    "message": "ERROR",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_ERR_NO_ACCESS",
    "message": "No access",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_ERR_OUT_OF_SCOPE",
    "message": "Out of scope",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_ERR_RESTRICTED",
    "message": "Restricted",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_LEGEND_CATCHING_UP",
    "message": "Catching up (≥1.0)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_LEGEND_FALLING_BEHIND",
    "message": "Falling behind (<1.0)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_NO_LIST_DATA",
    "message": "No list data",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_REMOVE",
    "message": "Remove from dashboard",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_REMOVE_ARIA",
    "message": "Remove",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_SERIES_RESOLUTION_RATE",
    "message": "Resolution rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TYPE_FILTER_ALL_IN",
    "message": "All in",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TYPE_FILTER_NOT_APPLIED",
    "message": "Type filter not applied",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_UNIT_D",
    "message": "d",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_UNIT_DAY",
    "message": "day",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_UNIT_DAYS",
    "message": "days",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_UNIT_HR",
    "message": "hr",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_UNIT_HRS",
    "message": "hrs",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_ASSIGNED",
    "message": "Assigned",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_IN_PROGRESS",
    "message": "In progress",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_OPEN",
    "message": "Open",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_PENDINGATLME",
    "message": "Assigned",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_PENDINGATSUPERVISOR",
    "message": "Pending at supervisor",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_PENDINGFORASSIGNMENT",
    "message": "Pending assignment",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_PENDINGFORREASSIGNMENT",
    "message": "Pending reassignment",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_REOPENED",
    "message": "Reopened",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_AVG_RESOLUTION_TIME",
    "message": "Average resolution time",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_AVG_RESOLUTION_TIME_SUBTITLE",
    "message": "Avg. time to resolve",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_COMPLAINTS_BY_TYPE",
    "message": "Complaints by type",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_COMPLAINTS_BY_TYPE_SUBTITLE",
    "message": "Complaints filed, by type",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_COMPLAINTS_OVER_TIME",
    "message": "Complaints over time",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_COMPLAINTS_OVER_TIME_SUBTITLE",
    "message": "Created, resolved and open per day",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_DEPARTMENT_BREACH_SCATTER",
    "message": "Breach rate vs caseload by department",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_DEPARTMENT_BREACH_SCATTER_SUBTITLE",
    "message": "Open caseload vs breach rate at period end",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_DEPARTMENT_FLOW_RATIO",
    "message": "Flow ratio by department",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_DEPARTMENT_FLOW_RATIO_SUBTITLE",
    "message": "Resolved ÷ created",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_DEPARTMENT_RESOLUTION_RATE",
    "message": "Department-wise resolution rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_DEPARTMENT_RESOLUTION_RATE_SUBTITLE",
    "message": "Resolved ÷ filed per department",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_DEPARTMENTS_BY_TYPE",
    "message": "Complaints by departments",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OFFICER_SLA",
    "message": "Employees with most open complaints",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OFFICER_SLA_SUBTITLE",
    "message": "Open complaints by SLA state per officer",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OPEN_BY_AGE",
    "message": "Complaints by age",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OPEN_BY_AGE_SUBTITLE",
    "message": "Open complaints by age bucket",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OPEN_BY_CHANNEL",
    "message": "Complaints by channel",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OPEN_BY_CHANNEL_SUBTITLE",
    "message": "Open complaints by intake channel",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OPEN_BY_TYPE_STAGE",
    "message": "Open Complaints by Workflow Stage",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OPEN_BY_TYPE_STAGE_SUBTITLE",
    "message": "Subtypes with the most open complaints, each broken down by which workflow stage they're stuck in.",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OVER_TIME_CREATED_DAILY",
    "message": "Complaints over time",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OVER_TIME_OPEN_DAILY",
    "message": "Open complaints over time (daily)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_WARDS_BY_SLA",
    "message": "Complaints by Wards",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_WARDS_BY_SLA_SUBTITLE",
    "message": "All complaints by SLA state — per ward",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CREATED_TODAY_COUNT",
    "message": "Complaints created today",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CSAT_AVG",
    "message": "Citizen satisfaction",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CSAT_AVG_SUBTITLE",
    "message": "Avg. rating on resolved complaints",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_FIRST_ASSIGNMENT_RATE_COUNT",
    "message": "First-assignment rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_FIRST_ASSIGNMENT_RATE_COUNT_SUBTITLE",
    "message": "Never reassigned ÷ assigned",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_FLOW_RATIO_COUNT",
    "message": "Flow ratio",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_FLOW_RATIO_COUNT_SUBTITLE",
    "message": "Resolved in period ÷ created in period",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_MAP_COMPLAINT_PINS",
    "message": "Complaint locations",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_MAP_WARD_WOW_CURRENT",
    "message": "Complaint map (week-over-week)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_NEW_CREATED_COUNT",
    "message": "New complaints created",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_OLDEST_OPEN_AGE",
    "message": "Oldest complaint",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_OLDEST_OPEN_AGE_SUBTITLE",
    "message": "Earliest open complaint",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_OPEN_COMPLAINTS_LIVE",
    "message": "Open complaints",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_REOPEN_RATE_COUNT",
    "message": "Reopen rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_REOPEN_RATE_COUNT_SUBTITLE",
    "message": "Reopened ÷ resolved",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_RESOLUTION_RATE_COUNT",
    "message": "Resolution rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_RESOLVED_DATE_RANGE_COUNT",
    "message": "Resolved complaints",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_RESOLVED_ON_TIME_RATE_COUNT",
    "message": "Resolved on time rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_SLA_COMPLIANCE_RATE_COUNT",
    "message": "SLA compliance rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_SLA_COMPLIANCE_RATE_COUNT_SUBTITLE",
    "message": "Resolved within SLA ÷ all filed",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_SLA_NONCOMPLIANCE_RATE_COUNT",
    "message": "SLA non-compliance rate",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_SLA_NONCOMPLIANCE_RATE_COUNT_SUBTITLE",
    "message": "Breached SLA ÷ all complaints",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_COMPLAINT_TYPE_DETAILS",
    "message": "Complaint type details",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_COMPLAINT_TYPE_DETAILS_SUBTITLE",
    "message": "Resolution, SLA and reopen metrics per complaint type - all complaints, narrowed by the date filter",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_COMPLAINTS_AT_RISK",
    "message": "Complaints at risk",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_COMPLAINTS_AT_RISK_SUBTITLE",
    "message": "Open complaints nearing or past SLA",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_RECURRING_WARD_SUBTYPE",
    "message": "Recurring complaints by ward & sub-type",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_RECURRING_WARD_SUBTYPE_SUBTITLE",
    "message": "Ward × subtype pairs with ≥ 3 complaints in period",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_SERVICE_QUALITY_BY_CHANNEL",
    "message": "Service quality by channel",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_SERVICE_QUALITY_BY_CHANNEL_SUBTITLE",
    "message": "Volume, resolution rate and CSAT by intake channel",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_SUBTYPE_PERFORMANCE",
    "message": "Complaint sub-type performance",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_SUBTYPE_PERFORMANCE_SUBTITLE",
    "message": "Share, resolution time and SLA by subtype",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_WARD_OPEN_DAILY",
    "message": "Open complaints by ward (daily)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_WARD_PERFORMANCE",
    "message": "Ward performance",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_WARD_PERFORMANCE_SUBTITLE",
    "message": "Created, open, reopen, on-time and CSAT by ward",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TOTAL_COMPLAINTS_COUNT",
    "message": "Total complaints",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TOTAL_COMPLAINTS_COUNT_SUBTITLE",
    "message": "Complaints filed in period",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_EP_TABLE_EMPLOYEE_PERFORMANCE",
    "message": "Employee performance",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_EP_TABLE_EMPLOYEE_PERFORMANCE_SUBTITLE",
    "message": "Workload and quality metrics per officer",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_RS_BREACH_TOTAL",
    "message": "Breached SLA (open)",
    "module": "rainmaker-dashboard"
  }
];

/**
 * pt_PT (European Portuguese) pack — same 315 codes as the en_IN pack, 1:1.
 * Translations follow European/Mozambique conventions (bairro/distrito geo
 * terms, "reclamações" agreement); placeholder tokens verified identical to
 * the en_IN messages.
 */
export const DASHBOARD_L10N_MESSAGES_PT_PT: { code: string; message: string; module: string }[] = [
  {
    "code": "DASHBOARD_BADGE_BOTTLENECK",
    "message": "ESTRANGULAMENTO",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_BADGE_LOW",
    "message": "BAIXO",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_BADGE_ON_TRACK",
    "message": "Dentro do prazo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CARD_HEADER",
    "message": "Painel",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_CSC",
    "message": "Balcão (CSC)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_EMAIL",
    "message": "E-mail",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_IVR",
    "message": "IVR",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_MOBILE",
    "message": "Telemóvel",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_OTHER",
    "message": "Outro",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_SMS",
    "message": "SMS",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_WALK_IN",
    "message": "Presencial",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_WEB",
    "message": "Web",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_CHANNEL_WHATSAPP",
    "message": "WhatsApp",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_ASSIGNED",
    "message": "Atribuídas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_AVG_RESOLUTION_TIME",
    "message": "Tempo médio de resolução",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_BREACH_DURATION",
    "message": "Duração do incumprimento",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_CSAT",
    "message": "CSAT",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_DEPT",
    "message": "Dep.",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_ESCALATION_RATE",
    "message": "Taxa de escalonamento",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_ID",
    "message": "ID",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_LOCALITY",
    "message": "Localidade",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_NAME",
    "message": "Nome",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_OLDEST_COMPLAINT",
    "message": "Reclamação mais antiga",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_OPEN",
    "message": "Abertas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_OWNER",
    "message": "Responsável",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_OWNER_ROLE",
    "message": "Função do responsável",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_REOPEN_RATE",
    "message": "Taxa de reabertura",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_RESOLVED",
    "message": "Resolvidas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_RESOLVED_ON_TIME_RATE",
    "message": "Taxa de resolução dentro do prazo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_ROLE",
    "message": "Função",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_SLA",
    "message": "SLA",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_SLA_STATUS",
    "message": "Estado do SLA",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_STATUS",
    "message": "Estado",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_SUBTYPE",
    "message": "Subtipo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COL_TYPE",
    "message": "Tipo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_BATCH_FAILED",
    "message": "Falha na consulta em lote",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_CATALOG_UNAVAILABLE",
    "message": "Catálogo indisponível",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_COUNT",
    "message": "Contagem",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_CREATED",
    "message": "criadas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_DAYS",
    "message": "dias",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_LOADING",
    "message": "A carregar…",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_NO_DATA",
    "message": "Sem dados",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_NO_TILES_FOR_ROLE",
    "message": "Não há mosaicos no pacote do catálogo para esta função.",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_REMOVE",
    "message": "Remover",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_REMOVE_FROM_DASHBOARD",
    "message": "Remover do painel",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_RESOLVED",
    "message": "resolvidas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_UNASSIGNED",
    "message": "Sem atribuição",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_COMMON_UNKNOWN",
    "message": "Desconhecido",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_DOW_FRI",
    "message": "Sex",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_DOW_MON",
    "message": "Seg",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_DOW_SAT",
    "message": "Sáb",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_DOW_SUN",
    "message": "Dom",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_DOW_THU",
    "message": "Qui",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_DOW_TUE",
    "message": "Ter",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_DOW_WED",
    "message": "Qua",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_EXPORT_COL_KPI",
    "message": "KPI",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_EXPORT_COL_TITLE",
    "message": "Título",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_EXPORT_COL_VALUE",
    "message": "Valor",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_EXPORT_ROWS",
    "message": "linhas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_ALL_TYPES",
    "message": "Todos os tipos",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_ALL_WARDS",
    "message": "Todos os bairros",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_CLEAR",
    "message": "Limpar",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_COMPLAINT_TYPE",
    "message": "Tipo de reclamação",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_COMPLAINT_TYPE_FILTER",
    "message": "Filtro de tipo de reclamação",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_FROM",
    "message": "De",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_FROM_DATE",
    "message": "Data de início",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_GEOGRAPHY",
    "message": "Geografia",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_TITLE",
    "message": "Filtros",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_TO",
    "message": "Até",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_TO_DATE",
    "message": "Data de fim",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_FILTERS_WARD_FILTER",
    "message": "Filtro de bairro",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GEO_LEVEL_0",
    "message": "Distrito",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GEO_LEVEL_1",
    "message": "Posto administrativo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GEO_LEVEL_2",
    "message": "Bairro",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GEO_LEVEL_3",
    "message": "Reclamações",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GROUPBY_CHIP",
    "message": "Agrupar",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GROUPBY_LABEL",
    "message": "Agrupar por",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GROUPBY_LEAF",
    "message": "Folha",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GROUPBY_LEVEL_CATEGORY",
    "message": "Categoria",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_GROUPBY_LEVEL_SUB_TYPE",
    "message": "Subtipo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_ADD",
    "message": "Adicionar",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_ADD_KPI",
    "message": "Adicionar KPI",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_ALL_KPIS_ON_DASHBOARD",
    "message": "Todos os KPIs estão no painel",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_ALL_LOCALITIES",
    "message": "Todas as Localidades",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_AREA",
    "message": "Área",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_AREA_SCOPED",
    "message": "Restrito à área",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_AVAILABLE_KPIS",
    "message": "KPIs disponíveis",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_EXPORT",
    "message": "Exportar",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_EXPORT_DASHBOARD",
    "message": "Exportar painel",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_KPIS_AVAILABLE",
    "message": "KPIs disponíveis para a sua função",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_LAST_7_DAYS",
    "message": "Últimos 7 dias",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_OFFICER_KPIS_HIDDEN",
    "message": "KPIs de funcionários: ocultos",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_OFFICER_KPIS_HIDDEN_TOOLTIP",
    "message": "Os KPIs ao nível do funcionário (por funcionário) estão ocultos para a sua função",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_OFFICER_KPIS_VISIBLE",
    "message": "KPIs de funcionários: visíveis",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_OFFICER_KPIS_VISIBLE_TOOLTIP",
    "message": "A sua função pode ver KPIs ao nível do funcionário (por funcionário)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_OPERATIONS",
    "message": "Operações",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_PGR_OPERATIONS",
    "message": "Operações PGR",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_RESET",
    "message": "Repor",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_RESET_LAYOUT",
    "message": "Repor disposição",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_ROLE_SCOPE_TOOLTIP",
    "message": "Os mosaicos do painel são limitados à sua função pelo catálogo de análise",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_ROW_SCOPE_TOOLTIP",
    "message": "Os dados do painel são restritos, linha a linha, ao(s) seu(s) departamento(s)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_SCOPED_TO",
    "message": "Restrito a",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_SEARCH_PLACEHOLDER",
    "message": "Pesquisar reclamações, bairros, cidadãos.",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_SHOWING",
    "message": "A mostrar",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_TARGET",
    "message": "Meta",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_TITLE",
    "message": "Operações de Resolução de Reclamações",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_TYPE_CHART",
    "message": "GRÁFICO",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_TYPE_STAT",
    "message": "ESTATÍSTICA",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_HEADER_TYPE_TABLE",
    "message": "TABELA",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CE_METRIC_REOPEN_RATE",
    "message": "Taxa de reabertura",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_AVG_RESOLUTION_TIME",
    "message": "Tempo médio de resolução",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_CREATED_TODAY",
    "message": "Reclamações criadas hoje",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_CSAT",
    "message": "Satisfação do cidadão",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_FIRST_ASSIGNMENT_RATE",
    "message": "Taxa de primeira atribuição",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_NEW_CREATED",
    "message": "Novas reclamações criadas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_OLDEST_OPEN",
    "message": "Reclamação mais antiga",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_REOPEN_RATE",
    "message": "Taxa de reabertura",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_RESOLUTION_RATE",
    "message": "Taxa de resolução",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_RESOLVED_ON_TIME_RATE",
    "message": "Taxa de resolução atempada",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_SLA_COMPLIANCE_RATE",
    "message": "Taxa de cumprimento do SLA",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_SLA_NON_COMPLIANCE_RATE",
    "message": "Taxa de incumprimento do SLA",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_TOTAL_OPEN",
    "message": "Reclamações abertas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_CL_METRIC_TOTAL_RESOLVED",
    "message": "Reclamações resolvidas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_RS_METRIC_BREACH_COUNT",
    "message": "SLA incumprido (abertas)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_KPI_DISPLAY_RS_METRIC_SLA_COMPLIANCE",
    "message": "Taxa de resolução atempada",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_DEMO_HEALTH",
    "message": "Técnico de saúde",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_DEMO_HEALTH_HINT",
    "message": "Apenas dept. de saúde",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_DEMO_LOGINS",
    "message": "Acessos de demonstração",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_DEMO_SUPERVISOR",
    "message": "Supervisor",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_DEMO_SUPERVISOR_HINT",
    "message": "todos os departamentos",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_DEMO_WATER",
    "message": "Técnico de águas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_DEMO_WATER_HINT",
    "message": "Apenas dept. de águas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_ENTER_CREDENTIALS",
    "message": "Introduza um nome de utilizador e uma palavra-passe.",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_FILL",
    "message": "Preencher",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_PASSWORD",
    "message": "Palavra-passe",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_SIGN_IN",
    "message": "Iniciar sessão",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_SIGN_IN_FAILED",
    "message": "Falha ao iniciar sessão",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_SIGNING_IN",
    "message": "A iniciar sessão…",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_SUBTITLE",
    "message": "Inicie sessão no painel de operações",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_TENANT",
    "message": "município",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_USERNAME",
    "message": "Nome de utilizador",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_LOGIN_USERNAME_PLACEHOLDER",
    "message": "p. ex. DEMO_SUPERVISOR",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_AREA",
    "message": "Área",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_AREAS",
    "message": "áreas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_BOUNDARIES_ERROR",
    "message": "Não foi possível carregar os limites dos bairros",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_CLEAR",
    "message": "Limpar",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_COMPLAINT_COUNT_PLURAL",
    "message": "reclamações",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_COMPLAINT_COUNT_SINGULAR",
    "message": "reclamação",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_EXIT_FULLSCREEN",
    "message": "Sair do ecrã inteiro",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_FILTER",
    "message": "Filtrar:",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_FULLSCREEN",
    "message": "Ecrã inteiro",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_HOVER_CREATED",
    "message": "Criadas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_HOVER_OPEN",
    "message": "Abertas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_HOVER_PCT_OPEN",
    "message": "% Abertas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_HOVER_PCT_RESOLVED",
    "message": "% Resolvidas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_HOVER_RESOLVED",
    "message": "Resolvidas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_HOVER_TOTAL_CREATED",
    "message": "Total criadas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LAYER_CREATED",
    "message": "Criadas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LAYER_OPEN",
    "message": "Abertas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LAYER_RESOLVED",
    "message": "Resolvidas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_COLLAPSE",
    "message": "Recolher legenda",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_COUNT_1_3",
    "message": "1–3",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_COUNT_11_13",
    "message": "11–13",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_COUNT_14_15",
    "message": "14–15",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_COUNT_4_5",
    "message": "4–5",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_COUNT_6_8",
    "message": "6–8",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_COUNT_9_10",
    "message": "9–10",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_EXPAND",
    "message": "Expandir legenda",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_FOOTER_FOCUS",
    "message": "para focar",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_FOOTER_ZOOM",
    "message": "Amplie para detalhar · clique em",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_NO_COMPLAINTS",
    "message": "Sem reclamações",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_PCT_0",
    "message": "0%",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_PCT_20_40",
    "message": "20–40%",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_PCT_40_60",
    "message": "40–60%",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_PCT_60_80",
    "message": "60–80%",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_PCT_GT_80",
    "message": "> 80%",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_PCT_LTE_20",
    "message": "≤ 20%",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_TITLE",
    "message": "Legenda do mapa",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_TITLE_CREATED",
    "message": "Criadas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_TITLE_OPEN",
    "message": "% Abertas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LEGEND_TITLE_RESOLVED",
    "message": "% Resolvidas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LOADING",
    "message": "A carregar…",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LOADING_BOUNDARIES",
    "message": "A carregar limites…",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_LOCATE_ME",
    "message": "Localizar-me",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_NO_GEO_DATA",
    "message": "Sem dados geográficos",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_APPROXIMATE",
    "message": "Localização aproximada (centroide do bairro)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_CHANNEL",
    "message": "Canal",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_COMPLAINT",
    "message": "Reclamação",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_FILED",
    "message": "Registada",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_ID",
    "message": "ID",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_SLA",
    "message": "SLA",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_STATUS",
    "message": "Estado",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PIN_WARD",
    "message": "Bairro",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_PINS_UNAVAILABLE",
    "message": "Marcadores de reclamações indisponíveis: a API de análise tem de expor latitude, longitude e service_request_id no nível de factos.",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_REGION",
    "message": "Região",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_RESET",
    "message": "Repor",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_RESET_VIEW",
    "message": "Repor vista",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_TITLE",
    "message": "Mapa de reclamações",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_ZONE",
    "message": "Zona",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_MAP_ZOOM",
    "message": "zoom",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SERIES_CREATED",
    "message": "Criadas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SERIES_FILED",
    "message": "Registadas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SERIES_OPEN",
    "message": "Abertas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SERIES_RESOLUTION_RATE",
    "message": "Taxa de resolução",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SERIES_RESOLVED",
    "message": "Resolvidas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SERIES_SLA_COMPLIANCE_RATE",
    "message": "Taxa de cumprimento do SLA",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SIDEBAR_DASHBOARD",
    "message": "Painel",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SIDEBAR_NOT_SIGNED_IN",
    "message": "Sessão não iniciada",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SIDEBAR_SIGN_OUT",
    "message": "Terminar sessão",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SLA_APPROACHING",
    "message": "Perto de incumprir",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SLA_BREACHED",
    "message": "Incumprido",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SLA_NEARING",
    "message": "Perto de incumprir",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_SLA_WITHIN",
    "message": "Dentro do prazo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TABLE_EMPTY_AT_RISK",
    "message": "Sem reclamações em risco",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TABLE_SORT_ASCENDING",
    "message": "ascendente",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TABLE_SORT_BY",
    "message": "Ordenar por",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TABLE_SORT_DESCENDING",
    "message": "descendente",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_ARIA_DONUT",
    "message": "Gráfico em anel",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_CTX_ACROSS_RESOLVED",
    "message": "Entre as resolvidas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_CTX_BREACHED_OPEN",
    "message": "Abertas em incumprimento",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_CTX_COMPLAINTS",
    "message": "reclamações",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_CTX_CSAT",
    "message": "CSAT",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_CTX_OPEN_COMPLAINTS",
    "message": "reclamações abertas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_CTX_OUT_OF",
    "message": "De um total de",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_ERR_FAILED_TO_LOAD",
    "message": "Falha ao carregar",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_ERR_GENERIC",
    "message": "ERRO",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_ERR_NO_ACCESS",
    "message": "Sem acesso",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_ERR_OUT_OF_SCOPE",
    "message": "Fora do âmbito",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_ERR_RESTRICTED",
    "message": "Restrito",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_LEGEND_CATCHING_UP",
    "message": "A recuperar (≥1.0)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_LEGEND_FALLING_BEHIND",
    "message": "A ficar para trás (<1.0)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_NO_LIST_DATA",
    "message": "Sem dados de lista",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_REMOVE",
    "message": "Remover do painel",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_REMOVE_ARIA",
    "message": "Remover",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TILE_SERIES_RESOLUTION_RATE",
    "message": "Taxa de resolução",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TYPE_FILTER_ALL_IN",
    "message": "Tudo em",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_TYPE_FILTER_NOT_APPLIED",
    "message": "Filtro de tipo não aplicado",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_UNIT_D",
    "message": "d",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_UNIT_DAY",
    "message": "dia",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_UNIT_DAYS",
    "message": "dias",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_UNIT_HR",
    "message": "h",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_UNIT_HRS",
    "message": "h",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_ASSIGNED",
    "message": "Atribuída",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_IN_PROGRESS",
    "message": "Em curso",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_OPEN",
    "message": "Aberta",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_PENDINGATLME",
    "message": "Atribuída",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_PENDINGATSUPERVISOR",
    "message": "Pendente no supervisor",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_PENDINGFORASSIGNMENT",
    "message": "Atribuição pendente",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_PENDINGFORREASSIGNMENT",
    "message": "Reatribuição pendente",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "DASHBOARD_WF_STAGE_REOPENED",
    "message": "Reaberta",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_AVG_RESOLUTION_TIME",
    "message": "Tempo médio de resolução",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_AVG_RESOLUTION_TIME_SUBTITLE",
    "message": "Tempo médio para resolver",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_COMPLAINTS_BY_TYPE",
    "message": "Reclamações por tipo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_COMPLAINTS_BY_TYPE_SUBTITLE",
    "message": "Reclamações registadas, por tipo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_COMPLAINTS_OVER_TIME",
    "message": "Reclamações ao longo do tempo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_COMPLAINTS_OVER_TIME_SUBTITLE",
    "message": "Criadas, resolvidas e abertas por dia",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_DEPARTMENT_BREACH_SCATTER",
    "message": "Taxa de incumprimento vs carga de trabalho por departamento",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_DEPARTMENT_BREACH_SCATTER_SUBTITLE",
    "message": "Carga aberta vs taxa de incumprimento no fim do período",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_DEPARTMENT_FLOW_RATIO",
    "message": "Rácio de fluxo por departamento",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_DEPARTMENT_FLOW_RATIO_SUBTITLE",
    "message": "Resolvidas ÷ criadas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_DEPARTMENT_RESOLUTION_RATE",
    "message": "Taxa de resolução por departamento",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_DEPARTMENT_RESOLUTION_RATE_SUBTITLE",
    "message": "Resolvidas ÷ registadas por departamento",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_DEPARTMENTS_BY_TYPE",
    "message": "Reclamações por departamento",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OFFICER_SLA",
    "message": "Funcionários com mais reclamações abertas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OFFICER_SLA_SUBTITLE",
    "message": "Reclamações abertas por estado de SLA por funcionário",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OPEN_BY_AGE",
    "message": "Reclamações por antiguidade",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OPEN_BY_AGE_SUBTITLE",
    "message": "Reclamações abertas por faixa de antiguidade",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OPEN_BY_CHANNEL",
    "message": "Reclamações por canal",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OPEN_BY_CHANNEL_SUBTITLE",
    "message": "Reclamações abertas por canal de entrada",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OPEN_BY_TYPE_STAGE",
    "message": "Reclamações Abertas por Fase do Fluxo de Trabalho",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OPEN_BY_TYPE_STAGE_SUBTITLE",
    "message": "Subtipos com mais reclamações abertas, cada um discriminado pela fase do fluxo de trabalho em que estão retidas.",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OVER_TIME_CREATED_DAILY",
    "message": "Reclamações ao longo do tempo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_OVER_TIME_OPEN_DAILY",
    "message": "Reclamações abertas ao longo do tempo (diário)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_WARDS_BY_SLA",
    "message": "Reclamações por Bairro",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CHART_WARDS_BY_SLA_SUBTITLE",
    "message": "Todas as reclamações por estado de SLA — por bairro",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CREATED_TODAY_COUNT",
    "message": "Reclamações criadas hoje",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CSAT_AVG",
    "message": "Satisfação do cidadão",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_CSAT_AVG_SUBTITLE",
    "message": "Classificação média das reclamações resolvidas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_FIRST_ASSIGNMENT_RATE_COUNT",
    "message": "Taxa de primeira atribuição",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_FIRST_ASSIGNMENT_RATE_COUNT_SUBTITLE",
    "message": "Nunca reatribuídas ÷ atribuídas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_FLOW_RATIO_COUNT",
    "message": "Rácio de fluxo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_FLOW_RATIO_COUNT_SUBTITLE",
    "message": "Resolvidas no período ÷ criadas no período",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_MAP_COMPLAINT_PINS",
    "message": "Localizações das reclamações",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_MAP_WARD_WOW_CURRENT",
    "message": "Mapa de reclamações (semana a semana)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_NEW_CREATED_COUNT",
    "message": "Novas reclamações criadas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_OLDEST_OPEN_AGE",
    "message": "Reclamação mais antiga",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_OLDEST_OPEN_AGE_SUBTITLE",
    "message": "Reclamação aberta mais antiga",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_OPEN_COMPLAINTS_LIVE",
    "message": "Reclamações abertas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_REOPEN_RATE_COUNT",
    "message": "Taxa de reabertura",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_REOPEN_RATE_COUNT_SUBTITLE",
    "message": "Reabertas ÷ resolvidas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_RESOLUTION_RATE_COUNT",
    "message": "Taxa de resolução",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_RESOLVED_DATE_RANGE_COUNT",
    "message": "Reclamações resolvidas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_RESOLVED_ON_TIME_RATE_COUNT",
    "message": "Taxa de resolução dentro do prazo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_SLA_COMPLIANCE_RATE_COUNT",
    "message": "Taxa de cumprimento de SLA",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_SLA_COMPLIANCE_RATE_COUNT_SUBTITLE",
    "message": "Resolvidas dentro do SLA ÷ todas as registadas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_SLA_NONCOMPLIANCE_RATE_COUNT",
    "message": "Taxa de incumprimento de SLA",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_SLA_NONCOMPLIANCE_RATE_COUNT_SUBTITLE",
    "message": "SLA violado ÷ todas as reclamações",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_COMPLAINT_TYPE_DETAILS",
    "message": "Detalhes por tipo de reclamação",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_COMPLAINT_TYPE_DETAILS_SUBTITLE",
    "message": "Métricas de resolução, SLA e reabertura por tipo de reclamação - todas as reclamações, restringidas pelo filtro de datas",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_COMPLAINTS_AT_RISK",
    "message": "Reclamações em risco",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_COMPLAINTS_AT_RISK_SUBTITLE",
    "message": "Reclamações abertas perto ou fora do SLA",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_RECURRING_WARD_SUBTYPE",
    "message": "Reclamações recorrentes por bairro e subtipo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_RECURRING_WARD_SUBTYPE_SUBTITLE",
    "message": "Pares bairro × subtipo com ≥ 3 reclamações no período",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_SERVICE_QUALITY_BY_CHANNEL",
    "message": "Qualidade do serviço por canal",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_SERVICE_QUALITY_BY_CHANNEL_SUBTITLE",
    "message": "Volume, taxa de resolução e CSAT por canal de entrada",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_SUBTYPE_PERFORMANCE",
    "message": "Desempenho por subtipo de reclamação",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_SUBTYPE_PERFORMANCE_SUBTITLE",
    "message": "Quota, tempo de resolução e SLA por subtipo",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_WARD_OPEN_DAILY",
    "message": "Reclamações abertas por bairro (diário)",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_WARD_PERFORMANCE",
    "message": "Desempenho por bairro",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TABLE_WARD_PERFORMANCE_SUBTITLE",
    "message": "Criadas, abertas, reabertas, dentro do prazo e CSAT por bairro",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TOTAL_COMPLAINTS_COUNT",
    "message": "Total de reclamações",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_CL_TOTAL_COMPLAINTS_COUNT_SUBTITLE",
    "message": "Reclamações registadas no período",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_EP_TABLE_EMPLOYEE_PERFORMANCE",
    "message": "Desempenho dos funcionários",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_EP_TABLE_EMPLOYEE_PERFORMANCE_SUBTITLE",
    "message": "Métricas de carga de trabalho e qualidade por funcionário",
    "module": "rainmaker-dashboard"
  },
  {
    "code": "CMS-DASHBOARD.DASHBOARD_KPI_RS_BREACH_TOTAL",
    "message": "SLA violado (abertas)",
    "module": "rainmaker-dashboard"
  }
];

/**
 * Locale → dashboard message pack. tenant_bootstrap applies the pack for
 * every locale it seeds (locales themselves come from the source tenant's
 * common-masters.StateInfo.languages), first-writer-wins under live-tenant
 * copies.
 */
export const DASHBOARD_L10N_PACKS: Record<string, { code: string; message: string; module: string }[]> = {
  en_IN: DASHBOARD_L10N_MESSAGES,
  pt_PT: DASHBOARD_L10N_MESSAGES_PT_PT,
};
