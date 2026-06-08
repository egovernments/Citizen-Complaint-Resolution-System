package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.*;

import java.util.List;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class ServiceResponse {

    @JsonProperty("ServiceWrappers")
    private List<ServiceWrapper> serviceWrappers;

    @JsonProperty("complaintsResolved")
    private int complaintsResolved;

    @JsonProperty("averageResolutionTime")
    private int averageResolutionTime;

    @JsonProperty("complaintTypes")
    private int complaintTypes;
}
