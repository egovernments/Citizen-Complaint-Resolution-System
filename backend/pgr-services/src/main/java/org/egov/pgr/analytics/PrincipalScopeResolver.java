package org.egov.pgr.analytics;

import static org.egov.pgr.util.PGRConstants.USERTYPE_CITIZEN;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * THE SEAM. The single, isolated place that derives an {@link AnalyticsScope} (ScopeSpec) for the
 * authenticated principal. Today it resolves from HRMS (employee assignments → departments,
 * jurisdiction → boundary). Tomorrow it could evaluate a stored JsonLogic policy condition — and
 * NOTHING downstream (the planner's WHERE-clause injection, the response shaping) needs to change,
 * because everyone consumes only the {@link AnalyticsScope} value object.
 *
 * To cut over to a policy engine: replace the body of {@link #resolve} (or just
 * {@link #resolveEmployeeScope}) with a policy evaluation that produces the same ScopeSpec. One
 * method. No rewrite.
 *
 * Fail-CLOSED for constrained principals (S3): an employee whose department scope cannot be
 * resolved — empty userName, no HRMS record, no active assignment, or an HRMS error — is denied
 * (a sentinel department that matches nothing) UNLESS they hold a {@link #TENANT_WIDE_ROLES}
 * role (admin/supervisor tier), which are legitimately tenant-wide and stay unrestricted. This
 * closes the prior fail-OPEN hole where an officer with a failed/missing HRMS lookup silently saw
 * every department. Under correct config (officers carry an HRMS department) this is a no-op for
 * them — they resolve to their real department. Pure citizens keep their existing self-scope.
 *
 * Tenant-configurable (#1280): {@code dss.DashboardConfig.departmentScoping = "disabled"} turns
 * the whole department axis OFF for a tenant (deployments whose complaint data carries no
 * departments). Tenant scoping and citizen self-scope are unaffected. Anything other than an
 * explicit "disabled" — missing record/field, malformed value, MDMS error — means "enforced",
 * i.e. exactly the behavior described above (fail-safe).
 */
@Component
@Slf4j
public class PrincipalScopeResolver {

    /**
     * Roles that are legitimately tenant-wide and may be unrestricted with no HRMS department
     * (admins/supervisors). Every other employee role MUST resolve a department or be denied.
     */
    private static final Set<String> TENANT_WIDE_ROLES = Set.of(
            "PGR_ADMIN", "SUPERUSER", "MDMS_ADMIN", "HRMS_ADMIN", "STADMIN",
            "SUPERVISOR", "PGR_SUPERVISOR");

    /** Sentinel department for a denied principal — matches no real row (fail-closed). */
    private static final String DENY_ALL_DEPARTMENT = "__scope_denied__";

    /**
     * Employee base-role markers. In DIGIT, HRMS stamps {@code EMPLOYEE} (and {@code COMMON_EMPLOYEE})
     * on every employee principal in addition to their functional roles (GRO, PGR_LME, admin, …); a
     * citizen never carries these. Holding any of them disqualifies a principal from being a pure
     * citizen, regardless of what other (citizen-side) roles they also hold.
     */
    private static final Set<String> EMPLOYEE_ROLE_CODES = Set.of("EMPLOYEE", "COMMON_EMPLOYEE");

    /** The citizen role code every self-registered citizen carries. */
    private static final String CITIZEN_ROLE_CODE = "CITIZEN";

    private final PGRConfiguration config;
    private final RestTemplate restTemplate;
    private final ObjectMapper mapper;
    private final KpiCatalogService catalog;

    @Autowired
    public PrincipalScopeResolver(PGRConfiguration config, RestTemplate restTemplate, ObjectMapper mapper,
                                  KpiCatalogService catalog) {
        this.config = config;
        this.restTemplate = restTemplate;
        this.mapper = mapper;
        this.catalog = catalog;
    }

    /**
     * Produce the ScopeSpec for this request. The ONLY entry point; consumers never construct an
     * {@link AnalyticsScope} themselves.
     */
    public AnalyticsScope resolve(RequestInfo requestInfo, String tenantId, int stateLevelLen) {
        boolean stateLevel = tenantId != null && tenantId.split("\\.").length == stateLevelLen;
        User u = requestInfo == null ? null : requestInfo.getUserInfo();

        if (u == null)
            return new AnalyticsScope(tenantId, stateLevel, null, null, null);

        // a pure citizen is locked to their own records; no department/boundary axis applies.
        if (isPureCitizen(requestInfo))
            return new AnalyticsScope(tenantId, stateLevel, u.getUuid(), null, null);

        // employee principal → derive department/jurisdiction scope from HRMS.
        return resolveEmployeeScope(requestInfo, u, tenantId, stateLevel);
    }

    /**
     * A "pure citizen" is a principal that HOLDS the {@code CITIZEN} role and holds NO employee
     * role (see {@link #EMPLOYEE_ROLE_CODES}). Such a principal is locked to their OWN records
     * everywhere — analytics self-scope here, and complaint-search ownership scoping in
     * {@code EnrichmentService.enrichSearchRequest}. This is the single source of truth for that
     * security-relevant classification, so the two call sites cannot drift.
     *
     * <p>Classification is role-based, NOT "type CITIZEN with only the CITIZEN role". A citizen may
     * legitimately carry additional non-employee (citizen-side) roles; requiring CITIZEN to be the
     * SOLE role would misclassify those principals as employees and push them down the HRMS employee
     * path where they fail-close. Conversely, an employee who also holds the CITIZEN role is still
     * an employee (they carry {@code EMPLOYEE}) and is not self-scoped.
     *
     * <p>Roles decide first, but a principal carrying NO employee role and no recognisable CITIZEN
     * role falls back to the declared user type so that an abnormal role state (role-sync gap, a
     * legacy/OTP session with empty roles, a citizen role coded differently) cannot silently demote
     * a citizen out of self-scoping. That fallback is what keeps this fail-CLOSED: without it such a
     * principal matches neither branch in {@code enrichSearchRequest}, userIds stays empty, and the
     * query builder drops the ownership clause entirely — reopening #1071.
     */
    public boolean isPureCitizen(RequestInfo requestInfo) {
        User u = requestInfo == null ? null : requestInfo.getUserInfo();
        if (u == null)
            return false;

        boolean hasCitizenRole = false;
        boolean hasEmployeeRole = false;
        if (u.getRoles() != null) {
            for (Role r : u.getRoles()) {
                if (r == null || r.getCode() == null) continue;
                String c = r.getCode().trim().toUpperCase();
                if (c.equals(CITIZEN_ROLE_CODE)) hasCitizenRole = true;
                else if (EMPLOYEE_ROLE_CODES.contains(c)) hasEmployeeRole = true;
            }
        }

        if (hasEmployeeRole) return false;
        if (hasCitizenRole) return true;
        return USERTYPE_CITIZEN.equalsIgnoreCase(u.getType());
    }

    /**
     * Employee derivation. THIS is the body a policy-engine cutover would replace. Returns a
     * ScopeSpec with departmentCodes (and best-effort boundaryPrefix). When a department cannot be
     * resolved, returns a fail-CLOSED spec (deny-all) for constrained roles, or unrestricted for
     * tenant-wide (admin/supervisor) roles — see {@link #unresolvedScope}.
     */
    private AnalyticsScope resolveEmployeeScope(RequestInfo requestInfo, User u, String tenantId, boolean stateLevel) {
        // #1280: tenant-configurable department scoping. When dss.DashboardConfig.departmentScoping
        // is "disabled" for this tenant, skip HRMS department resolution entirely — the employee is
        // scoped by tenant only (no department IN filter, no fail-closed sentinel). Citizen
        // self-scope is untouched (that path returns before this method); tenant scoping is
        // untouched (carried by the AnalyticsScope tenant fields as always). The catalog lookup is
        // fail-safe and never throws: missing record/field, malformed value, or an MDMS error all
        // resolve to "enforced" — exactly today's behavior below.
        if (catalog.isDepartmentScopingDisabled(tenantId)) {
            log.info("department scoping disabled by DashboardConfig for tenant {} — unrestricted employee scope for '{}'",
                    tenantId, u.getUserName());
            return new AnalyticsScope(tenantId, stateLevel, null, null, null);
        }
        try {
            String userName = u.getUserName();
            if (userName == null || userName.isEmpty())
                return unresolvedScope(u, tenantId, stateLevel, "empty userName");

            JsonNode employees = searchHrmsByCode(requestInfo, tenantId, userName);
            if (employees == null || !employees.isArray() || employees.size() == 0)
                return unresolvedScope(u, tenantId, stateLevel, "no HRMS employee for '" + userName + "'");

            // first matching employee record
            JsonNode emp = employees.get(0);

            // departments: union of ACTIVE assignment departments
            Set<String> departments = new LinkedHashSet<>();
            JsonNode assignments = emp.get("assignments");
            if (assignments != null && assignments.isArray()) {
                for (JsonNode a : assignments) {
                    boolean active = a.path("isCurrentAssignment").asBoolean(true);
                    String dept = a.path("department").asText(null);
                    if (active && dept != null && !dept.isEmpty()) departments.add(dept);
                }
            }

            // boundary / jurisdiction scope: DELIBERATELY SKIPPED for now (boundaryPrefix=null).
            //
            // boundary_path is '|'-delimited root-first (ancestralmaterializedpath||'|'||code), so an
            // HRMS jurisdiction whose boundary code is the path ROOT (e.g. county "BOMET") IS a valid
            // LIKE prefix and the wiring below would work. We leave it off because, on this data, a
            // county-level jurisdiction over-restricts: complaints filed under sibling roots (other
            // counties at the state tenant) would be dropped, which is NOT the intended department demo.
            // Department is the primary, exact-match axis. To enable jurisdiction scoping, uncomment the
            // block below — applyScope already injects boundary_path LIKE prefix%. (Resolver-only change;
            // no downstream change — the seam holds.)
            String boundaryPrefix = null;
            // JsonNode jurisdictions = emp.get("jurisdictions");
            // if (jurisdictions != null && jurisdictions.isArray() && jurisdictions.size() > 0) {
            //     String b = jurisdictions.get(0).path("boundary").asText(null);
            //     if (b != null && !b.isEmpty()) boundaryPrefix = b;
            // }

            if (departments.isEmpty())
                return unresolvedScope(u, tenantId, stateLevel, "no active HRMS department assignment");

            List<String> deptList = new ArrayList<>(departments);
            log.info("PrincipalScopeResolver: userName='{}' departments={} boundaryPrefix={}",
                    userName, deptList, boundaryPrefix);
            return new AnalyticsScope(tenantId, stateLevel, null, boundaryPrefix, deptList);
        } catch (Exception ex) {
            log.warn("HRMS scope resolution failed for '{}': {}", u.getUserName(), ex.toString());
            return unresolvedScope(u, tenantId, stateLevel, "HRMS error");
        }
    }

    /**
     * Scope for an employee whose department could not be resolved. Fail-CLOSED (deny-all sentinel)
     * for constrained roles; unrestricted only for tenant-wide (admin/supervisor) roles.
     */
    private AnalyticsScope unresolvedScope(User u, String tenantId, boolean stateLevel, String reason) {
        if (hasTenantWideRole(u)) {
            log.debug("scope unresolved ({}) for tenant-wide role '{}' — unrestricted", reason, u.getUserName());
            return new AnalyticsScope(tenantId, stateLevel, null, null, null);
        }
        log.info("scope unresolved ({}) for constrained principal '{}' — DENY (fail-closed)", reason, u.getUserName());
        return new AnalyticsScope(tenantId, stateLevel, null, null, List.of(DENY_ALL_DEPARTMENT));
    }

    private boolean hasTenantWideRole(User u) {
        List<Role> roles = u.getRoles();
        if (roles == null) return false;
        for (Role r : roles) {
            String c = r.getCode() == null ? "" : r.getCode().toUpperCase();
            if (TENANT_WIDE_ROLES.contains(c)) return true;
        }
        return false;
    }

    /**
     * POST /egov-hrms/employees/_search with codes=[userName] + tenantId. Returns the Employees
     * JSON array node (or null). Uses the internal gateway host from egov.hrms.host.
     */
    private JsonNode searchHrmsByCode(RequestInfo requestInfo, String tenantId, String userName) {
        String url = config.getHrmsHost() + config.getHrmsEndPoint()
                + "?tenantId=" + tenantId + "&codes=" + userName;
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("RequestInfo", requestInfo);
        Object resp = restTemplate.postForObject(url, req, Map.class);
        JsonNode root = mapper.convertValue(resp, JsonNode.class);
        if (root == null) return null;
        return root.get("Employees");
    }
}
