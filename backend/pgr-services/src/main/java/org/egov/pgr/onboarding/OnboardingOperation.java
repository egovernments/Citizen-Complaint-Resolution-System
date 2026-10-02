package org.egov.pgr.onboarding;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Data
@Builder(toBuilder = true)
@NoArgsConstructor
@AllArgsConstructor
public class OnboardingOperation {
    private UUID id;
    private UUID signupId;
    private String status;
    private String currentStep;
    @Builder.Default
    private List<String> completedSteps = new ArrayList<>();
    private String errorCode;
    private String errorMessage;
    private int attempt;
    private long createdAt;
    private long updatedAt;
}
