package org.egov.pgr.onboarding;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class OnboardingSteps {
    private final OnboardingProvisionerClient client;
    private final PlatformBaseline seed;
    private final ObjectMapper mapper;
    public OnboardingSteps(OnboardingProvisionerClient client, PlatformBaseline seed, ObjectMapper mapper) {
        this.client = client; this.seed = seed; this.mapper = mapper;
    }

    public void perform(String step, OnboardingSignup signup, OnboardingOperation operation, OnboardingProgress progress) {
        switch (step) {
            case "TENANT_FOUNDATION" -> foundation(signup, operation, progress);
            case "PLATFORM_BASELINE" -> baseline(signup, progress);
            case "FOUNDER_HRMS" -> founder(signup, operation, progress);
            case "ORGANIZATION" -> {
                operation.setOrganizationEnsureStarted(true);
                progress.save(); // Monotonic across every restart; precedes the first possible dispatch.
                ensureOrganization(signup, operation);
            }
            case "MEMBERSHIP" -> client.identity("memberships/_ensure", identityBody(signup, operation, true));
            case "BINDING" -> {
                var body = identityBody(signup, operation, true);
                body.put("digitUuid", operation.getFounderDigitUuid());
                client.identity("bindings/_ensure", body);
            }
            default -> throw new IllegalArgumentException("Unknown step " + step);
        }
    }

    public void ensureOrganization(OnboardingSignup signup, OnboardingOperation operation) {
        var body = identityBody(signup, operation, false);
        body.put("slug", signup.getUrlSlug()); body.put("name", signup.getAccountName());
        client.identity("organizations/_ensure", body);
    }

    public void publish(OnboardingOperation operation) {
        client.identity("organizations/_lifecycle", Map.of("operationId", operation.getId().toString(),
                "restartNo", operation.getLifecycleRestartNo(), "state", operation.getLifecycleDecision()));
    }

    private Map<String, Object> identityBody(OnboardingSignup signup, OnboardingOperation operation, boolean subject) {
        var body = new LinkedHashMap<String, Object>();
        body.put("operationId", operation.getId().toString()); body.put("restartNo", operation.getRestartNo());
        body.put("tenantId", signup.getRequestedTenantId());
        if (subject) body.put("subject", signup.getOwnerSubject());
        return body;
    }

    private void foundation(OnboardingSignup signup, OnboardingOperation operation, OnboardingProgress progress) {
        String tenant = signup.getRequestedTenantId();
        JsonNode schema = schema("tenant.tenants");
        progress.record("schema:tenant.tenants", () -> ensureSchema(tenant, schema));
        progress.record("tenant:" + tenant, () -> {
            JsonNode found = records(tenant, "tenant.tenants", tenant);
            if (!found.isEmpty() && !operation.getId().toString().equals(found.get(0).path("data").path("onboardingOperationId").asText()))
                throw new OnboardingFailure("TENANT_TAKEN", false);
            var data = new LinkedHashMap<String, Object>();
            data.put("code", tenant); data.put("name", signup.getAccountName());
            data.put("onboardingOperationId", operation.getId().toString());
            data.put("type", "CITY"); data.put("domainUrl", ""); data.put("imageId", null);
            data.put("emailId", ""); data.put("address", ""); data.put("contactNumber", "");
            data.put("OfficeTimings", Map.of("Mon - Fri", ""));
            data.put("city", Map.of("code", tenant, "name", signup.getAccountName(), "districtName", "",
                    "districtTenantCode", tenant, "ulbGrade", ""));
            ensureRecord(tenant, "tenant.tenants", tenant, data, true);
        });
        progress.record("encryption:" + tenant, () -> client.post("enc", "/egov-enc-service/crypto/v1/_generatekey", Map.of("tenantId", tenant)));
    }

    private void baseline(OnboardingSignup signup, OnboardingProgress progress) {
        String tenant = signup.getRequestedTenantId();
        for (JsonNode schema : seed.schemas()) {
            progress.record("schema:" + schema.path("code").asText(), () -> ensureSchema(tenant, schema));
        }
        for (JsonNode row : seed.records()) {
            String code = row.path("schemaCode").asText(), id = row.path("uniqueIdentifier").asText();
            progress.record("mdms:" + code + ":" + id, () -> ensureRecord(tenant, code, id, substitute(row.path("data"), tenant)));
        }
        progress.record("mobile", () -> {
            // Country master is deployment-owned; never inherit a regex from an unrelated tenant.
            JsonNode rules = records(signup.getCountryCode().toLowerCase(Locale.ROOT), "common-masters.MobileNumberValidation", null);
            JsonNode rule = null;
            for (JsonNode r : rules) if (r.path("isActive").asBoolean(true) && r.path("data").path("default").asBoolean()) {
                if (rule != null) throw new OnboardingFailure("COUNTRY_MOBILE_RULE_AMBIGUOUS", true);
                rule = r.path("data");
            }
            if (rule == null) throw new OnboardingFailure("COUNTRY_MOBILE_RULE_MISSING", true);
            ensureRecord(tenant, "common-masters.MobileNumberValidation", rule.path("countryCode").asText(), asMap(rule));
        });
        progress.record("state-info", () -> {
            var data = new LinkedHashMap<String, Object>(); data.put("code", tenant); data.put("name", signup.getAccountName());
            for (String k : List.of("qrCodeURL", "bannerUrl", "logoUrl", "logoUrlWhite", "statelogo")) data.put(k, "");
            data.put("hasLocalisation", true); data.put("defaultUrl", Map.of("citizen", "", "employee", ""));
            data.put("languages", signup.getLanguages().stream().map(l -> Map.of("label", l, "value", locale(l, signup.getCountryCode()))).toList());
            data.put("localizationModules", List.of(Map.of("label", "common", "value", "rainmaker-common")));
            ensureRecord(tenant, "common-masters.StateInfo", tenant, data, true);
        });
        for (String language : signup.getLanguages()) progress.record("localization:" + language, () -> client.post("localization",
                "/localization/messages/v1/_upsert", Map.of("tenantId", tenant, "messages", List.of(Map.of(
                        "code", "TENANT_TENANTS_" + tenant.toUpperCase(Locale.ROOT), "message", signup.getAccountName(),
                        "module", "rainmaker-common", "locale", locale(language, signup.getCountryCode()))))));
        rootBoundary(tenant, progress);
    }

    private void rootBoundary(String tenant, OnboardingProgress progress) {
        Map<String,Object> root = new LinkedHashMap<>(); root.put("boundaryType", "ROOT"); root.put("parentBoundaryType", null); root.put("active", true);
        progress.record("boundary-hierarchy", () -> ensureBoundary("/boundary-service/boundary-hierarchy-definition/_search",
                Map.of("BoundaryTypeHierarchySearchCriteria",Map.of("tenantId",tenant,"hierarchyType","ADMIN")), "BoundaryHierarchy",
                "/boundary-service/boundary-hierarchy-definition/_create", Map.of("BoundaryHierarchy",
                        Map.of("tenantId", tenant, "hierarchyType", "ADMIN", "boundaryHierarchy", List.of(root)))));
        progress.record("boundary-root", () -> ensureBoundary("/boundary-service/boundary/_search?tenantId=" + tenant + "&codes=" + tenant,
                Map.of(), "Boundary", "/boundary-service/boundary/_create", Map.of("Boundary", List.of(Map.of("tenantId", tenant, "code", tenant)))));
        progress.record("boundary-relationship", () -> ensureBoundary("/boundary-service/boundary-relationships/_search",
                Map.of("BoundaryRelationship", Map.of("tenantId", tenant, "hierarchyType", "ADMIN")), "TenantBoundary",
                "/boundary-service/boundary-relationships/_create", Map.of("BoundaryRelationship",
                        Map.of("tenantId", tenant, "code", tenant, "hierarchyType", "ADMIN", "boundaryType", "ROOT"))));
    }

    private void ensureBoundary(String search, Map<String,Object> criteria, String field, String create, Map<String,Object> body) {
        JsonNode existing = client.post("boundary", search, criteria).path(field);
        if (!existing.isArray()) throw new OnboardingFailure("BOUNDARY_INVALID_RESPONSE", true);
        if (!existing.isEmpty()) return;
        createProjectedRecord("boundary", create, body);
        existing = client.post("boundary", search, criteria).path(field);
        if (!existing.isArray() || existing.isEmpty()) throw new OnboardingFailure("BOUNDARY_NOT_VISIBLE", true);
    }

    private void founder(OnboardingSignup signup, OnboardingOperation operation, OnboardingProgress progress) {
        String tenant = signup.getRequestedTenantId(), code = "FOUNDER_" + signup.getId().toString().replace("-", "");
        JsonNode employees = client.post("hrms", "/egov-hrms/employees/_search?tenantId=" + tenant + "&codes=" + code, Map.of()).path("Employees");
        if (!employees.isArray()) throw new OnboardingFailure("HRMS_INVALID_RESPONSE", true);
        if (employees.size() > 1) throw new OnboardingFailure("FOUNDER_AMBIGUOUS", false);
        if (employees.isEmpty()) {
            if (operation.getFounderDigitUuid() != null) throw new OnboardingFailure("FOUNDER_NOT_FOUND", true);
            JsonNode contact = mapper.valueToTree(signup.getTenantMetadata().get("tenantAdmin"));
            List<Map<String, String>> roles = new ArrayList<>();
            seed.founderRoles().forEach(r -> roles.add(Map.of("code", r.asText(), "name", r.asText(), "tenantId", tenant)));
            var user = new LinkedHashMap<String, Object>();
            user.put("name", signup.getFounderName()); user.put("userName", code);
            String phone = contact.path("mobileNumber").asText().replaceAll("[\\s()-]", "");
            String countryCode = contact.path("countryCode").asText().trim();
            if (!countryCode.isBlank() && phone.startsWith(countryCode)) phone = phone.substring(countryCode.length());
            if (phone.isBlank()) throw new OnboardingFailure("TENANT_ADMIN_ACCOUNT_REJECTED", false);
            user.put("mobileNumber", phone);
            if (!countryCode.isBlank()) user.put("countryCode", countryCode);
            user.put("type", "EMPLOYEE"); user.put("active", true); user.put("tenantId", tenant); user.put("roles", roles);
            if (signup.isFounderEmailVerified()) user.put("emailId", signup.getFounderEmail());
            var employee = new LinkedHashMap<String,Object>();
            employee.put("tenantId", tenant); employee.put("code", code); employee.put("employeeStatus", "EMPLOYED");
            employee.put("employeeType", "PERMANENT"); employee.put("dateOfAppointment", signup.getCreatedAt());
            employee.put("user", user); employee.put("isActive", true);
            employee.put("assignments", List.of(Map.of("department", "ONBOARDING_ADMIN", "designation", "ONBOARDING_FOUNDER",
                    "fromDate", signup.getCreatedAt(), "isCurrentAssignment", true)));
            employee.put("jurisdictions", List.of(Map.of("tenantId", tenant, "hierarchy", "ADMIN", "boundaryType", "ROOT", "boundary", tenant, "roles", roles)));
            try {
                client.post("hrms", "/egov-hrms/employees/_create", Map.of("Employees", List.of(employee)));
            } catch (OnboardingFailure failure) {
                // Search on the next claim after uncertain/duplicate writes; never create
                // a different founder to work around an asynchronous HRMS projection.
                if (failure.isRetryable()) throw failure;
                String error = failure.getCode().toUpperCase(Locale.ROOT);
                if (error.contains("DUPLICATE") || error.contains("ALREADY_EXIST") || error.equals("PROVISIONING_HTTP_409"))
                    throw new OnboardingFailure("FOUNDER_NOT_VISIBLE", true);
                throw new OnboardingFailure("TENANT_ADMIN_ACCOUNT_REJECTED", false);
            }
            // HRMS/egov-user persist asynchronously. A later claim searches again before create.
            employees = client.post("hrms", "/egov-hrms/employees/_search?tenantId=" + tenant + "&codes=" + code, Map.of()).path("Employees");
        }
        String uuid = employees.path(0).path("user").path("uuid").asText();
        if (uuid.isBlank()) throw new OnboardingFailure("FOUNDER_NOT_VISIBLE", true);
        if (operation.getFounderDigitUuid() != null && !operation.getFounderDigitUuid().equals(uuid))
            throw new OnboardingFailure("BINDING_CONFLICT", false);
        operation.setFounderDigitUuid(uuid); progress.save();
    }

    private JsonNode schema(String code) {
        for (JsonNode s : seed.schemas()) if (code.equals(s.path("code").asText())) return s;
        throw new IllegalArgumentException(code);
    }
    private void ensureSchema(String tenant, JsonNode schema) {
        String code = schema.path("code").asText();
        JsonNode found = client.post("mdms", "/egov-mdms-service/schema/v1/_search", Map.of("SchemaDefCriteria", Map.of("tenantId", tenant, "codes", List.of(code)))).path("SchemaDefinitions");
        if (!found.isArray()) throw new OnboardingFailure("MDMS_INVALID_RESPONSE", true);
        if (!found.isEmpty()) return;
        var body = asMap(schema); body.put("tenantId", tenant); body.put("description", code); body.put("isActive", true);
        createProjectedRecord("mdms", "/egov-mdms-service/schema/v1/_create", Map.of("SchemaDefinition", body));
        found = client.post("mdms", "/egov-mdms-service/schema/v1/_search", Map.of("SchemaDefCriteria", Map.of("tenantId", tenant, "codes", List.of(code)))).path("SchemaDefinitions");
        if (!found.isArray() || found.isEmpty()) throw new OnboardingFailure("MDMS_SCHEMA_NOT_VISIBLE", true);
    }
    public JsonNode records(String tenant, String schema, String id) {
        var criteria = new LinkedHashMap<String, Object>(); criteria.put("tenantId", tenant); criteria.put("schemaCode", schema); criteria.put("limit", 1000);
        if (id != null) criteria.put("uniqueIdentifiers", List.of(id));
        JsonNode rows = client.post("mdms", "/egov-mdms-service/v2/_search", Map.of("MdmsCriteria", criteria)).path("mdms");
        if (!rows.isArray()) throw new OnboardingFailure("MDMS_INVALID_RESPONSE", true);
        return rows;
    }
    private void ensureRecord(String tenant, String schema, String id, Map<String,Object> data) {
        ensureRecord(tenant, schema, id, data, false);
    }
    private void ensureRecord(String tenant, String schema, String id, Map<String,Object> data, boolean refresh) {
        JsonNode rows = records(tenant, schema, id);
        if (rows.isEmpty()) {
            createProjectedRecord("mdms", "/egov-mdms-service/v2/_create/" + schema, Map.of("Mdms", Map.of(
                    "tenantId", tenant, "schemaCode", schema, "uniqueIdentifier", id, "isActive", true, "data", data)));
            rows = records(tenant, schema, id);
        }
        if (rows.isEmpty()) throw new OnboardingFailure("MDMS_RECORD_NOT_VISIBLE", true);
        if (!rows.get(0).path("isActive").asBoolean(true)) throw new OnboardingFailure("BASELINE_RECORD_INACTIVE", false);
        if (refresh && !rows.get(0).path("data").equals(mapper.valueToTree(data))) {
            var record = asMap(rows.get(0));
            var merged = asMap(rows.get(0).path("data")); merged.putAll(data); record.put("data", merged);
            client.post("mdms", "/egov-mdms-service/v2/_update/" + schema, Map.of("Mdms", record));
            JsonNode visible = records(tenant, schema, id).path(0).path("data");
            for (var field : data.entrySet()) if (!Objects.equals(visible.get(field.getKey()), mapper.valueToTree(field.getValue())))
                throw new OnboardingFailure("MDMS_RECORD_NOT_VISIBLE", true);
        }
    }
    private void createProjectedRecord(String service, String path, Map<String,Object> body) {
        try { client.post(service, path, body); }
        catch (OnboardingFailure failure) {
            String code = failure.getCode().toUpperCase(Locale.ROOT);
            if (code.contains("DUPLICATE") || code.contains("ALREADY_EXIST") || code.equals("PROVISIONING_HTTP_409"))
                throw new OnboardingFailure("PROVISIONING_RECORD_NOT_VISIBLE", true);
            throw failure;
        }
    }
    private Map<String,Object> substitute(JsonNode node, String tenant) {
        try { return asMap(mapper.readTree(mapper.writeValueAsString(node).replace("{tenantid}", tenant))); }
        catch (Exception e) { throw new IllegalStateException("Invalid baseline", e); }
    }
    private Map<String,Object> asMap(JsonNode node) { return mapper.convertValue(node, new TypeReference<LinkedHashMap<String,Object>>() {}); }
    public static String locale(String language, String country) { return language.replace('-', '_').contains("_") ? language.replace('-', '_') : language + "_" + country; }
}
