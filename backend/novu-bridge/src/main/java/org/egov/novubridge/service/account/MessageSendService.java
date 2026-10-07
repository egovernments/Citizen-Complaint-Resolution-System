package org.egov.novubridge.service.account;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.TenantAccountsConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.util.PiiMask;
import org.egov.novubridge.util.Values;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;

/**
 * {@code POST /novu-adapter/v1/messages/_send}: one message, sent now, through the TENANT'S OWN
 * Novu account (never through Kafka, never through the shared account), for the Identity BFF's
 * citizen OTP. Only {@code templateKey: OTP} exists: the bridge owns its text
 * ({@link TenantWorkflows#OTP_SMS_BODY}), which carries the code and its expiry and nothing else.
 *
 * <p>Distinct, documented outcomes:
 * <ul>
 *   <li>409 {@code NB_TENANT_NOT_PROVISIONED}: the tenant's root has no account of its own;</li>
 *   <li>422 {@code NB_NO_PROVIDER_FOR_CHANNEL}: it has, but no usable provider carries the channel
 *       (the BFF maps both to {@code OTP_CHANNEL_UNAVAILABLE});</li>
 *   <li>502 {@code NB_PROVIDER_FAILED}: Novu ran the send and the provider refused it;</li>
 *   <li>503 {@code NB_NOVU_UNAVAILABLE} / 502 {@code NB_NOVU_TRIGGER_FAILED}: Novu itself could not
 *       be reached or refused the trigger;</li>
 *   <li>200 {@code SENT}: the provider accepted it; 202 {@code QUEUED}: Novu accepted it and the
 *       provider had not answered within {@code novu.bridge.messages.confirm.timeout.ms}.</li>
 * </ul>
 * The code never reaches a log line, the ledger row or an error message.
 */
@Slf4j
@Service
public class MessageSendService {

    public static final String TEMPLATE_OTP = "OTP";
    private static final Pattern E164 = Pattern.compile("\\+[1-9][0-9]{6,14}");
    private static final Pattern EMAIL = Pattern.compile("[^\\s@]+@[^\\s@]+\\.[^\\s@]+");
    private static final Pattern CODE = Pattern.compile("[0-9A-Za-z]{4,12}");
    private static final long MAX_EXPIRY_SECONDS = 86_400L;

    private final TenantAccountService tenantAccounts;
    private final ChannelReadiness readiness;
    private final NovuClient novuClient;
    private final TenantAccountsConfiguration accounts;
    private final DispatchLogRepository dispatchLog;
    LongSupplier clock = System::currentTimeMillis;
    Sleeper sleeper = Thread::sleep;

    interface Sleeper {
        void sleep(long ms) throws InterruptedException;
    }

    public MessageSendService(TenantAccountService tenantAccounts, ChannelReadiness readiness, NovuClient novuClient,
                              TenantAccountsConfiguration accounts, DispatchLogRepository dispatchLog) {
        this.tenantAccounts = tenantAccounts;
        this.readiness = readiness;
        this.novuClient = novuClient;
        this.accounts = accounts;
        this.dispatchLog = dispatchLog;
    }

    /** The outcome; {@code accepted} false never reaches the caller (it is an {@link AccountException}). */
    public record Outcome(HttpStatus status, Map<String, Object> body) {
    }

    public Outcome send(Map<String, Object> request) {
        Request r = parse(request);
        NovuAccount account = tenantAccounts.accountFor(r.tenantId());
        if (account == null) {
            throw tenantAccounts.enabled() ? TenantAccountService.notProvisioned(r.root())
                    : new AccountException(HttpStatus.CONFLICT, "NB_TENANT_NOT_PROVISIONED", "Tenant " + r.root()
                    + " has no notification account of its own: per-tenant accounts are off on this deployment");
        }
        ChannelReadiness.Readiness ready = readiness.evaluate(account, r.tenantId(), r.channel());
        if (!ready.ready()) {
            throw new AccountException(HttpStatus.UNPROCESSABLE_ENTITY, "NB_NO_PROVIDER_FOR_CHANNEL",
                    "Tenant " + r.root() + " cannot send " + r.channel() + ": " + ready.reason());
        }

        String transactionId = "otp-" + UUID.randomUUID();
        String subscriberId = "otp-" + Values.stableId(r.root() + ":" + r.recipient().toLowerCase(Locale.ROOT));
        boolean email = "EMAIL".equals(r.channel());
        String workflow = email ? accounts.getOtpWorkflowEmail() : accounts.getOtpWorkflowSms();
        Map<String, Object> payload = new HashMap<>();
        payload.put("code", r.code());
        payload.put("expiresInMinutes", r.expiresInMinutes());
        payload.put("expiresAt", r.expiresAt());
        Map<String, Object> overrides = NovuClient.applyIntegrationOverride(null, r.channel(), ready.identifier());

        NovuClient.NovuResponse response;
        try {
            response = novuClient.trigger(account, workflow, subscriberId, email ? null : r.recipient(),
                    email ? r.recipient() : null, payload, transactionId, overrides);
        } catch (RuntimeException e) {
            record(r, transactionId, subscriberId, "FAILED", "NB_NOVU_UNAVAILABLE", "Novu could not be reached", null, ready);
            throw new AccountException(HttpStatus.SERVICE_UNAVAILABLE, "NB_NOVU_UNAVAILABLE",
                    "The notification service could not be reached", e);
        }
        Integer status = response == null ? null : response.getStatusCode();
        if (status == null || status < 200 || status >= 300) {
            record(r, transactionId, subscriberId, "FAILED", "NB_NOVU_TRIGGER_FAILED", "Novu answered " + status, null, ready);
            throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_NOVU_TRIGGER_FAILED",
                    "The notification service refused the send (HTTP " + status + ")");
        }
        Object novuTxn = Values.unwrapData(response.getResponse()).get("transactionId");
        String novuTransactionId = novuTxn == null ? transactionId : novuTxn.toString();

