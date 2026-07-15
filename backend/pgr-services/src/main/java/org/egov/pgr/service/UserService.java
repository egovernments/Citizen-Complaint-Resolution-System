package org.egov.pgr.service;


import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.UserUtils;
import org.egov.pgr.web.models.*;
import org.egov.pgr.web.models.user.CreateUserRequest;
import org.egov.pgr.web.models.user.UserDetailResponse;
import org.egov.pgr.web.models.user.UserSearchRequest;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;

import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.egov.pgr.util.PGRConstants.USERTYPE_CITIZEN;

@org.springframework.stereotype.Service
public class UserService {


    private UserUtils userUtils;

    private PGRConfiguration config;

    @Autowired
    public UserService(UserUtils userUtils, PGRConfiguration config) {
        this.userUtils = userUtils;
        this.config = config;
    }

    /**
     * Calls user service to enrich user from search or upsert user
     * @param request
     */
    public void callUserService(ServiceRequest request){

        if(!StringUtils.isEmpty(request.getService().getAccountId()))
            enrichUser(request);
        else if(request.getService().getCitizen()!=null)
            upsertUser(request);

    }

    /**
     * Calls user search to fetch the list of user and enriches it in serviceWrappers
     * @param serviceWrappers
     * @param requestInfo RequestInfo from the caller, passed to user service so enc-service applies correct role-based masking
     */
    public void enrichUsers(List<ServiceWrapper> serviceWrappers, RequestInfo requestInfo){

        Set<String> uuids = new HashSet<>();

        serviceWrappers.forEach(serviceWrapper -> {
            uuids.add(serviceWrapper.getService().getAccountId());
        });

        Map<String, User> idToUserMap = searchBulkUser(new LinkedList<>(uuids), requestInfo);

        serviceWrappers.forEach(serviceWrapper -> {
            serviceWrapper.getService().setCitizen(idToUserMap.get(serviceWrapper.getService().getAccountId()));
        });

    }


    /**
     * Creates or updates the user based on if the user exists. The user existance is searched based on userName = mobileNumber
     * If the there is already a user with that mobileNumber, the existing user is updated
     * @param request
     */
    private void upsertUser(ServiceRequest request){

        User user = request.getService().getCitizen();
        String tenantId = request.getService().getTenantId();
        User userServiceResponse = null;

        // Search on mobile number as user name
        UserDetailResponse userDetailResponse = searchUser(userUtils.getStateLevelTenant(tenantId),null, user.getMobileNumber(),request.getRequestInfo());
        if (!userDetailResponse.getUser().isEmpty()) {
            User userFromSearch = userDetailResponse.getUser().get(0);
            if(!user.getName().equalsIgnoreCase(userFromSearch.getName())){
                userServiceResponse = updateUser(request.getRequestInfo(),user,userFromSearch);
            }
            else userServiceResponse = userDetailResponse.getUser().get(0);
        }
        else {
            userServiceResponse = createUser(request.getRequestInfo(),tenantId,user);
        }

        // Enrich the accountId
        request.getService().setAccountId(userServiceResponse.getUuid());
    }


    /**
     * Calls user search to fetch a user and enriches it in request
     * @param request
     */
    private void enrichUser(ServiceRequest request){

        RequestInfo requestInfo = request.getRequestInfo();
        String accountId = request.getService().getAccountId();
        String tenantId = request.getService().getTenantId();

        UserDetailResponse userDetailResponse = searchUser(userUtils.getStateLevelTenant(tenantId),accountId,null,requestInfo);

        if(userDetailResponse.getUser().isEmpty())
            throw new CustomException("INVALID_ACCOUNTID","No user exist for the given accountId");

        else request.getService().setCitizen(userDetailResponse.getUser().get(0));

    }

    /**
     * Creates the user from the given userInfo by calling user service
     * @param requestInfo
     * @param tenantId
     * @param userInfo
     * @return
     */
    private User createUser(RequestInfo requestInfo,String tenantId, User userInfo) {

        userUtils.addUserDefaultFields(userInfo.getMobileNumber(),tenantId, userInfo);
        StringBuilder uri = new StringBuilder(config.getUserHost())
                .append(config.getUserContextPath())
                .append(config.getUserCreateEndpoint());


        UserDetailResponse userDetailResponse = userUtils.userCall(new CreateUserRequest(requestInfo, userInfo), uri);

        return userDetailResponse.getUser().get(0);

    }

    /**
     * Updates the given user by calling user service
     * @param requestInfo
     * @param user
     * @param userFromSearch
     * @return
     */
    private User updateUser(RequestInfo requestInfo,User user,User userFromSearch) {

        userFromSearch.setName(user.getName());
        userFromSearch.setActive(true);

        StringBuilder uri = new StringBuilder(config.getUserHost())
                .append(config.getUserContextPath())
                .append(config.getUserUpdateEndpoint());


        UserDetailResponse userDetailResponse = userUtils.userCall(new CreateUserRequest(requestInfo, userFromSearch), uri);

        return userDetailResponse.getUser().get(0);

    }

