package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.web.models.*;
import org.egov.pgr.web.models.workflow.*;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.util.CollectionUtils;

import java.util.*;
import java.util.stream.Collectors;

import static org.egov.pgr.util.PGRConstants.*;

@Slf4j
@org.springframework.stereotype.Service
public class WorkflowService {

    private PGRConfiguration pgrConfiguration;

    private ServiceRequestRepository repository;

    private ObjectMapper mapper;


    @Autowired
    public WorkflowService(PGRConfiguration pgrConfiguration, ServiceRequestRepository repository, ObjectMapper mapper) {
        this.pgrConfiguration = pgrConfiguration;
        this.repository = repository;
        this.mapper = mapper;
    }

    /*
     *
     * Should return the applicable BusinessService for the given request
     *
     * */
    public BusinessService getBusinessService(ServiceRequest serviceRequest) {
        String tenantId = serviceRequest.getService().getTenantId();
        StringBuilder url = getSearchURLWithParams(tenantId, PGR_BUSINESSSERVICE);
        RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(serviceRequest.getRequestInfo()).build();
        Object result = repository.fetchResult(url, requestInfoWrapper);
        BusinessServiceResponse response = null;
        try {
            response = mapper.convertValue(result, BusinessServiceResponse.class);
        } catch (IllegalArgumentException e) {
            throw new CustomException("PARSING ERROR", "Failed to parse response of workflow business service search");
        }

        if (CollectionUtils.isEmpty(response.getBusinessServices()))
            throw new CustomException("BUSINESSSERVICE_NOT_FOUND", "The businessService " + PGR_BUSINESSSERVICE + " is not found");

        return response.getBusinessServices().get(0);
    }


    /*
     * Call the workflow service with the given action and update the status
     * return the updated status of the application
     *
     * */
    public String updateWorkflowStatus(ServiceRequest serviceRequest) {
        ProcessInstance processInstance = getProcessInstanceForPGR(serviceRequest);
        ProcessInstanceRequest workflowRequest = new ProcessInstanceRequest(serviceRequest.getRequestInfo(), Collections.singletonList(processInstance));
        ProcessInstanceResponse response = callWorkFlow(workflowRequest);
        serviceRequest.getService().setApplicationStatus(response.getProcessInstances().get(0).getState().getApplicationStatus());
        serviceRequest.getService().setProcessInstance(response.getProcessInstances().get(0));
        return response.getProcessInstances().get(0).getState().getApplicationStatus();
    }


    public void validateAssignee(ServiceRequest serviceRequest) {
        /*
         * Call HRMS service and validate of the assignee belongs to same department
         * as the employee assigning it
         *
         * */

    }

    /**
     * Creates url for search based on given tenantId and businessservices
     *
     * @param tenantId        The tenantId for which url is generated
     * @param businessService The businessService for which url is generated
     * @return The search url
     */
    private StringBuilder getSearchURLWithParams(String tenantId, String businessService) {

        StringBuilder url = new StringBuilder(pgrConfiguration.getWfHost());
        url.append(pgrConfiguration.getWfBusinessServiceSearchPath());
        url.append("?tenantId=");
        url.append(tenantId);
        url.append("&businessServices=");
        url.append(businessService);
        return url;
    }


    public void enrichmentForSendBackToCititzen() {
        /*
         * If send bac to citizen action is taken assignes should be set to accountId
         *
         * */
    }


    public List<ServiceWrapper> enrichWorkflow(RequestInfo requestInfo, List<ServiceWrapper> serviceWrappers) {

        // FIX ME FOR BULK SEARCH
        Map<String, List<ServiceWrapper>> tenantIdToServiceWrapperMap = getTenantIdToServiceWrapperMap(serviceWrappers);

        List<ServiceWrapper> enrichedServiceWrappers = new ArrayList<>();

        for(String tenantId : tenantIdToServiceWrapperMap.keySet()) {

            List<String> serviceRequestIds = new ArrayList<>();

            List<ServiceWrapper> tenantSpecificWrappers = tenantIdToServiceWrapperMap.get(tenantId);

            tenantSpecificWrappers.forEach(pgrEntity -> {
                serviceRequestIds.add(pgrEntity.getService().getServiceRequestId());
            });

            RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();

            StringBuilder searchUrl = getprocessInstanceSearchURL(tenantId, StringUtils.join(serviceRequestIds, ','));
            Object result = repository.fetchResult(searchUrl, requestInfoWrapper);


            ProcessInstanceResponse processInstanceResponse = null;
            try {
                processInstanceResponse = mapper.convertValue(result, ProcessInstanceResponse.class);
            } catch (IllegalArgumentException e) {
                throw new CustomException("PARSING ERROR", "Failed to parse response of workflow processInstance search");
            }

            if (CollectionUtils.isEmpty(processInstanceResponse.getProcessInstances()) || processInstanceResponse.getProcessInstances().size() != serviceRequestIds.size())
                throw new CustomException("WORKFLOW_NOT_FOUND", "The workflow object is not found");

            Map<String, Workflow> businessIdToWorkflow = getWorkflow(processInstanceResponse.getProcessInstances());

            tenantSpecificWrappers.forEach(pgrEntity -> {
                pgrEntity.setWorkflow(businessIdToWorkflow.get(pgrEntity.getService().getServiceRequestId()));
            });

            enrichedServiceWrappers.addAll(tenantSpecificWrappers);
        }

        return enrichedServiceWrappers;

    }

