package org.egov.novubridge.config;

import jakarta.annotation.PostConstruct;
import lombok.Data;
import org.egov.tracer.config.TracerConfiguration;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Import;
import org.springframework.stereotype.Component;

import java.util.TimeZone;

@Component
@Data
@Import({TracerConfiguration.class})
public class NovuBridgeConfiguration {

    @Value("${app.timezone:UTC}")
    private String timeZone;

    // One topic per producer; the envelope's eventType (not the topic) decides handling.
    @Value("#{'${novu.bridge.kafka.input.topics:complaints.domain.events,otp.send.events}'.split(',')}")
    private java.util.List<String> inputTopics;

    // Producer types the bridge accepts (EnvelopeValidator). Add a producer here — never a
    // shape-sniffing branch in the consumer.
    @Value("#{'${novu.bridge.event.types:COMPLAINTS_WORKFLOW_TRANSITIONED,OTP}'.split(',')}")
    private java.util.List<String> eventTypes;

    @Value("${novu.bridge.kafka.dlq.topic:novu-bridge.dlq}")
    private String dlqTopic;

    @Value("${novu.bridge.default.locale:en_IN}")
    private String defaultLocale;

    @Value("${novu.bridge.preference.enabled:true}")
    private Boolean preferenceEnabled;

    // When the preference service cannot be reached or answers with an error, allow (true) or
    // deny (false). "No consent recorded" is always a deny; this only governs outages.
    @Value("${novu.bridge.preference.fail.open:true}")
    private Boolean preferenceFailOpen;

    @Value("${novu.bridge.preference.host:http://localhost:8080/user-preferences}")
    private String preferenceHost;

    @Value("${novu.bridge.preference.check.path:/v1/_search}")
    private String preferenceCheckPath;

    // Full search endpoint (returns the preferences list). The check path above
    // is the consent lookup (a _search filtered to one user);
    // the configurator's read-only listing always needs _search.
    @Value("${novu.bridge.preference.search.path:/user-preference/v1/_search}")
    private String preferenceSearchPath;

    @Value("${novu.bridge.preference.code:USER_NOTIFICATION_PREFERENCES}")
    private String preferenceCode;

    @Value("${novu.bridge.user.host:http://localhost:8081}")
    private String userHost;

    @Value("${novu.bridge.user.search.path:/user/_search}")
    private String userSearchPath;

    // ---- Proxy auth: validate the DIGIT bearer token server-side ----
    // The read-only configurator proxy GETs (/novu-adapter/v1/logs|integrations)
    // are authenticated INSIDE this service (ProxyAuthFilter): the bearer token is
    // introspected against egov-user POST /user/_details, then gated on
    // type==EMPLOYEE + at least one role code in the allowlist below.
    // ---- Per-tenant channel policy (MDMS RAINMAKER-PGR.NotificationChannel) ----
    // The single authority on "is channel X on for tenant T, through which gateway". The
    // env vars channels.enabled / sms.provider / sms.sender.id are only a bootstrap
    // fallback for tenants with no rows yet.
    @Value("${novu.bridge.channel.policy.enabled:true}")
    private Boolean channelPolicyEnabled;

    @Value("${novu.bridge.channel.policy.schema:RAINMAKER-PGR.NotificationChannel}")
    private String channelPolicySchema;

    @Value("${novu.bridge.channel.policy.cache.ttl.ms:60000}")
    private Long channelPolicyCacheTtlMs;

    @Value("${novu.bridge.mdms.host:http://egov-mdms-service:8094}")
    private String mdmsHost;

    @Value("${novu.bridge.mdms.search.path:/mdms-v2/v2/_search}")
    private String mdmsSearchPath;

    @Value("${novu.bridge.proxy.auth.enabled:true}")
    private Boolean proxyAuthEnabled;

    @Value("${novu.bridge.user.details.path:/user/_details}")
    private String userDetailsPath;

    @Value("#{'${novu.bridge.proxy.allowed.roles:EMPLOYEE,SUPERUSER,GRO,PGR_LME,MDMS_ADMIN}'.split(',')}")
    private java.util.List<String> proxyAllowedRoles;

    @Value("${novu.base.url:http://localhost:3000}")
    private String novuBaseUrl;

    @Value("${novu.api.key:test-api-key}")
    private String novuApiKey;

    // Shared secret for provider delivery receipts (POST|GET /novu-adapter/v1/receipts/{provider}).
    // Blank = the endpoint answers 403 and rows never move past SENT.
    @Value("${novu.bridge.receipts.secret:}")
    private String receiptsSecret;

    @Value("${novu.bridge.dispatch.log.enabled:true}")
    private Boolean dispatchLogEnabled;

    // ---- Config-driven pass-through: per-channel Novu workflow ids ----
    // PGR pre-renders the body; novu-bridge triggers a fixed per-channel
    // workflow whose step simply emits payload.body. One workflow per channel.
    @Value("${novu.bridge.workflow.id.sms:complaints-sms}")
    private String novuWorkflowSms;