        JobState job = awaitJob(account, novuTransactionId, email ? "email" : "sms", r.code());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("tenantId", r.tenantId());
        out.put("channel", r.channel());
        out.put("transactionId", novuTransactionId);
        out.put("provider", ready.identifier());
        out.put("account", NovuAccount.label(account));
        if (job.failed()) {
            record(r, novuTransactionId, subscriberId, "FAILED", "NB_PROVIDER_FAILED", job.detail(), response.getResponse(), ready);
            throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_PROVIDER_FAILED", "The " + r.channel()
                    + " provider (" + ready.identifier() + ") did not accept the message"
                    + (StringUtils.hasText(job.detail()) ? ": " + job.detail() : ""));
        }
        record(r, novuTransactionId, subscriberId, "SENT", null, null, response.getResponse(), ready);
        out.put("status", job.completed() ? "SENT" : "QUEUED");
        log.info("messages/_send: tenant={} channel={} provider={} txn={} status={}", r.root(), r.channel(),
                ready.identifier(), novuTransactionId, out.get("status"));
        return new Outcome(job.completed() ? HttpStatus.OK : HttpStatus.ACCEPTED, out);
    }

    // ------------------------------------------------------------------ request

    record Request(String tenantId, String root, String channel, String recipient, String code,
                   long expiresInMinutes, String expiresAt) {
    }

    Request parse(Map<String, Object> body) {
        if (body == null) {
            throw invalid("a JSON body is required");
        }
        String tenantId = Values.str(body.get("tenantId"));
        String root = TenantAccountService.rootOf(tenantId);
        String channel = Values.str(body.get("channel"));
        if (!StringUtils.hasText(channel)) {
            throw invalid("channel is required (SMS or EMAIL)");
        }
        channel = channel.trim().toUpperCase(Locale.ROOT);
        if (!"SMS".equals(channel) && !"EMAIL".equals(channel)) {
            throw invalid("channel must be SMS or EMAIL");
        }
        String templateKey = Values.str(body.get("templateKey"));
        if (!TEMPLATE_OTP.equalsIgnoreCase(templateKey == null ? "" : templateKey.trim())) {
            throw new AccountException(HttpStatus.BAD_REQUEST, "NB_UNKNOWN_TEMPLATE",
                    "templateKey must be OTP: it is the only message _send carries");
        }
        String recipient = Values.str(body.get("recipient"));
        recipient = recipient == null ? "" : recipient.trim();
        if ("SMS".equals(channel) ? !E164.matcher(recipient).matches() : !EMAIL.matcher(recipient).matches()) {
            throw invalid("SMS".equals(channel) ? "recipient must be an E.164 phone number (+ and 7 to 15 digits)"
                    : "recipient must be an email address");
        }
        Map<String, Object> payload = Values.asMap(body.get("payload"));
        String code = payload == null ? null : Values.str(payload.get("code"));
        if (code == null || !CODE.matcher(code.trim()).matches()) {
            throw invalid("payload.code is required: 4 to 12 letters or digits");
        }
        long now = clock.getAsLong();
        long seconds;
        Object expiresAt = payload.get("expiresAt");
        Object expiresIn = payload.get("expiresInSeconds");
        if (expiresIn != null) {
            try {
                seconds = Long.parseLong(expiresIn.toString().trim());
            } catch (NumberFormatException e) {
                throw invalid("payload.expiresInSeconds must be a whole number");
            }
        } else if (expiresAt != null) {
            try {
                seconds = (Instant.parse(expiresAt.toString().trim()).toEpochMilli() - now) / 1000L;
            } catch (DateTimeParseException e) {
                throw invalid("payload.expiresAt must be an ISO-8601 instant, e.g. 2026-10-07T10:15:30Z");
            }
        } else {
            throw invalid("payload.expiresAt or payload.expiresInSeconds is required");
        }
        if (seconds <= 0 || seconds > MAX_EXPIRY_SECONDS) {
            throw invalid("the code must expire in the future and within 24 hours");
        }
        long minutes = Math.max(1L, (seconds + 59L) / 60L);
        String at = Instant.ofEpochMilli(now + seconds * 1000L).toString();
        return new Request(tenantId.trim(), root, channel, recipient, code.trim(), minutes, at);
    }

    private static AccountException invalid(String message) {
        return new AccountException(HttpStatus.BAD_REQUEST, "NB_INVALID_REQUEST", message);
    }

    // ------------------------------------------------------------------ confirmation

    record JobState(boolean completed, boolean failed, String detail) {
    }

    /**
     * Polls Novu's notification for this transaction until the channel's job completes or fails,
     * or the confirm timeout runs out (then it is still in flight: 202). A read error is "unknown",
     * never a failure: Novu accepted the trigger.
     */
    JobState awaitJob(NovuAccount account, String transactionId, String stepType, String code) {
        long timeout = accounts.getConfirmTimeoutMs() == null ? 5000L : accounts.getConfirmTimeoutMs();
        long poll = Math.max(50L, accounts.getConfirmPollMs() == null ? 400L : accounts.getConfirmPollMs());
        long deadline = clock.getAsLong() + timeout;
        while (true) {
            JobState state = readJob(account, transactionId, stepType, code);
            if (state.completed() || state.failed() || clock.getAsLong() >= deadline) {
                return state;
            }
            try {
                sleeper.sleep(poll);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return state;
            }
        }
    }

    private JobState readJob(NovuAccount account, String transactionId, String stepType, String code) {
        try {
            NovuClient.NovuResponse response = novuClient.notificationsByTransaction(account, transactionId);
            List<Object> notifications = Values.asList(response == null || response.getResponse() == null
                    ? null : response.getResponse().get("data"));
            if (notifications == null) {
                return new JobState(false, false, null);
            }
            for (Object n : notifications) {
                Map<String, Object> notification = Values.asMap(n);
                if (notification == null || !transactionId.equals(Values.str(notification.get("transactionId")))) {
                    continue;
                }
                List<Object> jobs = Values.asList(notification.get("jobs"));
                if (jobs == null) {
                    continue;
                }
                for (Object j : jobs) {
                    Map<String, Object> job = Values.asMap(j);
                    if (job == null || !stepType.equalsIgnoreCase(Values.str(job.get("type")))) {
                        continue;
                    }
                    String status = Values.lower(Values.str(job.get("status")));
                    if ("completed".equals(status)) {
                        return new JobState(true, false, null);
                    }
                    if ("failed".equals(status) || "canceled".equals(status)) {
                        return new JobState(false, true, failureDetail(job, code));
                    }
                }
            }
        } catch (RuntimeException e) {
            log.warn("messages/_send: could not read Novu job state for txn {}: {}", transactionId, e.getMessage());
        }
        return new JobState(false, false, null);
    }

    /** Novu's own short detail of the failed step, masked; never the provider's raw answer. */
    static String failureDetail(Map<String, Object> job, String code) {
        List<Object> details = Values.asList(job.get("executionDetails"));
        String detail = null;
        if (details != null) {
            for (Object d : details) {
                Map<String, Object> row = Values.asMap(d);
                if (row != null && "failed".equalsIgnoreCase(Values.str(row.get("status")))
                        && StringUtils.hasText(Values.str(row.get("detail")))) {
                    detail = Values.str(row.get("detail"));
                }
            }
        }
        if (detail == null) {
            return null;
        }
        if (code != null && !code.isEmpty()) {
            detail = detail.replace(code, "******");
        }
        detail = PiiMask.maskEmbedded(detail);
        return detail.length() > 200 ? detail.substring(0, 200) : detail;
    }

    // ------------------------------------------------------------------ ledger

    /** One row per send at the tenant: recipient as the hashed subscriber id, never the code or text. */
    private void record(Request r, String transactionId, String subscriberId, String status, String errorCode,
                        String errorMessage, Map<String, Object> providerResponse, ChannelReadiness.Readiness ready) {
        try {
            long now = clock.getAsLong();
            Map<String, Object> response = new HashMap<>();
            if (providerResponse != null) {
                response.put("novu", PiiMask.maskDeep(providerResponse));
            }
            response.put("integrationIdentifier", ready.identifier());
            response.put("novuAccount", "tenant:" + r.root());
            dispatchLog.upsert(DispatchLogEntry.builder()
                    .id(UUID.randomUUID())
                    .eventId(transactionId)
                    .transactionId(transactionId)
                    .referenceNumber(transactionId)
                    .module("identity")
                    .eventName("OTP_SEND")
                    .tenantId(r.tenantId())
                    .channel(r.channel())
                    .recipientValue(subscriberId)
                    .templateKey(TEMPLATE_OTP)
                    .status(status)
                    .attemptCount(1)
                    .lastErrorCode(errorCode)
                    .lastErrorMessage(errorMessage)
                    .providerResponse(response)
                    .providerRef(transactionId)
                    .isTest(false)
                    .createdTime(now)
                    .lastModifiedTime(now)
                    .build());
        } catch (RuntimeException e) {
            // The ledger is the audit trail, not the send: a write failure must not fail an OTP.
            log.warn("messages/_send: ledger write failed for txn {}: {}", transactionId, e.getMessage());
        }
    }
}
