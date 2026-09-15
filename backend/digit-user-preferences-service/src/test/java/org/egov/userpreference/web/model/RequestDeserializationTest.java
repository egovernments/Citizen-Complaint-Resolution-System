package org.egov.userpreference.web.model;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Deserialization of the request envelopes, including the key-casing tolerance
 * Go's {@code encoding/json} gave the API for free.
 */
class RequestDeserializationTest {

    /** Mirrors the application mapper: see spring.jackson.* in application.properties. */
    private final ObjectMapper applicationMapper = JsonMapper.builder()
            .enable(MapperFeature.ACCEPT_CASE_INSENSITIVE_PROPERTIES)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();

    /** A stock mapper, to prove the @JsonAlias alone covers the in-production spelling. */
    private final ObjectMapper strictMapper = new ObjectMapper();

    @Test
    void readsTheCapitalisedRequestInfoFromTheDigitStandard() throws Exception {
        PreferenceRequest request = strictMapper.readValue(
                "{\"RequestInfo\":{\"apiId\":\"x\"},\"preference\":{\"userId\":\"u\"}}",
                PreferenceRequest.class);

        assertEquals("x", request.getRequestInfo().getApiId());
        assertEquals("u", request.getPreference().getUserId());
    }

    @Test
    void readsTheLowerCamelRequestInfoNovuBridgeSendsEvenWithoutTheCaseInsensitiveFlag() throws Exception {
        // The alias, not the mapper feature, is what carries this one — so a
        // mapper built elsewhere in the codebase still parses novu-bridge's
        // request correctly.
        PreferenceRequest request = strictMapper.readValue(
                "{\"requestInfo\":{\"apiId\":\"x\"}}", PreferenceRequest.class);

        assertNotNull(request.getRequestInfo());
        assertEquals("x", request.getRequestInfo().getApiId());
    }

    @Test
    void readsBothEnvelopeSpellingsOnTheSearchRequest() throws Exception {
        assertNotNull(strictMapper.readValue("{\"RequestInfo\":{}}", PreferenceSearchRequest.class)
                .getRequestInfo());
        assertNotNull(strictMapper.readValue("{\"requestInfo\":{}}", PreferenceSearchRequest.class)
                .getRequestInfo());
    }

    @Test
    void matchesFieldNamesWithoutRegardToCase() throws Exception {
        PreferenceRequest request = applicationMapper.readValue("""
                {
                  "REQUESTINFO": { "APIID": "x", "msgid": "m" },
                  "Preference": {
                    "UserId": "u",
                    "TENANTID": "pg",
                    "preferencecode": "C"
                  }
                }
                """, PreferenceRequest.class);

        assertEquals("x", request.getRequestInfo().getApiId());
        assertEquals("m", request.getRequestInfo().getMsgId());
        assertEquals("u", request.getPreference().getUserId());
        assertEquals("pg", request.getPreference().getTenantId());
        assertEquals("C", request.getPreference().getPreferenceCode());
    }

    @Test
    void ignoresKeysItDoesNotRecognise() throws Exception {
        PreferenceSearchRequest request = applicationMapper.readValue("""
                {
                  "RequestInfo": { "plainAccessRequest": { "recordId": "r" }, "brandNew": 1 },
                  "criteria": { "userId": "u", "unexpected": true }
                }
                """, PreferenceSearchRequest.class);

        assertEquals("u", request.getCriteria().getUserId());
    }

    @Test
    void acceptsANumericUserInfoId() throws Exception {
        RequestInfo requestInfo = strictMapper.readValue(
                "{\"userInfo\":{\"id\":4242}}", RequestInfo.class);

        assertEquals("4242", requestInfo.getUserInfo().getId());
    }

    @Test
    void acceptsAQuotedUserInfoId() throws Exception {
        RequestInfo requestInfo = strictMapper.readValue(
                "{\"userInfo\":{\"id\":\"4242\"}}", RequestInfo.class);

        assertEquals("4242", requestInfo.getUserInfo().getId());
    }

    @Test
    void roundsANonIntegralUserInfoIdTheWayGoFormattedIt() throws Exception {
        // Go ran the value through fmt.Sprintf("%.0f", n), which rounds
        // half-to-even. Pathological input, but it should not throw.
        assertEquals("124", strictMapper.readValue("{\"userInfo\":{\"id\":123.7}}", RequestInfo.class)
                .getUserInfo().getId());
        assertEquals("124", strictMapper.readValue("{\"userInfo\":{\"id\":124.5}}", RequestInfo.class)
                .getUserInfo().getId());
    }

    @Test
    void readsANullUserInfoIdAsAbsent() throws Exception {
        assertNull(strictMapper.readValue("{\"userInfo\":{\"id\":null}}", RequestInfo.class)
                .getUserInfo().getId());
    }

    @Test
    void readsTheRolesBlockWithoutComplaint() throws Exception {
        RequestInfo requestInfo = strictMapper.readValue("""
                {
                  "userInfo": {
                    "uuid": "u",
                    "roles": [ { "id": 1, "name": "Citizen", "code": "CITIZEN", "tenantId": "pg" } ]
                  }
                }
                """, RequestInfo.class);

        assertEquals(1, requestInfo.getUserInfo().getRoles().size());
        assertEquals("CITIZEN", requestInfo.getUserInfo().getRoles().get(0).getCode());
    }

    @Test
    void readsTheCriteriaPagingAsAbsentRatherThanZeroWhenOmitted() throws Exception {
        PreferenceCriteria criteria = strictMapper.readValue(
                "{\"userId\":\"u\"}", PreferenceCriteria.class);

        assertNull(criteria.getLimit());
        assertNull(criteria.getOffset());
    }

    @Test
    void rejectsAnEnvelopeThatIsNotAnObject() {
        assertThrows(Exception.class, () -> strictMapper.readValue("[]", PreferenceRequest.class));
    }
}
