package org.egov.pgr.analytics;

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
 * Fail-OPEN by design for this demo: an admin, an employee with no HRMS assignment, or any
 * resolution failure yields {@code departmentCodes = null} (unrestricted) — preserving today's
 * behavior for admins/supervisors. Only an employee with a concrete HRMS department assignment
 * gets row-scoped. Pure citizens keep their existing self-scope.
 */
@Component
@Slf4j
public class PrincipalScopeResolver {

    private final PGRConfiguration config;
    private final RestTemplate restTemplate;
    private final ObjectMapper mapper;

    @Autowired
    public PrincipalScopeResolver(PGRConfiguration config, RestTemplate restTemplate, ObjectMapper mapper) {
        this.config = config;
        this.restTemplate = restTemplate;
        this.mapper = mapper;
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

        boolean isCitizen = "CITIZEN".equalsIgnoreCase(u.getType());
        boolean hasEmployeeRole = false;
        List<Role> roles = u.getRoles();
        if (roles != null) for (Role r : roles) {
            String c = r.getCode() == null ? "" : r.getCode().toUpperCase();
            if (!c.equals("CITIZEN")) hasEmployeeRole = true;
        }

        // a pure citizen is locked to their own records; no department/boundary axis applies.
        if (isCitizen && !hasEmployeeRole)
            return new AnalyticsScope(tenantId, stateLevel, u.getUuid(), null, null);

        // employee principal → derive department/jurisdiction scope from HRMS.
        return resolveEmployeeScope(requestInfo, u, tenantId, stateLevel);
    }

    /**
     * Employee derivation. THIS is the body a policy-engine cutover would replace. Returns a
     * ScopeSpec with departmentCodes (and best-effort boundaryPrefix). On any failure or empty
     * assignment set, returns an unrestricted (tenant-only) spec — fail-open for the demo.
     */
    private AnalyticsScope resolveEmployeeScope(RequestInfo requestInfo, User u, String tenantId, boolean stateLevel) {
        try {
            String userName = u.getUserName();
            if (userName == null || userName.isEmpty())
                return new AnalyticsScope(tenantId, stateLevel, null, null, null);

            JsonNode employees = searchHrmsByCode(requestInfo, tenantId, userName);
            if (employees == null || !employees.isArray() || employees.size() == 0) {
                log.debug("no HRMS employee for userName '{}' @ {} — unrestricted (fail-open)", userName, tenantId);
                return new AnalyticsScope(tenantId, stateLevel, null, null, null);
            }

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

            List<String> deptList = departments.isEmpty() ? null : new ArrayList<>(departments);
            log.info("PrincipalScopeResolver: userName='{}' departments={} boundaryPrefix={}",
                    userName, deptList, boundaryPrefix);
            return new AnalyticsScope(tenantId, stateLevel, null, boundaryPrefix, deptList);
        } catch (Exception ex) {
            log.warn("HRMS scope resolution failed for '{}' — unrestricted (fail-open): {}",
                    u.getUserName(), ex.toString());
            return new AnalyticsScope(tenantId, stateLevel, null, null, null);
        }
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
