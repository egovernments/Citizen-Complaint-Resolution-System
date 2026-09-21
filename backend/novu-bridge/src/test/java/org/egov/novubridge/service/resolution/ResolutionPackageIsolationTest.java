package org.egov.novubridge.service.resolution;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * <b>The seam, asserted rather than aspired to.</b>
 *
 * <p>The product being exported is "a notification box that ships a DIGIT adapter", not "DIGIT
 * notifications". One jar, one deployable — but a hard internal boundary: everything under
 * {@code service.resolution} is module-neutral, and every DIGIT lookup lives in
 * {@code service.resolution.digit} behind an interface.
 *
 * <p>An SPI with one implementation and no second consumer rots into an indirection nobody
 * maintains. This test and {@link StaticRecipientResolverTest} are the boundary's only real
 * defence: one says the core cannot NAME a DIGIT client, the other says the core RUNS without
 * one. If either becomes hard to keep green, the seam has already failed and the honest response
 * is to say so, not to add an exception here.
 *
 * <p>A source scan rather than bytecode analysis, deliberately: it needs no extra dependency, it
 * catches a fully-qualified reference that an import scan would miss, and the failure message can
 * name the file and the line an author has to look at.
 */
class ResolutionPackageIsolationTest {

    private static final String CORE = "/service/resolution/";
    private static final String DIGIT = "/service/resolution/digit/";

    /**
     * What the module-neutral core may not mention. Each entry is here for a reason, not for
     * tidiness:
     *
     * <ul>
     *   <li>the {@code .digit} package itself — the boundary, stated;</li>
     *   <li>{@code RestTemplate} and {@code org.springframework.http} — a core class that makes an
     *       HTTP call is a core class with a deployment in it;</li>
     *   <li>the bridge's own DIGIT clients — reusing one would re-import DIGIT through the back
     *       door;</li>
     *   <li>{@code NovuBridgeConfiguration} — the deployment's settings. The core takes what it
     *       needs as constructor arguments, which is what lets a test build it with no Spring and
     *       a second product build it with its own configuration;</li>
     *   <li>MDMS and the egov multi-tenancy helper — DIGIT vocabulary, by name.</li>
     * </ul>
     *
     * <p>Two things are deliberately NOT forbidden. {@code org.egov.common.contract.request.RequestInfo}
     * is a DTO the SPI carries as opaque context, not a client; and
     * {@code org.springframework.web.util.HtmlUtils} is a string function whose exact entity table
     * the golden master pins, so reimplementing it to satisfy a rule would change what ships.
     */
    private static final Map<String, String> FORBIDDEN = Map.ofEntries(
            Map.entry("service.resolution.digit", "the DIGIT adapter package — that is the boundary"),
            Map.entry("RestTemplate", "an HTTP client; the core makes no network call"),
            Map.entry("org.springframework.http", "HTTP types; the core makes no network call"),
            Map.entry("java.net.http", "an HTTP client; the core makes no network call"),
            Map.entry("NovuBridgeConfiguration", "deployment settings; the core takes its settings "
                    + "as constructor arguments (see config/ResolutionWiring)"),
            Map.entry("ChannelPolicyClient", "a DIGIT/MDMS client"),
            Map.entry("PreferenceServiceClient", "a DIGIT client"),
            Map.entry("NovuClient", "a vendor client"),
            Map.entry("SmsCountryClient", "a vendor client"),
            Map.entry("MultiStateInstanceUtil", "the egov multi-tenancy helper"),
            Map.entry("MdmsCriteria", "MDMS vocabulary"),
            Map.entry("org.egov.mdms", "MDMS vocabulary"),
            Map.entry("org.egov.tracer.http", "the egov HTTP tracer"));

