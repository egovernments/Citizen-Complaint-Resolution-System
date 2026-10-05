package org.egov.userpreference.web.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Search criteria. At least one of {@code userId}, {@code tenantId} or
 * {@code preferenceCode} must be supplied.
 *
 * <p>{@code limit} and {@code offset} are boxed so that "absent" is
 * distinguishable from an explicit 0 — the enricher then applies the default
 * page size, matching the Go service where the {@code int} zero value drove
 * the same defaulting.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class PreferenceCriteria {

    @JsonProperty("userId")
    private String userId;

    @JsonProperty("tenantId")
    private String tenantId;

    @JsonProperty("preferenceCode")
    private String preferenceCode;

    @JsonProperty("limit")
    private Integer limit;

    @JsonProperty("offset")
    private Integer offset;
}
