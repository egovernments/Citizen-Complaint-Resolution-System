package org.egov.novubridge.config;

import org.egov.novubridge.web.filters.ProxyAuthFilter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
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
     * Auth-gate the read-only configurator proxy GETs. The servlet context path
     * (/novu-bridge) is NOT part of the pattern — patterns are matched within the
     * context. The POST diagnostics under the same namespace are gated too (and are
     * additionally not routed publicly by Kong).
     */
    @Bean
    public FilterRegistrationBean<ProxyAuthFilter> proxyAuthFilter(
            RestTemplate restTemplate, org.egov.novubridge.config.NovuBridgeConfiguration config) {
        FilterRegistrationBean<ProxyAuthFilter> registration =
                new FilterRegistrationBean<>(new ProxyAuthFilter(restTemplate, config));
        registration.addUrlPatterns("/novu-adapter/v1/*");
        registration.setOrder(1);
        return registration;
    }
}
