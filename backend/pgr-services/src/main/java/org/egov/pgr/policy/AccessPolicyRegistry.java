package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.RoleCodes;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
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
     * field — that naming predates this axis model. Keys MUST stay in sync with
     * {@link ScopePolicy#SUPPORTED_AXES} — {@link ScopePolicy#parse} already rejects any axis
     * outside that set before a {@link ScopePolicy} can even reach {@link #synthesizeCondition},
     * so the null-mapping branch there is a defense-in-depth backstop against the two drifting
     * apart, not the primary enforcement.
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
    private final PGRConfiguration config;

    private final Map<String, CachedEntry> cache = new ConcurrentHashMap<>();

    @Autowired
    public AccessPolicyRegistry(MDMSUtils mdmsUtils, ObjectMapper objectMapper, PGRConfiguration config) {
        this.mdmsUtils = mdmsUtils;
        this.objectMapper = objectMapper;
        this.config = config;
    }

    /**
     * The "policy not defined for this deployment, allow" fallback (see {@link #getCondition}) is
     * ONLY taken when {@link PGRConfiguration#isAbacStrictMode()} is false (the default) — an
     * explicit, opt-in rollout gate: a missing/invisible action is indistinguishable from a broken
     * role-action mapping, so once a tenant's ABAC policies are fully authored it should opt into
     * {@code pgr.abac.strict-mode=true} and get fail-closed here too, instead of relying on this
     * backward-compatible default forever.
     *
     * <p>{@code fetchAccessControlActions} calls egov-accesscontrol's ROLE-SCOPED
     * {@code /access/v1/actions/mdms/_get} — "no entry visible" here is genuinely ambiguous between
     * "this action was never configured for this deployment at all" and "this action exists, but
     * NONE of this caller's roles have an ACCESSCONTROL-ROLEACTIONS mapping to it" (the exact shape
     * of the DGRO incident this PR's own fix deleted the affected role over, rather than closing
     * this detection gap). We can't cheaply tell those apart without an extra, role-agnostic MDMS
     * lookup on every miss (this path is deliberately NOT cached — see the class Javadoc), so this
     * logs LOUDLY with the caller's role codes, so "not configured yet" and "role mapping missing"
     * are at least distinguishable by an operator correlating this line against the ROLEACTIONS
     * master, without adding that extra call to every request.
     */
    private String allowIfBackwardCompatibilityEnabled(String actionUrl, String tenantId, RequestInfo requestInfo) {
        String roles = roleKey(requestInfo);
        if (config.isAbacStrictMode()) {
            log.error("AccessPolicyRegistry: no ACCESSCONTROL-ACTIONS-TEST entry visible for url='{}' tenant='{}' roles='{}' — pgr.abac.strict-mode is enabled, failing closed",
                    actionUrl, tenantId, roles);
            return null;
        }
        log.warn("AccessPolicyRegistry: no ACCESSCONTROL-ACTIONS-TEST entry visible for url='{}' tenant='{}' roles='{}' — allowing (backward compatible; set pgr.abac.strict-mode=true to fail closed instead). "
                        + "This is indistinguishable from a role missing its ACCESSCONTROL-ROLEACTIONS mapping for this action (the DGRO incident pattern) — if these roles SHOULD have this action, check ROLEACTIONS before assuming it's simply unconfigured.",
                actionUrl, tenantId, roles);
        return ALWAYS_ALLOW_CONDITION;
    }

    /** Cached url sets from {@link #visibleActionUrls}, keyed the same way as {@link #cache}. */
    private final Map<String, CachedUrls> urlCache = new ConcurrentHashMap<>();

    private record CachedUrls(Set<String> urls, long expiresAt) {
        boolean isExpired() {
            return System.currentTimeMillis() > expiresAt;
        }
    }

    /**
     * Every action url this caller can reach, resolved in ONE accesscontrol call and cached for the
     * same TTL as everything else here.
     *
     * <p>For a caller that needs to test several urls at once, this replaces N calls that would
     * each have fetched the identical role-scoped payload and thrown away all but one entry.
     *
     * @throws AccessControlUnavailableException accesscontrol could not be consulted
     */
    public Set<String> visibleActionUrls(RequestInfo requestInfo, String tenantId) {
        String cacheKey = tenantId + "|*|" + roleKey(requestInfo);
        CachedUrls cached = urlCache.get(cacheKey);
        if (cached != null && !cached.isExpired())
            return cached.urls();

        Set<String> urls = mdmsUtils.fetchVisibleActionUrls(requestInfo, tenantId);
        urlCache.put(cacheKey, new CachedUrls(urls, System.currentTimeMillis() + CACHE_TTL_MILLIS));
        return urls;
    }

    /**
     * Whether this caller can reach {@code actionUrl} at all.
     *
     * <p>{@code /access/v1/actions/mdms/_get} is role-scoped: an action comes back only when one of
     * the caller's roles has an ACCESSCONTROL-ROLEACTIONS mapping to it. So "is this action visible"
     * IS the capability question, answered by egov-accesscontrol against the same role-action master
     * that governs every other action — no second grant model, and nothing for this service to
     * interpret.
     *
     * <p>Distinct from {@link #getCondition}, which asks what an action's policy SAYS. This asks
     * only whether the caller is granted it. An action with no policy at all is still a perfectly
     * good capability grant, which is exactly what the dashboard's endpoint actions are.
     *
     * @throws AccessControlUnavailableException if accesscontrol could not be consulted — callers
     *         must fail closed rather than read that as "not granted", which would look identical
     *         to a legitimate denial during an outage.
     */
    public boolean isActionVisible(String actionUrl, RequestInfo requestInfo, String tenantId) {
        return getAction(actionUrl, requestInfo, tenantId) != null;
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
     *   <li>the entry HAS a {@code resource.complaint.scope} block, but it's malformed (see
     *       {@link ScopePolicy#parse}), or declares an axis {@link #synthesizeCondition} has no
     *       field mapping for — an authoring mistake on an authored policy, worse than no policy at
     *       all; returns null, fail-closed (never falls through to the legacy {@code condition}
     *       field or {@link #ALWAYS_ALLOW_CONDITION} — those are for a CONFIRMED absence of scope
     *       config, not a broken one).</li>
     *   <li>the entry has neither a {@code resource.complaint.scope} block NOR a {@code condition}
     *       field — this is the SAME "not configured for this resource" case as no entry being
     *       visible at all (plenty of real ACCESSCONTROL-ACTIONS-TEST rows exist purely for
     *       basic action registration/visibility, with neither field ever populated), so it takes
     *       the SAME {@link #allowIfBackwardCompatibilityEnabled} path — backward compatible by
     *       default, fails closed only once {@code pgr.abac.strict-mode} is opted into.</li>
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
            return allowIfBackwardCompatibilityEnabled(actionUrl, tenantId, requestInfo);
        }

        Optional<ScopePolicy> scopePolicy;
        try {
            scopePolicy = extractScopePolicy(action, RESOURCE_TYPE_COMPLAINT);
        } catch (MalformedScopePolicyException e) {
            log.error("AccessPolicyRegistry: malformed resource.complaint.scope for url='{}' tenant='{}' — failing closed: {}",
                    actionUrl, tenantId, e.getMessage());
            return null;
        }
        if (scopePolicy.isPresent()) {
            String generated = synthesizeCondition(scopePolicy.get());
            if (generated != null)
                return generated;
            log.error("AccessPolicyRegistry: failed to generate condition for url='{}' tenant='{}' (unmapped axis or serialization failure — see above) — failing closed",
                    actionUrl, tenantId);
            return null;
        }

        Object condition = action.get("condition");
        if (condition == null) {
            // Neither resource.complaint.scope NOR condition was ever authored on this entry — a
            // genuinely bare action record (basic registration/visibility only), not a broken
            // configuration. Same backward-compatible treatment as no entry being visible at all.
            return allowIfBackwardCompatibilityEnabled(actionUrl, tenantId, requestInfo);
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
     * An axis with no known field mapping fails the WHOLE condition (returns null) rather than being
     * silently skipped: skipping would silently drop that axis's restriction from the Tier-2
     * re-check while {@link PolicyDrivenScopeResolver}'s Tier-1 SQL scope (which reads the exact same
     * {@code scope} block via {@code AXIS_FIELDS}' Tier-1 counterpart) may still be enforcing it —
     * i.e. the two tiers would silently disagree, which is exactly what generating both from one
     * artifact is meant to prevent. Also returns null if JSON serialization itself fails.
     */
    private String synthesizeCondition(ScopePolicy policy) {
        List<Object> employeeClauseParts = new ArrayList<>();
        employeeClauseParts.add(Map.of("==", List.of(Map.of("var", "user.type"), "EMPLOYEE")));
        for (String axis : policy.getAxes()) {
            AxisFields fields = AXIS_FIELDS.get(axis);
            if (fields == null) {
                log.error("AccessPolicyRegistry: scope declares axis '{}' with no known resource/user field mapping — failing the whole condition closed", axis);
                return null;
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
     * Parses {@code resource.<resourceType>.scope} into a {@link ScopePolicy}. Returns empty when
     * the {@code scope} key is genuinely ABSENT (no {@code resource}/{@code resourceType}/
     * {@code scope} at all) — callers treat that as "not configured" (backward compatible). Throws
     * {@link MalformedScopePolicyException} when the key IS present but doesn't parse into a
     * well-formed policy — see {@link ScopePolicy#parse} — which callers must NOT treat the same as
     * "not configured".
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
     * Also, deliberately, does NOT catch {@link MalformedScopePolicyException} for the same reason —
     * a present-but-broken policy must fail the request, never silently take the "not configured"
     * default a genuinely absent one gets.
     */
    public Optional<ScopePolicy> getScopePolicy(String actionUrl, RequestInfo requestInfo, String tenantId, String resourceType) {
        Map<String, Object> action = getAction(actionUrl, requestInfo, tenantId);
        if (action == null)
            return Optional.empty();
        return extractScopePolicy(action, resourceType);
    }

    /**
     * True when this action's Tier-1 SQL scope has genuinely nothing authored for it at all — no
     * {@code resource.<resourceType>.scope} block AND no legacy {@code condition} either — the SAME
     * "not configured" case {@link #getCondition} treats as backward-compatible-allow (or no action
     * visible at all). {@code SearchAccessPolicyService} uses this to decide its Tier-1 fallback: a
     * legacy tenant with a hand-authored {@code condition} but no {@code scope} block still gets the
     * structural {@code DEFAULT_SCOPE_POLICY} (some restriction was already intended, just not in the
     * new shape), but an action with NEITHER must get a fully unrestricted Tier-1 scope — otherwise
     * Tier-1 silently imposes a jurisdiction requirement nobody ever configured, while Tier-2 (this
     * class' {@link #getCondition}) is already allowing everything for the exact same "unconfigured"
     * action. Deliberately does NOT catch {@link MalformedScopePolicyException} — a present-but-broken
     * {@code scope} block is an authoring mistake, not "unconfigured", and must propagate exactly like
     * {@link #getScopePolicy} already does for the same case.
     *
     * <p><b>{@code resource.<resourceType>.attributes} (field masking) alone does NOT count as
     * "configured" here</b> — this method only looks at {@code scope} and {@code condition}. An
     * action that declares field-masking rules (e.g. REDACTing a PII field) but no {@code scope}/
     * {@code condition} still resolves {@code true} (fully unrestricted row-level access), by design:
     * field masking and row-level scoping are independent axes of this policy, and an operator
     * authoring one is not implicitly opting into the other. A caller who wants "any policy at all"
     * to imply row restriction must check {@link #getFieldVisibilityRules} separately, not read that
     * intent into this method.
     */
    public boolean isPolicyUnconfigured(String actionUrl, RequestInfo requestInfo, String tenantId, String resourceType) {
        return resolveScopeState(actionUrl, requestInfo, tenantId, resourceType).unconfigured();
    }

    /**
     * Combined form of {@link #getScopePolicy} + {@link #isPolicyUnconfigured} that fetches the
     * action exactly once instead of twice. {@code SearchAccessPolicyService#resolveScope} used to
     * call both separately — two independent {@link #getAction} calls that, on a cache miss (a
     * "not found"/not-visible action is never cached — see this class' Javadoc), each triggered a
     * fresh {@code /access/v1/actions/mdms/_get} round-trip for the SAME request: a real double-fetch
     * race and doubled hot-path load. This method is the single source both values are derived from.
     */
    public ScopeResolution resolveScopeState(String actionUrl, RequestInfo requestInfo, String tenantId, String resourceType) {
        Map<String, Object> action = getAction(actionUrl, requestInfo, tenantId);
        if (action == null)
            return new ScopeResolution(Optional.empty(), true);
        Optional<ScopePolicy> scopePolicy = extractScopePolicy(action, resourceType);
        if (scopePolicy.isPresent())
            return new ScopeResolution(scopePolicy, false);
        return new ScopeResolution(Optional.empty(), action.get("condition") == null);
    }

    /**
     * Result of {@link #resolveScopeState}: {@code scopePolicy} is the MDMS-authored
     * {@code resource.<resourceType>.scope} when present, and {@code unconfigured} is true only when
     * NEITHER a {@code scope} block NOR a legacy {@code condition} was authored (see
     * {@link #isPolicyUnconfigured}'s Javadoc for what "unconfigured" does and doesn't cover).
     * {@code scopePolicy} present always implies {@code unconfigured == false}.
     */
    public record ScopeResolution(Optional<ScopePolicy> scopePolicy, boolean unconfigured) {
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
     * Uses the SAME normalization ({@link RoleCodes#normalize}) as the actual outbound request
     * body ({@code MDMSUtils#fetchAccessControlActions}) — this key must never be computed from a
     * different role-code representation than what was actually sent, or a cached result for one
     * caller's role spelling could be served to a different caller whose real roles wouldn't have
     * matched it.
     */
    private static String roleKey(RequestInfo requestInfo) {
        return RoleCodes.normalize(requestInfo).stream().sorted().collect(java.util.stream.Collectors.joining(","));
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
