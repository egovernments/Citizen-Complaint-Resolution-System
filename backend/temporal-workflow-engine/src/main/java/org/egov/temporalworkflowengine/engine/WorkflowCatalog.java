package org.egov.temporalworkflowengine.engine;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.Data;
import org.apache.commons.lang3.StringUtils;
import org.egov.temporalworkflowengine.engine.model.ProcessRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;

@Component
public class WorkflowCatalog {

    private final Map<String, WorkflowDefinition> definitions;

    public WorkflowCatalog(
            ObjectMapper objectMapper,
            ResourceLoader resourceLoader,
            @Value("${workflow.engine.definitions-location:classpath:workflow-definitions.json}") String location) {
        this.definitions = loadDefinitions(objectMapper, resourceLoader, location).stream()
                .collect(Collectors.toUnmodifiableMap(
                        definition -> key(definition.getModule(), definition.getWorkflow()),
                        Function.identity()));
    }

    public WorkflowDefinition getDefinition(String module, String workflow) {
        WorkflowDefinition definition = definitions.get(key(module, workflow));
        if (definition == null) {
            throw new IllegalArgumentException("No workflow definition found for module=" + module + ", workflow=" + workflow);
        }
        return definition;
    }

    public List<String> availableActions(WorkflowDefinition definition, String state) {
        StateDefinition stateDefinition = definition.getStates().get(state);
        if (stateDefinition == null || stateDefinition.isTerminal()) {
            return List.of();
        }
        String timerAction = stateDefinition.getTimer() == null ? null : stateDefinition.getTimer().getAction();
        return definition.getTransitions().stream()
                .filter(transition -> state.equals(transition.getFromState()))
                .map(TransitionDefinition::getAction)
                .filter(action -> timerAction == null || !timerAction.equalsIgnoreCase(action))
                .distinct()
                .toList();
    }

    public Optional<TransitionDefinition> findTransition(WorkflowDefinition definition, String fromState, String action) {
        return definition.getTransitions().stream()
                .filter(transition -> transition.getFromState().equalsIgnoreCase(fromState))
                .filter(transition -> transition.getAction().equalsIgnoreCase(action))
                .findFirst();
    }

    public ProcessRequest mapIncomingEvent(String topic, Map<String, Object> payload) {
        return definitions.values().stream()
                .map(definition -> mapIncomingEvent(definition, topic, payload))
                .filter(java.util.Objects::nonNull)
                .findFirst()
                .orElse(null);
    }

    public boolean isStartAction(ProcessRequest request) {
        WorkflowDefinition definition = getDefinition(request.getModule(), request.getWorkflow());
        return findTransition(definition, definition.getStartState(), request.getAction()).isPresent();
    }

    private ProcessRequest mapIncomingEvent(WorkflowDefinition definition, String topic, Map<String, Object> payload) {
        return definition.getEventTriggers().stream()
                .filter(trigger -> topic.matches(trigger.getTopicPattern()))
                .findFirst()
                .map(trigger -> ProcessRequest.builder()
                        .tenantId(stringValue(payload, trigger.getTenantIdPath()))
                        .module(definition.getModule())
                        .workflow(definition.getWorkflow())
                        .action(StringUtils.defaultIfBlank(stringValue(payload, trigger.getActionPath()), trigger.getDefaultAction()))
                        .businessId(stringValue(payload, trigger.getBusinessIdPath()))
                        .correlationId(stringValue(payload, trigger.getCorrelationIdPath()))
                        .payload(payload)
                        .actor(Map.of())
                        .build())
                .orElse(null);
    }

    private List<WorkflowDefinition> loadDefinitions(ObjectMapper objectMapper, ResourceLoader resourceLoader, String location) {
        Resource resource = resourceLoader.getResource(location);
        try (InputStream inputStream = resource.getInputStream()) {
            CatalogFile file = objectMapper.readValue(inputStream, CatalogFile.class);
            return file.getDefinitions() == null ? List.of() : file.getDefinitions();
        } catch (IOException exception) {
            throw new IllegalStateException("Failed to load workflow definitions from " + location, exception);
        }
    }

    private String key(String module, String workflow) {
        return module + "::" + workflow;
    }

    @SuppressWarnings("unchecked")
    private String stringValue(Map<String, Object> source, String path) {
        if (StringUtils.isBlank(path)) {
            return null;
        }
        Object current = source;
        for (String segment : path.split("\\.")) {
            if (!(current instanceof Map<?, ?> map)) {
                return null;
            }
            current = map.get(segment);
            if (current == null) {
                return null;
            }
        }
        return String.valueOf(current);
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CatalogFile {
        private List<WorkflowDefinition> definitions = List.of();
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class WorkflowDefinition {
        private String module;
        private String workflow;
        private int version = 1;
        private String startState = "__START__";
        private List<EventTriggerDefinition> eventTriggers = List.of();
        private Map<String, StateDefinition> states = Collections.emptyMap();
        private List<TransitionDefinition> transitions = List.of();
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class EventTriggerDefinition {
        private String topicPattern;
        private String tenantIdPath;
        private String businessIdPath;
        private String correlationIdPath;
        private String actionPath;
        private String defaultAction;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class StateDefinition {
        private boolean terminal;
        private TimerDefinition timer;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class TimerDefinition {
        private Duration after;
        private String action;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class TransitionDefinition {
        private String fromState;
        private String action;
        private String toState;
        private List<StepDefinition> steps = List.of();
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class StepDefinition {
        private String name;
        private Map<String, Object> parameters = Collections.emptyMap();
    }
}
