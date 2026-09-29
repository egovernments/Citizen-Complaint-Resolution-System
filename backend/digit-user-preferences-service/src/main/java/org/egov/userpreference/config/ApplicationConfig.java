package org.egov.userpreference.config;

import jakarta.annotation.PostConstruct;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.TimeZone;

/**
 * Search paging and the notification-payload language allowlist.
 *
 * <p>The Go service hard-coded a page size of 10, a ceiling of 100 and the
 * four-locale language list; those are the defaults here, so behaviour is
 * unchanged unless an operator overrides them.
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

    /**
     * Locales accepted in a {@code USER_NOTIFICATION_PREFERENCES} payload.
     *
     * <p>Tenant-configurable because the citizen profile screen offers
     * whatever {@code StateInfo.languages} lists in MDMS, which is per-tenant
     * data: a deployment that adds a locale there would otherwise get
     * {@code INVALID_LANGUAGE} from a value its own MDMS advertises, and
     * because the validator collects and throws, the whole upsert (consent
     * changes included) would be rejected with it.
     *
     * <p>An empty value disables the check, for a tenant whose language set
     * is wider than it is worth enumerating here.
     */
    @Value("${user.preference.valid-languages}")
    private List<String> validLanguages;

    @Value("${app.timezone}")
    private String timeZone;

    @PostConstruct
    public void initialize() {
        TimeZone.setDefault(TimeZone.getTimeZone(timeZone));
    }

    /** The allowlist as a set, empty when the check is disabled. */
    public Set<String> getValidLanguageSet() {
        if (validLanguages == null) {
            return Set.of();
        }
        Set<String> languages = new LinkedHashSet<>();
        for (String language : validLanguages) {
            String trimmed = language == null ? "" : language.trim();
            if (!trimmed.isEmpty()) {
                languages.add(trimmed);
            }
        }
        return languages;
    }

    /**
     * The allowlist rendered for the {@code INVALID_LANGUAGE} message, derived
     * from the same value so the list and the message cannot drift apart.
     */
    public String getValidLanguagesMessage() {
        return String.join(", ", getValidLanguageSet());
    }
}
