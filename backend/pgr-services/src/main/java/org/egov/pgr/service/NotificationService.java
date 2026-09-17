package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.service.notification.NotificationRouter;
import org.egov.pgr.service.notification.RoutingMatch;
import org.egov.pgr.service.notification.TemplateRenderer;
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
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

import static org.egov.pgr.util.PGRConstants.*;

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
    private MultiStateInstanceUtil centralInstanceUtil;

    @Autowired
    private NotificationRouter notificationRouter;

    @Autowired
    private TemplateRenderer templateRenderer;

    @Autowired
    private Producer producer;

    /**
     * Entry point from the Kafka notification consumer. Routing, recipients and message
     * bodies come from MDMS (RAINMAKER-PGR.NotificationRouting / NotificationTemplate /
     * NotificationProviderTemplate); PGR renders the final text and publishes one
     * pre-rendered event per (recipient x channel) for novu-bridge to deliver.
     */
    public void process(ServiceRequest request, String topic) {
        processConfigDriven(request, topic);
    }


    /**
     * Resolves the localized complaint-type label for a service code: the current
     * COMPLAINT_HIERARCHY.<code> namespace first, then the legacy pgr.complaint.category.<code>
     * namespace for tenants whose localization predates the hierarchy migration.
     *
     * @param localizationMessage - Localization messages blob for the rainmaker-pgr module
     * @param serviceCode - Service code of the complaint
     * @return - Returns the localized label, or null when neither namespace has an entry
     */
    private String getLocalisedComplaintType(String localizationMessage, String serviceCode) {
        String localised = notificationUtil.getCustomizedMsgForPlaceholder(localizationMessage,
                "COMPLAINT_HIERARCHY." + serviceCode);
        if (!StringUtils.hasText(localised))
            localised = notificationUtil.getCustomizedMsgForPlaceholder(localizationMessage,
                    "pgr.complaint.category." + serviceCode);
        return localised;
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


    public Map<String, String> getHRMSEmployee(ServiceRequest request){
        Map<String, String> reassigneeDetails = new HashMap<>();
        List<String> mdmsDepartmentList = null;
        List<String> hrmsDepartmentList = null;
        List<String> designation = null;
        List<String> employeeName = null;
        String departmentFromMDMS;

        String localisationMessageForPlaceholder =  notificationUtil.getLocalizationMessages(request.getService().getTenantId(), request.getRequestInfo(),COMMON_MODULE);
        //HRSMS CALL
        StringBuilder url = hrmsUtils.getHRMSURI(request.getWorkflow().getAssignes(),request.getService().getTenantId());
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

        if(hrmsDepartmentList.contains(departmentFromMDMS)){
            String localisedDept = notificationUtil.getCustomizedMsgForPlaceholder(localisationMessageForPlaceholder,"COMMON_MASTERS_DEPARTMENT_"+departmentFromMDMS);
            reassigneeDetails.put("department",localisedDept);
        }

        String designationJsonPath = HRMS_DESIGNATION_JSONPATH.replace("{department}",departmentFromMDMS);

        try{
            designation = JsonPath.read(response, designationJsonPath);
            employeeName = JsonPath.read(response, HRMS_EMP_NAME_JSONPATH);
        }
        catch (Exception e){
            throw new CustomException("JSONPATH_ERROR","Failed to parse mdms response for department");
        }

        String localisedDesignation = notificationUtil.getCustomizedMsgForPlaceholder(localisationMessageForPlaceholder,"COMMON_MASTERS_DESIGNATION_"+designation.get(0));

        reassigneeDetails.put("designation",localisedDesignation);
        reassigneeDetails.put("employeeName",employeeName.get(0));

        return reassigneeDetails;
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


    private String buildMobileWithCountryCode(String mobileNumber, String countryCode) {
        if (mobileNumber == null) return null;
        if (mobileNumber.startsWith("+")) return mobileNumber;
        if (countryCode != null && !countryCode.isEmpty()) {
            return countryCode + mobileNumber;
        }
        return mobileNumber;
    }

    // ==================== Config-driven notification path (MDMS-driven) ====================
    // Routing comes from RAINMAKER-PGR.NotificationRouting, bodies from RAINMAKER-PGR.NotificationTemplate. PGR renders+localizes here, then publishes ONE
    // pre-rendered event per (recipient x channel) to complaints.domain.events. novu-bridge delivers.

    /**
     * Config-driven notification fan-out for one workflow transition. Resolves the routing rows for
     * (businessService, action, toState), fans each matched (audience, channel) out to its recipients,
     * renders+localizes the body, and publishes ONE pre-rendered event per (recipient x channel).
     *
     * Locale: each recipient renders in their preferredLanguage (digit-user-preferences-service,
     * one cached lookup per tenant) with pgr.notification.default.locale as the fallback; the
     * renderer additionally falls back to the default locale when a template is missing in the
     * recipient's language.
     */
    private void processConfigDriven(ServiceRequest request, String topic) {
        try {
            String tenantId = request.getService().getTenantId();
            String action = request.getWorkflow() != null ? request.getWorkflow().getAction() : null;
            String toState = request.getService().getApplicationStatus();
            if (!StringUtils.hasText(action) || !StringUtils.hasText(toState)) {
                log.info("Config-driven notification skipped: missing action/toState for complaint {}",
                        request.getService().getServiceRequestId());
                return;
            }
            List<RoutingMatch> matches = notificationRouter.route(tenantId, PGR_MODULENAME, null, action, toState);
            if (CollectionUtils.isEmpty(matches)) {
                log.info("No notification routing for action={} toState={} tenant={}", action, toState, tenantId);
                return;
            }
            String eventName = EVENT_NAME_PREFIX + action.toUpperCase(Locale.ROOT);
            String locale = config.getNotificationDefaultLocale();
            Map<String, String> values = buildPlaceholderValues(request);
            // uuid -> preferredLanguage for this tenant (one cached lookup per fan-out; empty = default for all).
            Map<String, String> preferredLocales = fetchPreferredLocales(tenantId, request.getRequestInfo());

            Set<String> emitted = new HashSet<>();
            // Memoize resolved recipients per (audience, assigneeOnly) so a role authored on
            // SMS+WHATSAPP+EMAIL triggers ONE tenant-wide user search, not three identical ones.
            Map<String, List<ResolvedRecipient>> audienceCache = new HashMap<>();
            for (RoutingMatch match : matches) {
                String audience = match.getAudience();
                String channel = match.getChannel();
                List<ResolvedRecipient> recipients;
                String audienceKey = audience.toUpperCase(Locale.ROOT) + "|" + match.isAssigneeOnly();
                if (audienceCache.containsKey(audienceKey)) {
                    recipients = audienceCache.get(audienceKey);
                } else {
                    try {
                        recipients = resolveByAudience(audience, match.isAssigneeOnly(), request);
                    } catch (Exception ex) {
                        log.error("Failed to resolve audience {} for complaint {}; skipping",
                                audience, request.getService().getServiceRequestId(), ex);
                        continue;   // do NOT poison the cache on failure
                    }
                    audienceCache.put(audienceKey, recipients);
                }
                if (CollectionUtils.isEmpty(recipients)) {
                    log.info("No recipients for audience {} on complaint {}; skipping",
                            audience, request.getService().getServiceRequestId());
                    continue;
                }
                // WHATSAPP: business-initiated messages must reference an APPROVED provider template
                // (Twilio Content SID) — free-form WhatsApp is rejected by Twilio (63016). Resolve it
                // once per (audience, channel) match. If none/unapproved we still EMIT the event with a
                // null templateId: the bridge persists an auditable SKIPPED/NB_TEMPLATE_NOT_APPROVED row
                // and never falls back to a free-form WhatsApp send. Dropping the event here (an earlier
                // `continue`) made the skip invisible — no nb_dispatch_log row. SMS/EMAIL are unaffected.
                // Everything below is per LOCALE: recipients render in their own preferredLanguage
                // (falling back to the instance default), so one (audience, channel) row can fan out
                // in several languages. Rendered bodies and provider templates are memoized per locale.
                Map<String, Rendered> renderedByLocale = new HashMap<>();
                Map<String, Map<String, Object>> providerTemplateByLocale = new HashMap<>();
                for (ResolvedRecipient recipient : recipients) {
                    if (recipient == null) continue;
                    // Per-channel contact requirement: EMAIL needs an email; SMS + WHATSAPP need a
                    // phone. A phone-only recipient on an EMAIL row would otherwise phantom-SEND.
                    boolean hasRequiredContact = "EMAIL".equalsIgnoreCase(channel)
                            ? StringUtils.hasText(recipient.email)
                            : StringUtils.hasText(recipient.phone);   // SMS + WHATSAPP need a phone
                    if (!hasRequiredContact) {
                        log.info("Recipient {} lacks the contact required for {} on complaint {}; skipping this channel",
                                recipient.userUuid, channel, request.getService().getServiceRequestId());
                        continue;
                    }
                    // Dedupe on (channel, subscriber): a user holding two notified roles gets ONE
                    // message per channel. Audience is intentionally NOT part of the key.
                    String dedupeKey = channel + "|" + recipient.subscriberKey();
                    if (emitted.contains(dedupeKey)) continue;
                    String rLocale = localeFor(preferredLocales, recipient, locale);
                    try {
                        Rendered rd = renderedByLocale.get(rLocale);
                        if (rd == null) {
                            rd = renderFor(request, tenantId, audience, action, toState, channel, rLocale, values);
                            renderedByLocale.put(rLocale, rd);
                        }
                        if (rd.body == null) {
                            // No template in this locale nor the default: nothing to send this recipient.
                            log.info("No template for {}.{}.{}.{} in {} (or default) on complaint {}; skipping recipient",
                                    audience, action, toState, channel, rLocale, request.getService().getServiceRequestId());
                            continue;
                        }
                        String providerTemplateId = null;
                        Map<String, Object> contentVariables = null;
                        if ("WHATSAPP".equalsIgnoreCase(channel)) {
                            // WHATSAPP: business-initiated messages must reference an APPROVED provider
                            // template. If none/unapproved we still EMIT with a null templateId: the bridge
                            // persists an auditable SKIPPED/NB_TEMPLATE_NOT_APPROVED row and never falls
                            // back to free-form WhatsApp. Dropping the event here made the skip invisible.
                            Map<String, Object> pt = providerTemplateByLocale.computeIfAbsent(rLocale,
                                    l -> providerTemplateFor(tenantId, audience, action, toState, l, locale));
                            if (pt.isEmpty()) {
                                log.info("No approved WhatsApp provider-template for {}.{}.{}.{} on complaint {}; "
                                        + "emitting for an auditable bridge-side SKIP (NB_TEMPLATE_NOT_APPROVED)",
                                        audience, action, toState, rLocale, request.getService().getServiceRequestId());
                            } else {
                                providerTemplateId = String.valueOf(pt.get("templateId"));
                                contentVariables = buildContentVariables(pt.get("variables"), values);
                            }
                        }
                        publishRenderedEvent(request, recipient, rLocale, channel, eventName, action, toState, rd.body, rd.subject,
                                rd.templateKey, providerTemplateId, contentVariables);
                        emitted.add(dedupeKey);   // only a successful publish consumes the key
                    } catch (Exception ex) {
                        log.error("Failed to render/publish {} for audience {} on complaint {}",
                                channel, audience, request.getService().getServiceRequestId(), ex);
                    }
                }
            }
        } catch (Exception ex) {
            log.error("Error in config-driven notification processing for topic {}", topic, ex);
        }
    }

    /** One rendered (body, subject, templateKey) for a locale. body==null means no template exists. */
    private static final class Rendered {
        final String body; final String subject; final String templateKey;
        Rendered(String body, String subject, String templateKey) { this.body = body; this.subject = subject; this.templateKey = templateKey; }
    }

    private Rendered renderFor(ServiceRequest request, String tenantId, String audience, String action, String toState,
                               String channel, String rLocale, Map<String, String> values) {
        String body = templateRenderer.render(tenantId, audience, action, toState, channel, rLocale, values);
        if (body == null) return new Rendered(null, null, null);
        String templateKey = templateRenderer.resolveTemplateKey(tenantId, audience, action, toState, channel, rLocale);
        String subject = null;
        // EMAIL requires a non-empty subject (Novu's email step rejects a blank one, dropping the
        // whole send). Render the template's subject and fall back to a sensible default.
        if ("EMAIL".equalsIgnoreCase(channel)) {
            subject = templateRenderer.renderSubject(tenantId, audience, action, toState, channel, rLocale, values);
            if (!StringUtils.hasText(subject)) subject = "Complaint " + request.getService().getServiceRequestId();
        }
        return new Rendered(body, subject, templateKey);
    }

    /** Approved WhatsApp provider template for the recipient's locale, else the default locale's; empty map if none. */
    private Map<String, Object> providerTemplateFor(String tenantId, String audience, String action, String toState,
                                                    String rLocale, String defaultLocale) {
        Map<String, Object> pt = resolveProviderTemplate(tenantId, "twilio", audience, action, toState, rLocale);
        if (pt == null && StringUtils.hasText(defaultLocale) && !defaultLocale.equalsIgnoreCase(rLocale)) {
            pt = resolveProviderTemplate(tenantId, "twilio", audience, action, toState, defaultLocale);
        }
        return pt != null ? pt : Collections.emptyMap();
    }

    private static String localeFor(Map<String, String> preferredLocales, ResolvedRecipient r, String defaultLocale) {
        if (r != null && StringUtils.hasText(r.userUuid)) {
            String preferred = preferredLocales.get(r.userUuid);
            if (StringUtils.hasText(preferred)) return preferred.trim();
        }
        return defaultLocale;
    }

    private static final class TimedLocales {
        final Map<String, String> byUuid; final long fetchedAt = System.currentTimeMillis();
        TimedLocales(Map<String, String> byUuid) { this.byUuid = byUuid; }
        boolean fresh(long ttl) { return System.currentTimeMillis() - fetchedAt < ttl; }
    }
    private final Map<String, TimedLocales> preferredLocaleCache = new java.util.concurrent.ConcurrentHashMap<>();

    /**
     * uuid -> preferredLanguage for the tenant, from digit-user-preferences-service
     * (preferenceCode USER_NOTIFICATION_PREFERENCES). One paged call per tenant per cache
     * window; failures and empties are cached too so an absent service costs one call per
     * window, not one per recipient. Off when the host is blank or the flag is false.
     */
    @SuppressWarnings("unchecked")
    Map<String, String> fetchPreferredLocales(String tenantId, RequestInfo requestInfo) {
        if (Boolean.FALSE.equals(config.getNotificationLocalePerRecipient())
                || !StringUtils.hasText(config.getUserPreferenceHost())) {
            return Collections.emptyMap();
        }
        String stateTenant = null;
        try { stateTenant = centralInstanceUtil.getStateLevelTenant(tenantId); } catch (Exception ignore) { }
        String tenant = StringUtils.hasText(stateTenant) ? stateTenant : tenantId;
        long ttl = config.getNotificationMdmsCacheTtlMs() != null ? config.getNotificationMdmsCacheTtlMs() : 60_000L;
        TimedLocales cached = preferredLocaleCache.get(tenant);
        if (cached != null && cached.fresh(ttl)) return cached.byUuid;
        Map<String, String> out = new HashMap<>();
        try {
            Map<String, Object> criteria = new LinkedHashMap<>();
            criteria.put("tenantId", tenant);
            criteria.put("preferenceCode", config.getNotificationPreferenceCode());
            criteria.put("limit", 1000);
            criteria.put("offset", 0);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("RequestInfo", requestInfo != null ? requestInfo : new RequestInfo());
            body.put("criteria", criteria);
            StringBuilder uri = new StringBuilder(config.getUserPreferenceHost()).append(config.getUserPreferenceSearchPath());
            Object res = serviceRequestRepository.fetchResult(uri, body);
            Object prefs = res instanceof Map ? ((Map<String, Object>) res).get("preferences") : null;
            if (prefs instanceof List) {
                for (Object o : (List<Object>) prefs) {
                    if (!(o instanceof Map)) continue;
                    Map<String, Object> p = (Map<String, Object>) o;
                    Object uid = p.get("userId");
                    Object payload = p.get("payload");
                    Object lang = payload instanceof Map ? ((Map<String, Object>) payload).get("preferredLanguage") : null;
                    if (uid != null && lang != null && StringUtils.hasText(lang.toString())) {
                        out.put(uid.toString(), lang.toString());
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Preferred-language lookup unavailable for tenant {} ({}); rendering in the default locale", tenant, e.getMessage());
        }
        preferredLocaleCache.put(tenant, new TimedLocales(out));
        return out;
    }

    /**
     * Resolves a flattened-routing audience to its recipient list:
     *   CITIZEN              -> [the complaint's citizen] (existing citizen extraction)
     *   EMPLOYEE (alias)     -> [the assignee] (current workflow assignee, else last ASSIGN) or []
     *   AUTO_ESCALATE/SYSTEM -> [] (non-notifiable; defensive — router already drops these)
     *   any other role R     -> if (assigneeOnly && named assignee exists) -> [assignee]
     *                           else the role POOL: all tenant users holding role R
     */
    private List<ResolvedRecipient> resolveByAudience(String audience, boolean assigneeOnly,
                                                      ServiceRequest request) {
        String locale = config.getNotificationDefaultLocale();
        if (AUDIENCE_CITIZEN.equalsIgnoreCase(audience)) {
            org.egov.pgr.web.models.User c = request.getService().getCitizen();
            if (c == null) return Collections.emptyList();
            String uuid = StringUtils.hasText(c.getUuid()) ? c.getUuid() : request.getService().getAccountId();
            String phone = buildMobileWithCountryCode(c.getMobileNumber(), c.getCountryCode());
            return Collections.singletonList(
                    new ResolvedRecipient(uuid, AUDIENCE_CITIZEN, c.getName(), phone, c.getEmailId(), locale));
        }
        if (AUDIENCE_EMPLOYEE.equalsIgnoreCase(audience)) {
            // Legacy alias -> the single assignee. Kept for backward compatibility.
            ResolvedRecipient assignee = resolveAssignee(request);
            return assignee == null ? Collections.emptyList() : Collections.singletonList(assignee);
        }
        if (AUDIENCE_AUTO_ESCALATE.equalsIgnoreCase(audience) || AUDIENCE_SYSTEM.equalsIgnoreCase(audience)) {
            return Collections.emptyList();
        }
        // Any other audience is a role code. Pool by default; opt into assignee-only per row.
        if (assigneeOnly) {
            ResolvedRecipient assignee = resolveAssignee(request);
            if (assignee != null) return Collections.singletonList(assignee);
            // No named assignee -> fall through to the role pool rather than notifying no one.
        }
        return resolveUsersByRole(audience, request.getService().getTenantId(), request.getRequestInfo());
    }

    /**
     * Resolves a role code to its tenant-wide POOL: every user holding {@code roleCode} in the
     * tenant, via egov-user _search with a roleCodes filter, run as the internal SYSTEM user.
     * Reuses the same user-search host/endpoint plumbing as {@link #fetchUserByUUID}. Recipients
     * with neither phone nor email are dropped.
     */
    @SuppressWarnings("unchecked")
    private List<ResolvedRecipient> resolveUsersByRole(String roleCode, String tenantId, RequestInfo ri) {
        String locale = config.getNotificationDefaultLocale();
        User userInfoCopy = ri.getUserInfo();
        ri.setUserInfo(getInternalMicroserviceUser(tenantId));
        // Dedupe holders by uuid across pages / data races; preserve insertion order.
        Map<String, ResolvedRecipient> byUuid = new LinkedHashMap<>();
        // Holders with no uuid can't be deduped by key — keep them verbatim.
        List<ResolvedRecipient> noUuid = new ArrayList<>();
        try {
            StringBuilder uri = new StringBuilder();
            uri.append(config.getUserHost()).append(config.getUserSearchEndpoint());
            int pageSize = config.getNotificationRolePoolPageSize();
            int maxPages = config.getNotificationRolePoolMaxPages();
            for (int page = 0; page < maxPages; page++) {
                Map<String, Object> userSearchRequest = new HashMap<>();
                userSearchRequest.put("RequestInfo", ri);
                userSearchRequest.put("tenantId", tenantId);
                userSearchRequest.put("userType", "EMPLOYEE");
                userSearchRequest.put("roleCodes", Collections.singletonList(roleCode));
                userSearchRequest.put("pageSize", pageSize);
                userSearchRequest.put("pageNumber", page);

                LinkedHashMap<String, Object> responseMap =
                        (LinkedHashMap<String, Object>) serviceRequestRepository.fetchResult(uri, userSearchRequest);
                if (responseMap == null) break;
                List<LinkedHashMap<String, Object>> users =
                        (List<LinkedHashMap<String, Object>>) responseMap.get("user");
                if (CollectionUtils.isEmpty(users)) break;
                // Only contact fields are needed for notification; map a trimmed view so unrelated
                // date fields (createdDate/dob) don't have to parse cleanly. Strip them defensively.
                for (LinkedHashMap<String, Object> raw : users) {
                    org.egov.pgr.web.models.User u = mapContactUser(raw);
                    if (u == null) continue;
                    String phone = buildMobileWithCountryCode(u.getMobileNumber(), u.getCountryCode());
                    String email = u.getEmailId();
                    if (!StringUtils.hasText(phone) && !StringUtils.hasText(email)) continue;
                    String type = StringUtils.hasText(roleCode) ? roleCode : AUDIENCE_EMPLOYEE;
                    ResolvedRecipient recipient =
                            new ResolvedRecipient(u.getUuid(), type, u.getName(), phone, email, locale);
                    if (StringUtils.hasText(u.getUuid())) byUuid.putIfAbsent(u.getUuid(), recipient);
                    else noUuid.add(recipient);
                }
                if (users.size() < pageSize) break;               // last page
                if (page == maxPages - 1)
                    log.warn("Role pool '{}' in tenant {} exceeds the {}-user notification cap; remaining holders NOT notified",
                            roleCode, tenantId, pageSize * maxPages);
            }
        } catch (Exception e) {
            log.error("Failed to resolve role pool '{}' for tenant {}", roleCode, tenantId, e);
        } finally {
            ri.setUserInfo(userInfoCopy);
        }
        List<ResolvedRecipient> out = new ArrayList<>(byUuid.values());
        out.addAll(noUuid);
        return out;
    }

    /**
     * Maps only the contact-relevant fields of a raw egov-user search row into a User. Avoids the
     * full {@link #parseResponse} date conversion (createdDate/dob/etc.) which is irrelevant for
     * notification recipients and brittle when those fields are absent or null.
     */
    private org.egov.pgr.web.models.User mapContactUser(Map<String, Object> raw) {
        if (raw == null) return null;
        org.egov.pgr.web.models.User u = new org.egov.pgr.web.models.User();
        Object uuid = raw.get("uuid");
        Object name = raw.get("name");
        Object mobile = raw.get("mobileNumber");
        Object countryCode = raw.get("countryCode");
        Object email = raw.get("emailId");
        if (uuid != null) u.setUuid(uuid.toString());
        if (name != null) u.setName(name.toString());
        if (mobile != null) u.setMobileNumber(mobile.toString());
        if (countryCode != null) u.setCountryCode(countryCode.toString());
        if (email != null) u.setEmailId(email.toString());
        return u;
    }

    private ResolvedRecipient resolveAssignee(ServiceRequest request) {
        String tenantId = request.getService().getTenantId();
        RequestInfo requestInfo = request.getRequestInfo();
        String locale = config.getNotificationDefaultLocale();
        // Current assignee from the live workflow (ASSIGN/REASSIGN transitions).
        if (request.getWorkflow() != null
                && !CollectionUtils.isEmpty(request.getWorkflow().getAssignes())
                && StringUtils.hasText(request.getWorkflow().getAssignes().get(0))) {
            ResolvedRecipient r = toEmployeeRecipient(
                    fetchUserByUUID(request.getWorkflow().getAssignes().get(0), requestInfo, tenantId), locale);
            if (r != null) return r;
        }
        // Fall back to the last ASSIGN in workflow history (REOPEN/RATE, or current resolution failed).
        try {
            ProcessInstance pi = getEmployeeName(tenantId, request.getService().getServiceRequestId(),
                    requestInfo, ASSIGN);
            if (pi != null && !CollectionUtils.isEmpty(pi.getAssignes())) {
                User wu = pi.getAssignes().get(0);
                if (StringUtils.hasText(wu.getUuid())) {
                    ResolvedRecipient r = toEmployeeRecipient(
                            fetchUserByUUID(wu.getUuid(), requestInfo, tenantId), locale);
                    if (r != null) return r;
                }
                String phone = buildMobileWithCountryCode(wu.getMobileNumber(), null);
                return new ResolvedRecipient(wu.getUuid(), AUDIENCE_EMPLOYEE, wu.getName(), phone, null, locale);
            }
        } catch (Exception e) {
            log.warn("Failed to resolve assignee from workflow history for complaint {}",
                    request.getService().getServiceRequestId(), e);
        }
        return null;
    }

    private ResolvedRecipient toEmployeeRecipient(org.egov.pgr.web.models.User u, String locale) {
        if (u == null) return null;
        String phone = buildMobileWithCountryCode(u.getMobileNumber(), u.getCountryCode());
        return new ResolvedRecipient(u.getUuid(), AUDIENCE_EMPLOYEE, u.getName(), phone, u.getEmailId(), locale);
    }

    private Map<String, String> buildPlaceholderValues(ServiceRequest request) {
        Map<String, String> v = new HashMap<>();
        org.egov.pgr.web.models.Service service = request.getService();
        String tenantId = service.getTenantId();
        RequestInfo ri = request.getRequestInfo();
        // Base placeholders that need NO localization: set these FIRST and independently, so a
        // localization-service outage cannot blank them. (Previously getLocalizationMessages was the
        // first call inside this try; when it threw — e.g. a downstream mis-instrumented JDBC driver
        // 400 — id/date/complaint_type were all left unset, and the WhatsApp Content-SID send then
        // shipped empty contentVariables → Twilio 21656.)
        try {
            put(v, "id", service.getServiceRequestId());
            put(v, "date", formatCreatedDate(service));
            // complaint_type falls back to the raw service code; localized label enriched below.
            if (StringUtils.hasText(service.getServiceCode()))
                put(v, "complaint_type", service.getServiceCode());
            if (StringUtils.hasText(service.getApplicationStatus()))
                put(v, "status", service.getApplicationStatus());
            if (request.getWorkflow() != null) put(v, "additional_comments", request.getWorkflow().getComments());
            if (service.getRating() != null) put(v, "rating", service.getRating().toString());
            if (service.getCitizen() != null) put(v, "citizen_name", service.getCitizen().getName());
        } catch (Exception e) {
            log.warn("Failed building base placeholders for {}", service.getServiceRequestId(), e);
        }
        // Localized enrichment (nicer complaint_type / status labels). Isolated: a localization
        // outage must NOT abort the base placeholders above.
        try {
            String loc = notificationUtil.getLocalizationMessages(tenantId, ri, PGR_MODULE);
            if (StringUtils.hasText(service.getServiceCode())) {
                String ct = getLocalisedComplaintType(loc, service.getServiceCode());
                if (StringUtils.hasText(ct)) put(v, "complaint_type", ct);
            }
            if (StringUtils.hasText(service.getApplicationStatus())) {
                String st = notificationUtil.getCustomizedMsgForPlaceholder(loc,
                        "CS_COMMON_" + service.getApplicationStatus());
                if (StringUtils.hasText(st)) put(v, "status", st);
            }
        } catch (Exception e) {
            log.warn("Localized placeholder enrichment unavailable for {}: {}",
                    service.getServiceRequestId(), e.getMessage());
        }
        // {download_link} is isolated in its own try: it makes an HTTP call to the url-shortening
        // service, and an outage there (e.g. a mis-instrumented JDBC driver returning 400) must NOT
        // abort the base placeholders above — otherwise recipients get a message with literal
        // {date}/{additional_comments} braces. Blank (not literal) when the shortener is unavailable.
        try {
            put(v, "download_link", notificationUtil.getShortnerURL(config.getMobileDownloadLink()));
        } catch (Exception e) {
            v.put("download_link", "");
            log.warn("url-shortening unavailable; blanked {download_link} for {}: {}",
                    service.getServiceRequestId(), e.getMessage());
        }
        try {
            String common = notificationUtil.getLocalizationMessages(tenantId, ri, COMMON_MODULE);
            if (service.getAddress() != null && StringUtils.hasText(service.getAddress().getDistrict()))
                put(v, "ulb", notificationUtil.getCustomizedMsgForPlaceholder(common,
                        service.getAddress().getDistrict()));
            try {
                ArrayList<String> ao = JsonPath.parse(common)
                        .read("$..messages[?(@.code==\"COMMON_MASTERS_DESIGNATION_AO\")].message");
                if (ao != null && !ao.isEmpty()) put(v, "ao_designation", ao.get(0));
            } catch (Exception ignore) { }
        } catch (Exception e) {
            log.warn("Failed building common placeholders for {}", service.getServiceRequestId(), e);
        }
        try {
            List<ResolvedRecipient> assignees = resolveByAudience(AUDIENCE_EMPLOYEE, false, request);
            ResolvedRecipient assignee = CollectionUtils.isEmpty(assignees) ? null : assignees.get(0);
            if (assignee != null && StringUtils.hasText(assignee.name)) put(v, "emp_name", assignee.name);
        } catch (Exception e) {
            // Expected when there is no assignee yet (e.g. APPLY); log at DEBUG so a
            // real HRMS/MDMS regression is still visible without spamming WARN.
            log.debug("Could not resolve assignee name for placeholders (may be no assignee yet): {}", e.getMessage());
        }
        try {
            Map<String, String> hrms = getHRMSEmployee(request);
            if (hrms != null) {
                put(v, "emp_department", hrms.get(DEPARTMENT));
                put(v, "emp_designation", hrms.get(DESIGNATION));
            }
        } catch (Exception e) {
            log.debug("Could not resolve HRMS employee for placeholders (may be no assignee yet): {}", e.getMessage());
        }
        return v;
    }

    private void put(Map<String, String> map, String key, String value) {
        if (value != null) map.put(key, value);
    }

    private String formatCreatedDate(org.egov.pgr.web.models.Service service) {
        if (service.getAuditDetails() == null || service.getAuditDetails().getCreatedTime() == null) return null;
        Long t = service.getAuditDetails().getCreatedTime();
        LocalDate date = Instant.ofEpochMilli(t > 1_000_000_000_000L ? t : t * 1000).atZone(ZoneId.systemDefault()).toLocalDate();
        return date.format(DateTimeFormatter.ofPattern(DATE_PATTERN));
    }

    private void publishRenderedEvent(ServiceRequest request, ResolvedRecipient r, String locale, String channel,
                                      String eventName, String action, String toState, String body, String subject,
                                      String templateKey, String providerTemplateId, Map<String, Object> contentVariables) {
        org.egov.pgr.web.models.Service service = request.getService();
        String tenantId = service.getTenantId();
        String subKey = r.subscriberKey();
        if (!StringUtils.hasText(subKey)) {
            log.warn("Skipping {} notification for complaint {}: no subscriberId (no uuid/mobile)",
                    channel, service.getServiceRequestId());
            return;
        }
        String subscriberId = tenantId + ":" + subKey;
        String transactionId = String.join(":", service.getServiceRequestId(), action, toState, subscriberId, channel);

        Map<String, Object> contact = new LinkedHashMap<>();
        contact.put("userId", r.userUuid);
        contact.put("type", r.type);
        contact.put("name", r.name);
        contact.put("phone", r.phone);
        contact.put("email", r.email);
        contact.put("locale", StringUtils.hasText(locale) ? locale : r.locale);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("complaintNo", service.getServiceRequestId());
        data.put("status", service.getApplicationStatus());
        data.put("action", action);
        data.put("toState", toState);

        Map<String, Object> event = new LinkedHashMap<>();
        event.put("schemaVersion", "1");   // novu-bridge envelope version
        event.put("eventId", UUID.randomUUID().toString());
        event.put("eventType", "COMPLAINTS_WORKFLOW_TRANSITIONED");
        event.put("eventName", eventName);
        event.put("eventTime", Instant.now().toString());
        event.put("producer", "complaints-service");
        event.put("module", "Complaints");
        event.put("entityType", "COMPLAINT");
        event.put("entityId", service.getServiceRequestId());
        event.put("tenantId", tenantId);
        event.put("channel", channel);
        event.put("subscriberId", subscriberId);
        event.put("contact", contact);
        event.put("renderedBody", body);
        event.put("subject", subject);   // EMAIL subject (rendered); null for SMS/WHATSAPP
        event.put("transactionId", transactionId);
        if (StringUtils.hasText(templateKey)) event.put("templateKey", templateKey);   // MDMS uid actually rendered
        event.put("data", data);
        // Provider-template (Twilio WhatsApp Content SID) delivery: carried only for WHATSAPP with an
        // approved template. When present, novu-bridge sends the ContentSid + positional variables via
        // a Twilio provider override instead of the free-form renderedBody.
        if (StringUtils.hasText(providerTemplateId)) {
            event.put("templateId", providerTemplateId);
            if (contentVariables != null && !contentVariables.isEmpty()) {
                event.put("contentVariables", contentVariables);
            }
        }

        producer.push(tenantId, config.getComplaintsDomainEventsTopic(), event);
        log.info("Published config-driven {} notification: complaint={} subscriber={} txn={} template={}",
                channel, service.getServiceRequestId(), maskPii(subscriberId), maskPii(transactionId),
                StringUtils.hasText(providerTemplateId) ? providerTemplateId : "free-form");
    }

    /**
     * Resolve the approved {@code NotificationProviderTemplate} row (Twilio WhatsApp Content SID)
     * for a routing key, or null if none is approved+active. Keyed by
     * (provider, WHATSAPP, audience, action, toState, locale). Matching is case-insensitive.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> resolveProviderTemplate(String tenantId, String provider, String audience,
                                                        String action, String toState, String locale) {
        List<Object> rows = mdmsUtils.getNotificationProviderTemplates(tenantId);
        if (CollectionUtils.isEmpty(rows)) return null;
        for (Object o : rows) {
            if (!(o instanceof Map)) continue;
            Map<String, Object> r = (Map<String, Object>) o;
            Object active = r.getOrDefault("active", Boolean.TRUE);
            if (active instanceof Boolean && !((Boolean) active)) continue;
            if (!"approved".equalsIgnoreCase(String.valueOf(r.get("approvalStatus")))) continue;
            if (!provider.equalsIgnoreCase(String.valueOf(r.get("provider")))) continue;
            if (!"WHATSAPP".equalsIgnoreCase(String.valueOf(r.get("channel")))) continue;
            if (!audience.equalsIgnoreCase(String.valueOf(r.get("audience")))) continue;
            if (!action.equalsIgnoreCase(String.valueOf(r.get("action")))) continue;
            if (!toState.equalsIgnoreCase(String.valueOf(r.get("toState")))) continue;
            if (!locale.equalsIgnoreCase(String.valueOf(r.get("locale")))) continue;
            Object templateId = r.get("templateId");
            if (templateId == null || !StringUtils.hasText(templateId.toString())) continue;
            return r;
        }
        return null;
    }

    /**
     * Build Twilio positional {@code contentVariables} ({@code {"1":.., "2":..}}) from the provider
     * template's ORDERED {@code variables} (our placeholder names) resolved against the rendered
     * placeholder {@code values} map. A missing placeholder becomes an empty string (never null).
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> buildContentVariables(Object variablesObj, Map<String, String> values) {
        if (!(variablesObj instanceof List)) return null;
        List<Object> variables = (List<Object>) variablesObj;
        Map<String, Object> cv = new LinkedHashMap<>();
        for (int i = 0; i < variables.size(); i++) {
            Object name = variables.get(i);
            String val = name == null ? null : values.get(String.valueOf(name));
            cv.put(String.valueOf(i + 1), val == null ? "" : val);
        }
        return cv;
    }

    /**
     * Mask PII embedded in a log value. subscriberId ({@code tenantId:subKey}) and
     * transactionId can carry a raw mobile when the recipient had no uuid. Replaces
     * any run of 7+ digits with {@code ***} + its last 3 digits — the same rule as
     * novu-bridge's PiiMask (kept local to avoid a cross-module dependency for one
     * method). UUIDs (digit runs < 7) pass through untouched.
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

    /** Resolved notification target: who + how to reach them, for one subscriber relationship. */
    private static class ResolvedRecipient {
        final String userUuid;
        final String type;   // CITIZEN | EMPLOYEE
        final String name;
        final String phone;
        final String email;
        final String locale;

        ResolvedRecipient(String userUuid, String type, String name, String phone, String email, String locale) {
            this.userUuid = userUuid;
            this.type = type;
            this.name = name;
            this.phone = phone;
            this.email = email;
            this.locale = locale;
        }

        String subscriberKey() {
            if (StringUtils.hasText(userUuid)) return userUuid;
            if (StringUtils.hasText(phone)) return phone;
            return null;
        }
    }

}