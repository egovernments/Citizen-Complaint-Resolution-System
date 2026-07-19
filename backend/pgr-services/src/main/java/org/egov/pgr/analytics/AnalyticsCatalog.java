package org.egov.pgr.analytics;

import org.springframework.stereotype.Component;

import java.util.*;

/**
 * The served-schema catalog for the dynamic analytics query API.
 *
 * This is BOTH the validation layer and the SQL-injection defense: every identifier
 * the planner can emit (table, dimension, measurable column, distinct-countable column,
 * time-role column) must appear here. Anything not registered is rejected before SQL is
 * built; all literals are bound as JDBC params. The grammar is closed; the catalog is open
 * (add a column here + it is instantly queryable, no grammar change) — that is the
 * extensibility model.
 *
 * Operation-level classification (per the design review): a column is independently
 * groupable / filterable / measurable / distinct-countable. UUID/PII-adjacent columns are
 * deliberately groupable + distinct-countable but NOT filterable (no arbitrary eq/in probing)
 * and never returned as raw row-grain dimensions by citizen scope.
 */
@Component
public class AnalyticsCatalog {

    public static final class Grain {
        public final String name;
        public final String table;
        public final Map<String,String> timeRoles;     // role -> column
        public final Set<String> epochMsColumns;        // columns stored as epoch-ms (vs sql date)
        public final Set<String> groupable;
        public final Set<String> filterable;
        public final Set<String> prefixFilterable;      // #1079: starts_with (path rollup/scope) allowlist — ONLY these
        public final Set<String> measurable;            // numeric -> sum/avg/min/max/percentile
        public final Set<String> distinctable;          // -> count_distinct
        public final String tenantColumn;
        public final String boundaryColumn;             // RBAC subtree scope (LIKE prefix)
        public final String citizenColumn;              // citizen self-scope
        public final String departmentColumn;           // RBAC department scope (IN list); null => grain has no dept axis
        public final String defaultTimeRole;

        Grain(String name, String table, Map<String,String> timeRoles, Set<String> epochMsColumns,
              Set<String> groupable, Set<String> filterable, Set<String> prefixFilterable,
              Set<String> measurable, Set<String> distinctable,
              String tenantColumn, String boundaryColumn, String citizenColumn, String departmentColumn,
              String defaultTimeRole) {
            this.name = name; this.table = table; this.timeRoles = timeRoles; this.epochMsColumns = epochMsColumns;
            this.groupable = groupable; this.filterable = filterable; this.prefixFilterable = prefixFilterable;
            this.measurable = measurable;
            this.distinctable = distinctable; this.tenantColumn = tenantColumn; this.boundaryColumn = boundaryColumn;
            this.citizenColumn = citizenColumn; this.departmentColumn = departmentColumn; this.defaultTimeRole = defaultTimeRole;
        }
        public boolean isEpochMs(String col){ return epochMsColumns.contains(col); }
    }

    private final Map<String,Grain> grains = new LinkedHashMap<>();

