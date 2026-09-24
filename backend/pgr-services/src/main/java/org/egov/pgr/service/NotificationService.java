package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.service.notification.ResolvedAssignee;
import org.egov.pgr.service.notification.ThinEventBuilder;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.NotificationUtil;
import org.egov.pgr.web.models.RequestInfoWrapper;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.workflow.ProcessInstance;
import org.egov.pgr.web.models.workflow.ProcessInstanceResponse;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.egov.pgr.util.PGRConstants.ASSIGN;
import static org.egov.pgr.util.PGRConstants.DEPARTMENT;
import static org.egov.pgr.util.PGRConstants.DESIGNATION;
import static org.egov.pgr.util.PGRConstants.HRMS_DEPARTMENT_JSONPATH;
import static org.egov.pgr.util.PGRConstants.HRMS_DESIGNATION_JSONPATH;
import static org.egov.pgr.util.PGRConstants.MDMS_DEPARTMENT_SEARCH;

/**
 * The PGR notification PRODUCER. One workflow transition in, one thin domain event out.
 *
 * <p>Everything that used to live here — matching routing rows, expanding role pools, reading user
 * preferences, picking a template, localizing, rendering, resolving a WhatsApp provider template and
 * minting one pre-rendered envelope per (recipient x channel) — now lives in novu-bridge, behind the
 * published {@code thin-event-v1} contract. It was DELETED in that move, not disabled: which path a
 * deployment is on is a property of the image it runs, so no dropped config overlay can flip it
 * (issue #1969), and rolling back means redeploying the previous pgr-services image, which the
 * bridge still accepts because the pre-rendered envelope stays a public interface forever.
 *
 * <p>What stays here is what only PGR knows:
 *
 * <ul>
 *   <li><b>is this transition notifiable at all</b> — an action and a target state must exist. Note
 *       what is NOT checked any more: whether any routing row matches. A transition nobody is routed
 *       for now reaches the bridge and becomes a visible {@code SKIPPED / NB_NO_ROUTING} ledger row
 *       instead of a silent drop here;</li>
 *   <li><b>who the complaint is with</b> — the live workflow assignee, else the last {@code ASSIGN}
 *       in workflow history ({@link #getEmployeeName}), hydrated from egov-user as the internal
 *       microservice user ({@link #fetchUserByUUID});</li>
 *   <li><b>the placeholder VALUES that need PGR context</b> — the complaint's own fields, the HRMS
 *       assignment crossed with the MDMS {@code ComplaintHierarchy} department
 *       ({@link #getHRMSEmployee}), and the shortened download link.</li>
 * </ul>
 *
 * <p>Localization is gone from this class entirely: {@link ThinEventBuilder} ships localization
 * CODES and the bridge resolves them once per recipient locale, which is the thing PGR could never
 * do — it builds placeholder values once per event.
 *
 * <p>An exception in here must never break the complaint transaction that triggered it, so the whole
 * body is wrapped and logged. That was true before the cutover and is true after it.
 */
@Service
@Slf4j
public class NotificationService {

    @Autowired
    private PGRConfiguration config;

    @Autowired
    private NotificationUtil notificationUtil;

    @Autowired
    private WorkflowService workflowService;

    @Autowired
    private ServiceRequestRepository serviceRequestRepository;

    @Autowired
    private MDMSUtils mdmsUtils;

    @Autowired
    private HRMSUtil hrmsUtils;

    @Autowired
    private ObjectMapper mapper;

    @Autowired
    private ThinEventBuilder thinEventBuilder;

    @Autowired
    private Producer producer;

