package org.egov.userpreference.service.enrichment;

import org.egov.userpreference.config.ApplicationConfig;
import org.egov.userpreference.web.model.AuditDetails;
import org.egov.userpreference.web.model.Preference;
import org.egov.userpreference.web.model.PreferenceCriteria;
import org.egov.userpreference.web.model.RequestInfo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PreferenceEnricherTest {

    private PreferenceEnricher enricher;

    @BeforeEach
    void setUp() {
        ApplicationConfig config = new ApplicationConfig();
        config.setDefaultLimit(10);
        config.setDefaultOffset(0);
        config.setMaxLimit(100);
        enricher = new PreferenceEnricher(config);
    }

    @Test
    void mintsAUuidWhenTheIdIsAbsent() {
        Preference preference = Preference.builder().userId("u1").preferenceCode("C").build();
        enricher.enrichForCreate(preference, "author");

        assertNotNull(preference.getId());
        assertDoesNotThrow(() -> UUID.fromString(preference.getId()));
    }

    @Test
    void keepsACallerSuppliedId() {
        Preference preference = Preference.builder().id("given-id").userId("u1").preferenceCode("C").build();
        enricher.enrichForCreate(preference, "author");

        assertEquals("given-id", preference.getId());
    }

    @Test
    void stampsAllFourAuditFieldsOnCreate() {
        long before = System.currentTimeMillis();
        Preference preference = Preference.builder().userId("u1").preferenceCode("C").build();
        enricher.enrichForCreate(preference, "author");
        long after = System.currentTimeMillis();

        AuditDetails audit = preference.getAuditDetails();
        assertEquals("author", audit.getCreatedBy());
        assertEquals("author", audit.getLastModifiedBy());
        assertEquals(audit.getCreatedTime(), audit.getLastModifiedTime());
        assertTrue(audit.getCreatedTime() >= before && audit.getCreatedTime() <= after);
    }

    @Test
    void attributesAnUnidentifiedCallerToSystem() {
        Preference preference = Preference.builder().userId("u1").preferenceCode("C").build();
        enricher.enrichForCreate(preference, "");

        assertEquals("system", preference.getAuditDetails().getCreatedBy());

        Preference other = Preference.builder().userId("u1").preferenceCode("C").build();
        enricher.enrichForCreate(other, null);
        assertEquals("system", other.getAuditDetails().getCreatedBy());
    }

    @Test
    void trimsTheKeyFieldsAndMapsAnAbsentTenantToTheEmptyString() {
        Preference preference = Preference.builder()
                .userId("  u1  ")
                .preferenceCode("  C  ")
                .build();
        enricher.enrichForCreate(preference, "author");

        assertEquals("u1", preference.getUserId());
        assertEquals("C", preference.getPreferenceCode());
        // The Go model held a string, never a null, so an absent tenant was
        // stored as '' — and the unique index keys on COALESCE(tenant_id, '').
        assertEquals("", preference.getTenantId());
    }

    @Test
    void carriesTheStoredIdAndCreationAuditThroughAnUpdate() {
        Preference existing = Preference.builder()
                .id("stored-id")
                .userId("u1")
                .preferenceCode("C")
                .auditDetails(AuditDetails.builder()
                        .createdBy("original-author")
                        .createdTime(111L)
                        .lastModifiedBy("original-author")
                        .lastModifiedTime(111L)
                        .build())
                .build();

        Preference incoming = Preference.builder()
                .id("ignored-id")
                .userId("u1")
                .preferenceCode("C")
                .build();

        enricher.enrichForUpdate(incoming, existing, "editor");

        assertEquals("stored-id", incoming.getId());
        assertEquals("original-author", incoming.getAuditDetails().getCreatedBy());
        assertEquals(111L, incoming.getAuditDetails().getCreatedTime());
        assertEquals("editor", incoming.getAuditDetails().getLastModifiedBy());
        assertTrue(incoming.getAuditDetails().getLastModifiedTime() > 111L);
    }

    @Test
    void survivesAStoredRowWithNoAuditDetails() {
        Preference existing = Preference.builder().id("stored-id").userId("u1").preferenceCode("C").build();
        Preference incoming = Preference.builder().userId("u1").preferenceCode("C").build();

        enricher.enrichForUpdate(incoming, existing, "editor");

        assertEquals("stored-id", incoming.getId());
        assertEquals("editor", incoming.getAuditDetails().getLastModifiedBy());
    }

    @Test
    void prefersTheUuidOverTheNumericIdWhenIdentifyingTheAuthor() {
        RequestInfo requestInfo = RequestInfo.builder()
                .userInfo(RequestInfo.UserInfo.builder().uuid("the-uuid").id("42").build())
                .build();

        assertEquals("the-uuid", PreferenceEnricher.userIdFrom(requestInfo));
    }

    @Test
    void fallsBackThroughNumericIdThenRequesterId() {
        RequestInfo numeric = RequestInfo.builder()
                .userInfo(RequestInfo.UserInfo.builder().id("42").build())
                .build();
        assertEquals("42", PreferenceEnricher.userIdFrom(numeric));

        RequestInfo requester = RequestInfo.builder().requesterId("seed-job").build();
        assertEquals("seed-job", PreferenceEnricher.userIdFrom(requester));
    }

    @Test
    void identifiesNobodyFromAnEmptyOrAbsentRequestInfo() {
        assertEquals("", PreferenceEnricher.userIdFrom(null));
        assertEquals("", PreferenceEnricher.userIdFrom(RequestInfo.builder().build()));
        assertEquals("", PreferenceEnricher.userIdFrom(RequestInfo.builder()
                .userInfo(RequestInfo.UserInfo.builder().build())
                .build()));
    }

    @Test
    void appliesTheDefaultPageToAnAbsentOrZeroLimit() {
        PreferenceCriteria absent = PreferenceCriteria.builder().userId("u1").build();
        enricher.enrichSearchDefaults(absent);
        assertEquals(10, absent.getLimit());
        assertEquals(0, absent.getOffset());

        PreferenceCriteria zero = PreferenceCriteria.builder().userId("u1").limit(0).build();
        enricher.enrichSearchDefaults(zero);
        assertEquals(10, zero.getLimit());
    }

    @Test
    void clampsAnOversizedLimitAndLeavesAValidOneAlone() {
        PreferenceCriteria oversized = PreferenceCriteria.builder().userId("u1").limit(5000).build();
        enricher.enrichSearchDefaults(oversized);
        assertEquals(100, oversized.getLimit());

        PreferenceCriteria exact = PreferenceCriteria.builder().userId("u1").limit(100).build();
        enricher.enrichSearchDefaults(exact);
        assertEquals(100, exact.getLimit());

        PreferenceCriteria small = PreferenceCriteria.builder().userId("u1").limit(5).offset(20).build();
        enricher.enrichSearchDefaults(small);
        assertEquals(5, small.getLimit());
        assertEquals(20, small.getOffset());
    }
}
