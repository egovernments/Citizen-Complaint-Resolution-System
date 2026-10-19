package org.egov.novubridge.service.resolution.digit;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** A last-write-wins cache whose entries expire after a TTL given at read time. */
final class TtlCache<K, V> {

    private record Entry<V>(V value, long fetchedAt) {
    }

    private final Map<K, Entry<V>> entries = new ConcurrentHashMap<>();

    /** The value if it is younger than {@code ttlMs}, else null. */
    V fresh(K key, long ttlMs) {
        Entry<V> entry = entries.get(key);
        return entry != null && System.currentTimeMillis() - entry.fetchedAt() < ttlMs ? entry.value() : null;
    }

    /** The value regardless of age, else null. */
    V any(K key) {
        Entry<V> entry = entries.get(key);
        return entry == null ? null : entry.value();
    }

    void put(K key, V value) {
        entries.put(key, new Entry<>(value, System.currentTimeMillis()));
    }
}
