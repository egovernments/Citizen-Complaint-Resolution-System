package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Expands a single HRMS-assigned jurisdiction boundary code into itself plus every DESCENDANT
 * boundary code under it, via boundary-service's {@code boundary-relationships/_search}
 * ({@code includeChildren=true}).
 *
 * <p>Exists to make {@code jurisdiction: OWN} cascade: an employee assigned a coarse boundary
 * (e.g. a County) is meant to see every complaint anywhere under it, not only complaints tagged
 * with that exact County-level code — which in practice never happens, since complaints are
 * always addressed at the leaf (Ward) level. Without this expansion, {@link
 * PolicyDrivenScopeResolver}'s downstream exact-match IN-list (both the Tier-1 SQL {@code
 * ads.locality IN (...)} and the generated Tier-2 JsonLogic condition, built from the same
 * resolved {@code jurisdictionCodes}) silently denies every complaint for any employee not
 * assigned the exact leaf boundary. This is the same list the dashboard now reuses (via {@code
 * AnalyticsRowScopeResolver}), so expanding it here — once, at the source — keeps search and
 * analytics giving the same answer, rather than requiring two different matching strategies (an
 * exact match here, a hierarchical segment match in {@code AnalyticsPlanner}) to agree by
 * coincidence.
 *
 * <p>Cached per (tenantId, hierarchyType, code) for {@link #CACHE_TTL_MILLIS} — boundary
 * hierarchies change rarely, and this sits on PGR search's hot path. A lookup FAILURE falls back
 * to the single unexpanded code, not to failing the caller's whole scope resolution: that is
 * strictly MORE restrictive than a successful expansion, so failing this way only degrades
 * toward today's exact-match behavior rather than opening access further — a safe default for an
 * axis-VALUE expansion, unlike a security DECISION (e.g. {@link AccessPolicyRegistry}'s own
 * outage handling), which must fail closed instead.
 */
@Component
@Slf4j
public class BoundaryHierarchyExpander {

    private static final long CACHE_TTL_MILLIS = TimeUnit.MINUTES.toMillis(30);

    private final PGRConfiguration config;
    private final RestTemplate restTemplate;
    private final ObjectMapper mapper;

    private final Map<String, CachedEntry> cache = new ConcurrentHashMap<>();

    @Autowired
    public BoundaryHierarchyExpander(PGRConfiguration config, RestTemplate restTemplate, ObjectMapper mapper) {
        this.config = config;
        this.restTemplate = restTemplate;
        this.mapper = mapper;
    }

    /** {@code code} plus every descendant boundary code under it, per {@code hierarchyType}. */
    public Set<String> descendantsOf(RequestInfo requestInfo, String tenantId, String hierarchyType, String code) {
        if (tenantId == null || hierarchyType == null || code == null || code.isBlank())
            return Set.of();
        String cacheKey = tenantId + "|" + hierarchyType + "|" + code;
        CachedEntry cached = cache.get(cacheKey);
        if (cached != null && !cached.isExpired())
            return cached.codes;

        Set<String> resolved;
        try {
            resolved = fetch(requestInfo, tenantId, hierarchyType, code);
            if (resolved.isEmpty())
                resolved = Set.of(code);
        } catch (Exception e) {
            log.warn("BoundaryHierarchyExpander: descendant lookup failed for tenantId='{}' hierarchyType='{}' code='{}' — falling back to the single unexpanded code: {}",
                    tenantId, hierarchyType, code, e.toString());
            return Set.of(code);
        }
        cache.put(cacheKey, new CachedEntry(resolved));
        return resolved;
    }

    @SuppressWarnings("unchecked")
    private Set<String> fetch(RequestInfo requestInfo, String tenantId, String hierarchyType, String code) {
        String url = UriComponentsBuilder.fromHttpUrl(config.getBoundaryHost() + config.getBoundaryRelationshipSearchEndpoint())
                .queryParam("tenantId", tenantId)
                .queryParam("hierarchyType", hierarchyType)
                .queryParam("codes", code)
                .queryParam("includeChildren", true)
                .encode()
                .toUriString();
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("RequestInfo", requestInfo);
        Object resp = restTemplate.postForObject(url, req, Map.class);
        JsonNode root = mapper.convertValue(resp, JsonNode.class);
        Set<String> codes = new LinkedHashSet<>();
        if (root == null)
            return codes;
        JsonNode tenantBoundary = root.get("TenantBoundary");
        if (tenantBoundary == null || !tenantBoundary.isArray())
            return codes;
        for (JsonNode tb : tenantBoundary) {
            JsonNode boundaries = tb.get("boundary");
            if (boundaries != null && boundaries.isArray())
                for (JsonNode b : boundaries)
                    collect(b, codes);
        }
        return codes;
    }

    private void collect(JsonNode node, Set<String> out) {
        String code = node.path("code").asText(null);
        if (code != null && !code.isEmpty())
            out.add(code);
        JsonNode children = node.get("children");
        if (children != null && children.isArray())
            for (JsonNode c : children)
                collect(c, out);
    }

    private static final class CachedEntry {
        final Set<String> codes;
        final long expiresAtMillis;

        CachedEntry(Set<String> codes) {
            this.codes = codes;
            this.expiresAtMillis = System.currentTimeMillis() + CACHE_TTL_MILLIS;
        }

        boolean isExpired() {
            return System.currentTimeMillis() > expiresAtMillis;
        }
    }
}
