package org.egov.pgr.config;

import jakarta.annotation.PostConstruct;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.TimeZone;

@Component
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PGRConfiguration {

    @Value("${app.timezone}")
    private String timeZone;

    @PostConstruct
    public void initialize() {
        TimeZone.setDefault(TimeZone.getTimeZone(timeZone));
    }

    // -------------------------------------------------------
    // IdGen (via digit-client)
    // -------------------------------------------------------
    @Value("${idgen.templateCode}")
    private String idGenTemplateCode;

    // -------------------------------------------------------
    // Workflow (via digit-client)
    // -------------------------------------------------------
    @Value("${pgr.workflow.processCode}")
    private String workflowProcessCode;

    @Value("${pgr.business.codes}")
    private String businessCodes;

    // -------------------------------------------------------
    // Registry schema codes
    // -------------------------------------------------------
    @Value("${pgr.registry.schema-code}")
    private String registryServiceCategorySchemaCode;

    @Value("${pgr.registry.pgr-storage.schema-code}")
    private String registryStorageSchemaCode;

    // -------------------------------------------------------
    // PGR search / pagination
    // -------------------------------------------------------
    @Value("${pgr.default.offset}")
    private Integer defaultOffset;

    @Value("${pgr.default.limit}")
    private Integer defaultLimit;

    @Value("${pgr.search.max.limit}")
    private Integer maxLimit;

    // -------------------------------------------------------
    // PGR business rules
    // -------------------------------------------------------
    @Value("${pgr.complain.idle.time}")
    private Long complainMaxIdleTime;

    @Value("${pgr.business.level.sla}")
    private Long businessLevelSla;

    @Value("${allowed.source}")
    private String allowedSource;

    @Value("${pgr.validate.dept.enabled}")
    private Boolean isValidateDeptEnabled;

    // -------------------------------------------------------
    // Search parameter config (per role)
    // -------------------------------------------------------
    @Value("${citizen.allowed.search.params}")
    private String allowedCitizenSearchParameters;

    @Value("${employee.allowed.search.params}")
    private String allowedEmployeeSearchParameters;

    // -------------------------------------------------------
    // Notification
    // -------------------------------------------------------
    @Value("${notification.sms.enabled}")
    private Boolean isSMSEnabled;

    @Value("${egov.user.event.notification.enabled}")
    private Boolean isUserEventsNotificationEnabled;

    @Value("${mseva.mobile.app.download.link}")
    private String mobileDownloadLink;

    @Value("${egov.pgr.events.rate.link}")
    private String rateLink;

    @Value("${egov.pgr.events.reopen.link}")
    private String reopenLink;

    @Value("${egov.usr.events.rate.code}")
    private String rateCode;

    @Value("${egov.usr.events.reopen.code}")
    private String reopenCode;

    @Value("${egov.url.shortner.host}")
    private String urlShortnerHost;

    @Value("${egov.url.shortner.endpoint}")
    private String urlShortnerEndpoint;

    @Value("#{${egov.ui.app.host.map}}")
    private Map<String, String> uiAppHostMap;

    // -------------------------------------------------------
    // Escalation scheduler
    // -------------------------------------------------------
    @Value("${pgr.escalation.enabled}")
    private Boolean escalationEnabled;

    @Value("${pgr.escalation.interval.ms}")
    private Long escalationIntervalMs;

    @Value("${pgr.escalation.batch.size}")
    private Integer escalationBatchSize;

    @Value("${pgr.escalation.default.sla.ms}")
    private Long escalationDefaultSlaMs;

    @Value("${pgr.escalation.max.depth}")
    private Integer escalationMaxDepth;

    // -------------------------------------------------------
    // Dashboard refresh scheduler
    // -------------------------------------------------------
    @Value("${pgr.dashboard.refresh.enabled:true}")
    private Boolean dashboardRefreshEnabled;

    @Value("${pgr.dashboard.refresh.interval.ms:300000}")
    private Long dashboardRefreshIntervalMs;

    // -------------------------------------------------------
    // Dynamic data / complaint types
    // -------------------------------------------------------
    @Value("${egov.dynamicdata.period}")
    private String numberOfDays;

    @Value("${egov.complaints.category}")
    private String complaintTypes;

    // -------------------------------------------------------
    // Central instance
    // -------------------------------------------------------
    @Value("${state.level.tenantid.length}")
    private Integer stateLevelTenantIdLength;

    @Value("${is.environment.central.instance}")
    private Boolean isEnvironmentCentralInstance;
}
