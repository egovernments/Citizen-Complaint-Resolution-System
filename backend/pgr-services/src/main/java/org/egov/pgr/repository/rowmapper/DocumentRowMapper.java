package org.egov.pgr.repository.rowmapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.web.models.Document;
import org.egov.tracer.model.CustomException;
import org.postgresql.util.PGobject;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.stereotype.Repository;

import java.io.IOException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.*;

@Repository
public class DocumentRowMapper implements ResultSetExtractor<Map<String, List<Document>>> {

    @Autowired
    private ObjectMapper mapper;

    @Override
    public Map<String, List<Document>> extractData(ResultSet rs) throws SQLException, DataAccessException {
        Map<String, List<Document>> serviceIdToDocuments = new LinkedHashMap<>();

        while (rs.next()) {
            String serviceId = rs.getString("service_id");

            Document document = Document.builder()
                    .id(rs.getString("id"))
                    .documentType(rs.getString("document_type"))
                    .fileStoreId(rs.getString("filestore_id"))
                    .documentUid(rs.getString("document_uid"))
                    .build();

            try {
                PGobject pgObj = (PGobject) rs.getObject("additional_details");
                if (pgObj != null) {
                    JsonNode additionalDetails = mapper.readTree(pgObj.getValue());
                    document.setAdditionalDetails(additionalDetails);
                }
            } catch (IOException e) {
                throw new CustomException("PARSING_ERROR", "Failed to parse document additionalDetails");
            }

            serviceIdToDocuments.computeIfAbsent(serviceId, k -> new ArrayList<>()).add(document);
        }

        return serviceIdToDocuments;
    }
}
