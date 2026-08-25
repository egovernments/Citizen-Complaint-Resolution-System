package org.egov.pgr.repository.rowmapper;

import org.egov.pgr.web.models.Service;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import java.sql.ResultSet;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PGRRowMapperTest {

    private final PGRRowMapper rowMapper = new PGRRowMapper();

    @ParameterizedTest(name = "maps latitude {0} and longitude {1} without coercing null or zero")
    @MethodSource("coordinates")
    void preservesNullableCoordinates(Double latitude, Double longitude) throws Exception {
        ResultSet resultSet = mock(ResultSet.class);
        when(resultSet.next()).thenReturn(true, false);
        when(resultSet.getString("ser_id")).thenReturn("service-id");
        when(resultSet.getDouble("latitude")).thenReturn(latitude == null ? 0.0d : latitude);
        when(resultSet.getDouble("longitude")).thenReturn(longitude == null ? 0.0d : longitude);
        // The row mapper checks the nullable rating before reading coordinates.
        // Return false for that first check, then model each coordinate read.
        when(resultSet.wasNull()).thenReturn(false, latitude == null, longitude == null);

        List<Service> services = rowMapper.extractData(resultSet);

        var jdbcReads = inOrder(resultSet);
        jdbcReads.verify(resultSet).getDouble("latitude");
        jdbcReads.verify(resultSet).wasNull();
        jdbcReads.verify(resultSet).getDouble("longitude");
        jdbcReads.verify(resultSet).wasNull();

        assertEquals(1, services.size());
        assertNotNull(services.get(0).getAddress());
        assertNotNull(services.get(0).getAddress().getGeoLocation());
        assertEquals(latitude, services.get(0).getAddress().getGeoLocation().getLatitude());
        assertEquals(longitude, services.get(0).getAddress().getGeoLocation().getLongitude());
    }

    private static Stream<Arguments> coordinates() {
        return Stream.of(
                Arguments.of(null, null),
                Arguments.of(null, 36.8219d),
                Arguments.of(-1.2921d, null),
                Arguments.of(-1.2921d, 36.8219d),
                Arguments.of(0.0d, 36.8219d),
                Arguments.of(-1.2921d, 0.0d)
        );
    }
}
