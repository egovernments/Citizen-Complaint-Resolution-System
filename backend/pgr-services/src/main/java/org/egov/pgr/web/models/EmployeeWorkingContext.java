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

    /**
     * Whether this employee's current HRMS assignment names a reportingTo officer.
     *
     * <p>Escalation moves a complaint to the assignee's reportingTo, so an employee at the
     * top of their chain cannot escalate: the service answers ESCALATION_TOP_OF_HIERARCHY.
     * The employee UI has no other way to know that before the click, so it offered a
     * button that could only fail (#2129). It is a boolean, not the officer's identity:
     * the target stays server-resolved and no HRMS PII is added to this projection.</p>
     */
    private boolean hasReportingTo;

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
