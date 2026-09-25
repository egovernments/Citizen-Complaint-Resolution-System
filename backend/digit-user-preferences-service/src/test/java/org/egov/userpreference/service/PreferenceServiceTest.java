package org.egov.userpreference.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.userpreference.config.ApplicationConfig;
import org.egov.userpreference.repository.PreferenceRepository;
import org.egov.userpreference.service.enrichment.PreferenceEnricher;
import org.egov.userpreference.service.validator.OwnershipValidator;
import org.egov.userpreference.service.validator.PreferenceValidator;
import org.egov.userpreference.utils.CustomException;
import org.egov.userpreference.web.model.AuditDetails;
import org.egov.userpreference.web.model.Preference;
import org.egov.userpreference.web.model.PreferenceCriteria;
import org.egov.userpreference.web.model.PreferenceRequest;
import org.egov.userpreference.web.model.PreferenceResponse;
import org.egov.userpreference.web.model.PreferenceSearchRequest;
import org.egov.userpreference.web.model.RequestInfo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Service-level behaviour that needs the repository to misbehave: the upsert
 * routing decision and the mapping of database failures onto the 500 responses
 * the Go service produced.
 */
class PreferenceServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private PreferenceRepository repository;
    private PreferenceService service;

    @BeforeEach
    void setUp() {
        ApplicationConfig config = new ApplicationConfig();
        config.setDefaultLimit(10);
        config.setDefaultOffset(0);
        config.setMaxLimit(100);
        config.setValidLanguages(List.of("en_IN", "hi_IN", "fr_IN", "pt_IN"));

        repository = mock(PreferenceRepository.class);
        OwnershipValidator ownershipValidator = new OwnershipValidator();
        ReflectionTestUtils.setField(ownershipValidator, "enforceOwnership", true);
        ReflectionTestUtils.setField(ownershipValidator, "privilegedRoles", List.of("EMPLOYEE", "SUPERUSER"));
        service = new PreferenceService(new PreferenceValidator(config), ownershipValidator,
                new PreferenceEnricher(config), repository);
    }

    private PreferenceRequest upsertRequest() {
        try {
            return PreferenceRequest.builder()
                    .requestInfo(RequestInfo.builder()
                            .userInfo(RequestInfo.UserInfo.builder().uuid("u1").build())
                            .build())
                    .preference(Preference.builder()
                            .userId("u1")
                            .tenantId("pg.citya")
                            .preferenceCode("USER_PROFILE")
                            .payload(MAPPER.readTree("{\"k\":\"v\"}"))
                            .build())
                    .build();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void insertsWhenNoRowExistsForTheKey() {
        when(repository.findByKey("u1", "pg.citya", "USER_PROFILE")).thenReturn(null);
        when(repository.create(any())).thenAnswer(invocation -> invocation.getArgument(0));

        PreferenceResponse response = service.upsert(upsertRequest());

        verify(repository).create(any());
        verify(repository, never()).update(any());
        assertEquals("u1", response.getPreferences().get(0).getAuditDetails().getCreatedBy());
        assertNull(response.getPagination(), "an upsert carries no pagination block");
    }

    @Test
    void updatesWhenARowAlreadyExistsForTheKey() {
        Preference existing = Preference.builder()
                .id("stored-id")
                .userId("u1")
                .tenantId("pg.citya")
                .preferenceCode("USER_PROFILE")
                .auditDetails(AuditDetails.builder().createdBy("first-author").createdTime(1L).build())
                .build();

        when(repository.findByKey("u1", "pg.citya", "USER_PROFILE")).thenReturn(existing);
        when(repository.update(any())).thenAnswer(invocation -> invocation.getArgument(0));

        PreferenceResponse response = service.upsert(upsertRequest());

        verify(repository).update(any());
        verify(repository, never()).create(any());
        assertEquals("stored-id", response.getPreferences().get(0).getId());
        assertEquals("first-author", response.getPreferences().get(0).getAuditDetails().getCreatedBy());
    }

    @Test
    void reportsALookupFailureAsAnInternalError() {
        when(repository.findByKey(anyString(), anyString(), anyString()))
                .thenThrow(new QueryTimeoutException("statement timed out"));

        CustomException e = assertThrows(CustomException.class, () -> service.upsert(upsertRequest()));

        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, e.getHttpStatus());
        assertEquals("INTERNAL_ERROR", e.getErrors().get(0).getCode());
        // The driver's text is logged, not returned: it names indexes,
        // constraints and columns the caller has no business seeing.
        assertEquals("failed to check existing preference", e.getErrors().get(0).getMessage());
        assertFalse(e.getErrors().get(0).getMessage().contains("statement timed out"));
    }

    @Test
    void reportsASaveFailureAsAnInternalError() {
        when(repository.findByKey(anyString(), anyString(), anyString())).thenReturn(null);
        when(repository.create(any()))
                .thenThrow(new DataIntegrityViolationException("wrapper",
                        new IllegalStateException("duplicate key value violates unique constraint")));

        CustomException e = assertThrows(CustomException.class, () -> service.upsert(upsertRequest()));

        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, e.getHttpStatus());
        assertEquals("failed to save preference", e.getErrors().get(0).getMessage());
        assertFalse(e.getErrors().get(0).getMessage().contains("unique constraint"));
    }

    @Test
    void reportsASearchFailureAsAnInternalError() {
        when(repository.count(any())).thenThrow(new QueryTimeoutException("statement timed out"));

        PreferenceSearchRequest request = PreferenceSearchRequest.builder()
                .requestInfo(RequestInfo.builder().build())
                .criteria(PreferenceCriteria.builder().userId("u1").build())
                .build();

        CustomException e = assertThrows(CustomException.class, () -> service.search(request));

        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, e.getHttpStatus());
        assertEquals("failed to search preferences", e.getErrors().get(0).getMessage());
    }

    @Test
    void keepsTheRequestInfoOnAnInternalErrorSoTheResponseCanEchoIt() {
        when(repository.findByKey(anyString(), anyString(), anyString()))
                .thenThrow(new QueryTimeoutException("boom"));

        PreferenceRequest request = upsertRequest();
        CustomException e = assertThrows(CustomException.class, () -> service.upsert(request));

        assertEquals(request.getRequestInfo(), e.getRequestInfo());
    }

    @Test
    void looksUpTheTrimmedKeySoPaddedInputStaysIdempotent() {
        // The Go service looked up the raw value, which merely inserted a
        // second row for padded input. With the unique index the migration now
        // creates, that same path would miss and then fail the insert with a
        // duplicate-key 500, so the lookup uses the key the row is stored
        // under.
        when(repository.findByKey(anyString(), anyString(), anyString())).thenReturn(null);
        when(repository.create(any())).thenAnswer(invocation -> invocation.getArgument(0));

        PreferenceRequest request = upsertRequest();
        request.getPreference().setTenantId("  pg.citya  ");

        PreferenceResponse response = service.upsert(request);

        verify(repository).findByKey("u1", "pg.citya", "USER_PROFILE");
        assertEquals("pg.citya", response.getPreferences().get(0).getTenantId());
    }

    @Test
    void countsEverythingMatchingWhilePagingTheRows() {
        when(repository.count(any())).thenReturn(42L);
        when(repository.search(any())).thenReturn(List.of());

        PreferenceSearchRequest request = PreferenceSearchRequest.builder()
                .requestInfo(RequestInfo.builder().build())
                .criteria(PreferenceCriteria.builder().tenantId("pg.citya").limit(5).offset(10).build())
                .build();

        PreferenceResponse response = service.search(request);

        assertEquals(42L, response.getPagination().getTotalCount());
        assertEquals(5, response.getPagination().getLimit());
        assertEquals(10, response.getPagination().getOffset());
    }

    @Test
    void validatesTheNotificationPayloadOnlyForItsOwnPreferenceCode() {
        when(repository.findByKey(anyString(), anyString(), anyString())).thenReturn(null);
        when(repository.create(any())).thenAnswer(invocation -> invocation.getArgument(0));

        PreferenceRequest request = upsertRequest();
        request.getPreference().setPreferenceCode("USER_NOTIFICATION_PREFERENCES");
        assertEquals("USER_NOTIFICATION_PREFERENCES",
                service.upsert(request).getPreferences().get(0).getPreferenceCode());

        PreferenceRequest invalid = upsertRequest();
        invalid.getPreference().setPreferenceCode("USER_NOTIFICATION_PREFERENCES");
        try {
            invalid.getPreference().setPayload(MAPPER.readTree("{\"preferredLanguage\":\"zz_ZZ\"}"));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        CustomException e = assertThrows(CustomException.class, () -> service.upsert(invalid));
        assertEquals("INVALID_LANGUAGE", e.getErrors().get(0).getCode());

        // The same payload under any other code is stored without complaint.
        PreferenceRequest other = upsertRequest();
        try {
            other.getPreference().setPayload(MAPPER.readTree("{\"preferredLanguage\":\"zz_ZZ\"}"));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
        assertEquals("USER_PROFILE", service.upsert(other).getPreferences().get(0).getPreferenceCode());
    }
}
