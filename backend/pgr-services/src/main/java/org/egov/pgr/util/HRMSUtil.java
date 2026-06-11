package org.egov.pgr.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.web.models.RequestInfoWrapper;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.egov.pgr.util.PGRConstants.HRMS_DEPARTMENT_JSONPATH;
import static org.egov.pgr.util.PGRConstants.HRMS_REPORTING_TO_JSONPATH;

@Component
@Slf4j
public class HRMSUtil {

    /**
     * HRMS page size for role searches. A raw page that hits this size may be
     * truncated — the caller must never derive an exactly-one verdict from it.
     */
    public static final int ROLE_SEARCH_LIMIT = 100;

    private ServiceRequestRepository serviceRequestRepository;

    private PGRConfiguration config;


    @Autowired
    public HRMSUtil(ServiceRequestRepository serviceRequestRepository, PGRConfiguration config) {
        this.serviceRequestRepository = serviceRequestRepository;
        this.config = config;
    }

    /**
     * Gets the list of department for the given list of uuids of employees
     * @param uuids
     * @param requestInfo
     * @return
     */
    public List<String> getDepartment(List<String> uuids, RequestInfo requestInfo,String tenantId){

        StringBuilder url = getHRMSURI(uuids,tenantId);

        RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();

        Object res = serviceRequestRepository.fetchResult(url, requestInfoWrapper);

        List<String> departments = null;

        try {
             departments = JsonPath.read(res, HRMS_DEPARTMENT_JSONPATH);
        }
        catch (Exception e){
            throw new CustomException("PARSING_ERROR","Failed to parse HRMS response");
        }

        if(CollectionUtils.isEmpty(departments))
            throw new CustomException("DEPARTMENT_NOT_FOUND","The Department of the user with uuid: "+uuids.toString()+" is not found");

        return departments;

    }

    /**
     * Given an employee UUID, find their supervisor's UUID from HRMS.
     * Reads assignments[*].reportingTo from the current assignment.
     * Returns null if no supervisor found.
     */
    public String getSupervisorUuid(String employeeUuid, RequestInfo requestInfo, String tenantId) {

        StringBuilder url = getHRMSURI(Collections.singletonList(employeeUuid), tenantId);

        RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();

        Object res = serviceRequestRepository.fetchResult(url, requestInfoWrapper);

        if (res == null) {
            log.warn("HRMS returned null for employee UUID: {}", employeeUuid);
            return null;
        }

        try {
            List<String> reportingTo = JsonPath.read(res, HRMS_REPORTING_TO_JSONPATH);
            if (CollectionUtils.isEmpty(reportingTo)) {
                log.info("No reportingTo found for employee UUID: {}", employeeUuid);
                return null;
            }
            return reportingTo.get(0);
        } catch (Exception e) {
            log.warn("Failed to parse HRMS reportingTo for employee UUID: {}", employeeUuid, e);
            return null;
        }
    }

    /**
     * Fetches the HRMS employee by uuid and returns a summary map with keys
     * {@code name} (Employee user.name) and {@code designation} (current
     * assignment's designation code) for audit-trail comments. Null-safe:
     * returns an empty map on any failure.
     */
    public Map<String, String> getEmployeeSummary(String uuid, RequestInfo requestInfo, String tenantId) {

        StringBuilder url = getHRMSURI(Collections.singletonList(uuid), tenantId);

        RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();

        Map<String, String> summary = new HashMap<>();

        Object res;
        try {
            res = serviceRequestRepository.fetchResult(url, requestInfoWrapper);
        } catch (Exception e) {
            log.warn("Failed to fetch HRMS employee summary for UUID: {}", uuid, e);
            return summary;
        }
        if (res == null) {
            log.warn("HRMS returned null for employee UUID: {}", uuid);
            return summary;
        }

        // The two reads are isolated on purpose: a failed designation JsonPath
        // must not discard an already-resolved name (partial summary still
        // yields a human-readable escalation comment).
        try {
            String name = JsonPath.read(res, "$.Employees[0].user.name");
            if (name != null) {
                summary.put("name", name);
            }
        } catch (Exception e) {
            log.warn("Failed to read HRMS employee name for UUID: {}", uuid, e);
        }

        try {
            List<String> designations = JsonPath.read(res, "$.Employees[0].assignments[?(@.isCurrentAssignment==true)].designation");
            if (!CollectionUtils.isEmpty(designations) && designations.get(0) != null) {
                summary.put("designation", designations.get(0));
            }
        } catch (Exception e) {
            log.warn("Failed to read HRMS designation for UUID: {} (keeping name if resolved)", uuid, e);
        }

        return summary;
    }

