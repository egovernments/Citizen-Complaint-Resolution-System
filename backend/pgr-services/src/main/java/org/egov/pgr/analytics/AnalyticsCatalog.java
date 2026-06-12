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
        public final Set<String> measurable;            // numeric -> sum/avg/min/max/percentile
        public final Set<String> distinctable;          // -> count_distinct
        public final String tenantColumn;
        public final String boundaryColumn;             // RBAC subtree scope (LIKE prefix)
        public final String citizenColumn;              // citizen self-scope
        public final String defaultTimeRole;

        Grain(String name, String table, Map<String,String> timeRoles, Set<String> epochMsColumns,
              Set<String> groupable, Set<String> filterable, Set<String> measurable, Set<String> distinctable,
              String tenantColumn, String boundaryColumn, String citizenColumn, String defaultTimeRole) {
            this.name = name; this.table = table; this.timeRoles = timeRoles; this.epochMsColumns = epochMsColumns;
            this.groupable = groupable; this.filterable = filterable; this.measurable = measurable;
            this.distinctable = distinctable; this.tenantColumn = tenantColumn; this.boundaryColumn = boundaryColumn;
            this.citizenColumn = citizenColumn; this.defaultTimeRole = defaultTimeRole;
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
                  "service_group","department_code","aging_bucket","sla_status_bucket","current_assignee_uuid",
                  "is_open","is_resolved","is_reopened","was_rejected","sla_breached","current_state_sla_breached",
                  "has_rating","is_negative_rating","is_first_time_complainant","has_geo_pin","filed_on_behalf",
                  "latitude","longitude",   // map pins: group by (lat,long) → one row per complaint location
                  "current_state_seq","created_month","created_week_start","created_year","created_quarter",
                  "created_date","created_dow","created_is_weekend","created_is_business_hr","tenant_id"),
            // filterable (NOTE: UUID columns intentionally absent)
            setOf("service_code","application_status","source","ward_code","zone_code","service_group",
                  "department_code","aging_bucket","sla_status_bucket","is_open","is_resolved","is_reopened",
                  "was_rejected","sla_breached","current_state_sla_breached","has_rating","is_negative_rating",
                  "is_first_time_complainant","has_geo_pin","created_month","created_year","created_quarter",
                  "created_is_weekend","created_at","resolved_at","rating","current_state_seq"),
            // measurable (numeric)
            setOf("resolution_ms","time_to_assign_ms","open_age_ms","current_state_age_ms","first_escalation_ms",
                  "max_dwell_ms","assigned_dwell_ms","unassigned_dwell_ms","transition_count","assignment_count",
                  "escalation_count","reopen_count","distinct_assignee_count","distinct_actor_count",
                  "system_transition_count","manual_transition_count","rating","complaint_seq_for_citizen",
                  "mdms_sla_hours","sla_target_ms"),
            // distinct-countable
            setOf("account_id","current_assignee_uuid","service_code","ward_code","zone_code","service_request_id"),
            "tenant_id","boundary_path","account_id","filed_at"));

        // ---------------- complaint_events ----------------
        grains.put("events", new Grain("events", "complaint_events",
            mapOf("event_at","entered_at"),
            setOf("entered_at","exited_at","complaint_created_at"),
            setOf("status","previous_status","action","escalation_source","ward_code","zone_code","service_code",
                  "source","occurred_month","occurred_week_start","occurred_date","occurred_dow","occurred_hour",
                  "occurred_is_weekend","occurred_is_business_hr","is_assignment","is_escalation","is_reopen",
                  "is_backward_transition","status_is_terminal","status_is_open","has_comment","has_multiple_assignees",
                  "actor_is_system","is_current_state","assignee_uuid","actor_uuid","status_seq","tenant_id"),
            setOf("status","previous_status","action","escalation_source","ward_code","zone_code","service_code",
                  "source","occurred_month","occurred_is_weekend","occurred_is_business_hr","is_assignment",
                  "is_escalation","is_reopen","is_backward_transition","status_is_terminal","status_is_open",
                  "has_comment","has_multiple_assignees","actor_is_system","is_current_state","entered_at","status_seq"),
            setOf("dwell_ms","state_sla_ms","business_sla_ms","comment_length","seq_delta","complaint_age_at_event_ms",
                  "event_rating","assignee_count"),
            setOf("service_request_id","assignee_uuid","actor_uuid","account_id"),
            "tenant_id","boundary_path","account_id","event_at"));

        // ---------------- complaint_open_state_daily ----------------
        grains.put("daily", new Grain("daily", "complaint_open_state_daily",
            mapOf("snapshot_date","snapshot_date"),
            setOf(),  // snapshot_date is a sql date, not epoch-ms
            setOf("snapshot_date","ward_code","zone_code","service_code","sla_status_bucket","aging_bucket",
                  "is_open","sla_breached","current_assignee_uuid","boundary_path","tenant_id"),
            setOf("snapshot_date","ward_code","zone_code","service_code","sla_status_bucket","aging_bucket",
                  "is_open","sla_breached"),
            setOf(),
            setOf("service_request_id","current_assignee_uuid","ward_code"),
            "tenant_id","boundary_path",null,"snapshot_date"));
    }

    public Grain grain(String name){ return grains.get(name); }
    public boolean hasGrain(String name){ return grains.containsKey(name); }
    public Collection<Grain> grains(){ return grains.values(); }

    public static final Set<String> AGG_FNS =
        setOf("count","count_distinct","sum","avg","min","max","percentile","ratio");

    // ---- helpers ----
    @SafeVarargs private static <T> Set<T> setOf(T... a){ return new LinkedHashSet<>(Arrays.asList(a)); }
    private static Map<String,String> mapOf(String... kv){
        Map<String,String> m = new LinkedHashMap<>();
        for (int i=0;i+1<kv.length;i+=2) m.put(kv[i],kv[i+1]);
        return m;
    }
}
