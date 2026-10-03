package org.egov.novubridge.service.policy;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.util.ServiceUrl;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-tenant channel policy from the MDMS master {@code NOTIFICATIONS.Channel} at the tenant's
 * STATE root ({@code ke.bomet} to {@code ke}): one row per channel,
 * {@code {code, enabled, gateway, senderId, provider, active}}. A tenant with no rows falls back,
 * automatically and per tenant, to the legacy {@code RAINMAKER-PGR.NotificationChannel} master, and
 * only a tenant with neither falls back to the env vars.
 *
 * <p>{@code provider} is the Novu integration identifier (or {@code _id}) of the ONE active
 * provider for the channel; blank = the pre-catalog {@code gateway} routing. Cache: an empty fetch is never cached,
 * a stale non-empty entry is served through an MDMS outage.
 */
@Slf4j
@Component
public class ChannelPolicyClient {

    /** @param provider Novu integration identifier of the active provider; blank = none */
    public record ChannelSetting(String code, boolean enabled, String gateway, String senderId, String provider) {
    }

    private record Timed(Map<String, ChannelSetting> rows, long fetchedAt) {
        boolean fresh(long ttl) {
            return System.currentTimeMillis() - fetchedAt < ttl;
        }
    }

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    private final Map<String, Timed> cache = new ConcurrentHashMap<>();
    private final Set<String> fallbackLogged = ConcurrentHashMap.newKeySet();
    private final Set<String> legacyLogged = ConcurrentHashMap.newKeySet();

