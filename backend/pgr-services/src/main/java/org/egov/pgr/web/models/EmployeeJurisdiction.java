package org.egov.pgr.web.models;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One HRMS jurisdiction row for an employee: a boundary code and the hierarchy it was defined
 * under. The hierarchy travels with the code because expanding it to its descendant subtree
 * (BoundaryUtil) must query boundary-service on that same hierarchy — a row's hierarchy need not
 * be the one PGR complaints are filed against on every tenant.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class EmployeeJurisdiction {

    private String hierarchy;

    private String boundary;
}
