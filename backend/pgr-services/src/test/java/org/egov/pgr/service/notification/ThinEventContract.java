package org.egov.pgr.service.notification;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Checks a built event against the published thin-event contract,
 * {@code backend/novu-bridge/src/main/resources/contract/thin-event-v1.schema.json} (identical copy
 * under {@code docs/2.20/notifications/contract/}). The Docker test runner builds this module on its
 * own, so the schema cannot be read from here; the sets below are taken from it by hand and must
 * follow it when it changes.
 */
public final class ThinEventContract {

    /** The schema's {@code required}. */
    public static final List<String> REQUIRED = List.of("kind", "eventId", "eventType", "module", "eventName", "tenantId");

    /**
     * The schema's top-level {@code properties}. {@code additionalProperties} is true, but the bridge
     * ignores an unknown field, so a producer key outside this set is a value that never arrives.
     */
    public static final Set<String> PROPERTIES = Set.of(
            "kind", "schemaVersion", "eventId", "eventType", "eventTime", "producer", "module", "eventName",
            "entityType", "entityId", "tenantId", "transactionSeed", "actors", "recipients", "data", "localized",
            "localizationModules", "dataByLocale", "localizationLocale", "ledgerEventName", "payload");

    /** {@code $defs.actorRef.properties}. */
    public static final Set<String> ACTOR_PROPERTIES = Set.of("userId", "type", "name", "phone", "email", "locale");

    private ThinEventContract() {
    }

    @SuppressWarnings("unchecked")
    public static void assertConforms(Map<String, Object> event) {
        for (String key : REQUIRED) {
            assertTrue(event.get(key) instanceof String && !((String) event.get(key)).isEmpty(),
                    "required field " + key + " must be a non-empty string: " + event.get(key));
        }
        for (String key : event.keySet()) {
            assertTrue(PROPERTIES.contains(key), "not a thin-event-v1 property: " + key);
        }
        assertEquals("THIN", event.get("kind"));
        assertEquals("1", event.get("schemaVersion"));
        assertNotNull(Instant.parse((String) event.get("eventTime")));

        Map<String, Object> actors = (Map<String, Object>) event.get("actors");
        if (actors != null) {
            actors.forEach((name, ref) -> {
                assertInstanceOf(Map.class, ref, "actor " + name);
                ((Map<String, Object>) ref).forEach((k, v) -> {
                    assertTrue(ACTOR_PROPERTIES.contains(k), "actor " + name + " has non-contract field " + k);
                    assertInstanceOf(String.class, v, "actor " + name + "." + k);
                });
            });
        }
        Map<String, Object> data = (Map<String, Object>) event.get("data");
        if (data != null) {
            data.forEach((k, v) -> assertInstanceOf(String.class, v, "data." + k));
        }
        Map<String, Object> localized = (Map<String, Object>) event.get("localized");
        if (localized != null) {
            localized.forEach((k, v) -> {
                if (v instanceof String) return;
                assertInstanceOf(List.class, v, "localized." + k);
                assertFalse(((List<?>) v).isEmpty(), "localized." + k + " is an empty ladder");
                ((List<?>) v).forEach(code -> assertInstanceOf(String.class, code, "localized." + k));
            });
        }
        Object modules = event.get("localizationModules");
        if (modules != null) {
            ((List<?>) modules).forEach(m -> assertInstanceOf(String.class, m, "localizationModules"));
        }
        assertNoNulls("event", event);
    }

    /** Null values are OMITTED, never written: the "absent, not blank" rule, all the way down. */
    public static void assertNoNulls(String path, Object value) {
        if (value == null) {
            fail(path + " is null; the producer omits a value it does not have");
        } else if (value instanceof Map<?, ?> map) {
            map.forEach((k, v) -> assertNoNulls(path + "." + k, v));
        } else if (value instanceof Collection<?> list) {
            list.forEach(v -> assertNoNulls(path + "[]", v));
        }
    }
}
