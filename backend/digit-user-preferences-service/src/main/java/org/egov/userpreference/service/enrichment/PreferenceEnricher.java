package org.egov.userpreference.service.enrichment;

import lombok.RequiredArgsConstructor;
import org.egov.userpreference.config.ApplicationConfig;
import org.egov.userpreference.utils.StringUtil;
import org.egov.userpreference.web.model.AuditDetails;
import org.egov.userpreference.web.model.Preference;
import org.egov.userpreference.web.model.PreferenceCriteria;
import org.egov.userpreference.web.model.RequestInfo;
import org.springframework.stereotype.Component;

import java.util.UUID;

/** Fills in the identifiers, audit trail and search defaults the caller did not supply. */
@Component
@RequiredArgsConstructor
public class PreferenceEnricher {

    /** Audit author recorded when the request carries no identifiable user. */
    private static final String SYSTEM_USER = "system";

    private final ApplicationConfig applicationConfig;

    public void enrichForCreate(Preference preference, String userId) {
        long now = System.currentTimeMillis();

        // A caller-supplied id is honoured; only a missing one is minted.
        if (StringUtil.isEmpty(preference.getId())) {
            preference.setId(UUID.randomUUID().toString());
        }

        normalize(preference);

        String author = resolveAuthor(userId);
        preference.setAuditDetails(AuditDetails.builder()
                .createdBy(author)
                .createdTime(now)
                .lastModifiedBy(author)
                .lastModifiedTime(now)
                .build());
    }

    /**
     * Folds an incoming preference onto the row already stored under the same
     * (userId, tenantId, preferenceCode) key: the stored id and creation audit
     * win, the caller only moves {@code lastModified*} and the payload.
     */
    public void enrichForUpdate(Preference preference, Preference existing, String userId) {
        long now = System.currentTimeMillis();

        preference.setId(existing.getId());

        normalize(preference);

        AuditDetails existingAudit = existing.getAuditDetails();
        preference.setAuditDetails(AuditDetails.builder()
                .createdBy(existingAudit != null ? existingAudit.getCreatedBy() : null)
                .createdTime(existingAudit != null ? existingAudit.getCreatedTime() : null)
                .lastModifiedBy(resolveAuthor(userId))
                .lastModifiedTime(now)
                .build());
    }

    /** Applies the default page size and clamps it to the configured maximum. */
    public void enrichSearchDefaults(PreferenceCriteria criteria) {
        Integer limit = criteria.getLimit();
        if (limit == null || limit == 0) {
            limit = applicationConfig.getDefaultLimit();
        }
        if (limit > applicationConfig.getMaxLimit()) {
            limit = applicationConfig.getMaxLimit();
        }
        criteria.setLimit(limit);

        if (criteria.getOffset() == null) {
            criteria.setOffset(applicationConfig.getDefaultOffset());
        }
    }

    /**
     * Identifies the audit author: the authenticated user's uuid, falling back
     * to their numeric id and then to {@code requesterId}.
     */
    public static String userIdFrom(RequestInfo requestInfo) {
        if (requestInfo == null) {
            return "";
        }
        if (requestInfo.getUserInfo() != null) {
            if (StringUtil.isNotEmpty(requestInfo.getUserInfo().getUuid())) {
                return requestInfo.getUserInfo().getUuid();
            }
            return StringUtil.nullToEmpty(requestInfo.getUserInfo().getId());
        }
        return StringUtil.nullToEmpty(requestInfo.getRequesterId());
    }

    /**
     * Whitespace is stripped from the key fields only after validation has run
     * on the raw values, preserving the Go ordering where e.g. a 65-character
     * userId that trims to 60 is still rejected.
     */
    private void normalize(Preference preference) {
        preference.setUserId(StringUtil.trimToEmpty(preference.getUserId()));
        preference.setTenantId(StringUtil.trimToEmpty(preference.getTenantId()));
        preference.setPreferenceCode(StringUtil.trimToEmpty(preference.getPreferenceCode()));
    }

    private String resolveAuthor(String userId) {
        return StringUtil.isEmpty(userId) ? SYSTEM_USER : userId;
    }
}
