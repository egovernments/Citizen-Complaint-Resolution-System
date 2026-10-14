package org.egov.novubridge.config;

import org.egov.novubridge.service.account.TenantAccountService;
import org.egov.novubridge.web.filters.InternalAuthFilter;
import org.egov.novubridge.web.filters.ProxyAuthFilter;
import org.egov.novubridge.web.filters.RequestFirewallFilter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

@Configuration
public class MainConfiguration {

    @Bean
    public RestTemplate restTemplate(
            @Value("${novu.bridge.http.connect.timeout.ms:5000}") int connectTimeoutMs,
            @Value("${novu.bridge.http.read.timeout.ms:10000}") int readTimeoutMs) {
        SimpleClientHttpRequestFactory f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(connectTimeoutMs);
        f.setReadTimeout(readTimeoutMs);
        return new RestTemplate(f);
    }

    /**
     * The first filter of every request: refuses a path that is not plain (a {@code ;} parameter,
     * an encoded slash, period or percent, a dot segment, {@code //}) with 400, so the container,
     * Spring MVC and the auth filters below can never read one request as three different paths.
     */
    @Bean
    public FilterRegistrationBean<RequestFirewallFilter> requestFirewallFilter() {
        FilterRegistrationBean<RequestFirewallFilter> registration =
                new FilterRegistrationBean<>(new RequestFirewallFilter());
        registration.addUrlPatterns("/*");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return registration;
    }

    /**
     * Auth-gate the configurator endpoints. Registered for every path: the filter itself decides,
     * on the canonical path ({@link org.egov.novubridge.web.filters.RequestPaths}), which requests
     * it authenticates, so no container-specific URL-pattern matching can route around it.
     */
    @Bean
    public FilterRegistrationBean<ProxyAuthFilter> proxyAuthFilter(
            RestTemplate restTemplate, org.egov.novubridge.config.NovuBridgeConfiguration config,
            TenantAccountService tenantAccounts) {
        FilterRegistrationBean<ProxyAuthFilter> registration =
                new FilterRegistrationBean<>(new ProxyAuthFilter(restTemplate, config, tenantAccounts));
        registration.addUrlPatterns("/*");
        registration.setOrder(1);
        return registration;
    }

    /**
     * The machine APIs of #2203 ({@code /tenants/**}, {@code /messages/**}): internal tokens only,
     * never a DIGIT user token. ProxyAuthFilter does not cover these paths. Registered for every
     * path, like the one above: the filter decides on the canonical path.
     */
    @Bean
    public FilterRegistrationBean<InternalAuthFilter> internalAuthFilter(TenantAccountsConfiguration accounts) {
        FilterRegistrationBean<InternalAuthFilter> registration =
                new FilterRegistrationBean<>(new InternalAuthFilter(accounts));
        registration.addUrlPatterns("/*");
        registration.setOrder(0);
        return registration;
    }
}
