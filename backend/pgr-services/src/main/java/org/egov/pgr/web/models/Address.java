package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.*;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class Address {

    @JsonProperty("tenantId")
    private String tenantId;

    @JsonProperty("id")
    private String id;

    @JsonProperty("doorNo")
    private String doorNo;

    @JsonProperty("plotNo")
    private String plotNo;

    @JsonProperty("landmark")
    private String landmark;

    @JsonProperty("city")
    private String city;

    @JsonProperty("district")
    private String district;

    @JsonProperty("region")
    private String region;

    @JsonProperty("state")
    private String state;

    @JsonProperty("country")
    private String country;

    @JsonProperty("pincode")
    private String pincode;

    @JsonProperty("buildingName")
    private String buildingName;

    @JsonProperty("street")
    private String street;

    @JsonProperty("locality")
    private Boundary locality;

    @JsonProperty("geoLocation")
    private GeoLocation geoLocation;

    @JsonProperty("additionDetails")
    private Object additionDetails;
}
