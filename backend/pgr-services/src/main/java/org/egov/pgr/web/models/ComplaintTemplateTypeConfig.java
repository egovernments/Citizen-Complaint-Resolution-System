package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class ComplaintTemplateTypeConfig {

    // From ComplaintTemplateType MDMS master
    private String       caseRelatedTo;
    private Boolean      active;
    private String       schemaRef;
    private List<String> allowedDocumentTypes;
    private List<String> allowedViewerRoles;

    // From ComplaintSchema MDMS master (merged by MDMSUtils via schemaRef)
    // Used internally for encryption and field validation — not part of the public MDMS model.
    @JsonProperty("x-security")
    private List<String> xSecurity;
    private List<FieldDefinition> fields;

    // Field keys that stay visible even when isConfidential=true masks everything else for an
    // unauthorized viewer (e.g. instituteName shown for public accountability). MDMS-driven
    // ("x-no-mask" in the schema), per caseRelatedTo — not a global/hardcoded list.
    @JsonProperty("x-no-mask")
    private List<String> noMaskFields;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class FieldDefinition {
        private String  fieldKey;
        private String  label;
        private String  dataType;
        private Boolean mandatory;
        private Integer maxLength;
        private Integer order;
        private String  regex;
    }
}
