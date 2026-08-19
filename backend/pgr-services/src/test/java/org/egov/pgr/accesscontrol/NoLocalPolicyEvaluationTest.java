package org.egov.pgr.accesscontrol;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The architectural rule of #1050, asserted against the source itself: pgr-services is a Policy
 * ENFORCEMENT point and nothing else.
 *
 * <p>A rule like this is worth a test because it does not fail loudly when it is broken. Adding one
 * role check back into a controller compiles, passes every other test, and quietly recreates the
 * split-brain this cutover removed — two services deciding the same question and drifting apart.
 * The evidence of the break is in the source, so that is where it is checked.
 */
class NoLocalPolicyEvaluationTest {

    private static final Path MAIN = Paths.get("src/main/java/org/egov/pgr");

    /** Role codes that used to gate the dashboard and search in this service's own code. */
    private static final List<String> DASHBOARD_ROLE_CODES = List.of(
            "\"PGR_SUPERVISOR\"", "\"PGR_ADMIN\"", "\"TICKET_REPORT_VIEWER\"", "\"PGR_VIEWER\"",
            "\"MDMS_ADMIN\"", "\"LOC_ADMIN\"", "\"DGRO\"", "\"PGR_LME\"");

    @Test
    void theLocalPolicyEvaluatorIsGoneEntirely() throws IOException {
        assertThat(Files.exists(MAIN.resolve("policy"))).isFalse();
        assertThat(Files.exists(MAIN.resolve("analytics/PrincipalScopeResolver.java"))).isFalse();
        assertThat(sourcesMentioning("org.egov.pgr.policy")).isEmpty();
    }

    @Test
    void noSourceCarriesADashboardRoleAllowList() throws IOException {
        // Which roles reach the dashboard is answered by the role→action master through
        // egov-accesscontrol. A role code appearing in this service's own code means some part of
        // that answer has been copied back here, where it can disagree with the original.
        List<String> offenders = new ArrayList<>();
        for (String roleCode : DASHBOARD_ROLE_CODES)
            offenders.addAll(sourcesMentioning(roleCode));

        assertThat(offenders).isEmpty();
    }

    @Test
    void noSourceEvaluatesPolicyItself() throws IOException {
        // JsonLogic evaluation, action-document fetches and scope synthesis all belong to the PDP.
        // Prose about not doing those things is fine; importing an engine or naming the master is
        // not — those are how it would actually be done.
        assertThat(sourcesMentioning("import io.github.jamsesso")).isEmpty();
        assertThat(sourcesMentioning("com.jayway.jsonpath.JsonPath.read(policy")).isEmpty();
        assertThat(sourcesMentioning("actions-test")).isEmpty();
        assertThat(sourcesMentioning("actions/mdms/_get")).isEmpty();
    }

    @Test
    void theServiceDoesNotEvenDependOnAJsonLogicEngine() throws IOException {
        String pom = Files.readString(Paths.get("pom.xml"), StandardCharsets.UTF_8);
        assertThat(pom).doesNotContain("json-logic");
    }

    private static List<String> sourcesMentioning(String needle) throws IOException {
        if (!Files.isDirectory(MAIN))
            throw new IllegalStateException("expected to run from the pgr-services module directory");
        List<String> hits = new ArrayList<>();
        try (Stream<Path> files = Files.walk(MAIN)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                String source = Files.readString(file, StandardCharsets.UTF_8);
                if (source.toLowerCase(Locale.ROOT).contains(needle.toLowerCase(Locale.ROOT)))
                    hits.add(MAIN.relativize(file).toString() + " mentions " + needle);
            }
        }
        return hits;
    }
}