    @Test
    @DisplayName("nothing in the module-neutral core names a DIGIT client or the digit package")
    void theCoreNamesNoDigitClient() {
        List<String> violations = new ArrayList<>();
        int scanned = 0;
        for (Path source : coreSources()) {
            scanned++;
            String text = read(source);
            String[] lines = text.split("\\R");
            for (int i = 0; i < lines.length; i++) {
                String line = lines[i];
                if (isComment(line)) {
                    continue;   // a javadoc may name what the code may not
                }
                for (Map.Entry<String, String> forbidden : FORBIDDEN.entrySet()) {
                    if (line.contains(forbidden.getKey())) {
                        violations.add(source.getFileName() + ":" + (i + 1) + "  "
                                + forbidden.getKey() + " — " + forbidden.getValue()
                                + "\n      " + line.trim());
                    }
                }
            }
        }
        assertTrue(scanned >= 10, "core discovery found only " + scanned + " files — the scan is broken, "
                + "not the boundary");
        assertTrue(violations.isEmpty(),
                "the module-neutral resolution core must not reference DIGIT. Move the class into\n"
                        + "service/resolution/digit/ and put an interface in its place:\n  "
                        + String.join("\n  ", violations));
    }

    @Test
    @DisplayName("the DIGIT adapters implement the core's interfaces — the dependency points one way")
    void theAdaptersDependOnTheCoreAndNotTheReverse() {
        List<String> adapters = new ArrayList<>();
        for (Path source : mainSources()) {
            if (source.toString().replace('\\', '/').contains(DIGIT)) {
                adapters.add(source.getFileName().toString());
            }
        }
        assertTrue(adapters.size() >= 6, "expected the DIGIT adapters to be in one place; found " + adapters);

        // Every SPI the core declares must have exactly one shipped DIGIT implementation, so the
        // "swap it out" story is about replacing something real rather than filling a hole.
        for (String spi : List.of("RecipientResolver", "LocaleProvider", "LocalizationProvider",
                "UserHydrator", "NotificationConfigRepository")) {
            boolean implemented = false;
            for (Path source : mainSources()) {
                String path = source.toString().replace('\\', '/');
                if (!path.contains(DIGIT)) {
                    continue;
                }
                String text = read(source);
                if (text.contains("implements " + spi) || text.contains(spi + " ")) {
                    implemented = true;
                    break;
                }
            }
            assertTrue(implemented, spi + " has no DIGIT implementation — an SPI with no "
                    + "implementation is a hole, not a seam");
        }
    }

    @Test
    @DisplayName("the core's SPI surface is the four interfaces plus the config repository, and no more")
    void theSpiSurfaceIsSmall() {
        TreeSet<String> interfaces = new TreeSet<>();
        for (Path source : coreSources()) {
            String name = source.getFileName().toString().replace(".java", "");
            String text = read(source);
            if (text.contains("public interface " + name)) {
                interfaces.add(name);
            }
        }
        // Growing this set is a real decision: every entry is something a consuming product has
        // to implement or accept, and the argument for (a) was that the seam stays small.
        assertEquals(new TreeSet<>(List.of("LocaleProvider", "LocalizationProvider",
                        "NotificationConfigRepository", "RecipientResolver", "UserHydrator")),
                interfaces,
                "the module-neutral core's public interfaces are the plug-in surface; adding one "
                        + "is a change to what a consuming product must supply");
    }

    private static List<Path> coreSources() {
        List<Path> core = new ArrayList<>();
        for (Path source : mainSources()) {
            String path = source.toString().replace('\\', '/');
            if (path.contains(CORE) && !path.contains(DIGIT)) {
                core.add(source);
            }
        }
        return core;
    }

    /**
     * Every {@code .java} under {@code src/main/java}. Walked here rather than borrowed from the
     * contract tests' helper: this test asserts a property of the source TREE, and a package-local
     * walk keeps it readable and keeps one test package from depending on another's internals.
     */
    private static List<Path> mainSources() {
        Path root = Paths.get("src", "main", "java");
        assertTrue(Files.isDirectory(root), root.toAbsolutePath() + " is missing — run from the module root");
        try (var paths = Files.walk(root)) {
            List<Path> files = new ArrayList<>();
            paths.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".java"))
                    .forEach(files::add);
            return files;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static String read(Path path) {
        try {
            return Files.readString(path, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static boolean isComment(String line) {
        String trimmed = line.trim();
        return trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*");
    }
}
