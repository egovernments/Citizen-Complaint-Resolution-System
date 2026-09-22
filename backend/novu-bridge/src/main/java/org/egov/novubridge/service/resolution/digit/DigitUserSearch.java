package org.egov.novubridge.service.resolution.digit;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.resolution.Recipient;
import org.egov.novubridge.util.ServiceUrl;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The one place the bridge calls egov-user, shared by the role resolver and the hydrator. Maps
 * only the contact fields: the code this replaced also parsed dates it never read, and NPE'd on a
 * null createdDate inside a catch that turned the crash into "there is no assignee".
 */
@Slf4j
public class DigitUserSearch {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    public DigitUserSearch(@Nullable RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    public boolean available() {
        return restTemplate != null && StringUtils.hasText(config.getUserHost());
    }

    /**
     * POST {@code /user/_search} as the internal microservice user.
     *
     * @return the {@code user} array, empty when there is none; transport failures throw
     */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> search(Map<String, Object> criteria, String tenantId,
                                            RequestInfo requestInfo) {
        if (!available()) {
            return Collections.emptyList();
        }
        Map<String, Object> body = new LinkedHashMap<>(criteria);
        body.put("RequestInfo", internalUser(requestInfo, tenantId));
        body.put("tenantId", tenantId);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        String url = ServiceUrl.join(config.getUserHost(), config.getUserSearchPath());
        ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST,
                new HttpEntity<>(body, headers), Map.class);
        Object users = response.getBody() == null ? null : response.getBody().get("user");
        if (!(users instanceof List)) {
            return Collections.emptyList();
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object user : (List<Object>) users) {
            if (user instanceof Map) {
                out.add((Map<String, Object>) user);
            }
        }
        return out;
    }

    /**
     * A raw egov-user row to a recipient, or null when it has neither phone nor email.
     *
     * @param type the envelope's {@code contact.type}: the role code, or EMPLOYEE/CITIZEN
     */
    public static Recipient toRecipient(Map<String, Object> raw, String type) {
        if (raw == null) {
            return null;
        }
        String phone = withCountryCode(text(raw.get("mobileNumber")), text(raw.get("countryCode")));
        String email = text(raw.get("emailId"));
        if (!StringUtils.hasText(phone) && !StringUtils.hasText(email)) {
            return null;
        }
        return new Recipient(text(raw.get("uuid")), type, text(raw.get("name")), phone, email, null);
    }

    /** {@code countryCode + mobileNumber}, unless the number is already E.164 ({@code +...}). */
    public static String withCountryCode(String mobileNumber, String countryCode) {
        if (!StringUtils.hasText(mobileNumber)) {
            return null;
        }
        if (mobileNumber.startsWith("+")) {
            return mobileNumber;
        }
        return StringUtils.hasText(countryCode) ? countryCode + mobileNumber : mobileNumber;
    }

    /** egov-user refuses a tenant-wide search without a user, and a Kafka message has none. */
    private RequestInfo internalUser(RequestInfo requestInfo, String tenantId) {
        RequestInfo copy = requestInfo != null ? requestInfo : new RequestInfo();
        RequestInfo out = new RequestInfo();
        out.setApiId(StringUtils.hasText(copy.getApiId()) ? copy.getApiId() : "novu-bridge");
        out.setVer(StringUtils.hasText(copy.getVer()) ? copy.getVer() : "1.0");
        out.setMsgId(copy.getMsgId());
        out.setUserInfo(User.builder()
                .uuid(config.getInternalMicroserviceUserUuid())
                .type("SYSTEM")
                .id(0L)
                .roles(Collections.singletonList(Role.builder()
                        .name("Internal Microservice Role")
                        .code("INTERNAL_MICROSERVICE_ROLE")
                        .tenantId(tenantId)
                        .build()))
                .build());
        return out;
    }

    private static String text(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
