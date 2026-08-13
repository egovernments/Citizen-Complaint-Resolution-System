package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.analytics.PrincipalScopeResolver;
import org.egov.pgr.config.PGRConfiguration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Config-driven ({@link ScopePolicy}) counterpart of {@link PrincipalScopeResolver}, for PGR
 * complaint search only. Deliberately a SEPARATE class in a separate package rather than another
 * method on {@link PrincipalScopeResolver}: that class is Dashboard/Analytics' own scope resolver
 * (its {@code ScopeAxis}-based {@code resolve} overloads), and a change made here to fix/extend
 * PGR search's policy-driven scoping must never risk touching Dashboard's behavior, or vice versa.
 * The two are intentionally NOT unified yet — once this engine has proven itself on PGR search,
 * Dashboard/Analytics can migrate to a {@link ScopePolicy}-driven resolve() here too and
 * {@link PrincipalScopeResolver}'s {@code ScopeAxis} machinery can retire.
 *
 * <p>The only thing reused from {@link PrincipalScopeResolver} is {@link
 * PrincipalScopeResolver#isPureCitizen}, which its own Javadoc already documents as the single
 * source of truth for that classification (shared with {@code EnrichmentService}) — that one is
 * meant to never drift, unlike the axis-resolution logic below. Everything else (HRMS lookup,
 * department/jurisdiction extraction, the tenant-wide-role fail-open exception, the deny-all
 * sentinel) is intentionally duplicated here rather than shared, so this class has no dependency
 * on Dashboard's resolver for its own core behavior. Keep {@link #TENANT_WIDE_ROLES} and {@link
 * #DENY_ALL_DEPARTMENT} in sync with {@link PrincipalScopeResolver}'s copies until the migration
 * above happens.
 */
@Component
@Slf4j
public class PolicyDrivenScopeResolver {

    /**
     * Roles that are legitimately tenant-wide and may be unrestricted with no HRMS department
     * (admins/supervisors). Every other employee role MUST resolve a department or be denied.
     * Kept identical to {@link PrincipalScopeResolver}'s copy — see class Javadoc.
     */
    private static final Set<String> TENANT_WIDE_ROLES = Set.of(
            "PGR_ADMIN", "SUPERUSER", "MDMS_ADMIN", "HRMS_ADMIN", "STADMIN",
            "SUPERVISOR", "PGR_SUPERVISOR");

    /** Sentinel department for a denied principal — matches no real row (fail-closed). */
    private static final String DENY_ALL_DEPARTMENT = "__scope_denied__";

    private final PGRConfiguration config;
    private final RestTemplate restTemplate;
    private final ObjectMapper mapper;
    private final PrincipalScopeResolver principalScopeResolver;

    @Autowired
    public PolicyDrivenScopeResolver(PGRConfiguration config, RestTemplate restTemplate, ObjectMapper mapper,
                                      PrincipalScopeResolver principalScopeResolver) {
        this.config = config;
        this.restTemplate = restTemplate;
        this.mapper = mapper;
        this.principalScopeResolver = principalScopeResolver;
    }

    /**
     * Produce the ScopeSpec for PGR complaint search. {@code scopePolicy} is the MDMS-authored (or
     * in-code default, when MDMS has none configured) {@code resource.complaint.scope} declaration
     * — see {@code AccessPolicyRegistry#getScopePolicy}. Per-role, per-axis levels are resolved by
     * {@link ScopePolicyEngine}, the SAME engine {@code AccessPolicyRegistry}'s generated Tier-2
     * condition is compiled from — one authored artifact, so the SQL prefilter here and the per-row
     * re-check there cannot disagree.
     */
    public PgrSearchScope resolve(RequestInfo requestInfo, String tenantId, int stateLevelLen, ScopePolicy scopePolicy) {
        boolean stateLevel = tenantId != null && tenantId.split("\\.").length == stateLevelLen;
        User u = requestInfo == null ? null : requestInfo.getUserInfo();

        if (u == null)
            return new PgrSearchScope(tenantId, stateLevel, null, null, null);

        if (principalScopeResolver.isPureCitizen(requestInfo))
            return new PgrSearchScope(tenantId, stateLevel, u.getUuid(), null, null);

        return resolveEmployeeScopeViaPolicy(requestInfo, u, tenantId, stateLevel, scopePolicy);
    }

    /**
     * Which axes are REQUIRED (level {@code OWN}) vs unrestricted (level {@code NONE}) for THIS
     * caller is read from {@code scopePolicy} — see {@link ScopePolicyEngine}. Only "no HRMS data
     * on ANY axis at all" routes through {@link #unresolvedScope} (preserving the tenant-wide-role
     * safety net for a genuinely blank HRMS record); once there's at least some assignment/
     * jurisdiction data, each axis is resolved independently by the engine, which fails closed
     * per-axis (a sentinel value, not "no restriction") when that SPECIFIC axis is required but
     * unresolvable — see {@link ScopePolicyEngine#UNRESOLVED_SENTINEL}.
     */
    private PgrSearchScope resolveEmployeeScopeViaPolicy(RequestInfo requestInfo, User u, String tenantId,
                                                          boolean stateLevel, ScopePolicy scopePolicy) {
        try {
            String userName = u.getUserName();
            if (userName == null || userName.isEmpty())
                return unresolvedScope(u, tenantId, stateLevel, "empty userName");

            JsonNode employees = searchHrmsByCode(requestInfo, tenantId, userName);
            if (employees == null || !employees.isArray() || employees.size() == 0)
                return unresolvedScope(u, tenantId, stateLevel, "no HRMS employee for '" + userName + "'");

            JsonNode emp = employees.get(0);
            Set<String> departments = extractDepartments(emp);
            Set<String> jurisdictions = extractJurisdictions(emp);

            if (departments.isEmpty() && jurisdictions.isEmpty())
                return unresolvedScope(u, tenantId, stateLevel, "no active HRMS department assignment or jurisdiction assignment");

            Set<String> roleCodes = u.getRoles() == null ? Set.of() : u.getRoles().stream()
                    .filter(r -> r != null && r.getCode() != null)
                    .map(r -> r.getCode().trim().toUpperCase())
                    .filter(c -> !c.isEmpty())
                    .collect(Collectors.toSet());

            Map<String, Set<String>> hrmsResolvedValuesPerAxis = Map.of(
                    "department", departments,
                    "jurisdiction", jurisdictions);
            Map<String, List<String>> resolvedAxisValues = ScopePolicyEngine.resolve(scopePolicy, roleCodes, hrmsResolvedValuesPerAxis);

            List<String> deptList = resolvedAxisValues.get("department");
            List<String> jurisdictionList = resolvedAxisValues.get("jurisdiction");
            log.info("PolicyDrivenScopeResolver: userName='{}' departments={} jurisdictions={} (policy-driven)",
                    userName, deptList, jurisdictionList);
            return new PgrSearchScope(tenantId, stateLevel, null, deptList, jurisdictionList);
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
    private PgrSearchScope unresolvedScope(User u, String tenantId, boolean stateLevel, String reason) {
        if (hasTenantWideRole(u)) {
            log.debug("scope unresolved ({}) for tenant-wide role '{}' — unrestricted", reason, u.getUserName());
            return new PgrSearchScope(tenantId, stateLevel, null, null, null);
        }
        log.info("scope unresolved ({}) for constrained principal '{}' — DENY (fail-closed)", reason, u.getUserName());
        return new PgrSearchScope(tenantId, stateLevel, null, List.of(DENY_ALL_DEPARTMENT), null);
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
