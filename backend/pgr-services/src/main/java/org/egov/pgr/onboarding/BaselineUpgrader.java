package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.util.*;
import java.util.function.LongSupplier;

/**
 * Brings a workspace onboarded on an older platform seed up to the current one (#2288). The onboarding runner calls
 * {@link #upgradeNext()} on its own thread when no signup is waiting, so workspaces are upgraded one at a time.
 *
 * Every step is create-if-absent or compare-then-write: a record, message or StateInfo the founder has changed is
 * left alone and logged, and running a finished step again writes nothing. Progress is checkpointed per step on the
 * workspace row under a lease, so a crash resumes from the last finished step once the lease expires.
 */
@Slf4j
@Component
public class BaselineUpgrader {
    static final String STEP = "BASELINE_UPGRADE";
    static final long LEASE_MS = 600_000;
    private final WorkspaceRepository workspaces;
    private final OnboardingRepository onboarding;
    private final OnboardingSteps steps;
    private final OnboardingProvisionerClient client;
    private final PlatformBaseline seed;
    private final ObjectMapper mapper;
    private final boolean enabled;
    LongSupplier clock = System::currentTimeMillis;

    public BaselineUpgrader(WorkspaceRepository workspaces, OnboardingRepository onboarding, OnboardingSteps steps,
                            OnboardingProvisionerClient client, PlatformBaseline seed, ObjectMapper mapper,
                            @Value("${pgr.onboarding.baseline-upgrade.enabled:true}") boolean enabled) {
        this.workspaces = workspaces; this.onboarding = onboarding; this.steps = steps; this.client = client;
        this.seed = seed; this.mapper = mapper; this.enabled = enabled;
    }

    /** Upgrades at most one workspace. True when one was claimed, whether or not it finished. */
    @SuppressWarnings("unchecked")
    public boolean upgradeNext() {
        if (!enabled) return false;
        UUID token = UUID.randomUUID(); long now = clock.getAsLong();
        var claim = workspaces.claimUpgrade(seed.versionNumber(), token, now + LEASE_MS, now);
        if (claim.isEmpty()) return false;
        String tenant = claim.get().get("tenantId").toString(), from = claim.get().get("seedVersion").toString();
        try {
            upgrade(tenant, Integer.parseInt(from), (Map<String, Object>) claim.get().get("progress"), token);
        } catch (OnboardingFailure failure) {
            if ("ONBOARDING_LEASE_LOST".equals(failure.getCode())) return true;
            log.warn("Platform seed upgrade of {} from v{} failed ({}); it will be retried", tenant, from, failure.getCode());
            workspaces.retryUpgrade(tenant, token, failure.getCode(), failure.isRetryable(), clock.getAsLong());
        }
        // Unexpected failures leave the lease to expire: the next claim resumes from the last checkpoint.
        return true;
    }

    @SuppressWarnings("unchecked")
    void upgrade(String tenant, int from, Map<String, Object> progress, UUID token) {
        OnboardingSignup signup = onboarding.findActiveSignupByTenant(tenant)
                .orElseThrow(() -> new OnboardingFailure("UPGRADE_SIGNUP_NOT_FOUND", false));
        var scope = new OnboardingProgress.WriteScope(signup.getId(), tenant, STEP, () -> workspaces.holdsUpgrade(tenant, token, clock.getAsLong()));
        Runnable save = () -> {
            long now = clock.getAsLong();
            if (!workspaces.upgradeCheckpoint(tenant, token, progress, now + LEASE_MS, now)) throw new OnboardingFailure("ONBOARDING_LEASE_LOST", true);
        };
        var kept = (List<String>) progress.computeIfAbsent("kept", k -> new ArrayList<String>());
        step(progress, save, "records", () -> records(scope, signup, save, kept));
        step(progress, save, "localization-packs", () -> packs(scope, signup, progress, kept));
        if (from < 2) {
            step(progress, save, "state-info", () -> stateInfo(scope, signup, kept));
            step(progress, save, "stray-name-keys", () -> strayNameKeys(scope, signup, progress, kept));
        }
        // Upserts and deletes evict the tenant's own cache entries; the full bust matches workspace rename.
        step(progress, save, "cache-bust", () -> {
            if (Boolean.TRUE.equals(progress.get("localizationChanged"))) client.write(scope, "localization", "/localization/messages/cache-bust", Map.of());
        });
        if (workspaces.finishUpgrade(tenant, token, seed.version(), Map.of("from", String.valueOf(from), "to", seed.version(), "kept", new ArrayList<>(new LinkedHashSet<>(kept))), clock.getAsLong()))
            log.info("Workspace {} upgraded from platform seed v{} to v{}{}", tenant, from, seed.version(), kept.isEmpty() ? "" : "; left as is: " + new LinkedHashSet<>(kept));
    }

