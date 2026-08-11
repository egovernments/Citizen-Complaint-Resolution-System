package org.egov.pgr.policy;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;

import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Resolves and briefly caches role-visible policy actions.
 *
 * <p>The backing access-control lookup is role-scoped, so the complete canonical role set is part
 * of the cache key. Omitting it would let one authorized role prime a tenant/URL entry for an
 * unrelated role. Only successful, uniquely matched results are cached; denial and failures are
 * retried on the next request and always remain fail-closed.
 *
 * <p>This core registry is intentionally not a Spring component yet. It performs policy lookup and
 * caching, not authentication: callers must supply a previously authenticated, tenant-bound
 * {@link RequestInfo}. A later integration supplies the concrete {@link AccessPolicySource} and
 * wires the registry after that trusted-principal boundary.
 */
@Slf4j
public class AccessPolicyRegistry {

    static final Duration DEFAULT_TTL = Duration.ofMinutes(15);
    static final int DEFAULT_MAX_ENTRIES = 4096;

    private final AccessPolicySource source;
    private final Clock clock;
    private final long ttlMillis;
    private final int maxEntries;
    private final Map<CacheKey, CachedAction> cache = new ConcurrentHashMap<>();

    public AccessPolicyRegistry(AccessPolicySource source) {
        this(source, Clock.systemUTC(), DEFAULT_TTL, DEFAULT_MAX_ENTRIES);
    }

    public AccessPolicyRegistry(AccessPolicySource source, Clock clock, Duration ttl) {
        this(source, clock, ttl, DEFAULT_MAX_ENTRIES);
    }

    AccessPolicyRegistry(AccessPolicySource source, Clock clock, Duration ttl, int maxEntries) {
        if (ttl == null || ttl.isZero() || ttl.isNegative() || ttl.toMillis() == 0)
            throw new IllegalArgumentException("ttl must be positive");
        if (maxEntries <= 0)
            throw new IllegalArgumentException("maxEntries must be positive");
        this.source = java.util.Objects.requireNonNull(source, "source");
        this.clock = java.util.Objects.requireNonNull(clock, "clock");
        this.ttlMillis = ttl.toMillis();
        this.maxEntries = maxEntries;
    }

    public PolicyResolution resolve(RequestInfo requestInfo, String tenantId, String method, String url) {
        if (isMissingOrPadded(tenantId) || isMissingOrPadded(method) || isMissingOrPadded(url)) {
            log.error("Cannot resolve access policy with a missing tenant, method, or URL");
            return PolicyResolution.invalidRequest();
        }

        List<String> roleCodes;
        try {
            roleCodes = canonicalRoleCodes(requestInfo);
        } catch (IllegalArgumentException e) {
            log.error("Cannot resolve access policy with malformed role codes: {}", e.getMessage());
            return PolicyResolution.invalidRequest();
        }
        if (roleCodes.isEmpty()) {
            log.warn("Cannot resolve access policy for tenant='{}' method='{}' url='{}': caller has no roles",
                    tenantId, method, url);
            return PolicyResolution.notAuthorized();
        }

        String canonicalMethod = method.toUpperCase(Locale.ROOT);
        CacheKey key = new CacheKey(tenantId, canonicalMethod, url, roleCodes);
        long now = clock.millis();
        CachedAction cached = cache.get(key);
        if (cached != null && cached.expiresAtMillis > now)
            return PolicyResolution.resolved(cached.action);
        if (cached != null)
            cache.remove(key, cached);

        evictExpired(now);

        List<PolicyAction> actions;
        try {
            actions = source.findActions(tenantId, canonicalMethod, url, roleCodes);
        } catch (MalformedPolicySourceResponseException e) {
            log.error("Access-policy source returned malformed policy data for tenant='{}' method='{}' url='{}'; denying",
                    tenantId, canonicalMethod, url);
            return PolicyResolution.invalidPolicy();
        } catch (Exception e) {
            // Do not log exception messages or response bodies: HTTP clients commonly include the
            // complete upstream body in both, and that body may itself contain policy data.
            log.error("Access-policy source failed for tenant='{}' method='{}' url='{}' with {}; denying",
                    tenantId, canonicalMethod, url, e.getClass().getName());
            return PolicyResolution.sourceUnavailable();
        }

        if (actions == null) {
            log.error("Access-policy source violated its non-null result contract; denying invalid policy");
            return PolicyResolution.invalidPolicy();
        }
        if (actions.isEmpty())
            return PolicyResolution.notAuthorized();
        if (actions.size() != 1) {
            log.error("Access-policy source returned {} actions for tenant='{}' method='{}' url='{}'; denying ambiguous policy",
                    actions.size(), tenantId, canonicalMethod, url);
            return PolicyResolution.invalidPolicy();
        }

        PolicyAction action = actions.get(0);
        if (action == null || !canonicalMethod.equals(action.method()) || !url.equals(action.url())) {
            log.error("Access-policy source returned a mismatched action for tenant='{}' method='{}' url='{}'; denying",
                    tenantId, canonicalMethod, url);
            return PolicyResolution.invalidPolicy();
        }

        cacheResolved(key, action, now);
        return PolicyResolution.resolved(action);
    }

    private static boolean isMissingOrPadded(String value) {
        return value == null || value.isBlank() || !value.equals(value.trim());
    }

    private List<String> canonicalRoleCodes(RequestInfo requestInfo) {
        if (requestInfo == null || requestInfo.getUserInfo() == null
                || requestInfo.getUserInfo().getRoles() == null)
            return List.of();

        List<String> codes = new ArrayList<>();
        for (Role role : requestInfo.getUserInfo().getRoles()) {
            if (role == null || role.getCode() == null || role.getCode().isBlank())
                throw new IllegalArgumentException("role codes must not be blank");
            String code = role.getCode();
            if (!code.equals(code.trim()))
                throw new IllegalArgumentException("role codes must not contain surrounding whitespace");
            codes.add(code);
        }
        Collections.sort(codes);
        List<String> distinct = new ArrayList<>();
        String previous = null;
        for (String code : codes) {
            if (!code.equals(previous))
                distinct.add(code);
            previous = code;
        }
        return List.copyOf(distinct);
    }

    private long expirationFrom(long now) {
        try {
            return Math.addExact(now, ttlMillis);
        } catch (ArithmeticException e) {
            return Long.MAX_VALUE;
        }
    }

    private void evictExpired(long now) {
        cache.entrySet().removeIf(entry -> entry.getValue().expiresAtMillis <= now);
    }

    private void cacheResolved(CacheKey key, PolicyAction action, long now) {
        synchronized (cache) {
            evictExpired(now);
            if (cache.containsKey(key) || cache.size() < maxEntries)
                cache.put(key, new CachedAction(action, expirationFrom(now)));
            else
                log.warn("Access-policy cache reached its {}-entry bound; returning uncached resolution", maxEntries);
        }
    }

    private record CacheKey(String tenantId, String method, String url, List<String> roleCodes) {
        private CacheKey {
            roleCodes = List.copyOf(roleCodes);
        }
    }

    private record CachedAction(PolicyAction action, long expiresAtMillis) { }
}
