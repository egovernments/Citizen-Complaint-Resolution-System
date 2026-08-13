package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.util.MDMSUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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
    private static final String RESOURCE_TYPE_COMPLAINT = "complaint";

    private static final long CACHE_TTL_MILLIS = TimeUnit.MINUTES.toMillis(15);
    private static final String ATTRIBUTES_KEY = "attributes";
    private static final String SCOPE_KEY = "scope";
    private static final Map<String, Object> DEFAULT_ON_DENY = Map.of("strategy", MaskingStrategy.REDACT.name());

    /**
     * Per-axis JsonLogic field mapping for the generated EMPLOYEE clause — tied to the complaint
     * resource's own JSON shape (a policy decision an MDMS operator makes is WHICH ROLE gets WHICH
     * LEVEL per axis, not what the resource's field is literally called), so this stays code-defined
     * rather than MDMS-authored. "jurisdiction" intentionally maps to the resource's "boundary"
     * field — that naming predates this axis model.
     */
    private record AxisFields(String resourceVar, String userAttributeVar) {
    }

    private static final Map<String, AxisFields> AXIS_FIELDS = Map.of(
            "department", new AxisFields("resource.complaint.department", "user.attributes.departments"),
            "jurisdiction", new AxisFields("resource.complaint.boundary", "user.attributes.jurisdictions")
    );
    /** JsonLogic literal `false` — always evaluates to deny, used to fail closed on a malformed rule. */
    private static final String ALWAYS_DENY_CONDITION = "false";
    /**
     * JsonLogic literal `true` — always evaluates to allow. Used ONLY when no
     * ACCESSCONTROL-ACTIONS-TEST entry is visible at all for this url+tenant+role (policy simply
     * not defined for this deployment) — backward compatible with pre-ABAC behavior, which had no
     * Tier-2 condition to consult. This is distinct from an entry that IS visible but is missing its
     * `condition` field — that is a real authoring mistake and still fails closed.
     */
    private static final String ALWAYS_ALLOW_CONDITION = "true";

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
     * the caller's roles). Outcomes:
     * <ul>
     *   <li>no MDMS entry visible at all for this url+tenant+role — policy not defined for this
     *       deployment; returns {@link #ALWAYS_ALLOW_CONDITION} (backward compatible with pre-ABAC
     *       behavior, which had no Tier-2 condition to consult).</li>
     *   <li>the accesscontrol call itself failed (see {@link AccessControlUnavailableException}) —
     *       NOT the same as a confirmed absence of policy; returns null (fail-closed) rather than
     *       risk failing a whole tenant open during an outage.</li>
     *   <li>the entry has a well-formed {@code resource.complaint.scope} — the EMPLOYEE clause is
     *       GENERATED from it (see {@link #synthesizeCondition}) rather than read from
     *       {@code condition}, so the Tier-1 SQL scope ({@link PolicyDrivenScopeResolver}, which
     *       reads the same {@code scope} block) and this Tier-2 re-check can never disagree.</li>
     *   <li>no {@code scope} block, and the entry has no {@code condition} field either — an
     *       authoring mistake, not an absent policy; returns null, fail-closed.</li>
     *   <li>no {@code scope} block, but a hand-authored {@code condition} exists — returns it
     *       verbatim (legacy path, unchanged).</li>
     * </ul>
     */
    public String getCondition(String actionUrl, RequestInfo requestInfo, String tenantId) {
        Map<String, Object> action;
        try {
            action = getAction(actionUrl, requestInfo, tenantId);
        } catch (AccessControlUnavailableException e) {
            log.error("AccessPolicyRegistry: accesscontrol unavailable for url='{}' tenant='{}' — failing closed: {}",
                    actionUrl, tenantId, e.getMessage());
            return null;
        }
        if (action == null) {
            log.info("AccessPolicyRegistry: no ACCESSCONTROL-ACTIONS-TEST entry visible for url='{}' tenant='{}' — policy not defined, allowing (backward compatible)",
                    actionUrl, tenantId);
            return ALWAYS_ALLOW_CONDITION;
        }

        Optional<ScopePolicy> scopePolicy = extractScopePolicy(action, RESOURCE_TYPE_COMPLAINT);
        if (scopePolicy.isPresent()) {
            String generated = synthesizeCondition(scopePolicy.get());
            if (generated != null)
                return generated;
            log.error("AccessPolicyRegistry: failed to serialize generated condition for url='{}' tenant='{}' — failing closed",
                    actionUrl, tenantId);
            return null;
        }

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
     * Generates the {@code {"or": [tenantWide, citizenSelfScope, employeeAxisClause]}} JsonLogic
     * tree for a resolved {@link ScopePolicy}: the tenantWide bypass and CITIZEN self-scope branches
     * are a fixed template (they aren't axis-based), and only the EMPLOYEE clause's axis-matching
     * sub-conditions are generated by iterating {@code policy.getAxes()} against {@link #AXIS_FIELDS}.
     * An axis with no known field mapping is skipped (logged) rather than failing the whole
     * condition — same "don't invalidate the whole policy over one bad entry" principle as
     * {@link ScopePolicy#parse}. Returns null only if JSON serialization itself fails.
     */
    private String synthesizeCondition(ScopePolicy policy) {
        List<Object> employeeClauseParts = new ArrayList<>();
        employeeClauseParts.add(Map.of("==", List.of(Map.of("var", "user.type"), "EMPLOYEE")));
        for (String axis : policy.getAxes()) {
            AxisFields fields = AXIS_FIELDS.get(axis);
            if (fields == null) {
                log.warn("AccessPolicyRegistry: scope declares axis '{}' with no known resource/user field mapping — skipping in generated condition", axis);
                continue;
            }
            employeeClauseParts.add(Map.of("or", List.of(
                    Map.of("!", Map.of("var", fields.userAttributeVar())),
                    Map.of("in", List.of(Map.of("var", fields.resourceVar()), Map.of("var", fields.userAttributeVar())))
            )));
        }

        Map<String, Object> condition = Map.of("or", List.of(
                Map.of("==", List.of(Map.of("var", "user.attributes.tenantWide"), true)),
                Map.of("and", List.of(
                        Map.of("==", List.of(Map.of("var", "user.type"), "CITIZEN")),
                        Map.of("==", List.of(Map.of("var", "resource.complaint.accountId"), Map.of("var", "user.uuid")))
                )),
                Map.of("and", employeeClauseParts)
        ));

        try {
            return objectMapper.writeValueAsString(condition);
        } catch (Exception e) {
            log.error("AccessPolicyRegistry: failed to serialize generated condition: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Parses {@code resource.<resourceType>.scope} into a {@link ScopePolicy}, or empty when
     * absent/malformed — callers treat that identically to "not configured" (backward compatible),
     * never as an error.
     */
    @SuppressWarnings("unchecked")
    private Optional<ScopePolicy> extractScopePolicy(Map<String, Object> action, String resourceType) {
        Object resource = action.get("resource");
        if (!(resource instanceof Map))
            return Optional.empty();
        Object resourceEntry = ((Map<String, Object>) resource).get(resourceType);
        if (!(resourceEntry instanceof Map))
            return Optional.empty();
        return ScopePolicy.parse(((Map<String, Object>) resourceEntry).get(SCOPE_KEY));
    }

    /**
     * Public counterpart of {@link #extractScopePolicy} for {@code SearchAccessPolicyService} /
     * {@link PolicyDrivenScopeResolver} (the Tier-1 SQL side) to consult the SAME
     * {@code resource.<resourceType>.scope} block the generated Tier-2 condition above reads —
     * one authored artifact for both.
     *
     * <p>Deliberately does NOT catch {@link AccessControlUnavailableException} — same rationale as
     * {@link #getFieldVisibilityRules}: an empty {@link Optional} here reads as "not configured",
     * which {@code SearchAccessPolicyService} treats as safe to fall back to its own backward-
     * compatible default policy. Swallowing a genuine accesscontrol OUTAGE into that same empty
     * result would apply that (comparatively permissive) default while the system is down, instead
     * of failing the request closed. Letting the exception propagate keeps the outage case distinct.
     */
    public Optional<ScopePolicy> getScopePolicy(String actionUrl, RequestInfo requestInfo, String tenantId, String resourceType) {
        Map<String, Object> action = getAction(actionUrl, requestInfo, tenantId);
        if (action == null)
            return Optional.empty();
        return extractScopePolicy(action, resourceType);
    }

    /**
     * Extracts and validates the field-visibility rules for {@code resourceType} from the same
     * Action's {@code resource} JSON object: {@code resource[resourceType].attributes} is a JSON
     * object keyed by field path, each value an independent {@code {condition, onDeny}} rule — any
     * number (N) of them. Returns an empty map (never null) if the action is unresolvable, the
     * legacy flat-string-array {@code resource} shape is present, or {@code resourceType}/
     * {@code attributes} isn't declared — all no-op cases, not errors.
     *
     * <p>Deliberately does NOT catch {@link AccessControlUnavailableException} the way
     * {@link #getCondition} and {@link #getScopePolicy} do: those two have a safe RESTRICTIVE
     * sentinel to fall back to (null condition -> {@link PolicyEvaluator} denies; absent
     * ScopePolicy -> {@code SearchAccessPolicyService}'s conservative default). An empty rules map
     * here means the opposite — {@code FieldVisibilityService.apply} reads it as "nothing to mask"
     * and leaves every field, including citizen PII, untouched. Some callers (plain search) apply
     * field masking with NO record-level Tier-2 gate at all, so silently returning "no rules" during
     * an outage would expose PII outright. Letting the exception propagate fails the whole request
     * closed instead.
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
        String cacheKey = tenantId + "|" + actionUrl + "|" + roleKey(requestInfo);
        CachedEntry cached = cache.get(cacheKey);
        if (cached != null && !cached.isExpired())
            return cached.action;

        Map<String, Object> action = fetch(actionUrl, requestInfo, tenantId);
        if (action != null)
            cache.put(cacheKey, new CachedEntry(action));
        return action;
    }

    /**
     * Stable, order-independent key for the caller's role set — {@code /access/v1/actions/mdms/_get}
     * is role-scoped (a role with no ACCESSCONTROL-ROLEACTIONS mapping to this action simply won't
     * see it), so a resolved entry must never be reused for a caller with a different role set.
     */
    private static String roleKey(RequestInfo requestInfo) {
        if (requestInfo == null || requestInfo.getUserInfo() == null || requestInfo.getUserInfo().getRoles() == null)
            return "";
        return requestInfo.getUserInfo().getRoles().stream()
                .filter(r -> r != null && r.getCode() != null)
                .map(r -> r.getCode().trim().toUpperCase())
                .filter(c -> !c.isEmpty())
                .distinct()
                .sorted()
                .collect(java.util.stream.Collectors.joining(","));
    }

    /**
     * Returns null when no MDMS entry is visible for this url+tenant+role — callers decide what
     * that means for their axis: {@link #getCondition} treats it as "not defined, allow"; a
     * malformed-but-present entry is a distinct case handled by the callers themselves.
     */
    private Map<String, Object> fetch(String actionUrl, RequestInfo requestInfo, String tenantId) {
        List<Map<String, Object>> actions = mdmsUtils.fetchAccessControlActions(requestInfo, tenantId, actionUrl);
        if (CollectionUtils.isEmpty(actions))
            return null;
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
