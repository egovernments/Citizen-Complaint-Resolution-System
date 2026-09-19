package org.egov.userpreference.web.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Response envelope for both {@code _upsert} and {@code _search}.
 *
 * <p>{@code responseInfo} is lower-camel and {@code preferences} is always
 * present (an empty array when a search matches nothing) — novu-bridge reads
 * {@code body.get("preferences")} directly. {@code pagination} is only sent by
 * {@code _search}.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class PreferenceResponse {

    @JsonProperty("responseInfo")
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private ResponseInfo responseInfo;

    @JsonProperty("preferences")
    private List<Preference> preferences;

    @JsonProperty("pagination")
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private Pagination pagination;
}