    /**
     * calls the user search API based on the given accountId and userName
     * @param stateLevelTenant
     * @param accountId
     * @param userName
     * @param requestInfo forwarded so enc-service applies role-based masking
     * @return
     */
    private UserDetailResponse searchUser(String stateLevelTenant, String accountId, String userName, RequestInfo requestInfo){

        UserSearchRequest userSearchRequest =new UserSearchRequest();
        userSearchRequest.setActive(true);
        userSearchRequest.setUserType(USERTYPE_CITIZEN);
        userSearchRequest.setTenantId(stateLevelTenant);
        userSearchRequest.setRequestInfo(requestInfo);

        if(StringUtils.isEmpty(accountId) && StringUtils.isEmpty(userName))
            return null;

        if(!StringUtils.isEmpty(accountId))
            userSearchRequest.setUuid(Collections.singletonList(accountId));

        if(!StringUtils.isEmpty(userName))
            userSearchRequest.setUserName(userName);

        StringBuilder uri = new StringBuilder(config.getUserHost()).append(config.getUserSearchEndpoint());
        return userUtils.userCall(userSearchRequest,uri);

    }

    /**
     * calls the user search API based on the given list of user uuids
     * @param uuids
     * @param requestInfo forwarded so user service passes caller's roles to enc-service for role-based masking
     * @return
     */
    private Map<String,User> searchBulkUser(List<String> uuids, RequestInfo requestInfo){

        UserSearchRequest userSearchRequest =new UserSearchRequest();
        userSearchRequest.setActive(true);
        userSearchRequest.setUserType(USERTYPE_CITIZEN);
        userSearchRequest.setRequestInfo(requestInfo);


        if(!CollectionUtils.isEmpty(uuids))
            userSearchRequest.setUuid(uuids);


        StringBuilder uri = new StringBuilder(config.getUserHost()).append(config.getUserSearchEndpoint());
        UserDetailResponse userDetailResponse = userUtils.userCall(userSearchRequest,uri);
        List<User> users = userDetailResponse.getUser();

        if(CollectionUtils.isEmpty(users))
            throw new CustomException("USER_NOT_FOUND","No user found for the uuids");

        Map<String,User> idToUserMap = users.stream().collect(Collectors.toMap(User::getUuid, Function.identity()));

        return idToUserMap;
    }

    /**
     * Searches for a user by UUID (without userType restriction) and returns the name of their first role.
     * Used to resolve the modifier's role from auditDetails.lastModifiedBy.
     */
    public String getFirstRoleNameByUuid(String uuid, String tenantId, RequestInfo requestInfo) {
        if (!StringUtils.hasText(uuid) || !StringUtils.hasText(tenantId)) return null;

        UserSearchRequest userSearchRequest = new UserSearchRequest();
        userSearchRequest.setRequestInfo(requestInfo);
        userSearchRequest.setUuid(Collections.singletonList(uuid));
        userSearchRequest.setActive(true);
        userSearchRequest.setTenantId(userUtils.getStateLevelTenant(tenantId));

        StringBuilder uri = new StringBuilder(config.getUserHost()).append(config.getUserSearchEndpoint());
        UserDetailResponse response = userUtils.userCall(userSearchRequest, uri);

        if (response == null || CollectionUtils.isEmpty(response.getUser())) return null;
        List<Role> roles = response.getUser().get(0).getRoles();
        return CollectionUtils.isEmpty(roles) ? null : roles.get(0).getName();
    }

    public void updateUserContactDetails(String accountId, String email, String address,
                                         String tenantId, RequestInfo requestInfo) {
        if (email == null && address == null) return;

        UserDetailResponse userDetailResponse =
                searchUser(userUtils.getStateLevelTenant(tenantId), accountId, null, requestInfo);

        if (userDetailResponse == null || userDetailResponse.getUser().isEmpty()) {
            return;
        }

        User user = userDetailResponse.getUser().get(0);

        if (email != null) user.setEmailId(email);
        if (address != null) user.setCorrespondenceAddress(address);

        StringBuilder uri = new StringBuilder(config.getUserHost())
                .append(config.getUserContextPath())
                .append(config.getUserUpdateEndpoint());
        userUtils.userCall(new org.egov.pgr.web.models.user.CreateUserRequest(requestInfo, user), uri);
    }

    /**
     * Enriches the list of userUuids associated with the mobileNumber in the search criteria
     * @param tenantId
     * @param criteria
     */
    public void enrichUserIds(String tenantId, RequestSearchCriteria criteria){

        String mobileNumber = criteria.getMobileNumber();

        UserSearchRequest userSearchRequest =new UserSearchRequest();
        userSearchRequest.setActive(true);
        userSearchRequest.setUserType(USERTYPE_CITIZEN);
        userSearchRequest.setTenantId(tenantId);
        userSearchRequest.setMobileNumber(mobileNumber);

        StringBuilder uri = new StringBuilder(config.getUserHost()).append(config.getUserSearchEndpoint());
        UserDetailResponse userDetailResponse = userUtils.userCall(userSearchRequest,uri);
        List<User> users = userDetailResponse.getUser();

        Set<String> userIds = users.stream().map(User::getUuid).collect(Collectors.toSet());
        criteria.setUserIds(userIds);
    }









}
