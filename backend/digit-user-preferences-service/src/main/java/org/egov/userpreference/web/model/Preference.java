package org.egov.userpreference.web.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A single user preference record.
 *
 * <p>{@code payload} is an opaque JSON document stored verbatim in the
 * {@code jsonb} column. It is parsed for validation when
 * {@code preferenceCode} is {@code USER_NOTIFICATION_PREFERENCES} (see
 * {@code PreferenceValidator}) but never rewritten, so a caller's key casing
 * and any extra keys survive a round trip untouched.
 *
 * <p>{@code id}, {@code tenantId} and {@code auditDetails} are omitted when
 * empty; {@code userId}, {@code preferenceCode} and {@code payload} are always
 * emitted. That split reproduces the Go struct's tags field for field.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public class Preference {

    @JsonProperty("id")
    private String id;

    @JsonProperty("userId")
    @JsonInclude(JsonInclude.Include.ALWAYS)
    private String userId;

    @JsonProperty("tenantId")
    private String tenantId;

    @JsonProperty("preferenceCode")
    @JsonInclude(JsonInclude.Include.ALWAYS)
    private String preferenceCode;

    @JsonProperty("payload")
    @JsonInclude(JsonInclude.Include.ALWAYS)
    private JsonNode payload;

    @JsonProperty("auditDetails")
    private AuditDetails auditDetails;
}
