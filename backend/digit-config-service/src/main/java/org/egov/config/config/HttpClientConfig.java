package org.egov.config.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

/**
 * HTTP Client Configuration for RestTemplate with proper timeout settings.
 * This ensures that the enc-client library uses a properly configured HTTP client.
 */
@Configuration
@Slf4j
public class HttpClientConfig {

    @Value("${http.client.connection.timeout:30000}")
    private int connectionTimeout;

    @Value("${http.client.read.timeout:60000}")
    private int readTimeout;

    /**
     * Configure RestTemplate with proper timeout settings.
     * This bean will be used by enc-client library internally.
     */
    @Bean
    @Primary
    public RestTemplate restTemplate() {
        RestTemplate restTemplate = new RestTemplate(clientHttpRequestFactory());
        
        log.info("RestTemplate configured with connectionTimeout={} ms, readTimeout={} ms", 
                connectionTimeout, readTimeout);
        
        return restTemplate;
    }

    /**
     * Configure HTTP request factory with timeout settings.
     */
    @Bean
    public ClientHttpRequestFactory clientHttpRequestFactory() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        
        // Connection timeout: Time to establish connection
        factory.setConnectTimeout(connectionTimeout);
        
        // Read timeout: Time to wait for response after connection is established
        factory.setReadTimeout(readTimeout);
        
        return factory;
    }
}