    private void step(Map<String, Object> progress, Runnable save, String name, Runnable action) {
        if ("DONE".equals(progress.get(name))) return;
        action.run();
        progress.put(name, "DONE");
        save.run();
    }

    /** Schemas, seed records (actions and role-actions included), workflows and the signup-derived masters, create-if-absent. */
    private void records(OnboardingProgress.WriteScope scope, OnboardingSignup signup, Runnable save, List<String> kept) {
        String tenant = signup.getRequestedTenantId();
        for (JsonNode schema : seed.schemas()) steps.ensureSchema(scope, tenant, schema);
        int done = 0;
        for (JsonNode row : seed.records()) {
            String code = row.path("schemaCode").asText(), id = row.path("uniqueIdentifier").asText();
            try { steps.ensureRecord(scope, tenant, code, id, steps.substitute(row.path("data"), tenant)); }
            catch (OnboardingFailure failure) {
                if (!"BASELINE_RECORD_INACTIVE".equals(failure.getCode())) throw failure;
                kept.add("inactive:" + code + ":" + id); // the founder deactivated it
            }
            if (++done % 100 == 0) save.run(); // extends the lease
        }
        for (JsonNode workflow : seed.workflows()) steps.ensureWorkflow(scope, tenant, workflow);
        steps.ensureIdFormat(scope, signup);
        steps.ensureMobileRule(scope, signup);
        steps.ensureDashboardConfig(scope, signup);
    }

    /**
     * Adds pack messages (and the tenant-name key where the pack holds rainmaker-common) that the tenant lacks in each
     * current StateInfo locale; existing messages are never rewritten. egov-localization answers from the tenant only
     * when it holds a message in the requested modules, otherwise from `default`. When `default` answers, nothing at
     * the tenant masks it, so the tenant is left alone rather than given a partial pack.
     */
    private void packs(OnboardingProgress.WriteScope scope, OnboardingSignup signup, Map<String, Object> progress, List<String> kept) {
        String tenant = signup.getRequestedTenantId(), nameKey = nameKey(tenant);
        for (String locale : steps.locales(signup).keySet()) {
            var packs = seed.localizationPacks(locale);
            if (packs.isEmpty()) continue;
            String modules = String.join(",", packs.keySet());
            JsonNode own = messages(tenant, locale, modules, null);
            if (!own.isEmpty() && identities(own, true).equals(identities(messages("default", locale, modules, null), true))) {
                kept.add("served-from-default:" + locale);
                continue;
            }
            Set<String> present = identities(own, false);
            packs.forEach((module, messages) -> {
                var missing = new ArrayList<JsonNode>();
                for (JsonNode m : messages) if (!present.contains(module + "|" + m.path("code").asText())) missing.add(m);
                for (int i = 0; i < missing.size(); i += 500)
                    upsert(scope, tenant, progress, missing.subList(i, Math.min(i + 500, missing.size())));
            });
            if (steps.seedsTenantNameModule(locale) && !present.contains(OnboardingSteps.TENANT_NAME_MODULE + "|" + nameKey))
                upsert(scope, tenant, progress, List.of(mapper.valueToTree(Map.of("code", nameKey, "message", signup.getAccountName(),
                        "module", OnboardingSteps.TENANT_NAME_MODULE, "locale", locale))));
        }
    }