    public ChannelPolicyClient(@Nullable RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    /** A tenant WITH rows is governed by them alone (no row = off); only a tenant with none uses the env list. */
    public boolean isEnabled(String tenantId, String channel) {
        if (!StringUtils.hasText(channel)) return false;
        Map<String, ChannelSetting> rows = enabled() ? rowsFor(stateTenant(tenantId)) : Map.of();
        if (rows.isEmpty()) {
            return config.isChannelEnabled(channel);
        }
        ChannelSetting s = rows.get(channel.trim().toUpperCase(Locale.ROOT));
        return s != null && s.enabled();
    }

    /** Gateway id for the (tenant, channel): {@code novu} (default) or {@code smscountry}. */
    public String gateway(String tenantId, String channel) {
        Optional<ChannelSetting> s = setting(tenantId, channel);
        if (s.isPresent() && StringUtils.hasText(s.get().gateway())) {
            return s.get().gateway().trim().toLowerCase(Locale.ROOT);
        }
        return "SMS".equalsIgnoreCase(channel) && config.isSmsCountryDirect() ? "smscountry" : "novu";
    }

    /** The integration the tenant pinned for the channel (outranks {@code gateway} and env), or null. */
    public String provider(String tenantId, String channel) {
        Optional<ChannelSetting> s = setting(tenantId, channel);
        if (s.isPresent() && StringUtils.hasText(s.get().provider())) {
            return s.get().provider().trim();
        }
        return null;
    }

    /**
     * Who still sends through an integration, from ONE read of each state's channel rows (MDMS now,
     * never the cache, with the same new-then-legacy choice dispatch makes).
     *
     * @param selecting the state tenants whose rows select it, by identifier or Novu {@code _id} (a
     *                  row may name either); empty when the policy is off, since dispatch then
     *                  never reads a pin
     * @param unpinned  per requested DIGIT channel code, the enabled channels that send through
     *                  Novu with no provider selected (see {@link #providerUsage})
     */
    public record ProviderUsage(List<String> selecting, Map<String, List<String>> unpinned) {
        public List<String> unpinned(String code) {
            return unpinned.getOrDefault(code.toUpperCase(Locale.ROOT), List.of());
        }
    }

    /**
     * Who sends through this integration, for the provider delete/disable guard.
     *
     * <p>{@code unpinnedCodes} are DIGIT channel codes ({@code SMS}, {@code WHATSAPP}, {@code EMAIL}).
     * For each, the enabled channels with that code that name no provider: a row without
     * {@code provider}, or, for a state with no rows at all, the {@code novu.bridge.channels.enabled}
     * list. An SMS channel on the direct SMSCountry gateway does not use Novu and is left out. Labels
     * read {@code <state>:<CHANNEL>}; with the policy off every tenant runs on the env list, labelled
     * {@code all tenants:<CHANNEL>}.
     *
     * <p>Fails CLOSED: throws when a state's rows cannot be read, so a delete is never allowed on a
     * guess.
     */
    public ProviderUsage providerUsage(Collection<String> stateTenants, String identifier, String id,
                                       Collection<String> unpinnedCodes) {
        List<String> selecting = new ArrayList<>();
        Map<String, List<String>> unpinned = new LinkedHashMap<>();
        Set<String> codes = new LinkedHashSet<>();
        for (String code : unpinnedCodes) {
            if (StringUtils.hasText(code)) {
                codes.add(code.trim().toUpperCase(Locale.ROOT));
            }
        }
        codes.forEach(code -> unpinned.put(code, new ArrayList<>()));
        if (!enabled()) {
            codes.forEach(code -> envUnpinned("all tenants", code, unpinned.get(code)));
            return new ProviderUsage(selecting, unpinned);
        }
        for (String stateTenant : new LinkedHashSet<>(stateTenants)) {
            if (!StringUtils.hasText(stateTenant)) {
                continue;
            }
            Map<String, ChannelSetting> rows = currentRowsOrThrow(stateTenant);
            if (usesProvider(rows, identifier) || usesProvider(rows, id)) {
                selecting.add(stateTenant);
            }
            for (String code : codes) {
                if (rows.isEmpty()) {
                    envUnpinned(stateTenant, code, unpinned.get(code));
                    continue;
                }
                ChannelSetting s = rows.get(code);
                if (s != null && s.enabled() && !StringUtils.hasText(s.provider())
                        && !directSmsCountry(s.code(), s.gateway())) {
                    unpinned.get(code).add(stateTenant + ":" + code);
                }
            }
        }
        return new ProviderUsage(selecting, unpinned);
    }

    /**
     * The integrations the bridge names by env var rather than by channel row, keyed by DIGIT
     * channel: {@code novu.bridge.integration.id.whatsapp} is what every WhatsApp trigger without a
     * selected provider names.
     */
    public Map<String, String> envPinnedIntegrations() {
        Map<String, String> out = new LinkedHashMap<>();
        if (StringUtils.hasText(config.getWhatsappIntegrationId())) {
            out.put("WHATSAPP", config.getWhatsappIntegrationId().trim());
        }
        return out;
    }

    /**
     * Every state tenant this instance has read channel rows for since it started, plus the states
     * that own the providers (the core-SMS default's and {@code novu.bridge.provider.admin.tenants}),
     * so a restart never shrinks the set below them.
     */
    public Set<String> knownStateTenants() {
        Set<String> states = new LinkedHashSet<>(cache.keySet());
        states.addAll(config.providerAdminStateTenants());
        return states;
    }

    /** A state's rows as dispatch would choose them (new schema, else legacy), read now; throws on failure. */
    private Map<String, ChannelSetting> currentRowsOrThrow(String stateTenant) {
        Map<String, ChannelSetting> rows = fetchOrThrow(stateTenant, config.getChannelPolicySchema());
        if (rows.isEmpty() && hasDistinctLegacySchema()) {
            rows = fetchOrThrow(stateTenant, config.getChannelPolicyLegacySchema());
        }
        return rows;
    }

    private void envUnpinned(String label, String code, List<String> out) {
        if (config.isChannelEnabled(code) && !directSmsCountry(code, null)) {
            out.add(label + ":" + code);
        }
    }

    /** {@link #gateway}'s rule: an SMS row's gateway, else {@code novu.bridge.sms.provider}. */
    private boolean directSmsCountry(String code, String rowGateway) {
        if (!"SMS".equalsIgnoreCase(code)) {
            return false;
        }
        if (StringUtils.hasText(rowGateway)) {
            return "smscountry".equalsIgnoreCase(rowGateway.trim());
        }
        return config.isSmsCountryDirect();
    }

    private static boolean usesProvider(Map<String, ChannelSetting> rows, String key) {
        if (!StringUtils.hasText(key)) {
            return false;
        }
        for (ChannelSetting s : rows.values()) {
            if (s.provider() != null && key.trim().equalsIgnoreCase(s.provider().trim())) {
                return true;
            }
        }
        return false;
    }

    /** Sender id for a direct SMS gateway: the tenant's row, else the env default. */
    public String senderId(String tenantId, String channel) {
        Optional<ChannelSetting> s = setting(tenantId, channel);
        if (s.isPresent() && StringUtils.hasText(s.get().senderId())) {
            return s.get().senderId();
        }
        return config.getSmsSenderId();
    }

    /** The tenant's row for the channel, or empty when the tenant has no policy rows at all. */
    public Optional<ChannelSetting> setting(String tenantId, String channel) {
        if (!enabled() || !StringUtils.hasText(channel)) {
            return Optional.empty();
        }
        String stateTenant = stateTenant(tenantId);
        Map<String, ChannelSetting> rows = rowsFor(stateTenant);
        if (rows.isEmpty()) {
            if (stateTenant != null && fallbackLogged.add(stateTenant)) {
                log.info("No {} rows (nor legacy {}) at tenant {} — using the env fallback "
                                + "(novu.bridge.channels.enabled / sms.provider) until the master is seeded",
                        config.getChannelPolicySchema(), config.getChannelPolicyLegacySchema(), stateTenant);
            }
            return Optional.empty();
        }
        return Optional.ofNullable(rows.get(channel.trim().toUpperCase(Locale.ROOT)));
    }

    private boolean enabled() {
        return Boolean.TRUE.equals(config.getChannelPolicyEnabled()) && restTemplate != null;
    }

    public static String stateTenant(String tenantId) {
        if (!StringUtils.hasText(tenantId)) return null;
        int dot = tenantId.indexOf('.');
        return dot < 0 ? tenantId : tenantId.substring(0, dot);
    }

    private Map<String, ChannelSetting> rowsFor(String stateTenant) {
        if (stateTenant == null) return Map.of();
        long ttl = config.getChannelPolicyCacheTtlMs() != null ? config.getChannelPolicyCacheTtlMs() : 60_000L;
        Timed cached = cache.get(stateTenant);
        if (cached != null && cached.fresh(ttl)) return cached.rows();
        Map<String, ChannelSetting> fetched = fetch(stateTenant, config.getChannelPolicySchema());
        if (fetched.isEmpty() && hasDistinctLegacySchema()) {
            // All-or-nothing and automatic: no setting chooses, so no overlay can flip it.
            fetched = fetch(stateTenant, config.getChannelPolicyLegacySchema());
            if (!fetched.isEmpty() && legacyLogged.add(stateTenant)) {
                log.info("Tenant {} has no {} rows — serving channel policy from the legacy {} master. "
                                + "Move the tenant with `migrate-notifications.py` (plan, then apply).",
                        stateTenant, config.getChannelPolicySchema(), config.getChannelPolicyLegacySchema());
            }
        }
        if (!fetched.isEmpty()) {
            cache.put(stateTenant, new Timed(fetched, System.currentTimeMillis()));
            return fetched;
        }
        return cached != null ? cached.rows() : fetched;
    }

    private boolean hasDistinctLegacySchema() {
        return StringUtils.hasText(config.getChannelPolicyLegacySchema())
                && !config.getChannelPolicyLegacySchema().equals(config.getChannelPolicySchema());
    }

    /** Dispatch's read: a failure is logged and served as no rows (then stale, then the env fallback). */
    private Map<String, ChannelSetting> fetch(String stateTenant, String schemaCode) {
        try {
            return fetchOrThrow(stateTenant, schemaCode);
        } catch (Exception e) {
            log.warn("Channel policy lookup failed for tenant {} schema {} ({}); serving stale/fallback",
                    stateTenant, schemaCode, e.getMessage());
            return Map.of();
        }
    }

    /** An answer without an {@code mdms} list is a failure here, not "no rows". */
    @SuppressWarnings("unchecked")
    private Map<String, ChannelSetting> fetchOrThrow(String stateTenant, String schemaCode) {
        Map<String, Object> criteria = new LinkedHashMap<>();
        criteria.put("tenantId", stateTenant);
        criteria.put("schemaCode", schemaCode);
        criteria.put("isActive", true);
        criteria.put("limit", 100);
        criteria.put("offset", 0);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("RequestInfo", Map.of("apiId", "novu-bridge"));
        body.put("MdmsCriteria", criteria);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        String url = ServiceUrl.join(config.getMdmsHost(), config.getMdmsSearchPath());
        ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(body, headers), Map.class);
        Object mdms = response.getBody() != null ? response.getBody().get("mdms") : null;
        if (!(mdms instanceof List)) {
            throw new IllegalStateException("MDMS answered " + response.getStatusCode() + " with no mdms list");
        }
        Map<String, ChannelSetting> out = new LinkedHashMap<>();
        for (Object o : (List<Object>) mdms) {
            if (!(o instanceof Map)) continue;
            Map<String, Object> row = (Map<String, Object>) o;
            if (Boolean.FALSE.equals(row.get("isActive"))) continue;
            Object dataObj = row.get("data");
            if (!(dataObj instanceof Map)) continue;
            Map<String, Object> data = (Map<String, Object>) dataObj;
            if (Boolean.FALSE.equals(data.get("active"))) continue;
            Object code = data.get("code");
            if (code == null || !StringUtils.hasText(code.toString())) continue;
            out.put(code.toString().trim().toUpperCase(Locale.ROOT), new ChannelSetting(
                    code.toString().trim().toUpperCase(Locale.ROOT),
                    Boolean.TRUE.equals(data.get("enabled")),
                    data.get("gateway") != null ? data.get("gateway").toString() : null,
                    data.get("senderId") != null ? data.get("senderId").toString() : null,
                    data.get("provider") != null ? data.get("provider").toString() : null));
        }
        return out;
    }
}
