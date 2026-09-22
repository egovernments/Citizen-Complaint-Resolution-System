package org.egov.novubridge.config;

import jakarta.annotation.PostConstruct;
import lombok.Data;
import org.egov.tracer.config.TracerConfiguration;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Import;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/** Property reference and defaults: {@code application.properties}. */
@Component
@Data
@Import({TracerConfiguration.class})
public class NovuBridgeConfiguration {

    @Value("${app.timezone:UTC}")
    private String timeZone;

    // Core SmsRequests may carry no tenantId; this is the tenant such sends are attributed to.
    @Value("${novu.bridge.core.sms.default.tenant:}")
    private String coreSmsDefaultTenant;

    @Value("${novu.bridge.core.sms.country.code:}")
    private String coreSmsCountryCode;

    // The eventType allowlist. Add a producer here, never a shape-sniffing branch in the consumer.
    @Value("#{'${novu.bridge.event.types:COMPLAINTS_WORKFLOW_TRANSITIONED,CORE_SMS}'.split(',')}")
    private List<String> eventTypes;

    @Value("${novu.bridge.kafka.dlq.topic:novu-bridge.dlq}")
    private String dlqTopic;

    @Value("${novu.bridge.default.locale:en_IN}")
    private String defaultLocale;

    @Value("${novu.bridge.preference.enabled:true}")
    private Boolean preferenceEnabled;

    // Governs outages only; "no consent recorded" is always a deny.
    @Value("${novu.bridge.preference.fail.open:true}")
    private Boolean preferenceFailOpen;

    @Value("${novu.bridge.preference.host:http://localhost:8080/user-preferences}")
    private String preferenceHost;

    @Value("${novu.bridge.preference.check.path:/v1/_search}")
    private String preferenceCheckPath;

    @Value("${novu.bridge.preference.search.path:/user-preference/v1/_search}")
    private String preferenceSearchPath;

    @Value("${novu.bridge.preference.code:USER_NOTIFICATION_PREFERENCES}")
    private String preferenceCode;

    @Value("${novu.bridge.user.host:http://localhost:8081}")
    private String userHost;

    @Value("${novu.bridge.user.search.path:/user/_search}")
    private String userSearchPath;

    @Value("${novu.bridge.channel.policy.enabled:true}")
    private Boolean channelPolicyEnabled;

    // Schema codes are defaults, not per-deployment settings: a dropped compose overlay must not be
    // able to flip them. GET /novu-adapter/v1/config/source reports what is in effect.
    @Value("${novu.bridge.channel.policy.schema:NOTIFICATIONS.Channel}")
    private String channelPolicySchema;

    @Value("${novu.bridge.channel.policy.legacy.schema:RAINMAKER-PGR.NotificationChannel}")
    private String channelPolicyLegacySchema;

    @Value("${novu.bridge.channel.policy.cache.ttl.ms:60000}")
    private Long channelPolicyCacheTtlMs;

    @Value("${novu.bridge.provider.availability.cache.ttl.ms:60000}")
    private Long providerAvailabilityCacheTtlMs;

    @Value("${novu.bridge.mdms.host:http://egov-mdms-service:8094}")
    private String mdmsHost;

    @Value("${novu.bridge.mdms.search.path:/mdms-v2/v2/_search}")
    private String mdmsSearchPath;

    @Value("${novu.bridge.notifications.namespace:NOTIFICATIONS}")
    private String notificationConfigNamespace;

    @Value("${novu.bridge.notifications.cache.ttl.ms:60000}")
    private Long notificationConfigCacheTtlMs;

    // MDMS v2 answers a page, not a set: these bound the read loop, and the cap warns.
    @Value("${novu.bridge.notifications.page.size:200}")
    private Integer notificationConfigPageSize;

    @Value("${novu.bridge.notifications.max.pages:50}")
    private Integer notificationConfigMaxPages;

    // Over the cap NOTHING is delivered (SKIPPED / NB_RECIPIENT_LIMIT_EXCEEDED): half a fan-out is
    // worse than none because nobody can tell which half went.
    @Value("${novu.bridge.notifications.recipient.cap:1000}")
    private Integer notificationRecipientCap;

    @Value("${novu.bridge.role.pool.page.size:100}")
    private Integer rolePoolPageSize;

    @Value("${novu.bridge.role.pool.max.pages:10}")
    private Integer rolePoolMaxPages;

    // Presented to egov-user as INTERNAL_MICROSERVICE_ROLE; required where egov-user enforces that check.
    @Value("${novu.bridge.internal.user.uuid:}")
    private String internalMicroserviceUserUuid;

    @Value("${novu.bridge.localization.host:http://egov-localization-service:8080}")
    private String localizationHost;

    @Value("${novu.bridge.localization.search.path:/localization/messages/v1/_search}")
    private String localizationSearchPath;

    @Value("${novu.bridge.localization.cache.ttl.ms:300000}")
    private Long localizationCacheTtlMs;

    // Searched IN ORDER when a thin event names no module of its own.
    @Value("#{'${novu.bridge.localization.modules:rainmaker-pgr,rainmaker-common}'.split(',')}")
    private List<String> localizationModules;

    @Value("${novu.bridge.proxy.auth.enabled:true}")
    private Boolean proxyAuthEnabled;

