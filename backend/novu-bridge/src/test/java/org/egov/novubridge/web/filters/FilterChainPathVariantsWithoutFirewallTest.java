package org.egov.novubridge.web.filters;

import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * {@link FilterChainPathVariantsTestBase} with {@link RequestFirewallFilter} switched off: the auth
 * filters must refuse every variant on their own (the firewall is defence in depth, not the fix).
 */
@SpringBootTest(classes = {FilterChainPathVariantsTestBase.WebLayer.class,
        FilterChainPathVariantsWithoutFirewallTest.NoFirewall.class},
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
class FilterChainPathVariantsWithoutFirewallTest extends FilterChainPathVariantsTestBase {

    @Configuration
    static class NoFirewall {
        @Bean
        static BeanPostProcessor disableTheFirewall() {
            return new BeanPostProcessor() {
                @Override
                public Object postProcessAfterInitialization(Object bean, String beanName) {
                    if (bean instanceof FilterRegistrationBean<?> registration
                            && registration.getFilter() instanceof RequestFirewallFilter) {
                        registration.setEnabled(false);
                    }
                    return bean;
                }
            };
        }
    }

    @Override
    boolean firewall() {
        return false;
    }
}