    /**
     * Outcome of {@link #searchEmployeesByRole}: the (filtered) employee
     * summaries plus two trust signals the caller must honour —
     * {@code truncated} when the RAW page hit {@link #ROLE_SEARCH_LIMIT}
     * (more holders may exist beyond the page, so any exactly-one verdict
     * over it would be a guess), and {@code failed} when the lookup itself
     * failed (transport/parse), which must not be conflated with "no
     * holders".
     */
    @Getter
    public static final class RoleSearchResult {
        private final List<Map<String, String>> employees;
        /** Raw HRMS page hit {@link #ROLE_SEARCH_LIMIT} — the list may be incomplete. */
        private final boolean truncated;
        /** The HRMS call/parse failed — the empty list means "unknown", not "nobody". */
        private final boolean failed;

        private RoleSearchResult(List<Map<String, String>> employees, boolean truncated, boolean failed) {
            this.employees = employees;
            this.truncated = truncated;
            this.failed = failed;
        }

        public static RoleSearchResult of(List<Map<String, String>> employees, boolean truncated) {
            return new RoleSearchResult(employees, truncated, false);
        }

        public static RoleSearchResult failure() {
            return new RoleSearchResult(Collections.emptyList(), false, true);
        }
    }

    /**
     * Searches HRMS for active employees holding the given role, optionally
     * restricted to a department. HRMS NPEs without an explicit offset, so
     * offset/limit are always sent. Candidacy requires a CURRENT assignment
     * ({@code isCurrentAssignment == true}); when {@code department} is
     * non-null, that current assignment's department must match it.
     *
     * <p>Returns one summary map per matching employee with keys {@code uuid},
     * {@code name}, {@code designation}, {@code reportingTo} and
     * {@code department} (all from the current assignment where applicable;
     * keys are omitted when the source field is null). Truncation is detected
     * on the RAW page BEFORE filtering — a full page filtered down to one
     * in-department holder must never read as an exactly-one verdict. Failures
     * (transport/parse/null response) come back as
     * {@link RoleSearchResult#failure()}, never as an empty list.</p>
     */
    @SuppressWarnings("unchecked")
    public RoleSearchResult searchEmployeesByRole(String role, String department,
                                                  String tenantId, RequestInfo requestInfo) {

        StringBuilder url = new StringBuilder(config.getHrmsHost());
        url.append(config.getHrmsEndPoint());
        url.append("?tenantId=").append(tenantId);
        url.append("&roles=").append(role);
        url.append("&isActive=true&offset=0&limit=").append(ROLE_SEARCH_LIMIT);

        RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();

        try {
            Object res = serviceRequestRepository.fetchResult(url, requestInfoWrapper);
            if (res == null) {
                log.warn("HRMS returned null for role search: role={}, tenantId={}", role, tenantId);
                return RoleSearchResult.failure();
            }
            List<Map<String, Object>> employees = JsonPath.read(res, "$.Employees");
            if (CollectionUtils.isEmpty(employees)) {
                return RoleSearchResult.of(Collections.emptyList(), false);
            }
            // Truncation check on the RAW page, before any filtering: a
            // 150-holder role yields a 100-row page that could filter down to
            // exactly one — a silent misroute, not a verdict.
            boolean truncated = employees.size() >= ROLE_SEARCH_LIMIT;
            List<Map<String, String>> out = new ArrayList<>();
            for (Map<String, Object> employee : employees) {
                if (employee == null) continue;
                Map<String, Object> assignment = currentAssignment(employee);
                if (assignment == null) continue;
                String empDepartment = asString(assignment.get("department"));
                if (department != null && !department.equals(empDepartment)) continue;

                Map<String, String> summary = new HashMap<>();
                String uuid = asString(employee.get("uuid"));
                if (uuid == null && employee.get("user") instanceof Map) {
                    uuid = asString(((Map<String, Object>) employee.get("user")).get("uuid"));
                }
                if (uuid == null) continue;
                summary.put("uuid", uuid);
                if (employee.get("user") instanceof Map) {
                    String name = asString(((Map<String, Object>) employee.get("user")).get("name"));
                    if (name != null) summary.put("name", name);
                }
                String designation = asString(assignment.get("designation"));
                if (designation != null) summary.put("designation", designation);
                String reportingTo = asString(assignment.get("reportingTo"));
                if (reportingTo != null) summary.put("reportingTo", reportingTo);
                if (empDepartment != null) summary.put("department", empDepartment);
                out.add(summary);
            }
            return RoleSearchResult.of(out, truncated);
        } catch (Exception e) {
            log.warn("HRMS role search failed: role={}, tenantId={}", role, tenantId, e);
            return RoleSearchResult.failure();
        }
    }