    private Map<String, List<ServiceWrapper>> getTenantIdToServiceWrapperMap(List<ServiceWrapper> serviceWrappers) {
        Map<String, List<ServiceWrapper>> resultMap = new HashMap<>();
        for(ServiceWrapper serviceWrapper : serviceWrappers){
            if(resultMap.containsKey(serviceWrapper.getService().getTenantId())){
                resultMap.get(serviceWrapper.getService().getTenantId()).add(serviceWrapper);
            }else{
                List<ServiceWrapper> serviceWrapperList = new ArrayList<>();
                serviceWrapperList.add(serviceWrapper);
                resultMap.put(serviceWrapper.getService().getTenantId(), serviceWrapperList);
            }
        }
        return resultMap;
    }

    /**
     * Enriches ProcessInstance Object for workflow
     *
     * @param request
     */
    private ProcessInstance getProcessInstanceForPGR(ServiceRequest request) {

        Service service = request.getService();
        Workflow workflow = request.getWorkflow();

        ProcessInstance processInstance = new ProcessInstance();
        processInstance.setBusinessId(service.getServiceRequestId());
        processInstance.setAction(request.getWorkflow().getAction());
        processInstance.setModuleName(PGR_MODULENAME);
        processInstance.setTenantId(service.getTenantId());
        processInstance.setBusinessService(getBusinessService(request).getBusinessService());
        processInstance.setDocuments(request.getWorkflow().getVerificationDocuments());
        processInstance.setComment(workflow.getComments());

        if(!CollectionUtils.isEmpty(workflow.getAssignes())){
            List<User> users = new ArrayList<>();

            workflow.getAssignes().forEach(uuid -> {
                User user = new User();
                user.setUuid(uuid);
                users.add(user);
            });

            processInstance.setAssignes(users);
        }

        return processInstance;
    }

    /**
     *
     * @param processInstances
     */
    public Map<String, Workflow> getWorkflow(List<ProcessInstance> processInstances) {

        Map<String, Workflow> businessIdToWorkflow = new HashMap<>();

        processInstances.forEach(processInstance -> {
            List<String> userIds = null;

            if(!CollectionUtils.isEmpty(processInstance.getAssignes())){
                userIds = processInstance.getAssignes().stream().map(User::getUuid).collect(Collectors.toList());
            }

            Workflow workflow = Workflow.builder()
                    .action(processInstance.getAction())
                    .assignes(userIds)
                    .comments(processInstance.getComment())
                    .verificationDocuments(processInstance.getDocuments())
                    .build();

            businessIdToWorkflow.put(processInstance.getBusinessId(), workflow);
        });

        return businessIdToWorkflow;
    }

    /**
     * Method to integrate with workflow
     * <p>
     * take the ProcessInstanceRequest as paramerter to call wf-service
     * <p>
     * and return wf-response to sets the resultant status
     */
    private ProcessInstanceResponse callWorkFlow(ProcessInstanceRequest workflowReq) {

        ProcessInstanceResponse response = null;
        StringBuilder url = new StringBuilder(pgrConfiguration.getWfHost().concat(pgrConfiguration.getWfTransitionPath()));
        Object optional = repository.fetchResult(url, workflowReq);
        response = mapper.convertValue(optional, ProcessInstanceResponse.class);
        return response;
    }


    public StringBuilder getprocessInstanceSearchURL(String tenantId, String serviceRequestId) {

        StringBuilder url = new StringBuilder(pgrConfiguration.getWfHost());
        url.append(pgrConfiguration.getWfProcessInstanceSearchPath());
        url.append("?tenantId=");
        url.append(tenantId);
        url.append("&businessIds=");
        url.append(serviceRequestId);
        return url;

    }

    /**
     * Upper bound on workflow rows for an assignee lookup. Without one, egov-workflow-v2 returns its
     * default page (egov.wf.default.limit, 10 in the stock jar) and silently drops the rest; above
     * egov.wf.max.limit (100 in the stock jar) workflow clamps it. Matches EscalationService's bound.
     */
    static final int ASSIGNEE_SEARCH_LIMIT = 200;

