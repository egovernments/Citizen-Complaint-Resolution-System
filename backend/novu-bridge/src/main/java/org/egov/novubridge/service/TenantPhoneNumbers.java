package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.thin.ThinEventErrorCodes;
import org.egov.novubridge.util.PhoneNumbers;
import org.egov.novubridge.util.ServiceUrl;
import org.egov.tracer.model.CustomException;
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
import java.util.function.LongSupplier;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

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
 *       {@code novu.bridge.notifications.cache.ttl.ms}. Its {@code mobileNumberRegex} also
 *       decides whether digits that start with the code already carry it
 *       ({@link PhoneNumbers#toE164(String, String, Pattern)});</li>
 *   <li>the deployment's {@code NOVU_BRIDGE_CORE_SMS_COUNTRY_CODE}, as a last resort — only where
 *       MDMS ANSWERED that the tenant and its root have no rule.</li>
 * </ol>
 * None of them: {@link #toE164} answers null and the caller does not send.
 *
 * <p>A failed MDMS read is never "no rule": that would complete an Indian workspace's numbers
 * with a Kenyan deployment code for as long as MDMS is down. It serves the last answer MDMS gave
 * for the tenant (stale beats nothing), and with none throws {@link RuleUnavailable}
 * ({@code NB_CONFIG_UNAVAILABLE}, like a config master with no cached copy): the dispatch
 * pipeline records the message FAILED and the consumer dead-letters it for replay. A failure is
 * remembered for {@link #FAILURE_BACKOFF_MS} (at most the TTL), not a whole TTL, so a short MDMS
 * blip costs a few seconds of dead-lettered messages, and an outage one MDMS call per back-off
 * per tenant, not one per message.
 */
@Slf4j
@Component
public class TenantPhoneNumbers {

    public static final String MOBILE_RULE_SCHEMA = "common-masters.MobileNumberValidation";

    /** How long a failed read is remembered before MDMS is asked again (capped at the TTL). */
    static final long FAILURE_BACKOFF_MS = 5_000L;

    /**
     * The tenant's mobile rule could not be read and MDMS never answered for it: the country code
     * is unknown, NOT "none". Retryable; {@code NB_CONFIG_UNAVAILABLE}.
     */
    public static class RuleUnavailable extends CustomException {
        RuleUnavailable(String message) {
            super(ThinEventErrorCodes.CONFIG_UNAVAILABLE, message);
        }
    }

    /** A tenant's rule: its country code ({@code +254}) and national number pattern, if it has one. */
    record Rule(String dialCode, Pattern national) {
    }

    /**
     * What MDMS said about a tenant: {@code answered} once a read succeeded ({@code rule} null =
     * the tenant has no rule), and {@code failedAt} > 0 while the last read failed.
     */
    private record Entry(boolean answered, Rule rule, long answeredAt, long failedAt) {
    }

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    private final Map<String, Entry> cache = new ConcurrentHashMap<>();
    /** Overridden by tests. */
    LongSupplier clock = System::currentTimeMillis;

    /** The deployment fallback only: no tenant rule is ever read. */
    public TenantPhoneNumbers(NovuBridgeConfiguration config) {
        this(null, config);
    }

    @Autowired
    public TenantPhoneNumbers(@Nullable RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    /**
     * {@code +<digits>} for this tenant, or null when no country code is known for a national number.
     *
     * @throws RuleUnavailable the tenant's rule could not be read and none was ever read before
     */
    public String toE164(String phone, String tenantId) {
        if (!StringUtils.hasText(phone)) {
            return null;
        }
        if (PhoneNumbers.isInternational(phone)) {
            return PhoneNumbers.toE164(phone, null);
        }
        Rule rule = tenantRule(tenantId);
        if (rule != null) {
            return PhoneNumbers.toE164(phone, rule.dialCode(), rule.national());
        }
        return PhoneNumbers.toE164(phone, deploymentCode());
    }

    /**
     * The country code a national number sent for this tenant is completed with ({@code +254}),
     * or null when neither the tenant nor the deployment has one.
     *
     * @throws RuleUnavailable as {@link #toE164}
     */
    public String dialCode(String tenantId) {
        Rule own = tenantRule(tenantId);
        return own != null ? own.dialCode() : deploymentCode();
    }

    /** Where the code came from, for an error message. */
    public String describeSources(String tenantId) {
        return "the number itself, " + MOBILE_RULE_SCHEMA + " at " + tenantId
                + (tenantId != null && tenantId.indexOf('.') > 0 ? " or " + tenantId.substring(0, tenantId.indexOf('.')) : "")
                + ", or NOVU_BRIDGE_CORE_SMS_COUNTRY_CODE";
    }

    private String deploymentCode() {
        String deployment = PhoneNumbers.dialDigits(config.getCoreSmsCountryCode());
        return deployment == null ? null : "+" + deployment;
    }

    /**
     * The rule at the tenant, else at its state root; null only when MDMS answered that neither
     * has one (or no MDMS is configured). A city whose own read failed with nothing cached throws
     * rather than falling to its root: it may have a rule of its own.
     */
    Rule tenantRule(String tenantId) {
        if (!StringUtils.hasText(tenantId) || restTemplate == null
                || !StringUtils.hasText(config.getMdmsHost()) || !StringUtils.hasText(config.getMdmsSearchPath())) {
            return null;
        }
        String tenant = tenantId.trim();
        Rule own = cached(tenant);
        int dot = tenant.indexOf('.');
        return own != null || dot < 0 ? own : cached(tenant.substring(0, dot));
    }

    private Rule cached(String tenant) {
        long ttl = config.getNotificationConfigCacheTtlMs() != null ? config.getNotificationConfigCacheTtlMs() : 60_000L;
        long backoff = Math.min(ttl, FAILURE_BACKOFF_MS);
        long now = clock.getAsLong();
        Entry entry = cache.get(tenant);
        if (entry != null) {
            if (entry.failedAt() == 0 && now - entry.answeredAt() < ttl) {
                return entry.rule();
            }
            if (entry.failedAt() > 0 && now - entry.failedAt() < backoff) {
                return lastAnswer(tenant, entry);
            }
        }
        Rule rule;
        try {
            rule = fetch(tenant);
        } catch (RuntimeException e) {
            Entry failed = entry != null && entry.answered()
                    ? new Entry(true, entry.rule(), entry.answeredAt(), now)
                    : new Entry(false, null, 0L, now);
            cache.put(tenant, failed);
            log.warn("{} at {} could not be read ({}); {} for the next {}ms", MOBILE_RULE_SCHEMA, tenant, e.getMessage(),
                    failed.answered() ? "using the last answer MDMS gave ("
                            + (failed.rule() != null ? failed.rule().dialCode() : "no rule") + ")"
                            : "national numbers for it are not sent (NB_CONFIG_UNAVAILABLE)", backoff);
            return lastAnswer(tenant, failed);
        }
        cache.put(tenant, new Entry(true, rule, now, 0L));
        return rule;
    }

    /** Stale beats nothing; nothing ever answered is unknown, never "no rule". */
    private static Rule lastAnswer(String tenant, Entry entry) {
        if (entry.answered()) {
            return entry.rule();
        }
        throw new RuleUnavailable(MOBILE_RULE_SCHEMA + " at " + tenant + " could not be read and was never read "
                + "before, so the country code of a national number sent for it is unknown. Nothing was sent; "
                + "replay the event once MDMS answers.");
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private Rule fetch(String tenant) {
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
        Rule first = null;
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
            Rule rule = new Rule("+" + digits, pattern(tenant, ((Map) data).get("mobileNumberRegex")));
            if (Boolean.TRUE.equals(((Map) data).get("default"))) {
                return rule;
            }
            if (first == null) {
                first = rule;
            }
        }
        return first;
    }

    /** A rule's pattern, or null when it has none or it does not compile (the code still applies). */
    private static Pattern pattern(String tenant, Object regex) {
        if (regex == null || !StringUtils.hasText(regex.toString())) {
            return null;
        }
        try {
            return Pattern.compile(regex.toString().trim());
        } catch (PatternSyntaxException e) {
            log.warn("{} at {}: mobileNumberRegex does not compile ({}); its country code is used without it",
                    MOBILE_RULE_SCHEMA, tenant, e.getDescription());
            return null;
        }
    }
}
