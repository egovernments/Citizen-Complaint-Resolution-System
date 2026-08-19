package org.egov.pgr.accesscontrol;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Mirrors egov-accesscontrol's {@code AxisScope} exactly — one attribute axis (department or jurisdiction) of a {@link ScopeAxes}. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public class AxisScope {
    private AxisMode mode;

    /** The permitted values when {@link #mode} is {@link AxisMode#VALUES}; empty when it is ALL. */
    @Builder.Default
    private List<String> values = List.of();
}
