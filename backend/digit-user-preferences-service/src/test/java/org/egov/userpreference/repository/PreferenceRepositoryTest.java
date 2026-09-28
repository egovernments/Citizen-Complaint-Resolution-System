package org.egov.userpreference.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.userpreference.web.model.AuditDetails;
import org.egov.userpreference.web.model.Preference;
import org.egov.userpreference.web.model.PreferenceCriteria;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest
@ActiveProfiles("test")
class PreferenceRepositoryTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired
    private PreferenceRepository repository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void clearPreferences() {
        jdbcTemplate.update("DELETE FROM user_preference");
    }

    private Preference preference(String userId, String tenantId, String code, String payloadJson) {
        try {
            long now = System.currentTimeMillis();
            return Preference.builder()
                    .id(UUID.randomUUID().toString())
                    .userId(userId)
                    .tenantId(tenantId)
                    .preferenceCode(code)
                    .payload(MAPPER.readTree(payloadJson))
                    .auditDetails(AuditDetails.builder()
                            .createdBy("author")
                            .createdTime(now)
                            .lastModifiedBy("author")
                            .lastModifiedTime(now)
                            .build())
                    .build();
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    @Test
    void roundTripsAPreferenceThroughTheDatabase() {
        Preference created = repository.create(preference("u1", "pg.citya", "CODE",
                "{\"preferredLanguage\":\"en_IN\",\"consent\":{\"SMS\":{\"status\":\"GRANTED\"}}}"));

        Preference loaded = repository.findById(created.getId());

        assertNotNull(loaded);
        assertEquals("u1", loaded.getUserId());
        assertEquals("pg.citya", loaded.getTenantId());
        assertEquals("CODE", loaded.getPreferenceCode());
        assertEquals("en_IN", loaded.getPayload().at("/preferredLanguage").asText());
        assertEquals("GRANTED", loaded.getPayload().at("/consent/SMS/status").asText());
        assertEquals("author", loaded.getAuditDetails().getCreatedBy());
    }

    @Test
    void findsARowByItsCompositeKey() {
        repository.create(preference("u1", "pg.citya", "CODE", "{}"));

        assertNotNull(repository.findByKey("u1", "pg.citya", "CODE"));
        assertNull(repository.findByKey("u1", "pg.cityb", "CODE"), "a different tenant is a different row");
        assertNull(repository.findByKey("u2", "pg.citya", "CODE"), "a different user is a different row");
        assertNull(repository.findByKey("u1", "pg.citya", "OTHER"), "a different code is a different row");
    }

    @Test
    void findsAGlobalRowWhenNoTenantIsSupplied() {
        repository.create(preference("u1", "", "CODE", "{}"));

        assertNotNull(repository.findByKey("u1", "", "CODE"));
        assertNotNull(repository.findByKey("u1", null, "CODE"));
        assertNull(repository.findByKey("u1", "pg.citya", "CODE"));
    }

    @Test
    void findsARowStoredWithANullTenant() {
        // A row written outside this service, or by an older schema, can carry
        // a NULL rather than ''. Both have to resolve to the global row.
        String id = UUID.randomUUID().toString();
        jdbcTemplate.update("INSERT INTO user_preference (id, user_id, tenant_id, preference_code, payload, "
                        + "created_by, created_time, last_modified_by, last_modified_time) "
                        + "VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)",
                id, "u-null", "CODE", "{}", "seed", 1L, "seed", 1L);

        Preference found = repository.findByKey("u-null", "", "CODE");

        assertNotNull(found);
        assertEquals(id, found.getId());
        assertNull(found.getTenantId());
    }

    @Test
    void returnsNullRatherThanThrowingWhenNothingMatches() {
        assertNull(repository.findByKey("absent", "pg.citya", "CODE"));
        assertNull(repository.findById(UUID.randomUUID().toString()));
    }

    @Test
    void movesOnlyThePayloadAndModificationAuditOnUpdate() {
        Preference created = repository.create(preference("u1", "pg.citya", "CODE", "{\"v\":1}"));

        Preference change = preference("ignored", "ignored", "IGNORED", "{\"v\":2}");
        change.setId(created.getId());
        change.getAuditDetails().setLastModifiedBy("editor");
        change.getAuditDetails().setLastModifiedTime(999L);

        Preference updated = repository.update(change);

        assertEquals(2, updated.getPayload().at("/v").asInt());
        assertEquals("editor", updated.getAuditDetails().getLastModifiedBy());
        assertEquals(999L, updated.getAuditDetails().getLastModifiedTime());
        // Untouched by the update statement.
        assertEquals("u1", updated.getUserId());
        assertEquals("pg.citya", updated.getTenantId());
        assertEquals("CODE", updated.getPreferenceCode());
        assertEquals("author", updated.getAuditDetails().getCreatedBy());
        assertEquals(created.getAuditDetails().getCreatedTime(), updated.getAuditDetails().getCreatedTime());
    }

    @Test
    void refusesASecondRowUnderTheSameKey() {
        repository.create(preference("u1", "pg.citya", "CODE", "{}"));

        assertThrows(DataIntegrityViolationException.class,
                () -> repository.create(preference("u1", "pg.citya", "CODE", "{}")));
    }

    @Test
    void pagesAndCountsIndependently() {
        for (int i = 0; i < 5; i++) {
            Preference p = preference("user-" + i, "pg.citya", "CODE", "{}");
            p.getAuditDetails().setCreatedTime((long) i);
            repository.create(p);
        }

        PreferenceCriteria criteria = PreferenceCriteria.builder()
                .tenantId("pg.citya")
                .limit(2)
                .offset(0)
                .build();

        assertEquals(5L, repository.count(criteria));
        List<Preference> page = repository.search(criteria);
        assertEquals(2, page.size());
        // created_time DESC, so the highest seeded index comes first.
        assertEquals("user-4", page.get(0).getUserId());
        assertEquals("user-3", page.get(1).getUserId());

        criteria.setOffset(4);
        assertEquals(1, repository.search(criteria).size());

        criteria.setOffset(99);
        assertTrue(repository.search(criteria).isEmpty());
    }

    @Test
    void writesTheColumnDefaultForAnAbsentPayload() {
        Preference p = preference("u1", "pg.citya", "CODE", "{}");
        p.setPayload(null);

        Preference created = repository.create(p);
        Preference loaded = repository.findById(created.getId());

        assertTrue(loaded.getPayload().isObject());
        assertTrue(loaded.getPayload().isEmpty());
    }

    @Test
    void roundTripsAnExplicitJsonNullPayload() throws Exception {
        Preference p = preference("u1", "pg.citya", "CODE", "{}");
        p.setPayload(MAPPER.readTree("null"));

        Preference loaded = repository.findById(repository.create(p).getId());

        assertTrue(loaded.getPayload().isNull());
    }

    @Test
    void reportsTheDatabaseAsReachable() {
        assertTrue(repository.isReachable());
    }
}
