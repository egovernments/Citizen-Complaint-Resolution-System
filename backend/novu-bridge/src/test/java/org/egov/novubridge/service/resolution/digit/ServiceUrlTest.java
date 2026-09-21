package org.egov.novubridge.service.resolution.digit;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class ServiceUrlTest {

    @Test
    void composeStyleHostWithoutTrailingSlash() {
        assertEquals("http://egov-localization:8096/localization/messages/v1/_search",
                ServiceUrl.join("http://egov-localization:8096", "/localization/messages/v1/_search"));
    }

    @Test
    void kubernetesConfigMapHostWithTrailingSlash() {
        assertEquals("http://egov-localization.egov:8080/localization/messages/v1/_search",
                ServiceUrl.join("http://egov-localization.egov:8080/", "/localization/messages/v1/_search"));
    }

    @Test
    void pathWithoutLeadingSlashAndBlankParts() {
        assertEquals("http://h:1/p", ServiceUrl.join("http://h:1//", "p"));
        assertEquals("http://h:1", ServiceUrl.join("http://h:1/", ""));
        assertEquals("/p", ServiceUrl.join(null, "p"));
    }
}
