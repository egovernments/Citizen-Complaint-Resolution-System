package org.egov.novubridge.contract;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * Where the contract lives, for the tests that keep it honest.
 *
 * <p>Two copies exist on purpose. The <b>packaged</b> one under {@code src/main/resources/contract/}
 * ships inside the jar and is served by {@code ContractController}; it is the copy the build
 * always has, because the Docker test runner mounts only {@code backend/novu-bridge}. The
 * <b>published</b> one under {@code docs/2.12/notifications/contract/} is what a reader finds in
 * the repository. Tests assert against the packaged copy and, only when the published copy is
 * reachable from the working directory, additionally assert the two are identical.
 */
final class ContractResources {

    static final String SCHEMA = "contract/envelope-v1.schema.json";
    static final String OPENAPI = "contract/openapi.yaml";
    static final String ERROR_CODES = "contract/error-codes.txt";
    static final String EXAMPLES_DIR = "contract/examples";

    /** Relative to the module root, which is the working directory when Maven runs the tests. */
    private static final Path PACKAGED_ROOT = Paths.get("src", "main", "resources", "contract");
    private static final Path MAIN_SOURCES = Paths.get("src", "main", "java");
    private static final Path PUBLISHED_ROOT =
            Paths.get("..", "..", "docs", "2.12", "notifications", "contract");

    private ContractResources() {
    }

    /** A packaged document, read from the test classpath. Fails loudly: it must always be there. */
    static String packaged(String classpathResource) {
        try (InputStream in = ContractResources.class.getClassLoader().getResourceAsStream(classpathResource)) {
            if (in == null) {
                throw new IllegalStateException(classpathResource
                        + " is not on the classpath — the contract must ship inside the jar");
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** The five example payloads, by file name, read from the packaged copy. */
    static List<String> exampleNames() {
        Path dir = PACKAGED_ROOT.resolve("examples");
        if (!Files.isDirectory(dir)) {
            throw new IllegalStateException(dir.toAbsolutePath() + " is missing");
        }
        try (var paths = Files.list(dir)) {
            List<String> names = new ArrayList<>();
            paths.filter(p -> p.getFileName().toString().endsWith(".json"))
                    .forEach(p -> names.add(p.getFileName().toString()));
            names.sort(String::compareTo);
            return names;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** The published copy of a contract file, or {@code null} when docs/ is not in this build context. */
    static String published(String fileName) {
        Path path = PUBLISHED_ROOT.resolve(fileName);
        if (!Files.isRegularFile(path)) {
            return null;
        }
        try {
            return Files.readString(path, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static boolean publishedContractPresent() {
        return Files.isDirectory(PUBLISHED_ROOT);
    }

    /** Every {@code .java} file under {@code src/main/java}. */
    static List<Path> mainSources() {
        if (!Files.isDirectory(MAIN_SOURCES)) {
            throw new IllegalStateException(MAIN_SOURCES.toAbsolutePath() + " is missing");
        }
        try (var paths = Files.walk(MAIN_SOURCES)) {
            List<Path> files = new ArrayList<>();
            paths.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".java"))
                    .forEach(files::add);
            return files;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static String read(Path path) {
        try {
            return Files.readString(path, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
