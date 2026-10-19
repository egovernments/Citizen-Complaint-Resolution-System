package org.egov.novubridge.service.resolution.digit;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.resolution.AudienceRef;
import org.egov.novubridge.service.resolution.Recipient;
import org.egov.novubridge.service.resolution.RecipientLimitExceededException;
import org.egov.novubridge.service.resolution.RecipientResolver;
import org.egov.novubridge.service.resolution.ResolutionContext;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * {@code ROLE:<code>}: every EMPLOYEE holder of the role in the tenant, from egov-user.
 *
 * <ul>
 *   <li>Holders are deduped by uuid across pages (paging a live directory can repeat people).</li>
 *   <li>Uuid-less holders are kept, appended last; they key on their phone.</li>
 *   <li>A holder with neither phone nor email is dropped here.</li>
 *   <li>A pool larger than {@code page.size x max.pages} is refused with
 *       {@link RecipientLimitExceededException} rather than partially notified, and a directory
 *       failure on any page propagates rather than returning a partial pool.</li>
 * </ul>
 */
public class DigitRoleRecipientResolver implements RecipientResolver {

    private final DigitUserSearch users;
    private final NovuBridgeConfiguration config;

    public DigitRoleRecipientResolver(DigitUserSearch users, NovuBridgeConfiguration config) {
        this.users = users;
        this.config = config;
    }

    @Override
    public String scheme() {
        return AudienceRef.ROLE;
    }

    @Override
    public List<Recipient> resolve(AudienceRef ref, ResolutionContext ctx) {
        String roleCode = ref.value();
        if (!StringUtils.hasText(roleCode) || !users.available()) {
            return Collections.emptyList();
        }
        String tenantId = ctx.event().getTenantId();
        int pageSize = config.getRolePoolPageSize() != null ? config.getRolePoolPageSize() : 100;
        int maxPages = config.getRolePoolMaxPages() != null ? config.getRolePoolMaxPages() : 10;

        Map<String, Recipient> byUuid = new LinkedHashMap<>();
        List<Recipient> withoutUuid = new ArrayList<>();
        // One page past the window, to tell "exactly full" from "more holders exist".
        for (int page = 0; page <= maxPages; page++) {
            List<Map<String, Object>> rows = users.search(criteria(roleCode, pageSize, page), tenantId,
                    ctx.requestInfo());
            if (rows.isEmpty()) {
                break;
            }
            if (page == maxPages) {
                throw new RecipientLimitExceededException("Role pool '" + roleCode + "' in tenant " + tenantId
                        + " has more than " + pageSize * maxPages + " holders (novu.bridge role pool "
                        + "page size x max pages)");
            }
            for (Map<String, Object> row : rows) {
                Recipient recipient = DigitUserSearch.toRecipient(row, roleCode);
                if (recipient == null) {
                    continue;
                }
                if (StringUtils.hasText(recipient.userId())) {
                    byUuid.putIfAbsent(recipient.userId().trim(), recipient);
                } else {
                    withoutUuid.add(recipient);
                }
            }
            if (rows.size() < pageSize) {
                break;
            }
        }
        List<Recipient> out = new ArrayList<>(byUuid.values());
        out.addAll(withoutUuid);
        return out;
    }

    private static Map<String, Object> criteria(String roleCode, int pageSize, int page) {
        Map<String, Object> criteria = new LinkedHashMap<>();
        criteria.put("userType", "EMPLOYEE");
        criteria.put("roleCodes", Collections.singletonList(roleCode));
        criteria.put("pageSize", pageSize);
        criteria.put("pageNumber", page);
        return criteria;
    }
}
