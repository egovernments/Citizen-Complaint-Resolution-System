package org.egov.pgr.onboarding;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.util.*;

/**
 * Onboarding step {@value #STEP}, right after PLATFORM_BASELINE: gives a new workspace the notification
 * configuration a deploy gives a fresh tenant ({@link NotificationDefaults}): the notification schemas, the
 * access-control rows the Configurator's Notifications screens need, the event catalogue, the default
 * templates, WhatsApp provider templates and routing. No channel rows: the workspace follows the
 * deployment's {@code NOVU_BRIDGE_CHANNELS_ENABLED} until its admin switches channels on. Without this step a
 * self-serve workspace had no notification configuration at all, and the deploy cannot seed one later (its
 * ADMIN does not exist there and the founder has no DIGIT password).
 *
 * <ul>
 *   <li><b>Non-fatal.</b> A failure never stops the signup: it is logged with the way to finish the seed and
 *       recorded in the operation's progress ({@code notifications:skipped:<code>}). Only a lost lease
 *       propagates.</li>
 *   <li><b>Idempotent and create-only.</b> A row is matched by its schema's x-unique fields and only
 *       created when absent; nothing is ever updated, so a resumed run, or a founder's edit, is safe.</li>
 *   <li><b>Never over someone's configuration.</b> A routing row (either namespace) this seed did not write
 *       means the tenant is configured already: configuration is then left alone (schemas and access rows
 *       are still ensured). Routing is written last, so a tenant is served from these rows only once every
 *       template is in.</li>
 * </ul>
 */
@Slf4j
@Component
public class NotificationDefaultsStep {
    public static final String STEP = "NOTIFICATION_DEFAULTS";
    static final int PAGE = 500, MAX_PAGES = 20;
    private final NotificationDefaults defaults;
    private final OnboardingProvisionerClient client;
    private final ObjectMapper mapper;
    private final boolean enabled;
    private long[] visibilityWaitsMs = new long[0];

    public NotificationDefaultsStep(NotificationDefaults defaults, OnboardingProvisionerClient client, ObjectMapper mapper,
                                    @Value("${pgr.onboarding.notification-defaults.enabled:true}") boolean enabled) {
        this.defaults = defaults; this.client = client; this.mapper = mapper; this.enabled = enabled;
    }

    @Value("${pgr.onboarding.mdms-visibility-waits-ms:150,300,600,1200}")
    void setVisibilityWaitsMs(long[] waits) { this.visibilityWaitsMs = waits == null ? new long[0] : waits.clone(); }

    public void run(OnboardingSteps steps, OnboardingSignup signup, OnboardingProgress progress, OnboardingProgress.WriteScope scope) {
        String tenant = signup.getRequestedTenantId();
        if (!enabled) {
            log.info("Workspace {}: notification defaults are off (pgr.onboarding.notification-defaults.enabled=false)", tenant);
            return;
        }
        try {
            seed(steps, tenant, progress, scope);
        } catch (OnboardingFailure failure) {
            if ("ONBOARDING_LEASE_LOST".equals(failure.getCode())) throw failure;
            log.warn("Workspace {}: notification defaults were NOT fully seeded ({}); the workspace is provisioned without "
                    + "them and sends no notifications until they are. Finish them with seed-notifications.py "
                    + "(NOTIF_TENANT={}, DIGIT_ACCESS_TOKEN=<an admin's DIGIT access token>, NOTIF_ADOPT_DEFAULTS=1): "
                    + "docs/releases/2.20/notifications/setup-guide.md, 'New workspaces'", tenant, failure.getCode(), tenant);
            progress.record("notifications:skipped:" + failure.getCode(), () -> { });
        }
    }

