package org.egov.novubridge.service.resolution.digit;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.resolution.Recipient;
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
 * The one place the bridge talks to egov-user, shared by the role-pool resolver and the actor
 * hydrator so they cannot drift on the two things that are easy to get subtly wrong: the
 * internal-user context, and how a phone number gets its country code.
 *
 * <p><b>The field mapping is deliberately trimmed to the five contact fields.</b> The code this
 * replaces ran every egov-user response through a date-parsing pass that converted
 * {@code createdDate}, {@code lastModifiedDate}, {@code dob} and {@code pwdExpiryDate} from
 * strings to epoch millis — and NPE'd on a null {@code createdDate}, inside a
 * {@code catch (Exception)} that turned the crash into a silent "there is no assignee". A
 * notification needs a name, a phone and an email; parsing four dates it will never read, in a
 * way that fails closed and quietly, is not a behaviour worth porting.
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
     * POST {@code /user/_search} with the given criteria, as the internal microservice user.
     *
     * @return the {@code user} array, or an empty list — never null, and never a throw for an
     *         empty answer
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
     * A raw egov-user row to a recipient, or null when it carries neither a phone nor an email.
     *
     * @param type what to label this person as on the envelope's {@code contact.type}: the role
     *             code for a pool member, {@code EMPLOYEE} or {@code CITIZEN} for a named actor
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

    /**
     * {@code countryCode + mobileNumber}, unless the number already carries a {@code +} — a
     * tenant whose user records are already E.164 must not end up with {@code +254+254712…}.
     */
    public static String withCountryCode(String mobileNumber, String countryCode) {
        if (!StringUtils.hasText(mobileNumber)) {
            return null;
        }
        if (mobileNumber.startsWith("+")) {
            return mobileNumber;
        }
        return StringUtils.hasText(countryCode) ? countryCode + mobileNumber : mobileNumber;
    }

    /**
     * The bridge's own identity for a directory read. egov-user refuses a tenant-wide search
     * from an ordinary caller, and there is no end user behind a Kafka message to borrow one
     * from, so the call is made as {@code INTERNAL_MICROSERVICE_ROLE} — the same identity the
     * producer used for the same searches.
     */
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
