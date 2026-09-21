package org.egov.novubridge.contract;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assumptions;

import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * An undocumented error code is an error code an operator cannot act on. This scans the main
 * source tree for {@code NB_*} literals and fails the build if one is not in the catalogue.
 *
 * <p>The catalogue has two copies. {@code src/main/resources/contract/error-codes.txt} is the
 * machine-readable one and ships in the jar; {@code docs/2.12/notifications/contract/error-codes.md}
 * is what a human reads. The scan asserts against the packaged copy, because the Docker test
 * runner mounts only {@code backend/novu-bridge} and the docs tree may not exist in the build
 * context at all. When it DOES exist, a second assertion checks the two agree — so the page
 * cannot fall behind the list, and the list cannot fall behind the code.
 */
class ErrorCodeCatalogTest {

    /**
     * A whole code, never a prefix. The word boundaries are what make {@code NB_PROVIDER_}
     * (ReceiptController builds {@code "NB_PROVIDER_" + status}) and {@code NB_NOVU_*} (a
     * DeliveryResult javadoc naming a family) match NOTHING rather than match a truncation:
     * a run of word characters that ends in {@code _} cannot satisfy both the trailing
     * {@code [A-Z0-9]} and the closing boundary. A bare prefix is not something an operator
     * ever sees; the concrete codes those two build are catalogued explicitly instead.
     */
    private static final Pattern CODE = Pattern.compile("\\bNB_[A-Z0-9_]*[A-Z0-9]\\b");

    @Test
    @DisplayName("every NB_* code in the main source is in the packaged catalogue")
    void everyEmittedCodeIsCatalogued() {
        Set<String> catalogued = packagedCodes();
        Set<String> undocumented = new TreeSet<>();
        for (Path source : ContractResources.mainSources()) {
            Matcher matcher = CODE.matcher(ContractResources.read(source));
            while (matcher.find()) {
                if (!catalogued.contains(matcher.group())) {
                    undocumented.add(matcher.group() + "  (" + source + ")");
                }
            }
        }
        assertTrue(undocumented.isEmpty(),
                "these NB_* codes are emitted but not in contract/error-codes.txt "
                        + "(and therefore not in error-codes.md):\n  " + String.join("\n  ", undocumented));
    }

    @Test
    @DisplayName("the catalogue lists no code that cannot be emitted")
    void catalogueListsNothingImaginary() {
        // The scan cannot see a dynamically built code, so those are the one allowed exception
        // and are named here rather than waved through by a loose regex.
        Set<String> builtByConcatenation = Set.of("NB_PROVIDER_FAILED", "NB_PROVIDER_BOUNCED");

        StringBuilder sources = new StringBuilder();
        ContractResources.mainSources().forEach(p -> sources.append(ContractResources.read(p)));
        String allSource = sources.toString();

        Set<String> stale = new TreeSet<>();
        for (String code : packagedCodes()) {
            if (!builtByConcatenation.contains(code) && !allSource.contains(code)) {
                stale.add(code);
            }
        }
        assertTrue(stale.isEmpty(),
                "contract/error-codes.txt documents codes no longer emitted anywhere: " + stale);
    }

    @Test
    @DisplayName("the packaged list and the published page name exactly the same codes")
    void packagedListAndPublishedPageAgree() {
        String markdown = ContractResources.published("error-codes.md");
        Assumptions.assumeTrue(markdown != null,
                "docs/2.12/notifications/contract is not in this build context — packaged copy only");

        // A code is documented when it heads a table row: | `NB_…` | meaning | … |
        Set<String> documented = new TreeSet<>();
        Matcher row = Pattern.compile("(?m)^\\|\\s*`(NB_[A-Z0-9_]+)`\\s*\\|").matcher(markdown);
        while (row.find()) {
            documented.add(row.group(1));
        }
        assertEquals(new TreeSet<>(packagedCodes()), documented,
                "error-codes.md and contract/error-codes.txt disagree — edit both");
    }

    private static Set<String> packagedCodes() {
        Set<String> codes = new LinkedHashSet<>();
        for (String line : ContractResources.packaged(ContractResources.ERROR_CODES).split("\\R")) {
            String trimmed = line.trim();
            if (!trimmed.isEmpty() && !trimmed.startsWith("#")) {
                codes.add(trimmed);
            }
        }
        assertTrue(codes.size() > 20, "the packaged catalogue looks empty: " + codes.size() + " codes");
        return codes;
    }
}
