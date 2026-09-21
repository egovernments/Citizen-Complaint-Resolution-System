package org.egov.novubridge.service.policy;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
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
 * Per-tenant channel policy, read from the MDMS master {@code NOTIFICATIONS.Channel} at the
 * tenant's STATE root ({@code ke.bomet} → {@code ke}), cached with a short TTL. One row per
 * channel: {@code {code, enabled, gateway, senderId, provider, active}}.
 *
 * <p>A tenant with NO rows there falls back, automatically and per tenant, to the pre-move
 * {@code RAINMAKER-PGR.NotificationChannel} master — the shape is unchanged, only the namespace
 * moved — so a server upgraded before the seeder copied its config keeps working. There is no
 * setting that chooses between them; the data chooses, and
 * {@code GET /novu-adapter/v1/config/source} reports which answered.
 *
 * <p>{@code provider} (optional) is the Novu integration <em>identifier</em> of the ONE
 * configured provider that is active for this channel — written by the configurator's
 * Notification Providers screen. Exactly one provider per channel per state tenant; there is
 * no automatic failover. When it is blank the pre-catalog behaviour applies verbatim:
 * {@code gateway} + the env fallbacks decide the transport.
 *
 * <p>This is the single authority on "is channel X on for tenant T, and through which
 * gateway". The deployment-wide env vars ({@code novu.bridge.channels.enabled},
 * {@code novu.bridge.sms.provider}, {@code novu.bridge.sms.sender.id}) remain only as a
 * bootstrap fallback for tenants that have <em>no</em> rows yet, and that fallback is
 * logged once per tenant so nobody mistakes it for configuration.
 *
 * <p>Cache semantics mirror pgr-services' MDMS masters: an empty fetch is never cached
 * (retry next event); a stale non-empty entry is served during an MDMS outage.
 */
@Slf4j
@Component
public class ChannelPolicyClient {

    public static final class ChannelSetting {
        public final String code;
        public final boolean enabled;
        public final String gateway;
        public final String senderId;
        /** Novu integration identifier of the active provider for this channel; blank = none. */
        public final String provider;

        public ChannelSetting(String code, boolean enabled, String gateway, String senderId) {
            this(code, enabled, gateway, senderId, null);
        }

        public ChannelSetting(String code, boolean enabled, String gateway, String senderId, String provider) {
            this.code = code;
            this.enabled = enabled;
            this.gateway = gateway;
            this.senderId = senderId;
            this.provider = provider;
        }
    }

    private static final class Timed {
        final Map<String, ChannelSetting> rows;
        final long fetchedAt = System.currentTimeMillis();
        Timed(Map<String, ChannelSetting> rows) { this.rows = rows; }
        boolean fresh(long ttl) { return System.currentTimeMillis() - fetchedAt < ttl; }
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

    /**
     * Whether the channel is enabled for the tenant. A tenant WITH policy rows is governed by
     * them alone — a channel with no row is off (no env leakage). Only a tenant with NO rows
     * at all falls back to the env allowlist.
     */
    public boolean isEnabled(String tenantId, String channel) {
        if (!StringUtils.hasText(channel)) return false;
        Map<String, ChannelSetting> rows = enabled() ? rowsFor(stateTenant(tenantId)) : Map.of();
        if (rows.isEmpty()) {
            return config.isChannelEnabled(channel);
        }
        ChannelSetting s = rows.get(channel.trim().toUpperCase(Locale.ROOT));
        return s != null && s.enabled;
    }

    /** Gateway id for the (tenant, channel): {@code novu} (default) or {@code smscountry}. */
    public String gateway(String tenantId, String channel) {
        Optional<ChannelSetting> s = setting(tenantId, channel);
        if (s.isPresent() && StringUtils.hasText(s.get().gateway)) {
            return s.get().gateway.trim().toLowerCase(Locale.ROOT);
        }
        return "SMS".equalsIgnoreCase(channel) && config.isSmsCountryDirect() ? "smscountry" : "novu";
    }

