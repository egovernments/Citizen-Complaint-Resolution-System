package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.HrmsScopeSemantics;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.Principals;
import org.egov.pgr.util.RoleCodes;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Config-driven ({@link ScopePolicy}) scope resolution for every surface that reads complaints.
 *
 * <p>This began as PGR complaint search's own resolver, deliberately separate from
 * Dashboard/Analytics' {@code PrincipalScopeResolver} so that a change to one could not disturb the
 * other, with a stated plan: <em>"once this engine has proven itself on PGR search,
 * Dashboard/Analytics can migrate to a ScopePolicy-driven resolve() here too and
 * PrincipalScopeResolver's ScopeAxis machinery can retire."</em> That migration is #1050, and it
 * has happened — analytics now resolves through {@code AnalyticsRowScopeResolver}, which calls
 * {@link SearchAccessPolicyService#resolveScope} and gets this same object back. There is one
 * resolver and one authored policy, so the dashboard and the search API can no longer disagree
 * about the same caller; before, they did, because the retired resolver left the jurisdiction axis
 * unresolved on purpose.
 *
 * <p>Citizen classification is shared with {@code EnrichmentService} through
 * {@link org.egov.pgr.util.Principals#isPureCitizen} — the single source of truth for that
 * security-relevant question, which is meant never to drift. The HRMS lookup and
 * department/jurisdiction extraction below stay local to this class.
 *
 * <p>Within this module there is exactly ONE deny sentinel constant
 * ({@link ScopePolicyEngine#UNRESOLVED_SENTINEL}) — {@link #denyAllScope} delegates to
 * {@link PgrSearchScope#deniedAll} rather than keeping its own copy (#1441 review).
 *
 * <p>There is NO hard-coded tenant-wide-role bypass here: whether a role is unrestricted on an axis
 * is decided ENTIRELY by the authored {@link ScopePolicy} (an explicit {@code ALL} for that
 * role/axis), even when HRMS has no data at all for the caller — see
 * {@link #resolveEmployeeScopeViaPolicy}. The retired analytics resolver had such a list, which is
 * why admin roles were unrestricted on the dashboard and policy-scoped on search.
 */
@Component
@Slf4j
public class PolicyDrivenScopeResolver {

    private final PGRConfiguration config;
    private final RestTemplate restTemplate;
    private final ObjectMapper mapper;
    private final Principals principals;
    private final MDMSUtils mdmsUtils;
    private final BoundaryHierarchyExpander boundaryHierarchyExpander;

    @Autowired
    public PolicyDrivenScopeResolver(PGRConfiguration config, RestTemplate restTemplate, ObjectMapper mapper,
                                      Principals principals, MDMSUtils mdmsUtils,
                                      BoundaryHierarchyExpander boundaryHierarchyExpander) {
        this.config = config;
        this.restTemplate = restTemplate;
        this.mapper = mapper;
        this.principals = principals;
        this.mdmsUtils = mdmsUtils;
        this.boundaryHierarchyExpander = boundaryHierarchyExpander;
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

        // An absent identity has no restrictive axis to fall back to (citizenUuid/departmentCodes/
        // jurisdictionCodes all null reads as tenantWide=true in PolicyInputBuilder) — deny rather
        // than let a missing/incomplete identity resolve to unrestricted access.
        if (u == null)
            return denyAllScope(tenantId, stateLevel);

        // The requested tenantId is client-controlled (RequestSearchCriteria#tenantId); the only
        // trustworthy tenant is the one the auth layer stamped on the token (u.getTenantId()). A
        // role check alone (e.g. a TENANT_WIDE_ROLES member with no HRMS record for this tenant)
        // must never be enough to grant access to a tenant the caller has no affiliation with —
        // validate the subtree BEFORE any role/HRMS resolution runs, and fail closed on mismatch,
        // same as any other unresolvable scope.
        if (!isAuthorizedTenant(u.getTenantId(), tenantId)) {
            log.warn("PolicyDrivenScopeResolver: requested tenantId='{}' is outside caller '{}' 's own tenant/subtree ('{}') — DENY (fail-closed)",
                    tenantId, u.getUserName(), u.getTenantId());
            return denyAllScope(tenantId, stateLevel);
        }

        if (principals.isPureCitizen(requestInfo)) {
            String uuid = u.getUuid();
            if (uuid == null || uuid.isBlank())
                return denyAllScope(tenantId, stateLevel);
            return new PgrSearchScope(tenantId, stateLevel, uuid, null, null);
        }

        return resolveEmployeeScopeViaPolicy(requestInfo, u, tenantId, stateLevel, scopePolicy);
    }

    private PgrSearchScope denyAllScope(String tenantId, boolean stateLevel) {
        return PgrSearchScope.deniedAll(tenantId, stateLevel);
    }

    /**
     * The requested tenantId is authorized only when it IS the caller's own (token-derived) home
     * tenant, or a descendant subtree of it — narrowing into a city under a state-wide identity is
     * fine, but a caller may never widen past their own tenant/subtree merely by naming a
     * different tenantId in the search criteria. Fails closed (false) when either side is
     * missing/blank, since there is then nothing to authorize against.
     */
    private static boolean isAuthorizedTenant(String callerTenantId, String requestedTenantId) {
        if (callerTenantId == null || callerTenantId.isBlank()
                || requestedTenantId == null || requestedTenantId.isBlank())
            return false;
        return requestedTenantId.equals(callerTenantId)
                || requestedTenantId.startsWith(callerTenantId + ".");
    }

    /**
     * Which axes are REQUIRED (level {@code OWN}) vs unrestricted (level {@code ALL}) for THIS
     * caller is read from {@code scopePolicy} — see {@link ScopePolicyEngine}. EVERY outcome here
     * (a resolved HRMS record, an empty one, no HRMS record at all, or an HRMS lookup error) routes
     * through the SAME {@link ScopePolicyEngine#resolve} call, passing whatever department/
     * jurisdiction values were actually resolved (possibly empty sets) — there is no hard-coded
     * role-based bypass. The engine already fails closed per-axis (a sentinel value, not "no
     * restriction") when a REQUIRED axis has no resolvable value, and only lets a role through
     * unrestricted when the authored policy explicitly grants that role {@code ALL} for that axis
     * — see {@link ScopePolicyEngine#UNRESOLVED_SENTINEL}. This means a hard-coded tenant-wide role
     * with no HRMS record is denied unless the policy itself says {@code ALL} for it.
     */
    private PgrSearchScope resolveEmployeeScopeViaPolicy(RequestInfo requestInfo, User u, String tenantId,
                                                          boolean stateLevel, ScopePolicy scopePolicy) {
        Set<String> roleCodes = extractRoleCodes(u);
        try {
            String userName = u.getUserName();
            if (userName == null || userName.isEmpty())
                return resolveViaEngine(requestInfo, u, tenantId, stateLevel, scopePolicy, roleCodes, Set.of(), Set.of(), "empty userName");

            JsonNode employees = searchHrmsByCode(requestInfo, tenantId, userName);
            if (employees == null || !employees.isArray() || employees.size() == 0)
                return resolveViaEngine(requestInfo, u, tenantId, stateLevel, scopePolicy, roleCodes, Set.of(), Set.of(),
                        "no HRMS employee for '" + userName + "'");

            JsonNode emp = employees.get(0);
            Set<String> departments = extractDepartments(emp);
            Set<String> jurisdictions = extractJurisdictions(emp, requestInfo, tenantId);
            return resolveViaEngine(requestInfo, u, tenantId, stateLevel, scopePolicy, roleCodes, departments, jurisdictions, null);
        } catch (Exception ex) {
            log.warn("HRMS scope resolution failed for '{}': {}", u.getUserName(), ex.toString());
            return resolveViaEngine(requestInfo, u, tenantId, stateLevel, scopePolicy, roleCodes, Set.of(), Set.of(), "HRMS error");
        }
    }

    private static Set<String> extractRoleCodes(User u) {
        return RoleCodes.normalize(u);
    }

    /**
     * @param noDataReason non-null only when {@code departments}/{@code jurisdictions} are empty
     *                      because HRMS resolution didn't produce anything (missing/blank/error) —
     *                      purely for the log line, has no effect on the resolved scope itself.
     */
    private PgrSearchScope resolveViaEngine(RequestInfo requestInfo, User u, String tenantId, boolean stateLevel,
                                             ScopePolicy scopePolicy, Set<String> roleCodes, Set<String> departments,
                                             Set<String> jurisdictions, String noDataReason) {
        Map<String, Set<String>> hrmsResolvedValuesPerAxis = Map.of(
                "department", departments,
                "jurisdiction", jurisdictions);
        Map<String, List<String>> resolvedAxisValues = ScopePolicyEngine.resolve(scopePolicy, roleCodes, hrmsResolvedValuesPerAxis);

        List<String> deptList = expandDepartmentNames(requestInfo, tenantId, resolvedAxisValues.get("department"));
        List<String> jurisdictionList = resolvedAxisValues.get("jurisdiction");
        if (noDataReason != null)
            log.info("PolicyDrivenScopeResolver: userName='{}' — {} — resolving via policy with no HRMS axis data: departments={} jurisdictions={}",
                    u.getUserName(), noDataReason, deptList, jurisdictionList);
        else
            log.info("PolicyDrivenScopeResolver: userName='{}' departments={} jurisdictions={} (policy-driven)",
                    u.getUserName(), deptList, jurisdictionList);
        return new PgrSearchScope(tenantId, stateLevel, null, deptList, jurisdictionList);
    }

    /**
     * HRMS only ever gives department CODEs, but complaints created before this system started
     * storing the code (see {@code PGRService#getDepartmentFromMDMS}) still have the display NAME
     * in that field — union in each code's display name (via MDMS {@code common-masters.Department})
     * so a department-scoped search still matches those historical rows, not just new ones. The
     * deny-all sentinel is never a real code and is excluded from the lookup entirely (both to avoid
     * a wasted MDMS call on the already-denied path, and because it must never accidentally resolve
     * to a real name). Best-effort: an MDMS failure just skips the expansion (see
     * {@link MDMSUtils#getDepartmentCodeToNameMap}), it never fails the search itself.
     */
    private List<String> expandDepartmentNames(RequestInfo requestInfo, String tenantId, List<String> departmentCodes) {
        if (departmentCodes == null || departmentCodes.isEmpty() || departmentCodes.contains(ScopePolicyEngine.UNRESOLVED_SENTINEL))
            return departmentCodes;
        Map<String, String> codeToName = mdmsUtils.getDepartmentCodeToNameMap(requestInfo, tenantId);
        if (codeToName.isEmpty())
            return departmentCodes;
        List<String> expanded = new java.util.ArrayList<>(departmentCodes);
        for (String code : departmentCodes) {
            String name = codeToName.get(code);
            if (name != null && !expanded.contains(name))
                expanded.add(name);
        }
        return expanded;
    }

    private static Set<String> extractDepartments(JsonNode emp) {
        Set<String> departments = new LinkedHashSet<>();
        JsonNode assignments = emp.get("assignments");
        if (assignments != null && assignments.isArray()) {
            for (JsonNode a : assignments) {
                boolean active = HrmsScopeSemantics.isCurrentAssignment(a);
                String dept = a.path("department").asText(null);
                if (active && dept != null && !dept.isEmpty()) departments.add(dept);
            }
        }
        return departments;
    }

    /**
     * Each active HRMS jurisdiction boundary is unioned in ALONGSIDE every descendant boundary
     * under it (see {@link BoundaryHierarchyExpander}) — an employee assigned a coarse boundary
     * (County/SubCounty) must match every complaint anywhere under it, not only complaints
     * tagged with that exact coarse code, which in practice never happens since complaints are
     * always addressed at the leaf (Ward) level.
     */
    private Set<String> extractJurisdictions(JsonNode emp, RequestInfo requestInfo, String tenantId) {
        Set<String> jurisdictions = new LinkedHashSet<>();
        JsonNode jurisdictionNodes = emp.get("jurisdictions");
        if (jurisdictionNodes != null && jurisdictionNodes.isArray()) {
            for (JsonNode j : jurisdictionNodes) {
                // Mirrors extractDepartments' isCurrentAssignment check — HRMS jurisdiction
                // records carry the same isActive semantic (eg_hrms_jurisdiction.isActive), so a
                // stale/superseded jurisdiction (e.g. after a transfer) must not stay unioned into
                // the caller's scope forever.
                boolean active = HrmsScopeSemantics.isActiveJurisdiction(j);
                String boundary = j.path("boundary").asText(null);
                String hierarchy = j.path("hierarchy").asText(null);
                if (active && boundary != null && !boundary.isEmpty()) {
                    if (hierarchy == null || hierarchy.isBlank())
                        jurisdictions.add(boundary);
                    else
                        jurisdictions.addAll(boundaryHierarchyExpander.descendantsOf(requestInfo, tenantId, hierarchy, boundary));
                }
            }
        }
        return jurisdictions;
    }

    /**
     * POST /egov-hrms/employees/_search with codes=[userName] + tenantId. Returns the Employees
     * JSON array node (or null). Uses the internal gateway host from egov.hrms.host.
     */
    private JsonNode searchHrmsByCode(RequestInfo requestInfo, String tenantId, String userName) {
        // Built via UriComponentsBuilder (query params encoded), not raw string concatenation: an
        // HRMS-linked username containing '&', '=', '%', or '#' (plausible for email-based/SSO
        // usernames) would otherwise corrupt the query string and resolve the wrong employee — the
        // exact record this resolver's department/jurisdiction scope values come from.
        String url = UriComponentsBuilder.fromHttpUrl(config.getHrmsHost() + config.getHrmsEndPoint())
                .queryParam("tenantId", tenantId)
                .queryParam("codes", userName)
                .encode()
                .toUriString();
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("RequestInfo", requestInfo);
        Object resp = restTemplate.postForObject(url, req, Map.class);
        JsonNode root = mapper.convertValue(resp, JsonNode.class);
        if (root == null) return null;
        return root.get("Employees");
    }
}
