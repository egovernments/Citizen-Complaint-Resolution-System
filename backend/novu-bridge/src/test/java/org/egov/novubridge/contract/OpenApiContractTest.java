package org.egov.novubridge.contract;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.yaml.snakeyaml.Yaml;

import java.lang.reflect.Method;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code contract/openapi.yaml} claims to describe every HTTP endpoint the bridge exposes,
 * "as implemented". This is what makes that claim checkable: the controllers' own mapping
 * annotations are read by reflection and compared with the spec's paths, as a SET EQUALITY —
 * so a new endpoint that nobody documented and a documented endpoint that no longer exists are
 * both build failures.
 *
 * <p>The controller classes are discovered from the source tree rather than listed here,
 * because a list is exactly the thing that would go stale.
 *
 * <p>The spec's paths carry the {@code /novu-bridge} servlet context prefix (that is what a
 * caller dials, through Kong or in-cluster); the annotations do not, because Spring matches
 * within the context. The prefix is added here, once, rather than being left out of the spec
 * where it would mislead every reader.
 */
class OpenApiContractTest {

    private static final String CONTEXT = "/novu-bridge";
    private static final String CONTROLLER_PACKAGE = "org.egov.novubridge.web.controllers";

    @Test
    @DisplayName("the spec's paths and the controllers' mappings are the same set")
    void specMatchesTheControllers() {
        assertEquals(controllerOperations(), specOperations(),
                "contract/openapi.yaml and the controllers disagree. Left = what the code exposes, "
                        + "right = what the contract publishes.");
    }

    @Test
    @DisplayName("the spec is a loadable OpenAPI 3 document with responses on every operation")
    void specIsStructurallySound() {
        Map<String, Object> spec = loadSpec();
        assertTrue(String.valueOf(spec.get("openapi")).startsWith("3."),
                "not an OpenAPI 3 document: " + spec.get("openapi"));
        assertTrue(spec.containsKey("info") && spec.containsKey("paths") && spec.containsKey("components"),
                "the spec must carry info, paths and components");

        @SuppressWarnings("unchecked")
        Map<String, Object> paths = (Map<String, Object>) spec.get("paths");
        for (Map.Entry<String, Object> path : paths.entrySet()) {
            @SuppressWarnings("unchecked")
            Map<String, Object> item = (Map<String, Object>) path.getValue();
            for (Map.Entry<String, Object> operation : item.entrySet()) {
                if (!isVerb(operation.getKey())) {
                    continue;   // `parameters`, shared across the path item
                }
                @SuppressWarnings("unchecked")
                Map<String, Object> body = (Map<String, Object>) operation.getValue();
                assertTrue(body.containsKey("summary"),
                        path.getKey() + " " + operation.getKey() + " has no summary");
                assertTrue(body.containsKey("responses"),
                        path.getKey() + " " + operation.getKey() + " documents no responses");
                assertTrue(((Map<?, ?>) body.get("responses")).containsKey("200"),
                        path.getKey() + " " + operation.getKey() + " documents no success response");
            }
        }
    }

    // ---- what the code exposes --------------------------------------------

    private static Set<String> controllerOperations() {
        Set<String> operations = new TreeSet<>();
        for (Class<?> controller : controllerClasses()) {
            RequestMapping base = controller.getAnnotation(RequestMapping.class);
            if (base == null) {
                continue;   // a helper class in the same package, not an endpoint
            }
            String basePath = first(base.value());
            for (Method method : controller.getDeclaredMethods()) {
                for (String operation : operationsOf(method, basePath)) {
                    operations.add(operation);
                }
            }
        }
        assertTrue(operations.size() >= 15, "found only " + operations.size() + " mappings — "
                + "controller discovery is broken, not the contract");
        return operations;
    }

    private static Set<String> operationsOf(Method method, String basePath) {
        Set<String> operations = new LinkedHashSet<>();
        GetMapping get = method.getAnnotation(GetMapping.class);
        if (get != null) {
            operations.add(entry("get", basePath, first(get.value())));
        }
        PostMapping post = method.getAnnotation(PostMapping.class);
        if (post != null) {
            operations.add(entry("post", basePath, first(post.value())));
        }
        RequestMapping generic = method.getAnnotation(RequestMapping.class);
        if (generic != null) {
            String suffix = first(generic.value());
            RequestMethod[] verbs = generic.method();
            if (verbs.length == 0) {
                throw new IllegalStateException(method + " maps every verb; the contract cannot express that");
            }
            for (RequestMethod verb : verbs) {
                operations.add(entry(verb.name().toLowerCase(), basePath, suffix));
            }
        }
        return operations;
    }

    private static String entry(String verb, String basePath, String suffix) {
        return verb + " " + CONTEXT + basePath + suffix;
    }

    private static List<Class<?>> controllerClasses() {
        List<Class<?>> classes = new java.util.ArrayList<>();
        for (Path source : ContractResources.mainSources()) {
            String file = source.getFileName().toString();
            if (!source.toString().replace('\\', '/').contains("/web/controllers/")) {
                continue;
            }
            String simpleName = file.substring(0, file.length() - ".java".length());
            try {
                classes.add(Class.forName(CONTROLLER_PACKAGE + "." + simpleName));
            } catch (ClassNotFoundException e) {
                throw new IllegalStateException("cannot load " + simpleName, e);
            }
        }
        assertTrue(classes.size() >= 7, "controller discovery found only " + classes.size() + " classes");
        return classes;
    }

    // ---- what the contract publishes ---------------------------------------

    private static Set<String> specOperations() {
        @SuppressWarnings("unchecked")
        Map<String, Object> paths = (Map<String, Object>) loadSpec().get("paths");
        Set<String> operations = new TreeSet<>();
        paths.forEach((path, item) -> ((Map<?, ?>) item).keySet().forEach(key -> {
            if (isVerb(String.valueOf(key))) {
                operations.add(key + " " + path);
            }
        }));
        return operations;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> loadSpec() {
        return new Yaml().loadAs(ContractResources.packaged(ContractResources.OPENAPI), Map.class);
    }

    private static boolean isVerb(String key) {
        return Set.of("get", "post", "put", "patch", "delete", "head", "options").contains(key);
    }

    private static String first(String[] values) {
        return values.length == 0 ? "" : values[0];
    }
}
