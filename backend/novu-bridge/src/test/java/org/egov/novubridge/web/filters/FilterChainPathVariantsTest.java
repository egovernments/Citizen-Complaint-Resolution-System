package org.egov.novubridge.web.filters;

import org.springframework.boot.test.context.SpringBootTest;

/** {@link FilterChainPathVariantsTestBase} with the filters exactly as deployed. */
@SpringBootTest(classes = FilterChainPathVariantsTestBase.WebLayer.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "server.servlet.context-path=/novu-bridge",
                "novu.bridge.tenant.accounts.enabled=true",
                "novu.bridge.internal.admin.token=" + FilterChainPathVariantsTestBase.ADMIN,
                "novu.bridge.internal.send.token=" + FilterChainPathVariantsTestBase.SEND,
                "novu.bridge.proxy.auth.enabled=true",
                "novu.bridge.core.sms.default.tenant=pg",
                "novu.bridge.proxy.allowed.roles=EMPLOYEE,GRO",
                "novu.bridge.proxy.admin.roles=SUPERUSER,MDMS_ADMIN,ACCOUNT_ADMIN",
        })
class FilterChainPathVariantsTest extends FilterChainPathVariantsTestBase {

    @Override
    boolean firewall() {
        return true;
    }
}
