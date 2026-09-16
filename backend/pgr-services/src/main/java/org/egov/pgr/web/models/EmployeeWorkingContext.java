package org.egov.pgr.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Collections;
import java.util.List;

/**
 * Display-safe projection of the authenticated employee's current HRMS context.
 *
 * <p>This deliberately omits the rest of the HRMS employee record (including PII and
 * historical employment details). Codes remain machine values so the frontend can use
 * the existing DIGIT localization bundles.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EmployeeWorkingContext {

    private boolean available;

    private String tenantId;

    @Builder.Default
    private List<Department> departments = Collections.emptyList();

    @Builder.Default
    private List<Role> roles = Collections.emptyList();

    @Builder.Default
    private List<String> roleContexts = Collections.emptyList();

    @Builder.Default
    private List<Jurisdiction> jurisdictions = Collections.emptyList();

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Department {
        private String code;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Role {
        private String code;
        private String name;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Jurisdiction {
        private String hierarchy;
        private String boundaryType;
        private String boundary;
    }
}
