package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.*;

import java.util.ArrayList;
import java.util.List;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class Workflow {

    @JsonProperty("action")
    private String action;

    @JsonProperty("assignes")
    private List<String> assignes;

    @JsonProperty("comments")
    private String comments;

    @JsonProperty("verificationDocuments")
    private List<Document> verificationDocuments;

    public Workflow addAssignesItem(String assignesItem) {
        if (this.assignes == null) {
            this.assignes = new ArrayList<>();
        }
        this.assignes.add(assignesItem);
        return this;
    }

    public Workflow addVerificationDocumentsItem(Document document) {
        if (this.verificationDocuments == null) {
            this.verificationDocuments = new ArrayList<>();
        }
        this.verificationDocuments.add(document);
        return this;
    }
}
