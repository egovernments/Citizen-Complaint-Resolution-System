package org.egov.config.utils;

import java.util.ArrayList;
import java.util.List;

public class FallbackUtil {

    private FallbackUtil() {}

    public static List<String> buildTenantChain(String tenantId) {
        List<String> chain = new ArrayList<>();
        if (tenantId != null) {
            chain.add(tenantId);
            String t = tenantId;
            while (t.contains(".")) {
                t = t.substring(0, t.lastIndexOf('.'));
                chain.add(t);
            }
        }
        chain.add("*");
        return chain;
    }
}
