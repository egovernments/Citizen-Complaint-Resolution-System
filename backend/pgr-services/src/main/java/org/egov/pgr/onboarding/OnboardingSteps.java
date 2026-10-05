package org.egov.pgr.onboarding;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class OnboardingSteps {
    /**
     * Reserved hierarchy that holds only the tenant's root boundary, for the founder's HRMS
     * jurisdiction. The operational hierarchy is the founder's own: the Geography step creates it
     * and records it in CMS-BOUNDARY.HierarchySchema, which digit-ui, the dashboard and the
     * configurator read. A one-level ADMIN here could never grow levels (boundary-service has no
     * hierarchy update), so it blocked that step (#2260).
     */
    public static final String WORKSPACE_HIERARCHY = "WORKSPACE";
    private final OnboardingProvisionerClient client;
    private final PlatformBaseline seed;
    private final ObjectMapper mapper;
    private final OnboardingIdentifierService identifiers;
    /** Platform tenant ids only (`default`); for tests that need no deployment configuration. */
    public OnboardingSteps(OnboardingProvisionerClient client, PlatformBaseline seed, ObjectMapper mapper) {
        this(client, seed, mapper, new OnboardingIdentifierService());
    }
    @Autowired
    public OnboardingSteps(OnboardingProvisionerClient client, PlatformBaseline seed, ObjectMapper mapper,
                           OnboardingIdentifierService identifiers) {
        this.client = client; this.seed = seed; this.mapper = mapper; this.identifiers = identifiers;
    }

    /**
     * mdms-v2 persists writes asynchronously, so a record read straight after its create is often not
     * yet visible. Instead of failing the whole step (and waiting out the runner's retry backoff, which
     * made a signup take minutes), re-read a few times with these pauses first. Empty (the default for
     * directly constructed instances, e.g. tests) means a single read, as before.
     */
    private long[] visibilityWaitsMs = new long[0];
    @org.springframework.beans.factory.annotation.Value("${pgr.onboarding.mdms-visibility-waits-ms:150,300,600,1200}")
    void setVisibilityWaitsMs(long[] waits) { this.visibilityWaitsMs = waits == null ? new long[0] : waits.clone(); }

    /** Reads until {@code visible} holds or the configured pauses run out; returns the last read. */
    private JsonNode awaitVisible(java.util.function.Supplier<JsonNode> read, java.util.function.Predicate<JsonNode> visible) {
        JsonNode result = read.get();
        for (long wait : visibilityWaitsMs) {
            if (visible.test(result)) return result;
            try { Thread.sleep(wait); } catch (InterruptedException e) { Thread.currentThread().interrupt(); return result; }
            result = read.get();
        }
        return result;
    }

    public void perform(String step, OnboardingSignup signup, OnboardingOperation operation, OnboardingProgress progress) {
        // Submit refuses a reserved tenant id, but a signup queued before that check existed may
        // still carry `default` or a state root. Refuse it terminally before any write, at every
        // step, so a run resumed past TENANT_FOUNDATION cannot finish either (#2269 round-3 item 1).
        if (identifiers.reservedTenantId(signup.getRequestedTenantId()))
            throw new OnboardingFailure("ONBOARDING_IDENTIFIER_TAKEN", false);
        var scope = progress.writeScope(signup, step);
        switch (step) {
            case "TENANT_FOUNDATION" -> foundation(signup, operation, progress, scope);
            case "PLATFORM_BASELINE" -> baseline(signup, progress, scope);
            case "FOUNDER_HRMS" -> founder(signup, operation, progress, scope);
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

    private void foundation(OnboardingSignup signup, OnboardingOperation operation, OnboardingProgress progress, OnboardingProgress.WriteScope scope) {
        String tenant = signup.getRequestedTenantId();
        JsonNode schema = schema("tenant.tenants");
        progress.record("schema:tenant.tenants", () -> ensureSchema(scope, tenant, schema));
        progress.record("tenant:" + tenant, () -> {
            JsonNode found = records(tenant, "tenant.tenants", tenant);
            if (!found.isEmpty() && !operation.getId().toString().equals(found.get(0).path("data").path("onboardingOperationId").asText()))
                throw new OnboardingFailure("TENANT_TAKEN", false);
            var data = new LinkedHashMap<String, Object>();
            data.put("code", tenant); data.put("name", signup.getAccountName());
            data.put("onboardingOperationId", operation.getId().toString());
            data.put("type", "CITY"); data.put("domainUrl", ""); data.put("imageId", null);
            data.put("emailId", ""); data.put("address", ""); data.put("contactNumber", "");
            // Signup choices are materialized on the authoritative tenant record (its schema allows extra fields).
            data.put("timeZone", signup.getTimeZone()); data.put("financialYearPolicy", signup.getFinancialYearPolicy());
            data.put("OfficeTimings", Map.of("Mon - Fri", ""));
            data.put("city", Map.of("code", tenant, "name", signup.getAccountName(), "districtName", "",
                    "districtTenantCode", tenant, "ulbGrade", ""));
            ensureRecord(scope, tenant, "tenant.tenants", tenant, data, true);
        });
        progress.record("encryption:" + tenant, () -> client.write(scope, "enc", "/egov-enc-service/crypto/v1/_generatekey", Map.of("tenantId", tenant)));
    }

    private void baseline(OnboardingSignup signup, OnboardingProgress progress, OnboardingProgress.WriteScope scope) {
        String tenant = signup.getRequestedTenantId();
        for (JsonNode schema : seed.schemas()) {
            progress.record("schema:" + schema.path("code").asText(), () -> ensureSchema(scope, tenant, schema));
        }
        for (JsonNode row : seed.records()) {
            String code = row.path("schemaCode").asText(), id = row.path("uniqueIdentifier").asText();
            progress.record("mdms:" + code + ":" + id, () -> ensureRecord(scope, tenant, code, id, substitute(row.path("data"), tenant)));
        }
        progress.record("id-format", () -> {
            // Complaint IDs carry the workspace's own code; SEQ_EG_PGR_ID stays one shared sequence.
            // idgen only interprets [..] tokens, so the literal prefix is kept to A-Z, 0-9 and '-'.
            String prefix = Objects.toString(signup.getAccountCode(), "").toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9-]", "");
            if (prefix.isEmpty()) throw new OnboardingFailure("ACCOUNT_CODE_INVALID", false);
            ensureRecord(scope, tenant, "common-masters.IdFormat", "pgr.servicerequestid", Map.of("idname", "pgr.servicerequestid",
                    "format", prefix + "-PGR-[cy:yyyy-MM-dd]-[SEQ_EG_PGR_ID]"));
        });
        for (JsonNode workflow : seed.workflows()) {
            String code = workflow.path("businessService").asText();
            progress.record("workflow:" + code, () -> {
                JsonNode found = client.read("workflow", "/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=" + tenant + "&businessServices=" + code, Map.of()).path("BusinessServices");
                if (!found.isArray()) throw new OnboardingFailure("WORKFLOW_INVALID_RESPONSE", true);
                // workflow-v2 caches searches in-JVM: re-searching before its persister lands would pin an
                // empty result, so an accepted create is the checkpoint and a replay searches again.
                if (found.isEmpty()) createProjectedRecord(scope, "workflow", "/egov-workflow-v2/egov-wf/businessservice/_create",
                        Map.of("BusinessServices", List.of(substitute(workflow, tenant))));
            });
        }
        progress.record("mobile", () -> {
            // The seed is the only source: onboarding never reads a country rule from another tenant.
            JsonNode rule = seed.countryMobileRule(signup.getCountryCode());
            if (rule.isMissingNode()) throw new OnboardingFailure("COUNTRY_NOT_SUPPORTED", false);
            validateMobileRule(rule);
            ensureRecord(scope, tenant, "common-masters.MobileNumberValidation", rule.path("countryCode").asText(), asMap(rule));
        });
        var locales = locales(signup);
        progress.record("state-info", () -> {
            var data = new LinkedHashMap<String, Object>(); data.put("code", tenant); data.put("name", signup.getAccountName());
            for (String k : List.of("qrCodeURL", "bannerUrl", "logoUrl", "logoUrlWhite", "statelogo")) data.put(k, "");
            data.put("hasLocalisation", true); data.put("defaultUrl", Map.of("citizen", "", "employee", ""));
            // digit-ui defaults to the first entry, so en_IN (the one locale with full packs) leads.
            data.put("languages", locales.entrySet().stream().map(e -> Map.of("label", e.getValue(), "value", e.getKey())).toList());
            data.put("localizationModules", List.of(Map.of("label", "common", "value", "rainmaker-common")));
            ensureRecord(scope, tenant, "common-masters.StateInfo", tenant, data, true);
        });
        // egov-localization serves the first tenant in [T, default] holding ANY message for the requested
        // modules, so T must own whole packs before its first key (#2257). digit-ui boot pins en_IN.
        for (String loc : locales.keySet()) seed.localizationPacks(loc).forEach((module, messages) ->
                progress.record("localization-pack:" + loc + ":" + module, () -> {
                    for (int i = 0; i < messages.size(); i += 500) {
                        var chunk = new ArrayList<JsonNode>();
                        for (int j = i; j < Math.min(i + 500, messages.size()); j++) chunk.add(messages.get(j));
                        client.write(scope, "localization", "/localization/messages/v1/_upsert", Map.of("tenantId", tenant, "messages", chunk));
                    }
                }));
        // The tenant-name key goes only where T now owns the whole rainmaker-common pack: anywhere else this one
        // key would make T the answering tenant for that locale and hide every `default` message (#2257).
        // Checkpoint names stay keyed by signup language so operations started before this rule replay cleanly.
        for (var language : locales.entrySet()) if (seedsTenantNameModule(language.getKey()))
            progress.record("localization:" + language.getValue(), () -> client.write(scope, "localization",
                "/localization/messages/v1/_upsert", Map.of("tenantId", tenant, "messages", List.of(Map.of(
                        "code", "TENANT_TENANTS_" + tenant.toUpperCase(Locale.ROOT), "message", signup.getAccountName(),
                        "module", TENANT_NAME_MODULE, "locale", language.getKey())))));
        // The dashboard (digit-ui and KpiCatalogService) reads its zone from the tenant's own "default" record.
        progress.record("dashboard-config", () -> ensureRecord(scope, tenant, "dss.DashboardConfig", "default",
                Map.of("id", "default", "timeZone", signup.getTimeZone())));
        rootBoundary(scope, tenant, progress);
    }

    private void rootBoundary(OnboardingProgress.WriteScope scope, String tenant, OnboardingProgress progress) {
        Map<String,Object> root = new LinkedHashMap<>(); root.put("boundaryType", "ROOT"); root.put("parentBoundaryType", null); root.put("active", true);
        progress.record("boundary-hierarchy", () -> ensureBoundary(scope, "/boundary-service/boundary-hierarchy-definition/_search",
                Map.of("BoundaryTypeHierarchySearchCriteria",Map.of("tenantId",tenant,"hierarchyType",WORKSPACE_HIERARCHY)), "BoundaryHierarchy", tenant,
                "/boundary-service/boundary-hierarchy-definition/_create", Map.of("BoundaryHierarchy",
                        Map.of("tenantId", tenant, "hierarchyType", WORKSPACE_HIERARCHY, "boundaryHierarchy", List.of(root)))));
        // Technical root placeholder only; operational geography is workspace-owned (Geography step).
        var geometry = Map.of("type", "Point", "coordinates", List.of(0,0));
        progress.record("boundary-root", () -> ensureBoundary(scope, "/boundary-service/boundary/_search?tenantId=" + tenant + "&codes=" + tenant,
                Map.of(), "Boundary", tenant, "/boundary-service/boundary/_create",
                Map.of("Boundary", List.of(Map.of("tenantId", tenant, "code", tenant, "geometry", geometry)))));
        // Stock boundary-service reads relationship search criteria from the query
        // string only; criteria in the body were ignored (8c gate 2).
        progress.record("boundary-relationship", () -> ensureBoundary(scope,
                "/boundary-service/boundary-relationships/_search?tenantId=" + tenant + "&hierarchyType=" + WORKSPACE_HIERARCHY,
                Map.of(), "TenantBoundary", tenant,
                "/boundary-service/boundary-relationships/_create", Map.of("BoundaryRelationship",
                        Map.of("tenantId", tenant, "code", tenant, "hierarchyType", WORKSPACE_HIERARCHY, "boundaryType", "ROOT"))));
    }

    private void validateMobileRule(JsonNode rule) {
        if (!rule.isObject() || !rule.path("default").isBoolean() || !rule.path("countryCode").isTextual()
                || !rule.path("countryCode").asText().matches("\\+[1-9][0-9]{0,3}")
                || !rule.path("mobileNumberRegex").isTextual() || rule.path("mobileNumberRegex").asText().isBlank())
            throw new OnboardingFailure("COUNTRY_MOBILE_RULE_INVALID", true);
        try { java.util.regex.Pattern.compile(rule.path("mobileNumberRegex").asText()); }
        catch (java.util.regex.PatternSyntaxException invalid) { throw new OnboardingFailure("COUNTRY_MOBILE_RULE_INVALID", true); }
    }

    private void ensureBoundary(OnboardingProgress.WriteScope scope, String search, Map<String,Object> criteria, String field, String tenant, String create, Map<String,Object> body) {
        if (boundaryPresent(client.read("boundary", search, criteria), field, tenant)) return;
        createProjectedRecord(scope, "boundary", create, body);
        if (!boundaryPresent(client.read("boundary", search, criteria), field, tenant))
            throw new OnboardingFailure("BOUNDARY_NOT_VISIBLE", true);
    }

    private boolean boundaryPresent(JsonNode response, String field, String tenant) {
        JsonNode entries = response.get(field);
        if (entries == null) throw new OnboardingFailure("BOUNDARY_INVALID_RESPONSE", true);
        if (entries.isNull()) return false; // stock boundary-service represents an empty search as null
        if (!entries.isArray()) throw new OnboardingFailure("BOUNDARY_INVALID_RESPONSE", true);
        for (JsonNode entry : entries) {
            if (!entry.isObject()) throw new OnboardingFailure("BOUNDARY_INVALID_RESPONSE", true);
            if (!boundaryIdentity(entry, tenant)) continue;
            if ("BoundaryHierarchy".equals(field) && WORKSPACE_HIERARCHY.equals(entry.path("hierarchyType").asText())) return true;
            if ("Boundary".equals(field) && tenant.equals(entry.path("code").asText())) return true;
            if ("TenantBoundary".equals(field)) {
                // A wrapper exists even when no relationship exists. Only the target
                // root node proves the HRMS prerequisite, never wrapper cardinality.
                JsonNode hierarchy = entry.path("hierarchyType");
                String hierarchyCode = hierarchy.isObject() ? hierarchy.path("code").asText()
                        : hierarchy.isTextual() ? hierarchy.asText() : ""; // a JSON null is not the string "null"
                if (!hierarchyCode.isBlank() && !WORKSPACE_HIERARCHY.equals(hierarchyCode)) continue;
                JsonNode roots = entry.path("boundary");
                if (roots.isMissingNode() || roots.isNull()) continue;
                if (roots.isObject()) { if (rootNode(roots, tenant)) return true; }
                else if (roots.isArray()) { for (JsonNode root : roots) if (rootNode(root, tenant)) return true; }
                else throw new OnboardingFailure("BOUNDARY_INVALID_RESPONSE", true);
            }
        }
        return false;
    }

    private boolean rootNode(JsonNode node, String tenant) {
        return node.isObject() && boundaryIdentity(node, tenant) && tenant.equals(node.path("code").asText())
                && "ROOT".equals(node.path("boundaryType").asText());
    }

    private boolean boundaryIdentity(JsonNode node, String tenant) {
        // Some scoped search projections omit these fields; explicit foreign or
        // inactive entries never establish the target tenant's prerequisite.
        return (!node.hasNonNull("tenantId") || tenant.equals(node.path("tenantId").asText()))
                && (!node.has("isActive") || node.path("isActive").isBoolean() && node.path("isActive").booleanValue())
                && (!node.has("active") || node.path("active").isBoolean() && node.path("active").booleanValue());
    }

    private void founder(OnboardingSignup signup, OnboardingOperation operation, OnboardingProgress progress, OnboardingProgress.WriteScope scope) {
        String tenant = signup.getRequestedTenantId(), code = "FOUNDER_" + signup.getId().toString().replace("-", "");
        JsonNode employees = client.read("hrms", "/egov-hrms/employees/_search?tenantId=" + tenant + "&codes=" + code + "&offset=0&limit=2", Map.of()).path("Employees");
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
            employee.put("jurisdictions", List.of(Map.of("tenantId", tenant, "hierarchy", WORKSPACE_HIERARCHY, "boundaryType", "ROOT", "boundary", tenant, "roles", roles)));
            try {
                client.write(scope, "hrms", "/egov-hrms/employees/_create", Map.of("Employees", List.of(employee)));
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
            employees = client.read("hrms", "/egov-hrms/employees/_search?tenantId=" + tenant + "&codes=" + code + "&offset=0&limit=2", Map.of()).path("Employees");
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
    private void ensureSchema(OnboardingProgress.WriteScope scope, String tenant, JsonNode schema) {
        String code = schema.path("code").asText();
        JsonNode found = client.read("mdms", "/egov-mdms-service/schema/v1/_search", Map.of("SchemaDefCriteria", Map.of("tenantId", tenant, "codes", List.of(code)))).path("SchemaDefinitions");
        if (!found.isArray()) throw new OnboardingFailure("MDMS_INVALID_RESPONSE", true);
        if (!found.isEmpty()) return;
        var body = asMap(schema); body.put("tenantId", tenant); body.put("description", code); body.put("isActive", true);
        createProjectedRecord(scope, "mdms", "/egov-mdms-service/schema/v1/_create", Map.of("SchemaDefinition", body));
        found = awaitVisible(() -> client.read("mdms", "/egov-mdms-service/schema/v1/_search", Map.of("SchemaDefCriteria", Map.of("tenantId", tenant, "codes", List.of(code)))).path("SchemaDefinitions"),
                rows -> rows.isArray() && !rows.isEmpty());
        if (!found.isArray() || found.isEmpty()) throw new OnboardingFailure("MDMS_SCHEMA_NOT_VISIBLE", true);
    }
    public JsonNode records(String tenant, String schema, String id) {
        var criteria = new LinkedHashMap<String, Object>(); criteria.put("tenantId", tenant); criteria.put("schemaCode", schema); criteria.put("limit", 1000);
        if (id != null) criteria.put("uniqueIdentifiers", List.of(id));
        JsonNode rows = client.read("mdms", "/egov-mdms-service/v2/_search", Map.of("MdmsCriteria", criteria)).path("mdms");
        if (!rows.isArray()) throw new OnboardingFailure("MDMS_INVALID_RESPONSE", true);
        return rows;
    }
    private void ensureRecord(OnboardingProgress.WriteScope scope, String tenant, String schema, String id, Map<String,Object> data) {
        ensureRecord(scope, tenant, schema, id, data, false);
    }
    private void ensureRecord(OnboardingProgress.WriteScope scope, String tenant, String schema, String id, Map<String,Object> data, boolean refresh) {
        JsonNode rows = records(tenant, schema, id);
        if (rows.isEmpty()) {
            createProjectedRecord(scope, "mdms", "/egov-mdms-service/v2/_create/" + schema, Map.of("Mdms", Map.of(
                    "tenantId", tenant, "schemaCode", schema, "uniqueIdentifier", id, "isActive", true, "data", data)));
            rows = awaitVisible(() -> records(tenant, schema, id), r -> !r.isEmpty());
        }
        if (rows.isEmpty()) throw new OnboardingFailure("MDMS_RECORD_NOT_VISIBLE", true);
        if (!rows.get(0).path("isActive").asBoolean(true)) throw new OnboardingFailure("BASELINE_RECORD_INACTIVE", false);
        if (refresh && !rows.get(0).path("data").equals(mapper.valueToTree(data))) {
            var record = asMap(rows.get(0));
            var merged = asMap(rows.get(0).path("data")); merged.putAll(data); record.put("data", merged);
            client.write(scope, "mdms", "/egov-mdms-service/v2/_update/" + schema, Map.of("Mdms", record));
            java.util.function.Predicate<JsonNode> applied = r -> data.entrySet().stream()
                    .allMatch(f -> Objects.equals(r.path(0).path("data").get(f.getKey()), mapper.valueToTree(f.getValue())));
            if (!applied.test(awaitVisible(() -> records(tenant, schema, id), applied)))
                throw new OnboardingFailure("MDMS_RECORD_NOT_VISIBLE", true);
        }
    }
    private void createProjectedRecord(OnboardingProgress.WriteScope scope, String service, String path, Map<String,Object> body) {
        try { client.write(scope, service, path, body); }
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

    /** Module holding TENANT_TENANTS_&lt;T&gt;. */
    static final String TENANT_NAME_MODULE = "rainmaker-common";
    /** True when the baseline seeds the whole tenant-name module in this locale, so T may hold its name key there. */
    public boolean seedsTenantNameModule(String locale) { return seed.localizationPacks(locale).containsKey(TENANT_NAME_MODULE); }

    /** StateInfo locales, in order, mapped to their label (the signup language): en_IN first, then each signup language. */
    LinkedHashMap<String, String> locales(OnboardingSignup signup) {
        var locales = new LinkedHashMap<String, String>(); locales.put("en_IN", "en");
        for (String language : signup.getLanguages()) locales.putIfAbsent(locale(language, signup.getCountryCode()), language);
        return locales;
    }

    /**
     * The DIGIT locale for a signup language. Packs and DIGIT deployments key a language by one locale code, not
     * by the signup country (digit-ui boots en_IN; the committed packs are en_IN, hi_IN, fr_FR and pt_BR), so:
     * <ul>
     *   <li>an explicit region is kept: {@code pt-br} becomes {@code pt_BR};</li>
     *   <li>a bare language with a committed pack uses that pack's locale: en is en_IN, fr is fr_FR, pt is pt_BR,
     *       hi is hi_IN, whatever the country;</li>
     *   <li>any other language takes the signup country, the DIGIT convention for locally added languages:
     *       sw in KE is sw_KE, am in ET is am_ET. No pack exists, so the tenant serves it from {@code default}.</li>
     * </ul>
     */
    String locale(String language, String country) {
        String[] parts = language.replace('-', '_').split("_", 2);
        String lang = parts[0].toLowerCase(Locale.ROOT);
        if (parts.length == 2) return lang + "_" + parts[1].toUpperCase(Locale.ROOT);
        for (String pack : seed.localeCodes()) if (pack.startsWith(lang + "_")) return pack;
        return lang + "_" + country.toUpperCase(Locale.ROOT);
    }
}