    /**
     * Tri-state active-employee check used to validate CRS.RoleSupervisors
     * pins at escalation time: {@code TRUE} — HRMS knows exactly one ACTIVE
     * employee with the given uuid; {@code FALSE} — HRMS answered and the
     * employee is NOT active (a genuinely stale pin, which must fall through
     * to the role ladder); {@code null} — the lookup itself FAILED
     * (transport/parse/null response), so the caller must NOT treat the pin
     * as stale. A transient HRMS blip routed through FALSE would silently
     * bypass an operator pin and misroute via R2/R3.
     */
    public Boolean isActiveEmployee(String uuid, String tenantId, RequestInfo requestInfo) {

        StringBuilder url = new StringBuilder(config.getHrmsHost());
        url.append(config.getHrmsEndPoint());
        url.append("?tenantId=").append(tenantId);
        url.append("&uuids=").append(uuid);
        url.append("&isActive=true&offset=0&limit=100");

        RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();

        try {
            Object res = serviceRequestRepository.fetchResult(url, requestInfoWrapper);
            if (res == null) {
                log.warn("HRMS returned null for active-employee check: uuid={}, tenantId={}", uuid, tenantId);
                return null;
            }
            List<Object> employees = JsonPath.read(res, "$.Employees");
            return employees != null && employees.size() == 1;
        } catch (Exception e) {
            log.warn("HRMS active-employee check failed: uuid={}, tenantId={}", uuid, tenantId, e);
            return null;
        }
    }

    /** First assignment with {@code isCurrentAssignment == true}, or null. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> currentAssignment(Map<String, Object> employee) {
        Object assignments = employee.get("assignments");
        if (!(assignments instanceof List)) return null;
        for (Object a : (List<Object>) assignments) {
            if (a instanceof Map && Boolean.TRUE.equals(((Map<String, Object>) a).get("isCurrentAssignment"))) {
                return (Map<String, Object>) a;
            }
        }
        return null;
    }

    private static String asString(Object value) {
        return value instanceof String ? (String) value : null;
    }

    /**
     * Builds HRMS search URL
     * @param uuids
     * @return
     */

    public StringBuilder getHRMSURI(List<String> uuids,String tenantId){

        StringBuilder builder = new StringBuilder(config.getHrmsHost());
        builder.append(config.getHrmsEndPoint());
        builder.append("?tenantId=");
        builder.append(tenantId);
        builder.append("&uuids=");
        builder.append(StringUtils.join(uuids, ","));

        return builder;
    }


}