    @Value("${novu.bridge.workflow.id.whatsapp:complaints-whatsapp}")
    private String novuWorkflowWhatsapp;

    @Value("${novu.bridge.workflow.id.email:complaints-email}")
    private String novuWorkflowEmail;

    // ---- WhatsApp needs its own Twilio integration, explicitly targeted ----
    // Novu resolves which integration to use per channel by picking the PRIMARY
    // one for that channel UNLESS the trigger names an explicit
    // overrides.<channel>.integrationIdentifier. Twilio WhatsApp delivery is
    // modeled in Novu as an "sms"-channel step (WhatsApp rides the Twilio sms integration), so
    // a second, WhatsApp-registered Twilio integration living alongside the
    // primary (plain SMS) one on that same "sms" channel is otherwise never
    // picked — every trigger, SMS or WhatsApp, would keep resolving to the
    // primary SMS integration's (non-WhatsApp) sender number. Set this to the
    // identifier of that distinct WhatsApp integration to route WHATSAPP
    // triggers there. Left blank (the default), no override is sent — existing
    // deployments that haven't onboarded a separate WhatsApp integration yet
    // see no behavior change.
    @Value("${novu.bridge.integration.id.whatsapp:}")
    private String whatsappIntegrationId;

    // ---- Ordinary SMS through a non-Twilio gateway -------------------------
    // Twilio is not usable everywhere: some deployments cannot clear the SMS
    // compliance registration it requires, even where WhatsApp is fine. Novu has
    // no built-in provider for most regional gateways either — setting an
    // integration's providerId to the gateway's own name fails at trigger time
    // ("Sms handler for provider <name> is not found"). The supported route is
    // Novu's built-in "generic-sms" provider plus a _passthrough body shaped for
    // that gateway's API, which is what SmsCountryClient does.
    //
    // Blank (the default) = no overrides are sent and SMS delivers through
    // whatever is primary on Novu's sms channel, i.e. today's behaviour.
    // "ozeki" or "smscountry" = attach that gateway's envelope to SMS-channel
    // triggers only.
    // WhatsApp is unaffected: it is keyed to a different integration and returns
    // before this is ever consulted.
    @Value("${novu.bridge.sms.provider:}")
    private String smsProvider;


    // Registered sender id / header the gateway sends from.
    @Value("${novu.bridge.sms.sender.id:}")
    private String smsSenderId;

    // ---- SMSCountry legacy bulk API (direct, not via Novu) ----
    // Its form-encoded request and plain-text response cannot ride Novu's
    // generic-sms provider, which injects a JSON _passthrough body, so
    // SmsCountryClient talks to the gateway directly. Credentials are the
    // SMSCountry panel login; that account type issues no API key.
    @Value("${novu.bridge.smscountry.url:http://api.smscountry.com/SMSCwebservice_bulk.aspx}")
    private String smsCountryUrl;

    @Value("${novu.bridge.smscountry.user:}")
    private String smsCountryUser;

    @Value("${novu.bridge.smscountry.password:}")
    private String smsCountryPassword;

    /** True when the SMS leg should bypass Novu and go straight to SMSCountry. */
    public boolean isSmsCountryDirect() {
        return "smscountry".equalsIgnoreCase(smsProvider == null ? "" : smsProvider.trim());
    }

    // ---- Subscriber identify (upsert) TTL cache ----
    @Value("${novu.bridge.identify.cache.ttl.ms:300000}")
    private Long identifyCacheTtlMs;

    // ---- Channel delivery gate ----
    // Only channels listed here are actually delivered. Any other KNOWN channel
    // (e.g. WHATSAPP until a legitimate provider is onboarded as a Novu
    // integration) is persisted as SKIPPED / NB_NO_PROVIDER — an honest,
    // debuggable outcome, never a fallback to another channel.
    // No default channel. An empty list matches nothing in isChannelEnabled, so
    // every event is SKIPPED/NB_NO_PROVIDER until an operator names the channels
    // they have actually configured a provider for. Defaulting to SMS,EMAIL meant
    // a deployment that never set this attempted email dispatch with no SMTP
    // provider onboarded, and failed silently on every complaint.
    @Value("#{'${novu.bridge.channels.enabled:}'.split(',')}")
    private java.util.List<String> channelsEnabled;

    public boolean isChannelEnabled(String channel) {
        if (channel == null) return false;
        return channelsEnabled.stream().anyMatch(c -> c.trim().equalsIgnoreCase(channel.trim()));
    }

    /**
     * Resolve the fixed Novu workflow id for a channel. Throws for null/unknown
     * channels — callers must gate on a known channel first (the pipeline
     * persists SKIPPED/NB_UNSUPPORTED_CHANNEL instead of ever reaching this
     * throw in normal operation). NEVER defaults to the SMS workflow.
     */
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
