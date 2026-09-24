package org.egov.novubridge.producer;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.tracer.kafka.CustomKafkaTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
@Slf4j
public class Producer {

    @Autowired
    private CustomKafkaTemplate<String, Object> kafkaTemplate;

    @Autowired
    private MultiStateInstanceUtil centralInstanceUtil;

    /**
     * A blank tenant publishes to the unprefixed topic. On a central instance the topic is
     * prefixed with the tenant's state: a null tenant throws there, and a blank one publishes to
     * {@code -<topic>}, which nothing reads.
     */
    public void push(String tenantId, String topic, Object value) {
        String updatedTopic = StringUtils.hasText(tenantId)
                ? centralInstanceUtil.getStateSpecificTopicName(tenantId, topic) : topic;
        kafkaTemplate.send(updatedTopic, value);
        log.info("Published event to topic={} tenantId={}", updatedTopic, tenantId);
    }
}