    @Value("${novu.bridge.user.details.path:/user/_details}")
    private String userDetailsPath;

    @Value("#{'${novu.bridge.proxy.allowed.roles:EMPLOYEE,SUPERUSER,GRO,PGR_LME,MDMS_ADMIN}'.split(',')}")
    private List<String> proxyAllowedRoles;

    // Creating, rotating or deleting a provider is a config-admin act, gated separately from the read list.
    @Value("#{'${novu.bridge.proxy.admin.roles:SUPERUSER,MDMS_ADMIN,ACCOUNT_ADMIN}'.split(',')}")
    private List<String> proxyAdminRoles;

    @Value("${novu.base.url:http://localhost:3000}")
    private String novuBaseUrl;

    @Value("${novu.api.key:test-api-key}")
    private String novuApiKey;

    // Blank = the receipts endpoint answers 403 and rows never move past SENT.
    @Value("${novu.bridge.receipts.secret:}")
    private String receiptsSecret;

    @Value("${novu.bridge.dispatch.log.enabled:true}")
    private Boolean dispatchLogEnabled;

    @Value("${novu.bridge.workflow.id.sms:complaints-sms}")
    private String novuWorkflowSms;

    @Value("${novu.bridge.workflow.id.whatsapp:complaints-whatsapp}")
    private String novuWorkflowWhatsapp;

    @Value("${novu.bridge.workflow.id.email:complaints-email}")
    private String novuWorkflowEmail;

    // Novu picks the PRIMARY sms integration unless a trigger names one; WhatsApp needs its own.
    @Value("${novu.bridge.integration.id.whatsapp:}")
    private String whatsappIntegrationId;

    // Deployment-wide SMS gateway fallback: blank = Novu, "smscountry" = direct legacy bulk API.
    @Value("${novu.bridge.sms.provider:}")
    private String smsProvider;

    @Value("${novu.bridge.sms.sender.id:}")
    private String smsSenderId;

    @Value("${novu.bridge.smscountry.url:http://api.smscountry.com/SMSCwebservice_bulk.aspx}")
    private String smsCountryUrl;

    @Value("${novu.bridge.smscountry.user:}")
    private String smsCountryUser;

    @Value("${novu.bridge.smscountry.password:}")
    private String smsCountryPassword;

    // Hosts the SMSCountry adapter may post credentials to (plus the smscountry.url host). The
    // adapter's apiUrl comes from its caller, so anything else would make it an internal proxy.
    @Value("#{'${novu.bridge.smscountry.allowed.hosts:api.smscountry.com,www.smscountry.com}'.split(',')}")
    private List<String> smsCountryAllowedHosts;

    // Must be reachable FROM the Novu worker: an in-cluster URL, never the public gateway.
    @Value("${novu.bridge.smscountry.adapter.url:http://novu-bridge:8080/novu-bridge/novu-adapter/v1/gateways/smscountry/send}")
    private String smsCountryAdapterUrl;

    @Value("${novu.bridge.identify.cache.ttl.ms:300000}")
    private Long identifyCacheTtlMs;

    // Fallback for tenants with no channel-policy rows. No default on purpose: a deployment that
    // never set it used to attempt email with no SMTP provider and fail silently.
    @Value("#{'${novu.bridge.channels.enabled:}'.split(',')}")
    private List<String> channelsEnabled;

    public boolean isSmsCountryDirect() {
        return "smscountry".equalsIgnoreCase(smsProvider == null ? "" : smsProvider.trim());
    }

    /** The configured gateway's own host is always allowed; the rest come from the allowlist. */
    public boolean isSmsCountryHostAllowed(String host) {
        if (host == null || host.isBlank()) {
            return false;
        }
        String wanted = host.trim().toLowerCase(Locale.ROOT);
        if (wanted.equals(hostOf(smsCountryUrl))) {
            return true;
        }
        return smsCountryAllowedHosts != null && smsCountryAllowedHosts.stream()
                .anyMatch(h -> h != null && wanted.equals(h.trim().toLowerCase(Locale.ROOT)));
    }

    private static String hostOf(String url) {
        try {
            String host = url == null ? null : URI.create(url.trim()).getHost();
            return host == null ? null : host.toLowerCase(Locale.ROOT);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    public boolean isChannelEnabled(String channel) {
        if (channel == null) return false;
        return channelsEnabled.stream().anyMatch(c -> c.trim().equalsIgnoreCase(channel.trim()));
    }

    /** The per-channel workflow. Throws for unknown channels; NEVER defaults to the SMS workflow. */
    public String getNovuWorkflowId(String channel) {
        if (channel == null) {
            throw new CustomException("NB_UNSUPPORTED_CHANNEL", "channel is null; refusing to guess a Novu workflow");
        }
        switch (channel.toUpperCase()) {
            case "SMS":      return novuWorkflowSms;
            case "WHATSAPP": return novuWorkflowWhatsapp;
            case "EMAIL":    return novuWorkflowEmail;
            default:
                throw new CustomException("NB_UNSUPPORTED_CHANNEL", "No Novu workflow for channel: " + channel);
        }
    }

    @PostConstruct
    public void initialize() {
        TimeZone.setDefault(TimeZone.getTimeZone(timeZone));
    }
}
