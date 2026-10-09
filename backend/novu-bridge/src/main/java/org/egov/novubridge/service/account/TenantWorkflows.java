package org.egov.novubridge.service.account;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.config.TenantAccountsConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.util.Values;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The Novu workflows every tenant organization needs. A new organization has none, and Novu
 * answers a trigger for a missing workflow with an error, so provisioning creates every workflow
 * the bridge triggers, idempotently (list, then create only the missing ones):
 * <ul>
 *   <li>the per-channel pass-through workflows of the dispatch pipeline, the same shells
 *       {@code bootstrap-novu-whatsapp.sh} creates in the shared account (the rendered text
 *       travels in {@code payload.body}/{@code payload.subject});</li>
 *   <li>the OTP workflows of {@code POST /messages/_send}, whose text is fixed here and carries
 *       only the code and its expiry.</li>
 * </ul>
 * Bump {@link #VERSION} whenever this set changes: a provision of an already-provisioned tenant
 * then re-ensures it, which is how existing tenants get a new workflow.
 */
@Slf4j
@Component
public class TenantWorkflows {

    /** The workflow set's version, recorded per tenant in {@code nb_tenant_account.workflows_version}. */
    public static final int VERSION = 1;

    /** The OTP SMS text. Only the code and its expiry: no name, link, tenant or reference. */
    public static final String OTP_SMS_BODY =
            "{{payload.code}} is your verification code. It expires in {{payload.expiresInMinutes}} minutes.";
    public static final String OTP_EMAIL_SUBJECT = "Your verification code";
    public static final String OTP_EMAIL_BODY =
            "<p>{{payload.code}} is your verification code. It expires in {{payload.expiresInMinutes}} minutes.</p>";

    private final NovuClient novuClient;
    private final NovuBridgeConfiguration config;
    private final TenantAccountsConfiguration accounts;

    public TenantWorkflows(NovuClient novuClient, NovuBridgeConfiguration config, TenantAccountsConfiguration accounts) {
        this.novuClient = novuClient;
        this.config = config;
        this.accounts = accounts;
    }

    /** Every workflow a tenant organization must hold, in creation order. */
    public List<Map<String, Object>> definitions() {
        List<Map<String, Object>> out = new ArrayList<>();
        out.add(workflow(config.getNovuWorkflowSms(), List.of(smsStep("sms-step", "{{ payload.body }}"))));
        out.add(workflow(config.getNovuWorkflowWhatsapp(), List.of(smsStep("whatsapp-step", "{{ payload.body }}"))));
        out.add(workflow(config.getNovuWorkflowEmail(),
                List.of(emailStep("email-step", "{{ payload.subject }}", "{{ payload.body }}"))));
        out.add(workflow(accounts.getOtpWorkflowSms(), List.of(smsStep("otp-sms-step", OTP_SMS_BODY))));
        out.add(workflow(accounts.getOtpWorkflowEmail(),
                List.of(emailStep("otp-email-step", OTP_EMAIL_SUBJECT, OTP_EMAIL_BODY))));
        return out;
    }

    /** Creates the missing workflows; returns the ids it created. Throws on any Novu failure. */
    public List<String> ensure(NovuAccount account) {
        Set<String> existing = existingWorkflowIds(account);
        List<String> created = new ArrayList<>();
        for (Map<String, Object> workflow : definitions()) {
            String id = Values.str(workflow.get("workflowId"));
            if (existing.contains(id)) {
                continue;
            }
            NovuClient.NovuResponse response = novuClient.createWorkflow(account, workflow);
            Integer status = response == null ? null : response.getStatusCode();
            if (status == null || status < 200 || status >= 300) {
                throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_NOVU_WORKFLOW_CREATE_FAILED",
                        "Novu answered " + status + " creating workflow " + id + " for tenant " + account.tenantRoot());
            }
            created.add(id);
        }
        if (!created.isEmpty()) {
            log.info("Tenant {}: created Novu workflows {}", account.tenantRoot(), created);
        }
        return created;
    }

    private Set<String> existingWorkflowIds(NovuAccount account) {
        NovuClient.NovuResponse response = novuClient.listWorkflows(account);
        Map<String, Object> body = response == null ? null : response.getResponse();
        Set<String> ids = new LinkedHashSet<>();
        Map<String, Object> data = body == null ? null : Values.asMap(body.get("data"));
        List<Object> rows = data != null ? Values.asList(data.get("workflows")) : null;
        if (rows == null && body != null) {
            rows = Values.asList(body.get("data"));
        }
        if (rows == null) {
            throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_NOVU_WORKFLOWS_FAILED",
                    "Novu listed workflows for tenant " + account.tenantRoot() + " without a workflow list");
        }
        for (Object row : rows) {
            Map<String, Object> workflow = Values.asMap(row);
            String id = workflow == null ? null : Values.str(workflow.get("workflowId"));
            if (StringUtils.hasText(id)) {
                ids.add(id);
            }
        }
        return ids;
    }

    /**
     * Novu derives the stored workflowId from the NAME when the two differ (that bit the shared
     * account once: "Complaints WhatsApp Workflow" became complaints-whats-app-workflow), so the
     * name IS the id.
     */
    private static Map<String, Object> workflow(String workflowId, List<Map<String, Object>> steps) {
        Map<String, Object> workflow = new LinkedHashMap<>();
        workflow.put("workflowId", workflowId);
        workflow.put("name", workflowId);
        workflow.put("active", true);
        workflow.put("validatePayload", false);
        workflow.put("isTranslationEnabled", false);
        workflow.put("steps", steps);
        return workflow;
    }

    private static Map<String, Object> smsStep(String name, String body) {
        Map<String, Object> controls = new LinkedHashMap<>();
        controls.put("body", body);
        Map<String, Object> step = new LinkedHashMap<>();
        step.put("name", name);
        step.put("type", "sms");
        step.put("controlValues", controls);
        return step;
    }

    private static Map<String, Object> emailStep(String name, String subject, String body) {
        Map<String, Object> controls = new LinkedHashMap<>();
        controls.put("subject", subject);
        controls.put("body", body);
        controls.put("editorType", "html");
        controls.put("disableOutputSanitization", true);
        Map<String, Object> step = new LinkedHashMap<>();
        step.put("name", name);
        step.put("type", "email");
        step.put("controlValues", controls);
        return step;
    }
}
