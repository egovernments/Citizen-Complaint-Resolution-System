package org.egov.novubridge.service.resolution.digit;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.service.resolution.Recipient;
import org.egov.novubridge.service.resolution.UserHydrator;
import org.egov.novubridge.util.PiiMask;
import org.springframework.util.StringUtils;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * A uuid to a contactable person, from egov-user. Null when there is no such user or it has no
 * contact; a directory failure propagates (see {@link UserHydrator}).
 */
@Slf4j
public class DigitUserHydrator implements UserHydrator {

    /** EMPLOYEE first: the case this handled before, at no extra call. */
    private static final List<String> UNTYPED_ORDER = List.of("EMPLOYEE", "CITIZEN");

    private final DigitUserSearch users;

    public DigitUserHydrator(DigitUserSearch users) {
        this.users = users;
    }

    @Override
    public Recipient hydrate(String userId, String type, String tenantId, RequestInfo requestInfo) {
        if (!StringUtils.hasText(userId) || !users.available()) {
            return null;
        }
        // The actor's declared type wins (so a citizen can be named by uuid). The contract makes
        // it optional, and egov-user will not search both kinds at once (a CITIZEN search moves to
        // the state tenant), so an untyped actor is looked up as each in turn: a uuid is one user.
        List<String> userTypes = StringUtils.hasText(type)
                ? List.of(type.trim().toUpperCase(Locale.ROOT)) : UNTYPED_ORDER;
        for (String userType : userTypes) {
            Map<String, Object> criteria = new LinkedHashMap<>();
            criteria.put("userType", userType);
            criteria.put("uuid", Collections.singletonList(userId.trim()));
            List<Map<String, Object>> rows = users.search(criteria, tenantId, requestInfo);
            if (rows.isEmpty()) {
                continue;
            }
            String resolvedType = StringUtils.hasText(type) ? type : userType;
            Recipient recipient = DigitUserSearch.toRecipient(rows.get(0), resolvedType);
            if (recipient == null) {
                return null;
            }
            // The uuid the event named wins: the transaction id and the ledger upsert key on it.
            return new Recipient(userId.trim(), resolvedType, recipient.name(), recipient.phone(),
                    recipient.email(), recipient.locale());
        }
        log.warn("egov-user has no {} record for actor {} in tenant {}; reporting it unreachable",
                String.join("/", userTypes), PiiMask.mask(userId), tenantId);
        return null;
    }
}
