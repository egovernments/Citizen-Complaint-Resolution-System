package org.egov.userpreference.config;

import jakarta.annotation.PostConstruct;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

import java.util.TimeZone;

/**
 * Tunables for search paging.
 *
 * <p>The Go service hard-coded a page size of 10 and a ceiling of 100; those
 * are the defaults here, so behaviour is unchanged unless an operator
 * overrides them.
 */
@Configuration
@ToString
@Setter
@Getter
public class ApplicationConfig {

    @Value("${user.preference.search.default-offset}")
    private Integer defaultOffset;

    @Value("${user.preference.search.default-limit}")
    private Integer defaultLimit;

    @Value("${user.preference.search.max-limit}")
    private Integer maxLimit;

    @Value("${app.timezone}")
    private String timeZone;

    @PostConstruct
    public void initialize() {
        TimeZone.setDefault(TimeZone.getTimeZone(timeZone));
    }
}
