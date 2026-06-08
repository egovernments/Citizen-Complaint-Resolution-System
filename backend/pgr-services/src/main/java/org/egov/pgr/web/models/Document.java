package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.*;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class Document {

    @JsonProperty("id")
    private String id;

    @JsonProperty("documentType")
    private String documentType;

    @JsonProperty("fileStoreId")
    private String fileStoreId;

    @JsonProperty("documentUid")
    private String documentUid;

    @JsonProperty("additionalDetails")
    private Object additionalDetails;
}
