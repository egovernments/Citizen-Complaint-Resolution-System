package org.egov.novubridge.service.resolution.digit;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.service.resolution.Recipient;
import org.egov.novubridge.service.resolution.UserHydrator;
import org.egov.novubridge.util.PiiMask;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A uuid to a contactable person, from egov-user.
 *
 * <p>This is what lets a producer name an actor by uuid alone, which is the largest PII reduction
 * in the thin-event design: contact details for the people an event is about no longer travel on
 * the broker at all.
 *
 * <p>Returns null when the directory has no such user or cannot be reached. Null is not an
 * exception on purpose: the caller turns it into a {@code SKIPPED} ledger row against the right
 * subscriber id, which an operator can see and act on, rather than a DLQ'd event that replaying
 * will never fix.
 */
@Slf4j
public class DigitUserHydrator implements UserHydrator {

    private final DigitUserSearch users;

    public DigitUserHydrator(DigitUserSearch users) {
        this.users = users;
    }

    @Override
    public Recipient hydrate(String userId, String type, String tenantId, RequestInfo requestInfo) {
        if (userId == null || userId.trim().isEmpty() || !users.available()) {
            return null;
        }
        try {
            Map<String, Object> criteria = new LinkedHashMap<>();
            // The producer's own lookup hardcoded EMPLOYEE. Honouring the actor's declared type
            // when it has one is what lets a module name a citizen by uuid; absent a type the
            // old default stands, so nothing that works today starts failing.
            criteria.put("userType", type != null && !type.trim().isEmpty()
                    ? type.trim().toUpperCase(java.util.Locale.ROOT) : "EMPLOYEE");
            criteria.put("uuid", Collections.singletonList(userId.trim()));

            List<Map<String, Object>> rows = users.search(criteria, tenantId, requestInfo);
            if (rows.isEmpty()) {
                log.warn("egov-user has no {} record for actor {} in tenant {}; the recipient will be "
                        + "reported as unreachable rather than guessed at",
                        criteria.get("userType"), PiiMask.mask(userId), tenantId);
                return null;
            }
            Recipient recipient = DigitUserSearch.toRecipient(rows.get(0), type);
            if (recipient == null) {
                return null;   // the record exists and carries no phone and no email
            }
            // The uuid the event named wins over whatever the record echoes: it is the key the
            // producer's transaction seed and the ledger's upsert both depend on.
            return new Recipient(userId.trim(), type, recipient.name(), recipient.phone(),
                    recipient.email(), recipient.locale());
        } catch (Exception e) {
            log.error("Failed to hydrate actor {} from egov-user for tenant {}",
                    PiiMask.mask(userId), tenantId, e);
            return null;
        }
    }
}
