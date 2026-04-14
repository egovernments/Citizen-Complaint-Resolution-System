package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.web.models.Message;
import org.egov.novubridge.web.models.MessageSearchCriteria;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

@Service
@Slf4j
public class MessageService {

    private final MongoTemplate mongoTemplate;

    public MessageService(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    public List<Message> searchMessages(MessageSearchCriteria criteria) {
        Query query = buildQuery(criteria);
        
        // Apply pagination
        int offset = criteria.getOffset() != null ? criteria.getOffset() : 0;
        int limit = criteria.getLimit() != null ? criteria.getLimit() : 10;
        
        query.with(Sort.by(Sort.Direction.DESC, "createdAt"));
        query.skip(offset);
        query.limit(limit);
        
        log.info("Executing MongoDB query: {}", query);
        return mongoTemplate.find(query, Message.class);
    }

    public long countMessages(MessageSearchCriteria criteria) {
        Query query = buildQuery(criteria);
        return mongoTemplate.count(query, Message.class);
    }

    private Query buildQuery(MessageSearchCriteria criteria) {
        Query query = new Query();
        
        // Date range filter
        if (criteria.getCreatedAtFrom() != null || criteria.getCreatedAtTo() != null) {
            Criteria dateCriteria = Criteria.where("createdAt");
            
            if (criteria.getCreatedAtFrom() != null) {
                dateCriteria.gte(new Date(criteria.getCreatedAtFrom()));
            }
            
            if (criteria.getCreatedAtTo() != null) {
                dateCriteria.lte(new Date(criteria.getCreatedAtTo()));
            }
            
            query.addCriteria(dateCriteria);
        }
        
        // Additional filters
        if (criteria.getSubscriberId() != null && !criteria.getSubscriberId().isEmpty()) {
            query.addCriteria(Criteria.where("subscriberId").is(criteria.getSubscriberId()));
        }
        
        if (criteria.getTemplateId() != null && !criteria.getTemplateId().isEmpty()) {
            query.addCriteria(Criteria.where("templateId").is(criteria.getTemplateId()));
        }
        
        if (criteria.getChannel() != null && !criteria.getChannel().isEmpty()) {
            query.addCriteria(Criteria.where("channel").is(criteria.getChannel()));
        }
        
        if (criteria.getStatus() != null && !criteria.getStatus().isEmpty()) {
            query.addCriteria(Criteria.where("status").is(criteria.getStatus()));
        }
        
        if (criteria.getTransactionId() != null && !criteria.getTransactionId().isEmpty()) {
            query.addCriteria(Criteria.where("transactionId").is(criteria.getTransactionId()));
        }
        
        return query;
    }
}
