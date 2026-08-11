package org.egov.pgr.policy;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.core.read.ListAppender;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpServerErrorException;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AccessPolicyRegistryTest {

    private static final String TENANT = "pg.city";
    private static final String URL = "/pgr-services/v2/request/_search";

    @Test
    void anAllowedRoleCannotPrimeTheCacheForAnUnmappedRole() {
        AtomicInteger calls = new AtomicInteger();
        AccessPolicySource source = (tenantId, method, url, roleCodes) -> {
            calls.incrementAndGet();
            return roleCodes.contains("EMPLOYEE") ? List.of(action(method, url)) : List.of();
        };
        AccessPolicyRegistry registry = new AccessPolicyRegistry(source);

        PolicyResolution allowed = registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);
        PolicyResolution unmapped = registry.resolve(request("CITIZEN"), TENANT, "POST", URL);

        assertEquals(PolicyResolution.Status.RESOLVED, allowed.status());
        assertEquals(PolicyResolution.Status.NOT_AUTHORIZED, unmapped.status());
        assertEquals(2, calls.get());
    }

    @Test
    void roleOrderAndDuplicatesShareOneCanonicalCacheEntry() {
        AtomicInteger calls = new AtomicInteger();
        List<List<String>> observedRoles = new ArrayList<>();
        AccessPolicySource source = (tenantId, method, url, roleCodes) -> {
            calls.incrementAndGet();
            observedRoles.add(roleCodes);
            return List.of(action(method, url));
        };
        AccessPolicyRegistry registry = new AccessPolicyRegistry(source);

        PolicyResolution first = registry.resolve(request("GRO", "EMPLOYEE", "GRO"), TENANT, "post", URL);
        PolicyResolution second = registry.resolve(request("EMPLOYEE", "GRO"), TENANT, "POST", URL);

        assertTrue(first.isResolved());
        assertTrue(second.isResolved());
        assertEquals(1, calls.get());
        assertEquals(List.of("EMPLOYEE", "GRO"), observedRoles.get(0));
        assertThrows(UnsupportedOperationException.class, () -> observedRoles.get(0).add("ADMIN"));
        assertSame(first.action().orElseThrow(), second.action().orElseThrow());
    }

    @Test
    void anAdditionalRoleCreatesADistinctCacheEntry() {
        AtomicInteger calls = new AtomicInteger();
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) -> {
            calls.incrementAndGet();
            return List.of(action(method, url));
        });

        registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);
        registry.resolve(request("EMPLOYEE", "GRO"), TENANT, "POST", URL);

        assertEquals(2, calls.get());
    }

    @Test
    void roleCodesRemainCaseSensitiveInTheCacheIdentity() {
        AtomicInteger calls = new AtomicInteger();
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) -> {
            calls.incrementAndGet();
            return List.of(action(method, url));
        });

        registry.resolve(request("GRO"), TENANT, "POST", URL);
        registry.resolve(request("gro"), TENANT, "POST", URL);

        assertEquals(2, calls.get());
    }

    @Test
    void tenantMethodAndExactUrlAreIndependentCacheAxes() {
        AtomicInteger calls = new AtomicInteger();
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) -> {
            calls.incrementAndGet();
            return List.of(action(method, url));
        });
        RequestInfo principal = request("EMPLOYEE");

        registry.resolve(principal, TENANT, "POST", URL);
        registry.resolve(principal, "pg.other", "POST", URL);
        registry.resolve(principal, TENANT, "GET", URL);
        registry.resolve(principal, TENANT, "POST", URL + "/child");
        registry.resolve(principal, TENANT, "post", URL);

        assertEquals(4, calls.get());
    }

    @Test
    void aSourceExceptionFailsClosedAndIsNotCached() {
        AtomicInteger calls = new AtomicInteger();
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) -> {
            calls.incrementAndGet();
            throw new IllegalStateException("access-control unavailable");
        });

        PolicyResolution first = registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);
        PolicyResolution second = registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);

        assertEquals(PolicyResolution.Status.SOURCE_UNAVAILABLE, first.status());
        assertEquals(PolicyResolution.Status.SOURCE_UNAVAILABLE, second.status());
        assertEquals(2, calls.get());
    }

    @Test
    void anHttpFailureDoesNotLeakItsResponseBodyIntoRegistryLogs() {
        String sensitiveBody = "policy-secret-that-must-not-be-logged";
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) -> {
            throw HttpServerErrorException.create(HttpStatus.SERVICE_UNAVAILABLE, "unavailable",
                    HttpHeaders.EMPTY, sensitiveBody.getBytes(StandardCharsets.UTF_8),
                    StandardCharsets.UTF_8);
        });
        Logger logger = (Logger) LoggerFactory.getLogger(AccessPolicyRegistry.class);
        ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);

        try {
            PolicyResolution result = registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);

            assertEquals(PolicyResolution.Status.SOURCE_UNAVAILABLE, result.status());
            String logs = appender.list.stream()
                    .map(ch.qos.logback.classic.spi.ILoggingEvent::getFormattedMessage)
                    .reduce("", (left, right) -> left + right);
            assertFalse(logs.contains(sensitiveBody));
            assertTrue(logs.contains(HttpServerErrorException.ServiceUnavailable.class.getName()));
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    @Test
    void aMalformedSuccessfulSourceResponseIsInvalidPolicyAndIsNotCached() {
        AtomicInteger calls = new AtomicInteger();
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) -> {
            calls.incrementAndGet();
            throw new MalformedPolicySourceResponseException("actions must be an array");
        });

        PolicyResolution first = registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);
        PolicyResolution second = registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);

        assertEquals(PolicyResolution.Status.INVALID_POLICY, first.status());
        assertEquals(PolicyResolution.Status.INVALID_POLICY, second.status());
        assertEquals(2, calls.get());
    }

    @Test
    void aCallerWithoutRolesIsDeniedWithoutConsultingTheSource() {
        AtomicInteger calls = new AtomicInteger();
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) -> {
            calls.incrementAndGet();
            return List.of(action(method, url));
        });

        PolicyResolution result = registry.resolve(request(), TENANT, "POST", URL);

        assertEquals(PolicyResolution.Status.NOT_AUTHORIZED, result.status());
        assertFalse(result.action().isPresent());
        assertEquals(0, calls.get());
    }

    @Test
    void noMatchingActionIsDeniedAndNotCached() {
        AtomicInteger calls = new AtomicInteger();
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) -> {
            calls.incrementAndGet();
            return List.of();
        });

        PolicyResolution first = registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);
        PolicyResolution second = registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);

        assertEquals(PolicyResolution.Status.NOT_AUTHORIZED, first.status());
        assertEquals(PolicyResolution.Status.NOT_AUTHORIZED, second.status());
        assertEquals(2, calls.get());
    }

    @Test
    void aNullSourceResultIsInvalidPolicyAndNotAuthorizationDenial() {
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) -> null);

        PolicyResolution result = registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);

        assertEquals(PolicyResolution.Status.INVALID_POLICY, result.status());
    }

    @Test
    void aMismatchedActionFailsClosedAndIsNotCached() {
        AtomicInteger calls = new AtomicInteger();
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) -> {
            calls.incrementAndGet();
            return List.of(action("GET", url + "/wrong"));
        });

        PolicyResolution first = registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);
        PolicyResolution second = registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);

        assertEquals(PolicyResolution.Status.INVALID_POLICY, first.status());
        assertEquals(PolicyResolution.Status.INVALID_POLICY, second.status());
        assertEquals(2, calls.get());
    }

    @Test
    void duplicateActionsFailClosedAsAmbiguous() {
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) ->
                List.of(action(method, url), action(method, url)));

        PolicyResolution result = registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);

        assertEquals(PolicyResolution.Status.INVALID_POLICY, result.status());
    }

    @Test
    void successfulEntriesExpireUsingTheInjectedClockAndTtl() {
        AtomicInteger calls = new AtomicInteger();
        MutableClock clock = new MutableClock(Instant.parse("2026-08-11T00:00:00Z"));
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) -> {
            calls.incrementAndGet();
            return List.of(action(method, url));
        }, clock, Duration.ofSeconds(30));

        registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);
        clock.advance(Duration.ofSeconds(29));
        registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);
        clock.advance(Duration.ofSeconds(1));
        registry.resolve(request("EMPLOYEE"), TENANT, "POST", URL);

        assertEquals(2, calls.get());
    }

    @Test
    void theCacheBoundPreventsUnboundedRoleAndActionCombinations() {
        AtomicInteger calls = new AtomicInteger();
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) -> {
            calls.incrementAndGet();
            return List.of(action(method, url));
        }, Clock.systemUTC(), Duration.ofMinutes(1), 1);
        RequestInfo principal = request("EMPLOYEE");

        registry.resolve(principal, TENANT, "POST", URL);
        registry.resolve(principal, TENANT, "POST", URL + "/second");
        registry.resolve(principal, TENANT, "POST", URL + "/second");

        assertEquals(3, calls.get());
    }

    @Test
    void theCacheBoundRemainsHardUnderConcurrentAdmission() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        CyclicBarrier simultaneousMisses = new CyclicBarrier(2);
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) -> {
            if (calls.incrementAndGet() <= 2)
                simultaneousMisses.await(5, TimeUnit.SECONDS);
            return List.of(action(method, url));
        }, Clock.systemUTC(), Duration.ofMinutes(1), 1);
        RequestInfo principal = request("EMPLOYEE");
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            var first = executor.submit(() -> registry.resolve(principal, TENANT, "POST", URL));
            var second = executor.submit(() ->
                    registry.resolve(principal, TENANT, "POST", URL + "/second"));
            first.get(5, TimeUnit.SECONDS);
            second.get(5, TimeUnit.SECONDS);
        } finally {
            executor.shutdownNow();
        }

        registry.resolve(principal, TENANT, "POST", URL);
        registry.resolve(principal, TENANT, "POST", URL + "/second");
        assertEquals(3, calls.get());
    }

    @Test
    void invalidLookupArgumentsAndTtlFailClosed() {
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roleCodes) ->
                List.of(action(method, url)));

        assertEquals(PolicyResolution.Status.INVALID_REQUEST,
                registry.resolve(request("EMPLOYEE"), null, "POST", URL).status());
        assertEquals(PolicyResolution.Status.INVALID_REQUEST,
                registry.resolve(request("EMPLOYEE"), TENANT, "", URL).status());
        assertEquals(PolicyResolution.Status.INVALID_REQUEST,
                registry.resolve(request("EMPLOYEE"), TENANT, "POST", "").status());
        assertEquals(PolicyResolution.Status.INVALID_REQUEST,
                registry.resolve(request(" EMPLOYEE"), TENANT, "POST", URL).status());
        assertEquals(PolicyResolution.Status.INVALID_REQUEST,
                registry.resolve(request("EMPLOYEE", ""), TENANT, "POST", URL).status());
        assertEquals(PolicyResolution.Status.INVALID_REQUEST,
                registry.resolve(request("EMPLOYEE"), " " + TENANT, "POST", URL).status());
        assertEquals(PolicyResolution.Status.INVALID_REQUEST,
                registry.resolve(request("EMPLOYEE"), TENANT, " POST", URL).status());
        assertThrows(IllegalArgumentException.class,
                () -> new AccessPolicyRegistry((tenant, method, url, roles) -> List.of(),
                        Clock.systemUTC(), Duration.ZERO));
        assertThrows(IllegalArgumentException.class,
                () -> new AccessPolicyRegistry((tenant, method, url, roles) -> List.of(),
                        Clock.systemUTC(), Duration.ofNanos(1)));
        assertThrows(IllegalArgumentException.class,
                () -> new AccessPolicyRegistry((tenant, method, url, roles) -> List.of(),
                        Clock.systemUTC(), Duration.ofSeconds(1), 0));
    }

    private static PolicyAction action(String method, String url) {
        return new PolicyAction(method, url, Map.of("condition", Map.of("==", List.of(1, 1))));
    }

    private static RequestInfo request(String... roleCodes) {
        User user = new User();
        List<Role> roles = new ArrayList<>();
        for (String roleCode : roleCodes)
            roles.add(Role.builder().code(roleCode).build());
        user.setRoles(roles);
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(user);
        return requestInfo;
    }

    private static final class MutableClock extends Clock {
        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        private void advance(Duration duration) {
            instant = instant.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
