package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.JsonNode;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.analytics.AnalyticsScope;
import org.egov.pgr.web.models.Address;
import org.egov.pgr.web.models.Boundary;
import org.egov.pgr.web.models.Service;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Builds the {@code user}/{@code resource} JsonLogic input document — the one shared contract
 * every Tier-2 PDP evaluation in pgr-services binds against (see the access-control policy design
 * doc). Extracted so record-level enforcement ({@link SearchAccessPolicyService}) and field-level
 * enforcement ({@link FieldVisibilityService}) build the exact same document, not two drifting
 * copies.
 */
@Component
public class PolicyInputBuilder {

    public Map<String, Object> buildUserDoc(RequestInfo requestInfo, AnalyticsScope scope) {
        User user = requestInfo == null ? null : requestInfo.getUserInfo();

        Map<String, Object> attributes = new LinkedHashMap<>();
        boolean tenantWide = scope.citizenUuid == null && CollectionUtils.isEmpty(scope.departmentCodes);
        attributes.put("tenantWide", tenantWide);
        attributes.put("departments", scope.departmentCodes == null ? List.of() : scope.departmentCodes);
        attributes.put("jurisdictions", scope.jurisdictionCodes == null ? List.of() : scope.jurisdictionCodes);

        Map<String, Object> userDoc = new LinkedHashMap<>();
        userDoc.put("uuid", user != null ? user.getUuid() : null);
        userDoc.put("type", user != null ? user.getType() : null);
        userDoc.put("attributes", attributes);
        return userDoc;
    }

    public Map<String, Object> buildResourceDoc(Service service) {
        Map<String, Object> complaint = new LinkedHashMap<>();
        complaint.put("accountId", service.getAccountId());
        complaint.put("department", extractDepartment(service));
        complaint.put("tenantId", service.getTenantId());
        complaint.put("boundary", extractBoundary(service));

        Map<String, Object> resource = new LinkedHashMap<>();
        resource.put("complaint", complaint);
        return resource;
    }

    /**
     * The complaint's jurisdiction boundary code, matched exact-match against an employee's HRMS
     * jurisdiction assignments (AnalyticsScope#jurisdictionCodes). Null-safe: a complaint with no
     * address/locality yields null, which never matches any non-empty jurisdiction list — fails
     * closed rather than leaking a complaint with unresolvable location data.
     */
    private String extractBoundary(Service service) {
        Address address = service.getAddress();
        if (address == null)
            return null;
        Boundary locality = address.getLocality();
        return locality == null ? null : locality.getCode();
    }

    /**
     * Service.additionalDetail is populated by PGRRowMapper as a Jackson JsonNode (via
     * mapper.readTree on the raw jsonb column) when read back from the DB, but as a plain Map
     * when built in-process (e.g. PGRService.create/update's deepMerge). Both shapes occur in
     * production, so both must be handled — silently returning null for the JsonNode case would
     * fail every department-scoped check closed.
     */
    private Object extractDepartment(Service service) {
        Object additionalDetail = service.getAdditionalDetail();
        if (additionalDetail instanceof Map)
            return ((Map<?, ?>) additionalDetail).get("department");
        if (additionalDetail instanceof JsonNode) {
            JsonNode department = ((JsonNode) additionalDetail).get("department");
            return department == null || department.isNull() ? null : department.asText();
        }
        return null;
    }
}
