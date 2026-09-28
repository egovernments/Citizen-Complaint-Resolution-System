package org.egov.userpreference.web.model;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Pins the serialized shape of every response, byte for byte, against what the
 * Go service emitted.
 *
 * <p>These are exact-string assertions rather than field-by-field ones on
 * purpose. The Go structs carried {@code omitempty} on most fields, so which
 * keys are *absent* is as much a part of the contract as the values — a
 * {@code "tenantId": null} or an {@code "offset": 0} that the old service
 * never sent is a change a caller could trip over. Key order matches too:
 * Jackson emits fields in declaration order, and the models declare them in
 * the Go structs' order.
 */
class WireContractTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    private Preference fullPreference() throws Exception {
        return Preference.builder()
                .id("11111111-2222-3333-4444-555555555555")
                .userId("user-uuid")
                .tenantId("pg.citya")
                .preferenceCode("USER_NOTIFICATION_PREFERENCES")
                .payload(objectMapper.readTree("{\"preferredLanguage\":\"en_IN\"}"))
                .auditDetails(AuditDetails.builder()
                        .createdBy("author")
                        .createdTime(1000L)
                        .lastModifiedBy("editor")
                        .lastModifiedTime(2000L)
                        .build())
                .build();
    }

    @Test
    void serializesASearchResponse() throws Exception {
        PreferenceResponse response = PreferenceResponse.builder()
                .responseInfo(ResponseInfo.builder()
                        .apiId("user-preferences")
                        .ver("1.0")
                        .ts(1707100000000L)
                        .msgId("msg-1")
                        .status("successful")
                        .build())
                .preferences(List.of(fullPreference()))
                .pagination(Pagination.builder().limit(10).offset(0).totalCount(1L).build())
                .build();

        assertEquals("{"
                + "\"responseInfo\":{\"apiId\":\"user-preferences\",\"ver\":\"1.0\",\"ts\":1707100000000,"
                + "\"msgId\":\"msg-1\",\"status\":\"successful\"},"
                + "\"preferences\":[{\"id\":\"11111111-2222-3333-4444-555555555555\",\"userId\":\"user-uuid\","
                + "\"tenantId\":\"pg.citya\",\"preferenceCode\":\"USER_NOTIFICATION_PREFERENCES\","
                + "\"payload\":{\"preferredLanguage\":\"en_IN\"},"
                + "\"auditDetails\":{\"createdBy\":\"author\",\"createdTime\":1000,"
                + "\"lastModifiedBy\":\"editor\",\"lastModifiedTime\":2000}}],"
                + "\"pagination\":{\"limit\":10,\"totalCount\":1}"
                + "}", objectMapper.writeValueAsString(response));
    }

    @Test
    void serializesAnUpsertResponseWithoutAPaginationBlock() throws Exception {
        PreferenceResponse response = PreferenceResponse.builder()
                .responseInfo(ResponseInfo.builder().ts(1L).status("successful").build())
                .preferences(List.of(fullPreference()))
                .build();

        String json = objectMapper.writeValueAsString(response);

        assertEquals(false, json.contains("pagination"), json);
        assertEquals(true, json.startsWith("{\"responseInfo\":{\"ts\":1,\"status\":\"successful\"},"), json);
    }

    @Test
    void omitsTheIdAndTenantOfAGlobalPreferenceButKeepsTheRest() throws Exception {
        // userId, preferenceCode and payload are unconditional; id, tenantId
        // and auditDetails drop out when empty.
        Preference preference = Preference.builder()
                .userId("user-uuid")
                .preferenceCode("USER_PROFILE")
                .payload(objectMapper.readTree("{}"))
                .build();

        assertEquals("{\"userId\":\"user-uuid\",\"preferenceCode\":\"USER_PROFILE\",\"payload\":{}}",
                objectMapper.writeValueAsString(preference));
    }

    @Test
    void emitsAnEmptyStringTenantAsNoTenantAtAll() throws Exception {
        Preference preference = Preference.builder()
                .userId("u")
                .tenantId("")
                .preferenceCode("C")
                .payload(objectMapper.readTree("{}"))
                .build();

        assertEquals("{\"userId\":\"u\",\"preferenceCode\":\"C\",\"payload\":{}}",
                objectMapper.writeValueAsString(preference));
    }

    @Test
    void emitsANullPayloadRatherThanDroppingIt() throws Exception {
        Preference preference = Preference.builder()
                .userId("u")
                .preferenceCode("C")
                .build();

        assertEquals("{\"userId\":\"u\",\"preferenceCode\":\"C\",\"payload\":null}",
                objectMapper.writeValueAsString(preference));
    }

    @Test
    void emitsAnEmptyPreferencesArrayOnAMiss() throws Exception {
        PreferenceResponse response = PreferenceResponse.builder()
                .responseInfo(ResponseInfo.builder().ts(1L).status("successful").build())
                .preferences(List.of())
                .pagination(Pagination.builder().limit(10).offset(0).totalCount(0L).build())
                .build();

        assertEquals("{\"responseInfo\":{\"ts\":1,\"status\":\"successful\"},"
                + "\"preferences\":[],\"pagination\":{\"limit\":10}}",
                objectMapper.writeValueAsString(response));
    }

    @Test
    void keepsAnExplicitOffsetButDropsAZeroOne() throws Exception {
        assertEquals("{\"limit\":10,\"offset\":20,\"totalCount\":31}",
                objectMapper.writeValueAsString(
                        Pagination.builder().limit(10).offset(20).totalCount(31L).build()));

        assertEquals("{\"limit\":10,\"totalCount\":31}",
                objectMapper.writeValueAsString(
                        Pagination.builder().limit(10).offset(0).totalCount(31L).build()));
    }

    @Test
    void serializesAnErrorEnvelopeWithACapitalisedErrorsList() throws Exception {
        ErrorResponse response = ErrorResponse.builder()
                .responseInfo(ResponseInfo.builder().ts(1L).msgId("m1").status("failed").build())
                .errors(List.of(
                        ErrorResponse.Error.builder().code("INVALID_USER_ID").message("userId is required").build(),
                        ErrorResponse.Error.builder().code("INVALID_PAYLOAD").message("payload is required").build()))
                .build();

        assertEquals("{"
                + "\"responseInfo\":{\"ts\":1,\"msgId\":\"m1\",\"status\":\"failed\"},"
                + "\"Errors\":[{\"code\":\"INVALID_USER_ID\",\"message\":\"userId is required\"},"
                + "{\"code\":\"INVALID_PAYLOAD\",\"message\":\"payload is required\"}]"
                + "}", objectMapper.writeValueAsString(response));
    }

    @Test
    void omitsTheResponseInfoOnAnErrorRaisedBeforeOneCouldBeParsed() throws Exception {
        ErrorResponse response = ErrorResponse.builder()
                .errors(List.of(ErrorResponse.Error.builder()
                        .code("INVALID_JSON")
                        .message("Invalid JSON format: unexpected EOF")
                        .build()))
                .build();

        assertEquals("{\"Errors\":[{\"code\":\"INVALID_JSON\","
                + "\"message\":\"Invalid JSON format: unexpected EOF\"}]}",
                objectMapper.writeValueAsString(response));
    }

    @Test
    void carriesAnOptionalErrorDescriptionOnlyWhenSet() throws Exception {
        assertEquals("{\"code\":\"C\",\"message\":\"m\",\"description\":\"d\"}",
                objectMapper.writeValueAsString(
                        ErrorResponse.Error.builder().code("C").message("m").description("d").build()));

        assertEquals("{\"code\":\"C\",\"message\":\"m\"}",
                objectMapper.writeValueAsString(
                        ErrorResponse.Error.builder().code("C").message("m").build()));
    }
}
