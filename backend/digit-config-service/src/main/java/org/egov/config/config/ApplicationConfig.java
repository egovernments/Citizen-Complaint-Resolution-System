package org.egov.config.config;

import jakarta.annotation.PostConstruct;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

import java.util.TimeZone;

@Configuration
@ToString
@Setter
@Getter
public class ApplicationConfig {

    @Value("${config.default.offset}")
    private Integer defaultOffset;

    @Value("${config.default.limit}")
    private Integer defaultLimit;

    @Value("${app.timezone}")
    private String timeZone;

    @PostConstruct
    public void initialize() {
        TimeZone.setDefault(TimeZone.getTimeZone(timeZone));
    }

    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}