    void seed(OnboardingSteps steps, String tenant, OnboardingProgress progress, OnboardingProgress.WriteScope scope) {
        for (JsonNode schema : defaults.schemas())
            progress.record("notifications:schema:" + schema.path("code").asText(), () -> steps.ensureSchema(scope, tenant, schema));
        boolean configured = configuredElsewhere(tenant);
        if (configured)
            log.info("Workspace {}: already has notification routing of its own; only the notification schemas and "
                    + "access-control rows are ensured, its configuration is left as it is", tenant);
        int created = 0;
        for (var group : defaults.recordsBySchema().entrySet()) {
            String schema = group.getKey();
            if (configured && defaults.configurationSchemas().contains(schema)) continue;
            Set<String> present = keys(schema, tenant);
            Set<String> wanted = new LinkedHashSet<>();
            for (JsonNode record : group.getValue()) {
                JsonNode data = defaults.data(record, tenant);
                String key = defaults.key(schema, data);
                wanted.add(key);
                if (present.contains(key)) continue;
                String id = record.path("uniqueIdentifier").asText();
                progress.record("notifications:" + schema + ":" + id, () -> create(scope, tenant, schema, id, data));
                created++;
            }
            if (!awaitVisible(schema, tenant, wanted)) throw new OnboardingFailure("MDMS_RECORD_NOT_VISIBLE", true);
        }
        log.info("Workspace {}: notification defaults in place ({} row(s) created)", tenant, created);
    }

    /** A routing row the seed would not have written: the tenant's own configuration. */
    private boolean configuredElsewhere(String tenant) {
        for (String schema : defaults.routingSchemas()) {
            Set<String> seeded = new HashSet<>();
            for (JsonNode record : defaults.recordsBySchema().getOrDefault(schema, List.of()))
                seeded.add(defaults.key(schema, defaults.data(record, tenant)));
            for (JsonNode row : rows(schema, tenant))
                if (!seeded.contains(defaults.key(schema, row.path("data")))) return true;
        }
        return false;
    }

    private void create(OnboardingProgress.WriteScope scope, String tenant, String schema, String id, JsonNode data) {
        var mdms = new LinkedHashMap<String, Object>();
        mdms.put("tenantId", tenant); mdms.put("schemaCode", schema); mdms.put("uniqueIdentifier", id);
        mdms.put("isActive", true); mdms.put("data", mapper.convertValue(data, new TypeReference<LinkedHashMap<String, Object>>() {}));
        try {
            client.write(scope, "mdms", "/egov-mdms-service/v2/_create/" + schema, Map.of("Mdms", mdms));
        } catch (OnboardingFailure failure) {
            String code = failure.getCode().toUpperCase(Locale.ROOT);
            // Created by an earlier, interrupted attempt and not yet visible: the visibility check decides.
            if (!(code.contains("DUPLICATE") || code.contains("ALREADY_EXIST") || code.equals("PROVISIONING_HTTP_409"))) throw failure;
        }
    }

    private boolean awaitVisible(String schema, String tenant, Set<String> wanted) {
        if (keys(schema, tenant).containsAll(wanted)) return true;
        for (long wait : visibilityWaitsMs) {
            try { Thread.sleep(wait); } catch (InterruptedException e) { Thread.currentThread().interrupt(); return false; }
            if (keys(schema, tenant).containsAll(wanted)) return true;
        }
        return false;
    }

    private Set<String> keys(String schema, String tenant) {
        Set<String> out = new HashSet<>();
        for (JsonNode row : rows(schema, tenant)) out.add(defaults.key(schema, row.path("data")));
        return out;
    }

    /** Every row of the schema at the tenant, inactive ones included (a row the founder switched off is still theirs). */
    private List<JsonNode> rows(String schema, String tenant) {
        List<JsonNode> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (int page = 0; page < MAX_PAGES; page++) {
            var criteria = new LinkedHashMap<String, Object>();
            criteria.put("tenantId", tenant); criteria.put("schemaCode", schema); criteria.put("limit", PAGE); criteria.put("offset", page * PAGE);
            JsonNode rows = client.read("mdms", client.mdmsSearchPath(), Map.of("MdmsCriteria", criteria)).path("mdms");
            if (!rows.isArray()) throw new OnboardingFailure("MDMS_INVALID_RESPONSE", true);
            int fresh = 0;
            for (JsonNode row : rows) {
                String id = row.path("id").asText(row.path("uniqueIdentifier").asText(UUID.randomUUID().toString()));
                if (seen.add(id)) { out.add(row); fresh++; }
            }
            if (rows.size() < PAGE || fresh == 0) break;
        }
        return out;
    }
}
