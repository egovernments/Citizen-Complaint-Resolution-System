package org.egov.config.utils;

import com.fasterxml.jackson.databind.JsonNode;
import org.json.JSONArray;
import org.json.JSONObject;

public class UniqueIdentifierUtil {

    private static final String X_UNIQUE_KEY = "x-unique";

    private UniqueIdentifierUtil() {}

    public static String computeFromSchema(JSONObject schema, JsonNode data) {
        if (!schema.has(X_UNIQUE_KEY)) {
            throw new CustomException("SCHEMA_MISSING_X_UNIQUE",
                    "Schema definition is missing 'x-unique' field list");
        }

        JSONArray uniqueFields = schema.getJSONArray(X_UNIQUE_KEY);
        if (uniqueFields.length() == 0) {
            throw new CustomException("SCHEMA_EMPTY_X_UNIQUE",
                    "Schema 'x-unique' field list is empty");
        }

        StringBuilder uid = new StringBuilder();
        for (int i = 0; i < uniqueFields.length(); i++) {
            String fieldPath = uniqueFields.getString(i);
            String jsonPointer = "/" + fieldPath.replace(".", "/");
            JsonNode valueNode = data.at(jsonPointer);

            if (valueNode.isMissingNode() || valueNode.isNull() || valueNode.asText().isEmpty()) {
                throw new CustomException("UNIQUE_FIELD_EMPTY",
                        "Value for unique field '" + fieldPath + "' cannot be empty");
            }

            if (i > 0) uid.append(".");
            uid.append(valueNode.asText());
        }
        return uid.toString();
    }
}