    /**
     * Entry point from the Kafka notification consumer: publish ONE thin domain event for this
     * workflow transition onto {@code complaints.domain.events}, the same topic the pre-rendered
     * envelopes used. novu-bridge consumes that topic and dispatches on the event's {@code kind},
     * so nothing downstream had to be repointed. The record carries NO Kafka key:
     * {@link Producer#push} uses the tenant only to pick the state-specific topic name, so there
     * is no per-tenant or per-complaint ordering, exactly as with the envelopes.
     */
    public void process(ServiceRequest request, String topic) {
        try {
            org.egov.pgr.web.models.Service service = request.getService();
            String action = request.getWorkflow() != null ? request.getWorkflow().getAction() : null;
            String toState = service.getApplicationStatus();
            // The only early exit left, and it is about the REQUEST, not about configuration: with
            // no action or no target state there is no transition to describe. Deciding that nobody
            // needs telling is the bridge's job now, and it records that decision as a ledger row.
            if (!StringUtils.hasText(action) || !StringUtils.hasText(toState)) {
                log.info("Notification skipped: missing action/toState for complaint {}",
                        service.getServiceRequestId());
                return;
            }

            ResolvedAssignee assignee = resolveAssignee(request);
            String downloadLink = shortenedDownloadLink(service.getServiceRequestId());
            // The HRMS + MDMS join only means anything for a named assignee, and skipping it when
            // there is none also spares an HRMS round trip on every APPLY. It is keyed on the
            // RESOLVED assignee: on RESOLVE/REJECT/REOPEN/RATE the request carries no assignes.
            String assigneeUuid = assignee == null ? null : assignee.getUserId();
            Map<String, String> employment = StringUtils.hasText(assigneeUuid)
                    ? hrmsCodes(request, assigneeUuid) : Collections.emptyMap();

            Map<String, Object> event = thinEventBuilder.build(request, assignee, downloadLink,
                    employment.get(DEPARTMENT), employment.get(DESIGNATION));

            producer.push(service.getTenantId(), config.getComplaintsDomainEventsTopic(), event);
            log.info("Published thin notification event: complaint={} event={} seed={} actors={}",
                    service.getServiceRequestId(), event.get("eventName"),
                    maskPii(String.valueOf(event.get("transactionSeed"))),
                    ((Map<?, ?>) event.get("actors")).keySet());
        } catch (Exception ex) {
            log.error("Error publishing the thin notification event for topic {}", topic, ex);
        }
    }

    /**
     * Who the complaint is with: the live workflow assignee, else the last {@code ASSIGN} in
     * workflow history. Never throws — no assignee is a normal state (an APPLY has none), and a
     * failure to find one must not stop the event being published.
     *
     * <p>Design errata 6: when the egov-user lookup fails on the history path the workflow's own
     * user record is sent INLINE, which publishes the same person under a different identity than
     * the uuid-only form would. That is today's behaviour, deliberately preserved.
     */
    ResolvedAssignee resolveAssignee(ServiceRequest request) {
        String tenantId = request.getService().getTenantId();
        RequestInfo requestInfo = request.getRequestInfo();
        try {
            // Current assignee from the live workflow (ASSIGN/REASSIGN transitions).
            if (request.getWorkflow() != null
                    && !CollectionUtils.isEmpty(request.getWorkflow().getAssignes())
                    && StringUtils.hasText(request.getWorkflow().getAssignes().get(0))) {
                org.egov.pgr.web.models.User u =
                        fetchUserByUUID(request.getWorkflow().getAssignes().get(0), requestInfo, tenantId);
                if (u != null) return ResolvedAssignee.ofUuid(u.getUuid(), u.getName());
            }
            // Fall back to the last ASSIGN in workflow history (REOPEN/RATE, or the lookup above failed).
            ProcessInstance pi = getEmployeeName(tenantId, request.getService().getServiceRequestId(),
                    requestInfo, ASSIGN);
            if (pi != null && !CollectionUtils.isEmpty(pi.getAssignes())) {
                User wu = pi.getAssignes().get(0);
                if (StringUtils.hasText(wu.getUuid())) {
                    org.egov.pgr.web.models.User u = fetchUserByUUID(wu.getUuid(), requestInfo, tenantId);
                    if (u != null) return ResolvedAssignee.ofUuid(u.getUuid(), u.getName());
                }
                // The lookup failed: send what the workflow record holds, inline, uuid and all —
                // it is then the only contact anyone has.
                return ResolvedAssignee.inline(wu.getUuid(), wu.getName(), wu.getMobileNumber());
            }
        } catch (Exception e) {
            // Expected when there is no assignee yet (e.g. APPLY, where the history search 404s or
            // returns nothing); DEBUG so a real workflow/user regression stays visible without
            // spamming WARN on every complaint filed.
            log.debug("Could not resolve an assignee for complaint {}: {}",
                    request.getService().getServiceRequestId(), e.getMessage());
        }
        return null;
    }

    /**
     * {@code {download_link}} — the one placeholder blanked rather than omitted on failure, because
     * a shortener outage must not ship a message containing the literal text
     * <code>{download_link}</code>.
     */
    private String shortenedDownloadLink(String serviceRequestId) {
        try {
            String url = notificationUtil.getShortnerURL(config.getMobileDownloadLink());
            return url == null ? "" : url;
        } catch (Exception e) {
            log.warn("url-shortening unavailable; blanked {download_link} for {}: {}",
                    serviceRequestId, e.getMessage());
            return "";
        }
    }

    /** {@link #getHRMSEmployee} with the failure isolated: no assignment found is not an error. */
    private Map<String, String> hrmsCodes(ServiceRequest request, String assigneeUuid) {
        try {
            return getHRMSEmployee(request, assigneeUuid);
        } catch (Exception e) {
            log.debug("Could not resolve the HRMS assignment for complaint {}: {}",
                    request.getService().getServiceRequestId(), e.getMessage());
            return Collections.emptyMap();
        }
    }