    /**
     * Novu integration identifier explicitly selected for the (tenant, channel), or {@code null}
     * when the tenant has not picked one. A non-null value means "deliver through Novu, targeting
     * exactly this integration"; it takes precedence over {@code gateway} and over every env
     * fallback. Null restores the pre-catalog routing entirely.
     */
    public String provider(String tenantId, String channel) {
        Optional<ChannelSetting> s = setting(tenantId, channel);
        if (s.isPresent() && StringUtils.hasText(s.get().provider)) {
            return s.get().provider.trim();
        }
        return null;
    }

    /**
     * Whether any channel row of the tenant still points at this integration identifier.
     * {@code tenantId == null} widens the check to every state tenant whose rows are already
     * cached — deleting a provider must not silently break a tenant this process has served.
     * It does NOT fetch tenants never seen: MDMS has no "search all tenants" call here, so a
     * delete is only ever refused on evidence, never on a guess.
     */
    public boolean isProviderInUse(String tenantId, String identifier) {
        if (!StringUtils.hasText(identifier)) {
            return false;
        }
        if (StringUtils.hasText(tenantId)) {
            return usesProvider(rowsFor(stateTenant(tenantId)), identifier);
        }
        for (Timed cached : cache.values()) {
            if (usesProvider(cached.rows, identifier)) {
                return true;
            }
        }
        return false;
    }

    private static boolean usesProvider(Map<String, ChannelSetting> rows, String identifier) {
        for (ChannelSetting s : rows.values()) {
            if (s.provider != null && identifier.equals(s.provider.trim())) {
                return true;
            }
        }
        return false;
    }

    /** Sender id for a direct SMS gateway: the tenant's row, else the env default. */
    public String senderId(String tenantId, String channel) {
        Optional<ChannelSetting> s = setting(tenantId, channel);
        if (s.isPresent() && StringUtils.hasText(s.get().senderId)) {
            return s.get().senderId;
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

    static String stateTenant(String tenantId) {
        if (!StringUtils.hasText(tenantId)) return null;
        int dot = tenantId.indexOf('.');
        return dot < 0 ? tenantId : tenantId.substring(0, dot);
    }

    private Map<String, ChannelSetting> rowsFor(String stateTenant) {
        if (stateTenant == null) return Map.of();
        long ttl = config.getChannelPolicyCacheTtlMs() != null ? config.getChannelPolicyCacheTtlMs() : 60_000L;
        Timed cached = cache.get(stateTenant);
        if (cached != null && cached.fresh(ttl)) return cached.rows;
        Map<String, ChannelSetting> fetched = fetch(stateTenant, config.getChannelPolicySchema());
        if (fetched.isEmpty() && StringUtils.hasText(config.getChannelPolicyLegacySchema())
                && !config.getChannelPolicyLegacySchema().equals(config.getChannelPolicySchema())) {
            // Per-tenant fallback to the pre-move namespace, for a server upgraded to this image
            // before the seeder copied its config. All-or-nothing and automatic: there is no
            // setting that chooses, so no overlay can flip it, and /config/source says which
            // namespace answered.
            fetched = fetch(stateTenant, config.getChannelPolicyLegacySchema());
            if (!fetched.isEmpty() && legacyLogged.add(stateTenant)) {
                log.info("Tenant {} has no {} rows — serving channel policy from the legacy {} master. "
                                + "Run `./deploy.sh <tenant> --tags notifications` to copy them.",
                        stateTenant, config.getChannelPolicySchema(), config.getChannelPolicyLegacySchema());
            }
        }
        if (!fetched.isEmpty()) {
            cache.put(stateTenant, new Timed(fetched));
            return fetched;
        }
        return cached != null ? cached.rows : fetched;
    }

    @SuppressWarnings("unchecked")
    private Map<String, ChannelSetting> fetch(String stateTenant, String schemaCode) {
        try {
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
            String url = config.getMdmsHost() + config.getMdmsSearchPath();
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(body, headers), Map.class);
            Object mdms = response.getBody() != null ? response.getBody().get("mdms") : null;
            Map<String, ChannelSetting> out = new LinkedHashMap<>();
            if (mdms instanceof List) {
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
            }
            return out;
        } catch (Exception e) {
            log.warn("Channel policy lookup failed for tenant {} schema {} ({}); serving stale/fallback",
                    stateTenant, schemaCode, e.getMessage());
            return Map.of();
        }
    }
}
