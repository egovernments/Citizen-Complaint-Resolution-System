package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.JsonNode;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
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

    public Map<String, Object> buildUserDoc(RequestInfo requestInfo, PgrSearchScope scope) {
        User user = requestInfo == null ? null : requestInfo.getUserInfo();

        Map<String, Object> attributes = new LinkedHashMap<>();
        // Department and jurisdiction are independent axes — an employee scoped by jurisdiction
        // alone (departmentCodes empty, jurisdictionCodes not) is NOT tenant-wide; only "no
        // restriction on EITHER axis" is. Checking departmentCodes alone would let a
        // boundary-only-scoped employee's condition short-circuit to unrestricted via the
        // "tenantWide" branch below, bypassing their own jurisdiction scope. This also already
        // covers ScopePolicyEngine's config-driven output correctly: a role configured ALL on both
        // axes resolves both PgrSearchScope fields to null (the engine omits ALL-level axes entirely),
        // landing here exactly like the old hardcoded "unrestricted" case — no axis-count-aware
        // rewrite needed as long as PgrSearchScope keeps exactly these two named fields.
        boolean tenantWide = scope.citizenUuid == null
                && CollectionUtils.isEmpty(scope.departmentCodes)
                && CollectionUtils.isEmpty(scope.jurisdictionCodes);
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
        // Deliberately no "tenantId" here: AccessPolicyRegistry.AXIS_FIELDS has no axis mapped to
        // resource.complaint.tenantId, so a JsonLogic condition referencing it would silently
        // consult an undefined value (Tier-2 drift risk, since Tier-1's SQL scope has no matching
        // predicate either) — add it back only alongside a real axis wired into AXIS_FIELDS and the
        // SQL side (#1441 review).
        complaint.put("boundary", extractBoundary(service));

        Map<String, Object> resource = new LinkedHashMap<>();
        resource.put("complaint", complaint);
        return resource;
    }

    /**
     * The complaint's jurisdiction boundary code, matched exact-match against an employee's HRMS
     * jurisdiction assignments (PgrSearchScope#jurisdictionCodes). Null-safe: a complaint with no
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
