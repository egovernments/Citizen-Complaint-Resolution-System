package org.egov.userpreference.web.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Paging block on the {@code _search} response.
 *
 * <p>The numeric fields are primitives and the class is {@code NON_DEFAULT} so
 * that a zero is omitted, exactly as the Go struct's {@code omitempty} tags
 * did. That matters here and not on the other models: {@code offset} defaults
 * to 0 on nearly every real search, so a {@code Long} field would start
 * emitting an {@code "offset": 0} key the Go service never sent.
 *
 * <p>Note the wire name is {@code offset} — not the {@code offSet} that
 * digit-config-service uses. The preference service's contract is fixed by its
 * existing callers, so the original spelling is kept.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_DEFAULT)
public class Pagination {

    @JsonProperty("limit")
    private int limit;

    @JsonProperty("offset")
    private int offset;

    @JsonProperty("totalCount")
    private long totalCount;
}
