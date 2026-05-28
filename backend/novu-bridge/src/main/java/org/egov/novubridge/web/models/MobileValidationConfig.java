package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MobileValidationConfig {
    private String prefix;
    private String pattern;
    private Integer minLength;
    private Integer maxLength;
}