    public AnalyticsCatalog() {
        // ---------------- complaint_facts ----------------
        grains.put("facts", new Grain("facts", "complaint_facts",
            mapOf("filed_at","created_at", "resolved_at","resolved_at"),
            setOf("created_at","resolved_at","last_transition_at","first_assigned_at","facts_built_at"),
            // groupable
            setOf("service_code","application_status","source","ward_code","zone_code","boundary_path",
                  "boundary_leaf_code","boundary_leaf_type",   // #1079: depth-agnostic leaf node
                  "complaint_depth","service_parent_code",     // #1079: complaint taxonomy axis
                  "service_request_id",   // D1b: natural row id for the at-risk table (already distinctable)
                  "service_group","department_code","aging_bucket","sla_status_bucket","current_assignee_uuid",
                  "is_open","is_resolved","is_reopened","was_rejected","sla_breached","current_state_sla_breached",
                  "has_rating","is_negative_rating","is_first_time_complainant","has_geo_pin","filed_on_behalf",
                  "latitude","longitude",   // map pins: per-complaint coordinates (projectable for the pin KPI)
                  "current_state_seq","created_month","created_week_start","created_year","created_quarter",
                  "created_date","created_dow","created_is_weekend","created_is_business_hr","tenant_id"),
            // filterable (NOTE: UUID columns intentionally absent)
            setOf("service_code","application_status","source","ward_code","zone_code","service_group",
                  "boundary_leaf_code","boundary_leaf_type",                       // #1079
                  "complaint_node_path","complaint_depth","service_parent_code",   // #1079
                  "department_code","aging_bucket","sla_status_bucket","is_open","is_resolved","is_reopened",
                  "was_rejected","sla_breached","current_state_sla_breached","has_rating","is_negative_rating",
                  "is_first_time_complainant","has_geo_pin","created_month","created_year","created_quarter",
                  "created_is_weekend","created_at","resolved_at","rating","current_state_seq",
                  // D1c: non-PII integer assignment counters — filterable so first-assignment rate can be
                  // expressed against real facts columns (replaces the nonexistent has_been_assigned/is_reassigned).
                  "assignment_count","distinct_assignee_count",
                  // escalation_count filterable so the employee-performance escalation rate can be a
                  // count(escalation_count>=1)/count ratio (mirrors the reference escalation companion).
                  "escalation_count"),
            // prefix-filterable (#1079: starts_with rollup/scope on materialized paths ONLY)
            setOf("boundary_path","complaint_node_path"),
            // measurable (numeric)
            setOf("resolution_ms","time_to_assign_ms","open_age_ms","current_state_age_ms","first_escalation_ms",
                  "max_dwell_ms","assigned_dwell_ms","unassigned_dwell_ms","transition_count","assignment_count",
                  "escalation_count","reopen_count","distinct_assignee_count","distinct_actor_count",
                  "system_transition_count","manual_transition_count","rating","complaint_seq_for_citizen",
                  "mdms_sla_hours","sla_target_ms"),
            // distinct-countable
            setOf("account_id","current_assignee_uuid","service_code","ward_code","zone_code","service_request_id"),
            "tenant_id","boundary_path","account_id","department_code","filed_at"));

        // ---------------- complaint_events ----------------
        grains.put("events", new Grain("events", "complaint_events",
            mapOf("event_at","entered_at"),
            setOf("entered_at","exited_at","complaint_created_at"),
            setOf("status","previous_status","action","escalation_source","ward_code","zone_code","service_code",
                  "department_code",   // S2: events now carries department_code (from MDMS ServiceDefs)
                  "boundary_leaf_code","boundary_leaf_type","complaint_depth",   // #1079
                  "source","occurred_month","occurred_week_start","occurred_date","occurred_dow","occurred_hour",
                  "occurred_is_weekend","occurred_is_business_hr","is_assignment","is_escalation","is_reopen",
                  "is_backward_transition","status_is_terminal","status_is_open","has_comment","has_multiple_assignees",
                  "actor_is_system","is_current_state","assignee_uuid","actor_uuid","status_seq","tenant_id"),
            setOf("status","previous_status","action","escalation_source","ward_code","zone_code","service_code",
                  "department_code",   // S2
                  "boundary_leaf_code","boundary_leaf_type",                      // #1079
                  "complaint_node_path","complaint_depth",                        // #1079
                  "source","occurred_month","occurred_is_weekend","occurred_is_business_hr","is_assignment",
                  "is_escalation","is_reopen","is_backward_transition","status_is_terminal","status_is_open",
                  "has_comment","has_multiple_assignees","actor_is_system","is_current_state","entered_at",
                  "complaint_created_at",   // D2: real epoch-ms col on complaint_events; lets the global date range / compare:prior actually narrow events-grain tiles
                  "status_seq"),
            // prefix-filterable (#1079)
            setOf("boundary_path","complaint_node_path"),
            setOf("dwell_ms","state_sla_ms","business_sla_ms","comment_length","seq_delta","complaint_age_at_event_ms",
                  "event_rating","assignee_count"),
            setOf("service_request_id","assignee_uuid","actor_uuid","account_id"),
            "tenant_id","boundary_path","account_id","department_code","event_at"));   // S2: department row-scope axis

        // ---------------- complaint_open_state_daily ----------------
        grains.put("daily", new Grain("daily", "complaint_open_state_daily",
            mapOf("snapshot_date","snapshot_date"),
            setOf(),  // snapshot_date is a sql date, not epoch-ms
            setOf("snapshot_date","ward_code","zone_code","service_code","sla_status_bucket","aging_bucket",
                  "department_code",   // S2: daily now carries department_code + account_id
                  "is_open","sla_breached","current_assignee_uuid","boundary_path","tenant_id"),
            setOf("snapshot_date","ward_code","zone_code","service_code","sla_status_bucket","aging_bucket",
                  "department_code",   // S2
                  "is_open","sla_breached"),
            // prefix-filterable (#1079: daily carries boundary_path only)
            setOf("boundary_path"),
            setOf(),
            setOf("service_request_id","current_assignee_uuid","ward_code","account_id"),
            "tenant_id","boundary_path","account_id","department_code","snapshot_date"));   // S2: department + citizen row-scope axes
    }

