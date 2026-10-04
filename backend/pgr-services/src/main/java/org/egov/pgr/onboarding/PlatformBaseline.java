package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import java.io.IOException;

@Component
public class PlatformBaseline {
    private final JsonNode seed;
    public PlatformBaseline(ObjectMapper mapper) throws IOException {
        try (var input = new ClassPathResource("onboarding/platform-baseline-v1.json").getInputStream()) {
            seed = mapper.readTree(input);
        }
        if (!"1".equals(seed.path("version").asText())) throw new IOException("Unsupported platform seed");
    }
    public String version() { return seed.path("version").asText(); }
    public JsonNode schemas() { return seed.path("schemas"); }
    public JsonNode records() { return seed.path("records"); }
    public JsonNode founderRoles() { return seed.path("founderRoles"); }
}
