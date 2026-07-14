package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Per-recipient contact profile carried verbatim from PGR's pre-rendered
 * domain event. PGR already resolved who the recipient is and how to reach
 * them; novu-bridge only upserts this into Novu (identify) and delivers.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Contact {
    private String userId;   // user uuid (may be null for uuid-less citizens)
    private String type;     // CITIZEN | EMPLOYEE
    private String name;
    private String phone;    // E.164 with country code
    private String email;
    private String locale;   // e.g. en_IN — PGR already localized renderedBody
}
