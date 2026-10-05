package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;
import java.io.IOException;
import java.util.*;

@Component
public class PlatformBaseline {
    private static final String PACKS = "classpath*:onboarding/l10n/*/*.json";
    private final JsonNode seed;
    /** locale -> module -> messages; tenant-neutral packs from onboarding/l10n/&lt;locale&gt;/&lt;module&gt;.json. */
    private final Map<String, SortedMap<String, JsonNode>> packs = new HashMap<>();
    private final Set<List<String>> packMessages = new HashSet<>();
    public PlatformBaseline(ObjectMapper mapper) throws IOException {
        try (var input = new ClassPathResource("onboarding/platform-baseline-v1.json").getInputStream()) {
            seed = mapper.readTree(input);
        }
        // The seed version is recorded per workspace as seed_version. Bump it with every content change; records are
        // create-if-absent, so a workspace onboarded on an older version keeps that content until it is upgraded.
        if (!"2".equals(seed.path("version").asText())) throw new IOException("Unsupported platform seed");
        for (Resource pack : new PathMatchingResourcePatternResolver().getResources(PACKS)) {
            String[] path = pack.getURL().getPath().split("/");
            String locale = path[path.length - 2], module = path[path.length - 1].replaceFirst("\\.json$", "");
            JsonNode messages;
            try (var input = pack.getInputStream()) { messages = mapper.readTree(input); }
            if (!messages.isArray() || messages.isEmpty()) throw new IOException("Invalid localization pack " + locale + "/" + module);
            for (JsonNode m : messages) {
                if (!locale.equals(m.path("locale").asText()) || !module.equals(m.path("module").asText())
                        || !m.path("code").isTextual() || !m.path("message").isTextual() || m.size() != 4)
                    throw new IOException("Invalid localization message in " + locale + "/" + module);
                packMessages.add(List.of(locale, module, m.path("code").asText(), m.path("message").asText()));
            }
            packs.computeIfAbsent(locale, k -> new TreeMap<>()).put(module, messages);
        }
        if (!packs.containsKey("en_IN")) throw new IOException("Missing en_IN localization packs");
    }
    public String version() { return seed.path("version").asText(); }
    public JsonNode schemas() { return seed.path("schemas"); }
    public JsonNode records() { return seed.path("records"); }
    public JsonNode workflows() { return seed.path("workflow"); }
    public JsonNode founderRoles() { return seed.path("founderRoles"); }
    public JsonNode countryMobileRule(String country) {
        return seed.path("countryMobileRules").path(country.toUpperCase(java.util.Locale.ROOT)).deepCopy();
    }
    /** ISO 3166-1 alpha-2 codes that have a country mobile rule in the seed. */
    public Set<String> supportedCountries() {
        Set<String> countries = new TreeSet<>();
        seed.path("countryMobileRules").fieldNames().forEachRemaining(code -> countries.add(code.toUpperCase(java.util.Locale.ROOT)));
        return Collections.unmodifiableSet(countries);
    }
    public SortedMap<String, JsonNode> localizationPacks(String locale) { return packs.getOrDefault(locale, new TreeMap<>()); }
    /** Locales with at least one committed pack, sorted. */
    public SortedSet<String> localeCodes() { return new TreeSet<>(packs.keySet()); }
    public boolean isPackMessage(JsonNode m) {
        return packMessages.contains(List.of(m.path("locale").asText(), m.path("module").asText(), m.path("code").asText(), m.path("message").asText()));
    }
}