    /** v1 wrote language_COUNTRY locales into StateInfo; rewrite them with the current rule unless the founder changed them. */
    private void stateInfo(OnboardingProgress.WriteScope scope, OnboardingSignup signup, List<String> kept) {
        String tenant = signup.getRequestedTenantId(), schema = "common-masters.StateInfo";
        JsonNode rows = steps.records(tenant, schema, tenant);
        if (rows.isEmpty()) throw new OnboardingFailure("MDMS_RECORD_NOT_VISIBLE", true);
        JsonNode languages = rows.get(0).path("data").path("languages"), current = mapper.valueToTree(steps.stateInfoLanguages(signup));
        if (languages.equals(current)) return;
        if (!languages.equals(mapper.valueToTree(v1Languages(signup)))) {
            log.info("Workspace {}: StateInfo.languages was edited after onboarding; left as is", tenant);
            kept.add("state-info-languages");
            return;
        }
        var record = steps.asMap(rows.get(0)); var data = steps.asMap(rows.get(0).path("data"));
        data.put("languages", steps.stateInfoLanguages(signup)); record.put("data", data);
        client.write(scope, "mdms", "/egov-mdms-service/v2/_update/" + schema, Map.of("Mdms", record));
        if (!steps.records(tenant, schema, tenant).path(0).path("data").path("languages").equals(current))
            throw new OnboardingFailure("MDMS_RECORD_NOT_VISIBLE", true);
    }

    /**
     * v1 wrote TENANT_TENANTS_&lt;T&gt; into every signup locale. Where the baseline seeds no rainmaker-common pack, that one
     * key makes the tenant answer for the locale and hides `default` (#2257). Removed only while it still holds the
     * workspace name.
     */
    private void strayNameKeys(OnboardingProgress.WriteScope scope, OnboardingSignup signup, Map<String, Object> progress, List<String> kept) {
        String tenant = signup.getRequestedTenantId(), nameKey = nameKey(tenant);
        for (String language : new LinkedHashSet<>(signup.getLanguages())) {
            String locale = v1Locale(language, signup.getCountryCode());
            if (steps.seedsTenantNameModule(locale)) continue;
            for (JsonNode m : messages(tenant, locale, OnboardingSteps.TENANT_NAME_MODULE, nameKey)) {
                if (!nameKey.equals(m.path("code").asText())) continue;
                if (!signup.getAccountName().equals(m.path("message").asText())) {
                    log.info("Workspace {}: {} in {} was edited after onboarding; left as is", tenant, nameKey, locale);
                    kept.add("name-key:" + locale);
                    continue;
                }
                client.write(scope, "localization", "/localization/messages/v1/_delete", Map.of("tenantId", tenant,
                        "messages", List.of(Map.of("code", nameKey, "module", OnboardingSteps.TENANT_NAME_MODULE, "locale", locale))));
                progress.put("localizationChanged", true);
            }
        }
    }

    private void upsert(OnboardingProgress.WriteScope scope, String tenant, Map<String, Object> progress, List<JsonNode> messages) {
        client.write(scope, "localization", "/localization/messages/v1/_upsert", Map.of("tenantId", tenant, "messages", messages));
        progress.put("localizationChanged", true);
    }

    private JsonNode messages(String tenant, String locale, String modules, String code) {
        JsonNode found = client.read("localization", "/localization/messages/v1/_search?tenantId=" + tenant + "&locale=" + locale
                + "&module=" + modules + (code == null ? "" : "&codes=" + code), Map.of()).path("messages");
        if (!found.isArray()) throw new OnboardingFailure("LOCALIZATION_INVALID_RESPONSE", true);
        return found;
    }

    private static Set<String> identities(JsonNode messages, boolean withText) {
        Set<String> out = new HashSet<>();
        for (JsonNode m : messages) out.add(m.path("module").asText() + "|" + m.path("code").asText() + (withText ? "|" + m.path("message").asText() : ""));
        return out;
    }

    private static String nameKey(String tenant) { return "TENANT_TENANTS_" + tenant.toUpperCase(Locale.ROOT); }

    /** StateInfo.languages as seed v1 wrote it: each signup language, region from the signup country. */
    static List<Map<String, String>> v1Languages(OnboardingSignup signup) {
        return signup.getLanguages().stream().map(l -> Map.of("label", l, "value", v1Locale(l, signup.getCountryCode()))).toList();
    }

    static String v1Locale(String language, String country) {
        return language.replace('-', '_').contains("_") ? language.replace('-', '_') : language + "_" + country;
    }
}
