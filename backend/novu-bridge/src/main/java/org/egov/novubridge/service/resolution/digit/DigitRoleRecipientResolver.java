package org.egov.novubridge.service.resolution.digit;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.resolution.AudienceRef;
import org.egov.novubridge.service.resolution.Recipient;
import org.egov.novubridge.service.resolution.RecipientResolver;
import org.egov.novubridge.service.resolution.ResolutionContext;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * {@code ROLE:<code>} — every holder of the role in the tenant, from egov-user.
 *
 * <p>This is the one resolver a non-DIGIT product must replace, and the reason the SPI exists at
 * all: a role pool is a directory question, and every product answers it differently. Everything
 * else about a role notification — routing, templates, per-recipient locale, fan-out, dedupe, the
 * contact gate, the ledger — is untouched by the swap.
 *
 * <p>Four behaviours are ported exactly, because each was learned from a real failure:
 *
 * <ul>
 *   <li><b>Holders are deduped by uuid across pages, preserving insertion order.</b> Paging a
 *       live directory races against its own writes, and the same person can appear twice.</li>
 *   <li><b>Uuid-less holders are kept verbatim, appended last.</b> They cannot be deduped by key,
 *       and dropping them would silently stop notifying an ops desk whose user record has no
 *       uuid. Their subscriber id keys on the phone instead.</li>
 *   <li><b>A holder with neither a phone nor an email is dropped here, not later.</b> Such a
 *       person cannot be reached on any channel, so carrying them through the fan-out would only
 *       produce three unreachable-recipient rows per event.</li>
 *   <li><b>The page loop stops on a short page and WARNS at the cap.</b> A pool larger than
 *       {@code page.size x max.pages} is truncated, and an operator who is not told will believe
 *       everyone was notified.</li>
 * </ul>
 *
 * <p>The search is run as the internal microservice user: there is no end user behind a Kafka
 * message, and egov-user refuses a tenant-wide search without one.
 */
@Slf4j
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
        if (roleCode == null || roleCode.trim().isEmpty() || !users.available()) {
            return Collections.emptyList();
        }
        int pageSize = config.getRolePoolPageSize() != null ? config.getRolePoolPageSize() : 100;
        int maxPages = config.getRolePoolMaxPages() != null ? config.getRolePoolMaxPages() : 10;

        Map<String, Recipient> byUuid = new LinkedHashMap<>();
        List<Recipient> withoutUuid = new ArrayList<>();
        try {
            for (int page = 0; page < maxPages; page++) {
                Map<String, Object> criteria = new LinkedHashMap<>();
                criteria.put("userType", "EMPLOYEE");
                criteria.put("roleCodes", Collections.singletonList(roleCode));
                criteria.put("pageSize", pageSize);
                criteria.put("pageNumber", page);

                List<Map<String, Object>> rows = users.search(criteria, ctx.tenantId(), ctx.requestInfo());
                if (rows.isEmpty()) {
                    break;
                }
                for (Map<String, Object> row : rows) {
                    Recipient recipient = DigitUserSearch.toRecipient(row, roleCode);
                    if (recipient == null) {
                        continue;   // no phone and no email: unreachable on every channel
                    }
                    if (recipient.userId() != null && !recipient.userId().trim().isEmpty()) {
                        byUuid.putIfAbsent(recipient.userId().trim(), recipient);
                    } else {
                        withoutUuid.add(recipient);
                    }
                }
                if (rows.size() < pageSize) {
                    break;   // short page: that was the last one
                }
                if (page == maxPages - 1) {
                    log.warn("Role pool '{}' in tenant {} exceeds the {}-holder notification cap; the "
                                    + "remaining holders were NOT notified",
                            roleCode, ctx.tenantId(), pageSize * maxPages);
                }
            }
        } catch (Exception e) {
            // Returning what was collected rather than throwing: a directory blip on page three
            // should notify the first two pages, not nobody. The caller does not memoize a
            // partial answer it never saw fail, so the next routing row tries again.
            log.error("Failed to resolve role pool '{}' for tenant {}", roleCode, ctx.tenantId(), e);
        }
        List<Recipient> out = new ArrayList<>(byUuid.values());
        out.addAll(withoutUuid);
        return out;
    }
}
