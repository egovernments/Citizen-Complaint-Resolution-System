package org.egov.pgr.util;

import com.jayway.jsonpath.JsonPath;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.web.models.RequestInfoWrapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import static org.egov.pgr.util.PGRConstants.BOUNDARY_RELATIONSHIP_ROOTS_JSONPATH;

/**
 * Expands one HRMS jurisdiction boundary code into every code in its descendant subtree, via
 * boundary-service's boundary-relationships search (`codes=<code>&includeChildren=true`, which
 * returns the code itself plus its full subtree in one query — not just its immediate children).
 *
 * Without this, an employee jurisdiction-mapped ABOVE the leaf level (e.g. a whole city, not one
 * ward) never matches any complaint: {@code PGRQueryBuilder}'s {@code ads.locality IN (...)} is a
 * bare string-equality check, and complaints are typically filed at leaf granularity — so a
 * city-level code only ever matches a complaint someone filed with that exact city-level code,
 * never the wards underneath it. See EmployeeJurisdictionScopeService, which calls this once per
 * jurisdiction row and unions the results.
 *
 * Cached per (tenantId, hierarchy, boundary code) — the boundary tree changes rarely, so repeat
 * expansions of the same code (across searches, and across employees who share a jurisdiction)
 * are served from cache rather than re-querying boundary-service every time. Mirrors the
 * TTL-cache-with-stale-fallback contract MDMSUtils already uses for MDMS masters: a fetch that
 * returns nothing usable serves the last-known-good expansion if one exists; with no prior cache
 * at all, it falls back to the raw, un-expanded code (never an empty set) so a boundary-service
 * outage narrows scope back to today's exact-match behavior instead of denying everything.
 */
@Component
@Slf4j
public class BoundaryUtil {

    private final ServiceRequestRepository serviceRequestRepository;
    private final PGRConfiguration config;

    private final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();

    @Autowired
    public BoundaryUtil(ServiceRequestRepository serviceRequestRepository, PGRConfiguration config) {
        this.serviceRequestRepository = serviceRequestRepository;
        this.config = config;
    }

    /**
     * {@code boundaryCode} plus every descendant beneath it in {@code hierarchy}. Never returns
     * an empty set — falls back to a singleton of just {@code boundaryCode} when neither a fresh
     * nor a stale cache entry is available.
     */
    public Set<String> expandToDescendants(String tenantId, String hierarchy, String boundaryCode, RequestInfo requestInfo) {
        String cacheKey = tenantId + "|" + hierarchy + "|" + boundaryCode;
        long now = System.currentTimeMillis();

        CacheEntry cached = cache.get(cacheKey);
        if (cached != null && cached.fresh(config.getJurisdictionSubtreeCacheTtlMs(), now))
            return cached.codes;

        Set<String> fetched = fetchDescendants(tenantId, hierarchy, boundaryCode, requestInfo);
        if (!fetched.isEmpty()) {
            cache.put(cacheKey, new CacheEntry(fetched, now));
            return fetched;
        }

        if (cached != null) {
            log.warn("boundary-service expansion failed for code='{}' hierarchy='{}' tenant='{}' — "
                    + "serving stale cached subtree instead", boundaryCode, hierarchy, tenantId);
            return cached.codes;
        }

        // No cache at all and the fetch failed/came back empty: fall back to the raw code,
        // uncached, so the very next call retries boundary-service rather than being stuck with
        // this fallback for a full TTL window.
        log.warn("boundary-service expansion failed for code='{}' hierarchy='{}' tenant='{}' with no "
                + "prior cache — falling back to the raw, un-expanded code", boundaryCode, hierarchy, tenantId);
        return Collections.singleton(boundaryCode);
    }

    private Set<String> fetchDescendants(String tenantId, String hierarchy, String boundaryCode, RequestInfo requestInfo) {
        StringBuilder url = new StringBuilder(config.getBoundaryHost())
                .append(config.getBoundaryRelationshipSearchEndpoint())
                .append("?tenantId=").append(tenantId)
                .append("&hierarchyType=").append(hierarchy)
                .append("&codes=").append(boundaryCode)
                .append("&includeChildren=true");

        RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();

        try {
            Object res = serviceRequestRepository.fetchResult(url, requestInfoWrapper);
            if (res == null)
                return Collections.emptySet();

            List<Map<String, Object>> roots = JsonPath.read(res, BOUNDARY_RELATIONSHIP_ROOTS_JSONPATH);
            Set<String> codes = new LinkedHashSet<>();
            for (Map<String, Object> root : roots)
                collectCodes(root, codes);
            return codes;
        } catch (Exception e) {
            log.warn("Failed to fetch boundary subtree for code='{}' hierarchy='{}' tenant='{}'",
                    boundaryCode, hierarchy, tenantId, e);
            return Collections.emptySet();
        }
    }

    @SuppressWarnings("unchecked")
    private void collectCodes(Map<String, Object> node, Set<String> out) {
        Object code = node.get("code");
        if (code != null)
            out.add(code.toString());

        Object children = node.get("children");
        if (children instanceof List) {
            for (Object child : (List<Object>) children)
                if (child instanceof Map)
                    collectCodes((Map<String, Object>) child, out);
        }
    }

    private static final class CacheEntry {
        final Set<String> codes;
        final long fetchedAt;

        CacheEntry(Set<String> codes, long fetchedAt) {
            this.codes = codes;
            this.fetchedAt = fetchedAt;
        }

        boolean fresh(long ttlMs, long now) {
            return now - fetchedAt < ttlMs;
        }
    }
}
