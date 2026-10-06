package org.egov.pgr.onboarding;

import org.junit.Test;
import static org.junit.Assert.*;

public class WorkspaceNameNormalizationTest {
    @Test public void signupAndRenameShareIdempotentUnicodeKeys() {
        var normalizer=new OnboardingIdentifierService();
        String[][] vectors={{"  EXAMPLE\t Council\r\n","example council"},{"\ufeffCafe\u0301\u00a0Council\ufeff","café council"},
                {"J\u030c","ǰ"},{"Υ\u0308\u0301","ΰ"},{"İZMİR","i\u0307zmi\u0307r"}};
        for(String[] vector:vectors) {
            String key=normalizer.normalizeOrganizationName(vector[0]);assertEquals(vector[1],key);
            assertEquals(key,normalizer.normalizeOrganizationName(key));
            assertEquals(key,normalizer.forInput("ORGANIZATION_NAME",vector[0]).get(0).value());
            var signup=OnboardingSignup.builder().accountName(vector[0]).accountCode("EXAMPLE").requestedTenantId("example")
                    .organizationAlias("example").urlSlug("example").build();
            assertEquals(key,normalizer.forSignup(signup).get(0).value());
        }
    }
}