    /**
     * Complaints this employee currently holds in workflow, at this exact tenant (workflow matches
     * {@code tenantid} exactly, so a state-level tenant finds nothing).
     *
     * <p>Workflow's own {@code assignee} filter only looks at each complaint's newest transition,
     * and most transitions — a citizen COMMENT, ESCALATE, a blank ASSIGN — name no assignee. On its
     * own it therefore drops a complaint from its holder the moment anyone comments on it. The
     * holder is instead derived the way {@link EscalationService#getCurrentAssignees} does it
     * (#2129/#2138): the assignee named by the newest transition that named anyone, within the
     * complaint's current state occupancy ({@link #currentHolders}).
     *
     * <ol>
     *   <li>Complaints whose newest transition names the employee — held by definition.</li>
     *   <li>Complaints an older transition named them on (history search by assignee), whose full
     *       histories are then fetched in one batch and walked with {@link #currentHolders}.</li>
     * </ol>
     *
     * Each search is bounded by {@link #ASSIGNEE_SEARCH_LIMIT}, newest first: an employee with more
     * assignments than that loses the least recently touched ones. A truncated history can only
     * omit a complaint, never admit one it does not hold. If step 2 fails the step-1 result stands.
     */
    public Set<String> getServiceRequestIdsByAssignee(RequestInfo requestInfo, String tenantId, String assigneeUuid) {
        RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();

        Set<String> held = businessIdsOf(searchProcessInstances(assigneeSearchURL(tenantId, assigneeUuid, false), requestInfoWrapper));

        try {
            Set<String> candidates = businessIdsOf(searchProcessInstances(assigneeSearchURL(tenantId, assigneeUuid, true), requestInfoWrapper));
            candidates.removeAll(held);
            if (candidates.isEmpty())
                return held;

            StringBuilder historyUrl = getprocessInstanceSearchURL(tenantId, String.join(",", candidates));
            historyUrl.append("&history=true&limit=").append(ASSIGNEE_SEARCH_LIMIT);
            Map<String, List<ProcessInstance>> histories = new LinkedHashMap<>();
            for (ProcessInstance instance : searchProcessInstances(historyUrl, requestInfoWrapper))
                histories.computeIfAbsent(instance.getBusinessId(), id -> new ArrayList<>()).add(instance);

            histories.forEach((businessId, history) -> {
                if (candidates.contains(businessId) && currentHolders(history).contains(assigneeUuid))
                    held.add(businessId);
            });
        } catch (Exception e) {
            log.warn("WorkflowService: workflow history lookup for assignee={} tenant={} failed — using complaints whose latest transition names them only: {}",
                    assigneeUuid, tenantId, e.getMessage());
        }
        return held;
    }

    /**
     * Who holds a complaint, from its workflow history ordered newest-first (as egov-workflow-v2
     * returns it): the assignees of the newest transition that named anyone, walking back only
     * while the state is unchanged. Leaving a state relinquishes ownership (REASSIGN and REOPEN
     * return a complaint to a queue on purpose), so an occupancy entered without an assignee is
     * genuinely unowned and yields an empty list. See {@link EscalationService#getCurrentAssignees}.
     */
    public static List<String> currentHolders(List<ProcessInstance> newestFirst) {
        if (CollectionUtils.isEmpty(newestFirst))
            return Collections.emptyList();
        String currentState = stateOf(newestFirst.get(0));
        for (ProcessInstance instance : newestFirst) {
            if (!Objects.equals(currentState, stateOf(instance)))
                return Collections.emptyList();
            List<String> assignees = assigneeUuidsOf(instance);
            if (!assignees.isEmpty())
                return assignees;
        }
        return Collections.emptyList();
    }

    private static String stateOf(ProcessInstance instance) {
        return instance == null || instance.getState() == null ? null : instance.getState().getUuid();
    }

    private static List<String> assigneeUuidsOf(ProcessInstance instance) {
        if (instance == null || CollectionUtils.isEmpty(instance.getAssignes()))
            return Collections.emptyList();
        return instance.getAssignes().stream()
                .map(User::getUuid)
                .filter(uuid -> uuid != null && !uuid.isBlank())
                .collect(Collectors.toList());
    }

    private StringBuilder assigneeSearchURL(String tenantId, String assigneeUuid, boolean history) {
        StringBuilder url = new StringBuilder(pgrConfiguration.getWfHost());
        url.append(pgrConfiguration.getWfProcessInstanceSearchPath());
        url.append("?tenantId=").append(tenantId);
        url.append("&businessService=").append(PGR_BUSINESSSERVICE);
        url.append("&assignee=").append(assigneeUuid);
        url.append("&history=").append(history);
        url.append("&limit=").append(ASSIGNEE_SEARCH_LIMIT);
        return url;
    }

    private List<ProcessInstance> searchProcessInstances(StringBuilder url, RequestInfoWrapper requestInfoWrapper) {
        Object result = repository.fetchResult(url, requestInfoWrapper);
        if (result == null)
            throw new CustomException("WORKFLOW_SEARCH_FAILED", "Workflow process instance search returned no response");
        ProcessInstanceResponse response;
        try {
            response = mapper.convertValue(result, ProcessInstanceResponse.class);
        } catch (IllegalArgumentException e) {
            throw new CustomException("PARSING ERROR", "Failed to parse workflow response for assignee search");
        }
        return response == null || response.getProcessInstances() == null
                ? Collections.emptyList() : response.getProcessInstances();
    }

    private static Set<String> businessIdsOf(List<ProcessInstance> instances) {
        return instances.stream().map(ProcessInstance::getBusinessId).filter(Objects::nonNull)
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }

}
