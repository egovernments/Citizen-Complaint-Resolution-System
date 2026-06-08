package org.egov.pgr.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.User;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

import static org.egov.pgr.util.PGRConstants.*;

@Slf4j
@Component
@RequiredArgsConstructor
public class NotificationService {

    private final PGRConfiguration config;
    private final RestTemplate restTemplate;

    /**
     * Sends SMS and in-app event notifications on workflow state changes.
     * Replaces old Kafka-based notification dispatch with direct HTTP.
     */
    public void process(ServiceRequest request) {
        Service service = request.getService();
        String applicationStatus = service.getApplicationStatus();
        String action = request.getWorkflow() != null ? request.getWorkflow().getAction() : null;

        if (action == null) return;

        String key = action + "_" + applicationStatus;
        if (!NOTIFICATION_ENABLE_FOR_STATUS.contains(key)) {
            log.info("Notifications disabled for state: {}", applicationStatus);
            return;
        }

        try {
            if (Boolean.TRUE.equals(config.getIsSMSEnabled())) {
                sendSmsNotification(service, action, applicationStatus);
            }
        } catch (Exception e) {
            log.error("Error sending notification for serviceRequestId={}", service.getServiceRequestId(), e);
        }
    }

    private void sendSmsNotification(Service service, String action, String applicationStatus) {
        User citizen = service.getCitizen();
        if (citizen == null || citizen.getMobileNumber() == null) {
            log.warn("Skipping SMS — no citizen mobile for {}", service.getServiceRequestId());
            return;
        }

        String mobile = buildMobile(citizen.getMobileNumber(), citizen.getCountryCode());
        String message = buildMessage(service, action, applicationStatus);

        Map<String, Object> smsPayload = new HashMap<>();
        smsPayload.put("mobileNumber", mobile);
        smsPayload.put("message", message);

        try {
            String smsEndpoint = config.getUrlShortnerHost() + "/egov.core.notification.sms";
            restTemplate.postForEntity(smsEndpoint, smsPayload, Void.class);
            log.info("SMS dispatched for {} to {}", service.getServiceRequestId(), mobile);
        } catch (Exception e) {
            log.warn("SMS dispatch failed for {}: {}", service.getServiceRequestId(), e.getMessage());
        }
    }

    private String buildMessage(Service service, String action, String applicationStatus) {
        String base = "Your complaint " + service.getServiceRequestId() +
                " (" + service.getServiceCode() + ") status: " + applicationStatus + ".";

        if (RESOLVED.equalsIgnoreCase(applicationStatus)) {
            String rateLink = config.getRateLink().replace("{application-id}", service.getServiceRequestId());
            String reopenLink = config.getReopenLink().replace("{application-id}", service.getServiceRequestId());
            String host = getUiHost(service.getTenantId());
            base += " Rate: " + host + rateLink + " | Reopen: " + host + reopenLink;
        }

        return base;
    }

    private String getUiHost(String tenantId) {
        if (config.getUiAppHostMap() == null) return "";
        String stateId = tenantId != null && tenantId.contains(".") ? tenantId.split("\\.")[0] : tenantId;
        return config.getUiAppHostMap().getOrDefault(stateId, "");
    }

    private String buildMobile(String mobile, String countryCode) {
        if (mobile == null) return null;
        if (mobile.startsWith("+")) return mobile;
        if (countryCode != null && !countryCode.isEmpty()) {
            return (countryCode.startsWith("+") ? countryCode : "+" + countryCode) + mobile;
        }
        return mobile;
    }
}