    /**
     * Fetches User Object based on the UUID.
     *
     * @param uuidstring - UUID of User
     * @param requestInfo - Request Info Object
     * @param tenantId - Tenant Id
     * @return - Returns User object with given UUID
     */
    public org.egov.pgr.web.models.User fetchUserByUUID(String uuidstring, RequestInfo requestInfo, String tenantId) {
        User userInfoCopy = requestInfo.getUserInfo();

        User userInfo = getInternalMicroserviceUser(tenantId);

        requestInfo.setUserInfo(userInfo);

        StringBuilder uri = new StringBuilder();
        uri.append(config.getUserHost()).append(config.getUserSearchEndpoint());
        Map<String, Object> userSearchRequest = new HashMap<>();
        userSearchRequest.put("RequestInfo", requestInfo);
        userSearchRequest.put("tenantId", tenantId);
        userSearchRequest.put("userType", "EMPLOYEE");
        Set<String> uuid = new HashSet<>() ;
        uuid.add(uuidstring);
        userSearchRequest.put("uuid", uuid);
        org.egov.pgr.web.models.User user = null;
        try {
            LinkedHashMap<String, Object> responseMap = (LinkedHashMap<String, Object>) serviceRequestRepository.fetchResult(uri, userSearchRequest);
            List<LinkedHashMap<String, Object>> users = (List<LinkedHashMap<String, Object>>) responseMap.get("user");
            String dobFormat = "yyyy-MM-dd";
            parseResponse(responseMap,dobFormat);
            user = mapper.convertValue(users.get(0), org.egov.pgr.web.models.User.class);

        }catch(Exception e) {
            log.error("Exception while trying parse user object: ",e);
        }

        requestInfo.setUserInfo(userInfoCopy);
        return user;
    }

    /**
     * Parses date formats to long for all users in responseMap
     * @param responeMap LinkedHashMap got from user api response
     */
    private void parseResponse(LinkedHashMap responeMap,String dobFormat){
        List<LinkedHashMap> users = (List<LinkedHashMap>)responeMap.get("user");
        String formatForDate = "dd-MM-yyyy HH:mm:ss";
        if(users!=null){
            users.forEach( map -> {
                        map.put("createdDate",dateTolong((String)map.get("createdDate"),formatForDate));
                        if((String)map.get("lastModifiedDate")!=null)
                            map.put("lastModifiedDate",dateTolong((String)map.get("lastModifiedDate"),formatForDate));
                        if((String)map.get("dob")!=null)
                            map.put("dob",dateTolong((String)map.get("dob"),dobFormat));
                        if((String)map.get("pwdExpiryDate")!=null)
                            map.put("pwdExpiryDate",dateTolong((String)map.get("pwdExpiryDate"),formatForDate));
                    }
            );
        }
    }

    /**
     * Converts date to long
     * @param date date to be parsed
     * @param format Format of the date
     * @return Long value of date
     */
    private Long dateTolong(String date,String format){
        SimpleDateFormat simpleDateFormatObject = new SimpleDateFormat(format);
        Date returnDate = null;
        try {
            returnDate = simpleDateFormatObject.parse(date);
        } catch (ParseException e) {
            e.printStackTrace();
        }
        return  returnDate.getTime();
    }

    public ProcessInstance getEmployeeName(String tenantId, String serviceRequestId, RequestInfo requestInfo,String action){
        ProcessInstance processInstanceToReturn = new ProcessInstance();
        User userInfoCopy = requestInfo.getUserInfo();

        User userInfo = getInternalMicroserviceUser(tenantId);

        requestInfo.setUserInfo(userInfo);

        RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();
        StringBuilder URL = workflowService.getprocessInstanceSearchURL(tenantId,serviceRequestId);
        URL.append("&").append("history=true");

        Object result = serviceRequestRepository.fetchResult(URL, requestInfoWrapper);
        ProcessInstanceResponse processInstanceResponse = null;
        try {
            processInstanceResponse = mapper.convertValue(result, ProcessInstanceResponse.class);
        } catch (IllegalArgumentException e) {
            throw new CustomException("PARSING ERROR", "Failed to parse response of workflow processInstance search");
        }
        if (CollectionUtils.isEmpty(processInstanceResponse.getProcessInstances()))
            throw new CustomException("WORKFLOW_NOT_FOUND", "The workflow object is not found");

        for(ProcessInstance processInstance:processInstanceResponse.getProcessInstances()){
            if(processInstance.getAction().equalsIgnoreCase(action))
                processInstanceToReturn= processInstance;
        }
        requestInfo.setUserInfo(userInfoCopy);
        return processInstanceToReturn;
    }


