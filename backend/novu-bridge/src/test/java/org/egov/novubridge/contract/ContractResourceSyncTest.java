package org.egov.novubridge.contract;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The contract exists twice on purpose — packaged in the jar so a running deployment can serve
 * it, published under {@code docs/} so a reader can find it — and two copies of anything drift.
 * This is the tripwire.
 *
 * <p>Every assertion here <b>skips</b> rather than fails when the docs tree is absent, because
 * the Docker test runner mounts only {@code backend/novu-bridge}: a build that cannot see the
 * published copy has nothing to compare and must not be red for it. In a full checkout, which
 * is where anyone edits either copy, the comparison runs.
 */
class ContractResourceSyncTest {

    @Test
    @DisplayName("the packaged schema and the published schema are byte-identical")
    void schemaCopiesAgree() {
        assertCopiesAgree("envelope-v1.schema.json", ContractResources.SCHEMA);
    }

    @Test
    @DisplayName("the packaged thin-event schema and the published thin-event schema are byte-identical")
    void thinEventSchemaCopiesAgree() {
        assertCopiesAgree("thin-event-v1.schema.json", ContractResources.THIN_SCHEMA);
    }

    @Test
    @DisplayName("the packaged OpenAPI and the published OpenAPI are byte-identical")
    void openApiCopiesAgree() {
        assertCopiesAgree("openapi.yaml", ContractResources.OPENAPI);
    }

    @Test
    @DisplayName("every published envelope example is packaged, byte for byte")
    void exampleCopiesAgree() {
        assertExampleCopiesAgree("examples/", ContractResources.EXAMPLES_DIR, ContractResources.exampleNames());
    }

    @Test
    @DisplayName("every published thin-event example is packaged, byte for byte")
    void thinExampleCopiesAgree() {
        assertExampleCopiesAgree("examples/thin/", ContractResources.THIN_EXAMPLES_DIR,
                ContractResources.thinExampleNames());
    }

    private static void assertExampleCopiesAgree(String publishedDir, String packagedDir, List<String> names) {
        Assumptions.assumeTrue(ContractResources.publishedContractPresent(), skipReason());
        for (String name : names) {
            String published = ContractResources.published(publishedDir + name);
            assertEquals(published, ContractResources.packaged(packagedDir + "/" + name),
                    publishedDir + name + " differs between docs/ and the jar — edit both");
        }
    }

    private static void assertCopiesAgree(String publishedName, String packagedResource) {
        String published = ContractResources.published(publishedName);
        Assumptions.assumeTrue(published != null, skipReason());
        assertEquals(published, ContractResources.packaged(packagedResource),
                publishedName + " differs between docs/2.12/notifications/contract/ and "
                        + "src/main/resources/contract/ — edit both, they are one contract");
    }

    private static String skipReason() {
        return "docs/2.12/notifications/contract is not in this build context "
                + "(the Docker test runner mounts only backend/novu-bridge)";
    }
}
