package org.egov.userpreference.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.userpreference.repository.PreferenceRepository;
import org.egov.userpreference.service.enrichment.PreferenceEnricher;
import org.egov.userpreference.service.validator.PreferenceValidator;
import org.egov.userpreference.utils.CustomException;
import org.egov.userpreference.utils.ErrorCodes;
import org.egov.userpreference.utils.ResponseUtil;
import org.egov.userpreference.web.model.Pagination;
import org.egov.userpreference.web.model.Preference;
import org.egov.userpreference.web.model.PreferenceCriteria;
import org.egov.userpreference.web.model.PreferenceRequest;
import org.egov.userpreference.web.model.PreferenceResponse;
import org.egov.userpreference.web.model.PreferenceSearchRequest;
import org.egov.userpreference.web.model.RequestInfo;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;

import java.util.List;

/** Business logic for storing and retrieving user preferences. */
@Service
@Slf4j
@RequiredArgsConstructor
public class PreferenceService {

    private final PreferenceValidator validator;
    private final PreferenceEnricher enricher;
    private final PreferenceRepository repository;

    /**
     * Creates or replaces the preference held under
     * (userId, tenantId, preferenceCode).
     *
     * <p>There is deliberately no separate create and update endpoint: callers
     * such as the citizen profile screen know the consent they want, not
     * whether a row already exists.
     */
    public PreferenceResponse upsert(PreferenceRequest request) {
        RequestInfo requestInfo = request.getRequestInfo();
        validator.validateRequestInfo(requestInfo);

        Preference preference = request.getPreference();
        if (preference == null) {
            throw CustomException.validation(ErrorCodes.INVALID_REQUEST, "preference is required", requestInfo);
        }

        validator.validatePreference(preference, requestInfo);
        if (PreferenceValidator.USER_NOTIFICATION_PREFERENCES.equals(preference.getPreferenceCode())) {
            validator.validateNotificationPayload(preference.getPayload(), requestInfo);
        }

        String userId = PreferenceEnricher.userIdFrom(requestInfo);

        // The lookup runs on the raw key, before normalization, exactly as it
        // did in the Go service — a tenantId of "  " therefore misses the
        // trimmed row it will later be stored under.
        Preference existing;
        try {
            existing = repository.findByKey(
                    preference.getUserId(), preference.getTenantId(), preference.getPreferenceCode());
        } catch (DataAccessException e) {
            log.error("Failed to look up the existing preference", e);
            throw CustomException.internal("failed to check existing preference: " + rootCause(e), requestInfo);
        }

        Preference result;
        try {
            if (existing != null) {
                enricher.enrichForUpdate(preference, existing, userId);
                result = repository.update(preference);
            } else {
                enricher.enrichForCreate(preference, userId);
                result = repository.create(preference);
            }
        } catch (DataAccessException e) {
            log.error("Failed to save the preference", e);
            throw CustomException.internal("failed to save preference: " + rootCause(e), requestInfo);
        }

        return PreferenceResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(requestInfo, true))
                .preferences(List.of(result))
                .build();
    }

    /** Pages the preferences matching the criteria, newest first. */
    public PreferenceResponse search(PreferenceSearchRequest request) {
        RequestInfo requestInfo = request.getRequestInfo();
        validator.validateRequestInfo(requestInfo);

        PreferenceCriteria criteria = request.getCriteria();
        if (criteria == null) {
            throw CustomException.validation(ErrorCodes.INVALID_REQUEST, "criteria is required", requestInfo);
        }

        validator.validateCriteria(criteria, requestInfo);
        enricher.enrichSearchDefaults(criteria);

        List<Preference> preferences;
        long totalCount;
        try {
            totalCount = repository.count(criteria);
            preferences = repository.search(criteria);
        } catch (DataAccessException e) {
            log.error("Failed to search preferences", e);
            throw CustomException.internal("failed to search preferences: " + rootCause(e), requestInfo);
        }

        return PreferenceResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(requestInfo, true))
                .preferences(preferences)
                .pagination(Pagination.builder()
                        .limit(criteria.getLimit())
                        .offset(criteria.getOffset())
                        .totalCount(totalCount)
                        .build())
                .build();
    }

    /**
     * The message Go's {@code %v} on a wrapped error produced — the innermost
     * cause, which is the database's own complaint.
     */
    private static String rootCause(Throwable e) {
        Throwable cause = e;
        while (cause.getCause() != null) {
            cause = cause.getCause();
        }
        return cause.getMessage();
    }
}
