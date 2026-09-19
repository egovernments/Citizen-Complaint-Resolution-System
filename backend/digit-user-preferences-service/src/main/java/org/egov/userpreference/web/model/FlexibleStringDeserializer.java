package org.egov.userpreference.web.model;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Accepts a JSON value that may arrive either quoted or as a bare number and
 * always yields a {@code String}.
 *
 * <p>Carried over from the Go implementation's {@code digit.FlexibleString}:
 * {@code RequestInfo.userInfo.id} is numeric in most DIGIT services but is
 * serialized as a string by some callers, and the Go service tolerated both. A
 * plain {@code String} field would reject {@code "id": 42} under a strict
 * mapper, and a {@code Long} field would reject {@code "id": "42"}, so neither
 * type alone reproduces the old behaviour.
 *
 * <p>Non-integral numbers are rounded half-even to match Go's
 * {@code fmt.Sprintf("%.0f", n)}.
 */
public class FlexibleStringDeserializer extends JsonDeserializer<String> {

    @Override
    public String deserialize(JsonParser parser, DeserializationContext context) throws IOException {
        JsonToken token = parser.currentToken();
        if (token == JsonToken.VALUE_NULL) {
            return null;
        }
        if (token == JsonToken.VALUE_NUMBER_INT) {
            return parser.getText();
        }
        if (token == JsonToken.VALUE_NUMBER_FLOAT) {
            return new BigDecimal(parser.getText()).setScale(0, RoundingMode.HALF_EVEN).toPlainString();
        }
        return parser.getValueAsString();
    }
}
