package org.egov.novubridge.web.controllers;

import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.response.ResponseInfo;
import org.egov.novubridge.service.MessageService;
import org.egov.novubridge.util.ResponseInfoFactory;
import org.egov.novubridge.web.models.Message;
import org.egov.novubridge.web.models.MessageSearchRequest;
import org.egov.novubridge.web.models.MessageSearchResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;

import java.util.List;

@Controller
@RequestMapping("/novu-adapter/v1/messages")
@Slf4j
public class MessageController {

    private final MessageService messageService;
    private final ResponseInfoFactory responseInfoFactory;

    public MessageController(MessageService messageService, ResponseInfoFactory responseInfoFactory) {
        this.messageService = messageService;
        this.responseInfoFactory = responseInfoFactory;
    }

    @PostMapping("/_search")
    public ResponseEntity<MessageSearchResponse> searchMessages(@Valid @RequestBody MessageSearchRequest request) {
        log.info("Received message search request with criteria: {}", request.getCriteria());
        
        List<Message> messages = messageService.searchMessages(request.getCriteria());
        long totalCount = messageService.countMessages(request.getCriteria());
        
        ResponseInfo responseInfo = responseInfoFactory.createResponseInfoFromRequestInfo(
                request.getRequestInfo(), true);
        
        MessageSearchResponse response = MessageSearchResponse.builder()
                .responseInfo(responseInfo)
                .messages(messages)
                .totalCount(totalCount)
                .build();
        
        log.info("Returning {} messages out of {} total", messages.size(), totalCount);
        return new ResponseEntity<>(response, HttpStatus.OK);
    }
}
