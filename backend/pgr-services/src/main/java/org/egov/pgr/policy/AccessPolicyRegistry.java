package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.util.MDMSUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Resolves policy data — both the record-level JsonLogic {@code condition} and the field-level
 * visibility rules nested under {@code resource} — from a single Action record in the
 * {@code ACCESSCONTROL-ACTIONS-TEST.actions-test} MDMS master, fetched via egov-accesscontrol's
 * own role-scoped {@code /access/v1/actions/mdms/_get} API
 * ({@link MDMSUtils#fetchAccessControlActions}). Both concerns share ONE fetch+cache — see
 * {@link #getAction}.
 *
 * Cached per (tenant, action url) for {@link #CACHE_TTL_MILLIS} to keep accesscontrol load off the
 * search hot path. Only a SUCCESSFUL resolution is cached: because the underlying API is
 * role-scoped (a role with no ACCESSCONTROL-ROLEACTIONS mapping to this action simply won't see
 * it), caching a "not found" would risk locking out a legitimately-authorized caller for the full
 * TTL just because an earlier caller's role set didn't include this action. A "not found"/failure
 * always fails closed for that request, but is retried fresh next time.
 */
@Component
@Slf4j
public class AccessPolicyRegistry {

    public static final String PGR_REQUEST_SEARCH_URL = "/pgr-services/v2/request/_search";

    private static final long CACHE_TTL_MILLIS = TimeUnit.MINUTES.toMillis(15);
    private static final String ATTRIBUTES_KEY = "attributes";
    private static final Map<String, Object> DEFAULT_ON_DENY = Map.of("strategy", MaskingStrategy.REDACT.name());
    /** JsonLogic literal `false` — always evaluates to deny, used to fail closed on a malformed rule. */
    private static final String ALWAYS_DENY_CONDITION = "false";

    private final MDMSUtils mdmsUtils;
    private final ObjectMapper objectMapper;

    private final Map<String, CachedEntry> cache = new ConcurrentHashMap<>();

    @Autowired
    public AccessPolicyRegistry(MDMSUtils mdmsUtils, ObjectMapper objectMapper) {
        this.mdmsUtils = mdmsUtils;
        this.objectMapper = objectMapper;
    }

    /**
     * Returns the raw JsonLogic condition JSON for the given action url + tenant (resolved using
     * the caller's roles), or null if unresolvable (no visible/enabled MDMS entry for this
     * caller's roles, no condition on it, or an accesscontrol failure) — callers must treat null
     * as fail-closed, never as "no restriction".
     */
    public String getCondition(String actionUrl, RequestInfo requestInfo, String tenantId) {
        Map<String, Object> action = getAction(actionUrl, requestInfo, tenantId);
        if (action == null)
            return null;

        Object condition = action.get("condition");
        if (condition == null) {
            log.error("AccessPolicyRegistry: ACCESSCONTROL-ACTIONS-TEST entry for url='{}' tenant='{}' has no 'condition' — failing closed",
                    actionUrl, tenantId);
            return null;
        }

        try {
            return objectMapper.writeValueAsString(condition);
        } catch (Exception e) {
            log.error("AccessPolicyRegistry: failed to serialize condition for url='{}' tenant='{}' — failing closed: {}",
                    actionUrl, tenantId, e.getMessage());
            return null;
        }
    }

    /**
     * Extracts and validates the field-visibility rules for {@code resourceType} from the same
     * Action's {@code resource} JSON object: {@code resource[resourceType].attributes} is a JSON
     * object keyed by field path, each value an independent {@code {condition, onDeny}} rule — any
     * number (N) of them. Returns an empty map (never null) if the action is unresolvable, the
     * legacy flat-string-array {@code resource} shape is present, or {@code resourceType}/
     * {@code attributes} isn't declared — all no-op cases, not errors.
     */
    @SuppressWarnings("unchecked")
    public Map<String, FieldVisibilityRule> getFieldVisibilityRules(String actionUrl, RequestInfo requestInfo,
                                                                      String tenantId, String resourceType) {
        Map<String, Object> action = getAction(actionUrl, requestInfo, tenantId);
        if (action == null)
            return Map.of();

        Object resource = action.get("resource");
        if (!(resource instanceof Map))
            return Map.of(); // legacy flat string-array shape (["complaint"]), or absent

        Object resourceEntry = ((Map<String, Object>) resource).get(resourceType);
        if (!(resourceEntry instanceof Map))
            return Map.of();

        Object attributes = ((Map<String, Object>) resourceEntry).get(ATTRIBUTES_KEY);
        if (!(attributes instanceof Map))
            return Map.of();

        Map<String, FieldVisibilityRule> rules = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : ((Map<String, Object>) attributes).entrySet())
            rules.put(entry.getKey(), validateAndParseRule(entry.getKey(), entry.getValue()));
        return rules;
    }

    /**
     * Validation happens here, at the service level (not in egov-accesscontrol, which stores this
     * as opaque JSON) — a malformed entry never results in an absent rule (which would read as "no
     * restriction"/always visible); it's normalized to a rule that always masks instead.
     */
    @SuppressWarnings("unchecked")
    private FieldVisibilityRule validateAndParseRule(String path, Object raw) {
        if (!(raw instanceof Map)) {
            log.error("AccessPolicyRegistry: field visibility rule for path '{}' is not a JSON object — failing closed (always masked)", path);
            return new FieldVisibilityRule(ALWAYS_DENY_CONDITION, DEFAULT_ON_DENY);
        }

        Map<String, Object> ruleMap = (Map<String, Object>) raw;
        Object condition = ruleMap.get("condition");
        String conditionJson;
        if (condition == null) {
            log.error("AccessPolicyRegistry: field visibility rule for path '{}' has no 'condition' — failing closed (always masked)", path);
            conditionJson = ALWAYS_DENY_CONDITION;
        } else {
            try {
                conditionJson = objectMapper.writeValueAsString(condition);
            } catch (Exception e) {
                log.error("AccessPolicyRegistry: failed to serialize condition for path '{}' — failing closed (always masked): {}",
                        path, e.getMessage());
                conditionJson = ALWAYS_DENY_CONDITION;
            }
        }

        Object onDenyRaw = ruleMap.get("onDeny");
        Map<String, Object> onDeny = onDenyRaw instanceof Map ? (Map<String, Object>) onDenyRaw : DEFAULT_ON_DENY;
        if (onDenyRaw != null && !(onDenyRaw instanceof Map))
            log.error("AccessPolicyRegistry: field visibility rule for path '{}' has an invalid 'onDeny' — defaulting to REDACT", path);

        return new FieldVisibilityRule(conditionJson, onDeny);
    }

    private Map<String, Object> getAction(String actionUrl, RequestInfo requestInfo, String tenantId) {
        String cacheKey = tenantId + "|" + actionUrl;
        CachedEntry cached = cache.get(cacheKey);
        if (cached != null && !cached.isExpired())
            return cached.action;

        Map<String, Object> action = fetch(actionUrl, requestInfo, tenantId);
        if (action != null)
            cache.put(cacheKey, new CachedEntry(action));
        return action;
    }

    private Map<String, Object> fetch(String actionUrl, RequestInfo requestInfo, String tenantId) {
        List<Map<String, Object>> actions = mdmsUtils.fetchAccessControlActions(requestInfo, tenantId, actionUrl);
        if (CollectionUtils.isEmpty(actions)) {
            log.error("AccessPolicyRegistry: no ACCESSCONTROL-ACTIONS-TEST entry visible for url='{}' tenant='{}' — failing closed",
                    actionUrl, tenantId);
            return null;
        }
        return actions.get(0);
    }

    private static final class CachedEntry {
        final Map<String, Object> action;
        final long expiresAtMillis;

        CachedEntry(Map<String, Object> action) {
            this.action = action;
            this.expiresAtMillis = System.currentTimeMillis() + CACHE_TTL_MILLIS;
        }

        boolean isExpired() {
            return System.currentTimeMillis() > expiresAtMillis;
        }
    }
}
