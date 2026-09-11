package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Stakeholder {
    private String type;
    private String userId;
    private String mobile;

    // ---- Config-driven enrichment (optional; carried when a per-recipient
    //      pre-rendered event arrives in the legacy stakeholders[] envelope) ----
    private String email;
    private String firstName;
    private String lastName;
    private String locale;
    private String channel;
    private String renderedBody;
    private String renderedSubject;
    private String role;
}