    /**
     * The assignee's department and designation as RAW CODES, for {@code {emp_department}} and
     * {@code {emp_designation}} — the HRMS assignment list crossed with the MDMS
     * {@code ComplaintHierarchy} department of the complaint's service code. Only the producer can
     * do that join; the RESULT is a pair of localization codes the bridge resolves per locale,
     * which is why nothing here is localized any more.
     *
     * <p>Both codes are returned only when HRMS confirms the employee actually holds an assignment
     * in the complaint's department — a designation from some unrelated assignment would name the
     * wrong job.
     *
     * @param assigneeUuid the resolved assignee ({@link #resolveAssignee}), which on
     *        RESOLVE/REJECT/REOPEN/RATE comes from workflow history, not the request
     * @return {@code {department, designation}} (designation absent when the assignment has none),
     *         or an empty map when there is no matching assignment or no assignee
     */
    public Map<String, String> getHRMSEmployee(ServiceRequest request, String assigneeUuid){
        Map<String, String> assigneeDetails = new HashMap<>();
        List<String> mdmsDepartmentList;
        List<String> hrmsDepartmentList;
        String departmentFromMDMS;

        // HRMS CALL. Never with an empty uuid list: egov-hrms reads `&uuids=` as "no filter" and
        // returns the whole tenant, whose first designation would then name somebody else's job.
        if (!StringUtils.hasText(assigneeUuid))
            return Collections.emptyMap();
        StringBuilder url = hrmsUtils.getHRMSURI(Collections.singletonList(assigneeUuid),
                request.getService().getTenantId());
        RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(request.getRequestInfo()).build();
        Object response = serviceRequestRepository.fetchResult(url, requestInfoWrapper);

        //MDMS CALL
        Object mdmsData = mdmsUtils.mDMSCall(request);
        String jsonPath = MDMS_DEPARTMENT_SEARCH.replace("{SERVICEDEF}",request.getService().getServiceCode());

        try{
            mdmsDepartmentList = JsonPath.read(mdmsData,jsonPath);
            hrmsDepartmentList = JsonPath.read(response, HRMS_DEPARTMENT_JSONPATH);
        }
        catch (Exception e){
            throw new CustomException("JSONPATH_ERROR","Failed to parse mdms response for department");
        }

        if(CollectionUtils.isEmpty(mdmsDepartmentList))
            throw new CustomException("PARSING_ERROR","Failed to fetch department from mdms data for serviceCode: "+request.getService().getServiceCode());
        else departmentFromMDMS = mdmsDepartmentList.get(0);

        if(!hrmsDepartmentList.contains(departmentFromMDMS))
            return Collections.emptyMap();

        assigneeDetails.put(DEPARTMENT, departmentFromMDMS);

        String designationJsonPath = HRMS_DESIGNATION_JSONPATH.replace("{department}",departmentFromMDMS);
        List<String> designation;
        try{
            designation = JsonPath.read(response, designationJsonPath);
        }
        catch (Exception e){
            throw new CustomException("JSONPATH_ERROR","Failed to parse hrms response for designation");
        }
        if(!CollectionUtils.isEmpty(designation))
            assigneeDetails.put(DESIGNATION, designation.get(0));

        return assigneeDetails;
    }


    private User getInternalMicroserviceUser(String tenantId)
    {
        //Creating role with INTERNAL_MICROSERVICE_ROLE
        Role role = Role.builder()
                .name("Internal Microservice Role").code("INTERNAL_MICROSERVICE_ROLE")
                .tenantId(tenantId).build();

        //Creating userinfo with uuid and role of internal micro service role
        User userInfo = User.builder()
                .uuid(config.getEgovInternalMicroserviceUserUuid())
                .type("SYSTEM")
                .roles(Collections.singletonList(role)).id(0L).build();

        return userInfo;
    }

    /**
     * Mask PII embedded in a log value. The transaction seed can carry a raw mobile when the
     * recipient had no uuid. Replaces any run of 7+ digits with {@code ***} + its last 3 digits —
     * the same rule as novu-bridge's PiiMask (kept local to avoid a cross-module dependency for one
     * method). UUIDs (digit runs &lt; 7) pass through untouched.
     */
    private static String maskPii(String value) {
        if (value == null) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\d{7,}").matcher(value);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String run = m.group();
            m.appendReplacement(sb, java.util.regex.Matcher.quoteReplacement("***" + run.substring(run.length() - 3)));
        }
        m.appendTail(sb);
        return sb.toString();
    }

}