    public Grain grain(String name){ return grains.get(name); }
    public boolean hasGrain(String name){ return grains.containsKey(name); }
    public Collection<Grain> grains(){ return grains.values(); }

    public static final Set<String> AGG_FNS =
        setOf("count","count_distinct","sum","avg","min","max","percentile","ratio");

    // ---- #1111: complaint-hierarchy level rollup (query-time derived dimension) ----

    /** Max hierarchy level, matching the grain migrations' chwalk recursion guard (depth < 12). */
    public static final int MAX_HIER_LEVEL = 12;

    /**
     * #1111/R1: composer-internal derived-dimension marker. The planner accepts an OBJECT
     * dimension {@code {"__hierLevel": <n>, "__token": <jvm-nonce>}} ONLY when {@code __token}
     * equals this per-JVM nonce — which only {@link KpiQueryComposer} (in-process, never
     * serialized) can supply. Request bodies and MDMS defs arrive as parsed JSON and cannot
     * know the nonce, so the object-dimension form is unreachable from any external input:
     * there is NO generic expression injection surface, and the inline-query grammar is
     * unchanged (textual dimensions only).
     */
    static final String HIER_DIM_LEVEL_FIELD = "__hierLevel";
    static final String HIER_DIM_TOKEN_FIELD = "__token";
    static final String HIER_DIM_TOKEN = UUID.randomUUID().toString();

    /**
     * #1111: fixed registry of grains carrying {@code complaint_node_path}/{@code complaint_depth}
     * — the only grains that can serve the hierarchy-level derived dimension (facts + events;
     * daily has no path column, so a {@code hierLevel} param no-ops there exactly like ward).
     */
    private static final Set<String> HIER_LEVEL_GRAINS = setOf("facts","events");

    public boolean supportsHierLevel(String grainName){ return HIER_LEVEL_GRAINS.contains(grainName); }

    /**
     * The hierarchy-level rollup expression for path segment {@code level} (1-based):
     * the Nth '.'-segment of {@code complaint_node_path}, clamped to the row's own depth
     * (a depth-2 complaint asked for level-3 buckets stays under its leaf instead of a NULL
     * bucket), with the leaf {@code service_code} as fallback for rows with a NULL/empty path
     * (flat/legacy tenants keep today's leaf buckets — the AC's leaf-only fallback for free).
     *
     * <p>The template is FIXED Java — neither MDMS defs nor request JSON can supply an
     * expression. The only variable is {@code level}, validated here (defense in depth, the
     * composer/planner validate first) and interpolated as a bare int, never raw input.
     */
    public String hierLevelExpr(String grainName, int level){
        if (!supportsHierLevel(grainName))
            throw new IllegalArgumentException("invalid_param: hierLevel is not supported on grain " + grainName);
        if (level < 1 || level > MAX_HIER_LEVEL)
            throw new IllegalArgumentException("invalid_param: hierLevel must be an integer in 1.." + MAX_HIER_LEVEL);
        return "coalesce(nullif(split_part(complaint_node_path,'.',least(" + level
                + ",complaint_depth)),''), service_code)";
    }

    // ---- helpers ----
    @SafeVarargs private static <T> Set<T> setOf(T... a){ return new LinkedHashSet<>(Arrays.asList(a)); }
    private static Map<String,String> mapOf(String... kv){
        Map<String,String> m = new LinkedHashMap<>();
        for (int i=0;i+1<kv.length;i+=2) m.put(kv[i],kv[i+1]);
        return m;
    }
}
