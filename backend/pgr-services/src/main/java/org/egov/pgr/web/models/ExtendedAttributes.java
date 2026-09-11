package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonAnyGetter;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Flat JSONB container for category-specific complaint fields.
 *
 * Known metadata fields (isConfidential, caseRelatedTo, schemaVersion) are explicit.
 * All other keys — the actual category fields — land in dynamicFields via @JsonAnySetter
 * and are serialized back flat via @JsonAnyGetter.
 *
 * complainantAddress and email are received in the API payload but stripped before Kafka
 * push (nulled by EnrichmentService after forwarding to User Service).
 */
public class ExtendedAttributes {

    @JsonProperty("isConfidential")
    private Boolean isConfidential;

    @JsonProperty("caseRelatedTo")
    private String caseRelatedTo;

    @JsonProperty("schemaVersion")
    private String schemaVersion;

    // Received from API, forwarded to User Service, nulled before Kafka — not stored in JSONB.
    @JsonProperty("complainantAddress")
    private String complainantAddress;

    @JsonProperty("email")
    private String email;

    @JsonIgnore
    private Map<String, Object> dynamicFields = new LinkedHashMap<>();

    public ExtendedAttributes() {}

    // ── known-field accessors ────────────────────────────────────────────────

    public Boolean getIsConfidential() { return isConfidential; }
    public void setIsConfidential(Boolean isConfidential) { this.isConfidential = isConfidential; }

    public String getCaseRelatedTo() { return caseRelatedTo; }
    public void setCaseRelatedTo(String caseRelatedTo) { this.caseRelatedTo = caseRelatedTo; }

    public String getSchemaVersion() { return schemaVersion; }
    public void setSchemaVersion(String schemaVersion) { this.schemaVersion = schemaVersion; }

    public String getComplainantAddress() { return complainantAddress; }
    public void setComplainantAddress(String complainantAddress) { this.complainantAddress = complainantAddress; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }

    // ── flat dynamic fields ──────────────────────────────────────────────────

    @JsonAnySetter
    public void setDynamicField(String key, Object value) {
        if (dynamicFields == null) dynamicFields = new LinkedHashMap<>();
        dynamicFields.put(key, value);
    }

    @JsonAnyGetter
    public Map<String, Object> getDynamicFields() {
        return dynamicFields != null ? dynamicFields : Collections.emptyMap();
    }

    // ── service-layer helpers ────────────────────────────────────────────────

    /** Unified read: checks named first-class fields before falling back to dynamicFields. */
    public Object getField(String key) {
        if ("email".equals(key)) return email;
        if ("complainantAddress".equals(key)) return complainantAddress;
        return dynamicFields != null ? dynamicFields.get(key) : null;
    }

    /** Shallow copy of metadata + dynamicFields for API response (excludes transient user-service fields). */
    public ExtendedAttributes copy() {
        ExtendedAttributes c = new ExtendedAttributes();
        c.setIsConfidential(this.isConfidential);
        c.setCaseRelatedTo(this.caseRelatedTo);
        c.setSchemaVersion(this.schemaVersion);
        if (this.dynamicFields != null) this.dynamicFields.forEach(c::putField);
        return c;
    }

    public void putField(String key, Object value) {
        if (dynamicFields == null) dynamicFields = new LinkedHashMap<>();
        dynamicFields.put(key, value);
    }

    public void removeField(String key) {
        if (dynamicFields != null) dynamicFields.remove(key);
    }

    @JsonIgnore
    public boolean getIsConfidentialSafe() {
        return Boolean.TRUE.equals(isConfidential);
    }
}
