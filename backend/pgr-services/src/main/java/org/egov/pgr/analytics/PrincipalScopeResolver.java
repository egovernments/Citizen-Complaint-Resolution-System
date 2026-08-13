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
 * THE SEAM for Dashboard/Analytics. The single, isolated place that derives an {@link
 * AnalyticsScope} (ScopeSpec) for the authenticated principal on {@code AnalyticsService}'s own
 * hardcoded {@link ScopeAxis} model, from HRMS (employee assignments → departments, jurisdiction
 * → boundary). NOTHING downstream (the planner's WHERE-clause injection, the response shaping)
 * needs to change when this method's derivation logic changes, because every consumer only ever
 * sees the {@link AnalyticsScope} value object.
 *
 * <p>PGR complaint search does NOT use this class' axis machinery — it has its own, separate,
 * MDMS-{@code ScopePolicy}-driven resolver ({@code org.egov.pgr.policy.PolicyDrivenScopeResolver}),
 * kept in a different package deliberately: a change here for Dashboard's own axes must never risk
 * PGR search's scoping, and vice versa. The only thing shared between them is {@link
 * #isPureCitizen}, documented below as the intentional single source of truth for that
 * classification. (A previous per-tenant {@code dss.DashboardConfig.departmentScoping} toggle used
 * to override Dashboard's department axis — removed: Dashboard's scoping rule now lives entirely
 * in {@link ScopeAxis}/this class, no ad-hoc side config.)
 *
 * <p>Fail-CLOSED for constrained principals (S3): an employee whose scope cannot be resolved on
 * ANY axis {@link ScopeAxis} requires — empty userName, no HRMS record, no active assignment, or
 * an HRMS error — is denied (a sentinel that matches nothing) UNLESS they hold a
 * {@link #TENANT_WIDE_ROLES} role (admin/supervisor tier), which are legitimately tenant-wide and
 * stay unrestricted. This closes the prior fail-OPEN hole where an officer with a failed/missing
 * HRMS lookup silently saw everything. Under correct config this is a no-op for them — they
 * resolve to their real scope. Pure citizens keep their existing self-scope.
 */
@Component
@Slf4j
public class PrincipalScopeResolver {

    /**
     * Which HRMS-derived axes matter for a given caller, and which are required for that caller to
     * be resolvable at all. {@link #DEPARTMENT_AND_JURISDICTION} accepts either axis alone or both
     * (only "neither resolved" fails closed) — used by Dashboard/Analytics. {@link
     * #JURISDICTION_ONLY} never looks at department and fails closed purely on jurisdiction — used
     * by PGR complaint search, whose own row-scoping model doesn't include department.
     */
    public enum ScopeAxis {
        JURISDICTION_ONLY,
        DEPARTMENT_AND_JURISDICTION
    }

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

    @Autowired
    public PrincipalScopeResolver(PGRConfiguration config, RestTemplate restTemplate, ObjectMapper mapper) {
        this.config = config;
        this.restTemplate = restTemplate;
        this.mapper = mapper;
    }

    /** Defaults to {@link ScopeAxis#DEPARTMENT_AND_JURISDICTION} — Dashboard/Analytics' call shape. */
    public AnalyticsScope resolve(RequestInfo requestInfo, String tenantId, int stateLevelLen) {
        return resolve(requestInfo, tenantId, stateLevelLen, ScopeAxis.DEPARTMENT_AND_JURISDICTION);
    }

    /**
     * Produce the ScopeSpec for this request. The ONLY entry point; consumers never construct an
     * {@link AnalyticsScope} themselves.
     */
    public AnalyticsScope resolve(RequestInfo requestInfo, String tenantId, int stateLevelLen, ScopeAxis axis) {
        boolean stateLevel = tenantId != null && tenantId.split("\\.").length == stateLevelLen;
        User u = requestInfo == null ? null : requestInfo.getUserInfo();

        if (u == null)
            return new AnalyticsScope(tenantId, stateLevel, null, null, null);

        // a pure citizen is locked to their own records; no department/boundary axis applies.
        if (isPureCitizen(requestInfo))
            return new AnalyticsScope(tenantId, stateLevel, u.getUuid(), null, null);

        // employee principal → derive scope from HRMS, per the caller's required axis.
        return resolveEmployeeScope(requestInfo, u, tenantId, stateLevel, axis);
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
     * Employee derivation. Returns a ScopeSpec built from HRMS assignments/jurisdictions, shaped by
     * {@code axis}: {@link ScopeAxis#JURISDICTION_ONLY} never reads department and fails closed on
     * jurisdiction alone; {@link ScopeAxis#DEPARTMENT_AND_JURISDICTION} resolves both and only
     * fails closed when NEITHER resolves. Returns a fail-CLOSED spec (deny-all) for constrained
     * roles when the required axis/axes can't be resolved, or unrestricted for tenant-wide
     * (admin/supervisor) roles — see {@link #unresolvedScope}.
     */
    private AnalyticsScope resolveEmployeeScope(RequestInfo requestInfo, User u, String tenantId, boolean stateLevel,
                                                 ScopeAxis axis) {
        try {
            String userName = u.getUserName();
            if (userName == null || userName.isEmpty())
                return unresolvedScope(u, tenantId, stateLevel, "empty userName");

            JsonNode employees = searchHrmsByCode(requestInfo, tenantId, userName);
            if (employees == null || !employees.isArray() || employees.size() == 0)
                return unresolvedScope(u, tenantId, stateLevel, "no HRMS employee for '" + userName + "'");

            // first matching employee record
            JsonNode emp = employees.get(0);

            // departments: union of ACTIVE assignment departments — never resolved for
            // JURISDICTION_ONLY callers (PGR search's own row-scoping model doesn't include
            // department, regardless of what HRMS has assigned to this employee).
            Set<String> departments = axis == ScopeAxis.DEPARTMENT_AND_JURISDICTION
                    ? extractDepartments(emp) : new LinkedHashSet<>();

            // analytics module's own hierarchical jurisdiction axis: DELIBERATELY SKIPPED for now
            // (boundaryPrefix=null).
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
            // JsonNode jurisdictionsForAnalytics = emp.get("jurisdictions");
            // if (jurisdictionsForAnalytics != null && jurisdictionsForAnalytics.isArray() && jurisdictionsForAnalytics.size() > 0) {
            //     String b = jurisdictionsForAnalytics.get(0).path("boundary").asText(null);
            //     if (b != null && !b.isEmpty()) boundaryPrefix = b;
            // }

            // PGR search's own jurisdiction axis (exact-match against a complaint's address
            // locality, see AnalyticsScope#jurisdictionCodes) — union of ALL assigned jurisdiction
            // boundary codes. Always resolved regardless of axis: it's the ONLY axis JURISDICTION_ONLY
            // callers get, and one of two independent axes for DEPARTMENT_AND_JURISDICTION callers.
            Set<String> jurisdictions = extractJurisdictions(emp);

            if (axis == ScopeAxis.JURISDICTION_ONLY) {
                // Department is never this caller's concern — fail closed purely on jurisdiction.
                if (jurisdictions.isEmpty())
                    return unresolvedScope(u, tenantId, stateLevel, "no HRMS jurisdiction assignment");

                List<String> jurisdictionList = new ArrayList<>(jurisdictions);
                log.info("PrincipalScopeResolver: userName='{}' jurisdictions={} (jurisdiction-only)",
                        userName, jurisdictionList);
                return new AnalyticsScope(tenantId, stateLevel, null, null, null, jurisdictionList);
            }

            // DEPARTMENT_AND_JURISDICTION: independent axes — some tenants/countries don't track
            // department at all, so requiring BOTH would fail-closed every employee on that tenant.
            // Only deny-all when NEITHER axis resolved — that is the real "can't scope this
            // principal at all" case. When exactly one resolved, scope by that one alone (the other
            // stays null => "no restriction on this axis", per AnalyticsScope's documented contract).
            if (departments.isEmpty() && jurisdictions.isEmpty())
                return unresolvedScope(u, tenantId, stateLevel, "no active HRMS department assignment or jurisdiction assignment");

            List<String> deptList = departments.isEmpty() ? null : new ArrayList<>(departments);
            List<String> jurisdictionList = jurisdictions.isEmpty() ? null : new ArrayList<>(jurisdictions);
            log.info("PrincipalScopeResolver: userName='{}' departments={} jurisdictions={} boundaryPrefix={}",
                    userName, deptList, jurisdictionList, boundaryPrefix);
            return new AnalyticsScope(tenantId, stateLevel, null, boundaryPrefix, deptList, jurisdictionList);
        } catch (Exception ex) {
            log.warn("HRMS scope resolution failed for '{}': {}", u.getUserName(), ex.toString());
            return unresolvedScope(u, tenantId, stateLevel, "HRMS error");
        }
    }

    private static Set<String> extractDepartments(JsonNode emp) {
        Set<String> departments = new LinkedHashSet<>();
        JsonNode assignments = emp.get("assignments");
        if (assignments != null && assignments.isArray()) {
            for (JsonNode a : assignments) {
                boolean active = a.path("isCurrentAssignment").asBoolean(true);
                String dept = a.path("department").asText(null);
                if (active && dept != null && !dept.isEmpty()) departments.add(dept);
            }
        }
        return departments;
    }

    private static Set<String> extractJurisdictions(JsonNode emp) {
        Set<String> jurisdictions = new LinkedHashSet<>();
        JsonNode jurisdictionNodes = emp.get("jurisdictions");
        if (jurisdictionNodes != null && jurisdictionNodes.isArray()) {
            for (JsonNode j : jurisdictionNodes) {
                String boundary = j.path("boundary").asText(null);
                if (boundary != null && !boundary.isEmpty()) jurisdictions.add(boundary);
            }
        }
        return jurisdictions;
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
