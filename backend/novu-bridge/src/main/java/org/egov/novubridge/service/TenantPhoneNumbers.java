package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.util.PhoneNumbers;
import org.egov.novubridge.util.ServiceUrl;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Completes a national phone number into E.164 with the country code of the TENANT it is sent
 * for, so one deployment can serve workspaces in several countries (KE, IN, ET, MZ, ...).
 *
 * <p>Where the country code comes from, first match wins:
 * <ol>
 *   <li>the number itself, when it is already international ({@code +…} / {@code 00…}), which is
 *       how a user's own egov-user {@code countryCode} arrives (the producer or
 *       {@code DigitUserSearch} prefixes it);</li>
 *   <li>the tenant's {@code common-masters.MobileNumberValidation} rule (the {@code default: true}
 *       one, else the first active one) — the rule digit-ui and the identity BFF validate the
 *       number against, and the one workspace onboarding writes from the signup country — read
 *       at the tenant, then at its state root, through MDMS v2 and cached per tenant for
 *       {@code novu.bridge.notifications.cache.ttl.ms};</li>
 *   <li>the deployment's {@code NOVU_BRIDGE_CORE_SMS_COUNTRY_CODE}, as a last resort.</li>
 * </ol>
 * None of them: {@link #toE164} answers null and the caller does not send. A failed MDMS read
 * serves the last answer it had for the tenant, else falls through to the deployment code.
 */
@Slf4j
@Component
public class TenantPhoneNumbers {

    public static final String MOBILE_RULE_SCHEMA = "common-masters.MobileNumberValidation";

    private record Cached(String dialCode, long fetchedAt) {
    }

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    /** The deployment fallback only: no tenant rule is ever read. */
    public TenantPhoneNumbers(NovuBridgeConfiguration config) {
        this(null, config);
    }

    @Autowired
    public TenantPhoneNumbers(@Nullable RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    /** {@code +<digits>} for this tenant, or null when no country code is known for a national number. */
    public String toE164(String phone, String tenantId) {
        if (!StringUtils.hasText(phone)) {
            return null;
        }
        if (PhoneNumbers.isInternational(phone)) {
            return PhoneNumbers.toE164(phone, null);
        }
        return PhoneNumbers.toE164(phone, dialCode(tenantId));
    }

    /**
     * The country code a national number sent for this tenant is completed with ({@code +254}),
     * or null when neither the tenant nor the deployment has one.
     */
    public String dialCode(String tenantId) {
        String own = tenantRule(tenantId);
        if (own != null) {
            return own;
        }
        String deployment = PhoneNumbers.dialDigits(config.getCoreSmsCountryCode());
        return deployment == null ? null : "+" + deployment;
    }

    /** Where the code came from, for an error message. */
    public String describeSources(String tenantId) {
        return "the number itself, " + MOBILE_RULE_SCHEMA + " at " + tenantId
                + (tenantId != null && tenantId.indexOf('.') > 0 ? " or " + tenantId.substring(0, tenantId.indexOf('.')) : "")
                + ", or NOVU_BRIDGE_CORE_SMS_COUNTRY_CODE";
    }

    String tenantRule(String tenantId) {
        if (!StringUtils.hasText(tenantId) || restTemplate == null
                || !StringUtils.hasText(config.getMdmsHost()) || !StringUtils.hasText(config.getMdmsSearchPath())) {
            return null;
        }
        String tenant = tenantId.trim();
        String own = cached(tenant);
        int dot = tenant.indexOf('.');
        return own != null || dot < 0 ? own : cached(tenant.substring(0, dot));
    }

    private String cached(String tenant) {
        long ttl = config.getNotificationConfigCacheTtlMs() != null ? config.getNotificationConfigCacheTtlMs() : 60_000L;
        long now = System.currentTimeMillis();
        Cached entry = cache.get(tenant);
        if (entry != null && now - entry.fetchedAt() < ttl) {
            return entry.dialCode();
        }
        String code;
        try {
            code = fetch(tenant);
        } catch (RuntimeException e) {
            // Stale beats nothing; a failure is remembered for one TTL, not retried per message.
            code = entry != null ? entry.dialCode() : null;
            log.warn("{} at {} could not be read ({}); using {} for national numbers for the next {}ms",
                    MOBILE_RULE_SCHEMA, tenant, e.getMessage(), code != null ? "the last known " + code
                            : "the deployment's NOVU_BRIDGE_CORE_SMS_COUNTRY_CODE", ttl);
        }
        cache.put(tenant, new Cached(code, now));
        return code;
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private String fetch(String tenant) {
        Map<String, Object> criteria = new LinkedHashMap<>();
        criteria.put("tenantId", tenant);
        criteria.put("schemaCode", MOBILE_RULE_SCHEMA);
        criteria.put("limit", 100);
        criteria.put("offset", 0);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("RequestInfo", Map.of("apiId", "novu-bridge"));
        body.put("MdmsCriteria", criteria);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<Map> response = restTemplate.exchange(ServiceUrl.join(config.getMdmsHost(),
                config.getMdmsSearchPath()), HttpMethod.POST, new HttpEntity<>(body, headers), Map.class);
        Object mdms = response.getBody() == null ? null : response.getBody().get("mdms");
        if (!(mdms instanceof List)) {
            throw new IllegalStateException("MDMS answered without an mdms list");
        }
        String first = null;
        for (Object record : (List<Object>) mdms) {
            if (!(record instanceof Map) || Boolean.FALSE.equals(((Map) record).get("isActive"))) {
                continue;
            }
            Object data = ((Map) record).get("data");
            if (!(data instanceof Map) || Boolean.FALSE.equals(((Map) data).get("isActive"))
                    || Boolean.FALSE.equals(((Map) data).get("active"))) {
                continue;
            }
            Object raw = ((Map) data).get("countryCode");
            String digits = raw == null ? null : PhoneNumbers.dialDigits(raw.toString());
            if (digits == null) {
                continue;
            }
            if (Boolean.TRUE.equals(((Map) data).get("default"))) {
                return "+" + digits;
            }
            if (first == null) {
                first = "+" + digits;
            }
        }
        return first;
    }
}
