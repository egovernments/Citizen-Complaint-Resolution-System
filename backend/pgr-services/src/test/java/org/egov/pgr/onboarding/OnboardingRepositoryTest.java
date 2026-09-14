package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.Mock;
import org.mockito.junit.MockitoJUnitRunner;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.Assert.assertEquals;

@RunWith(MockitoJUnitRunner.class)
public class OnboardingRepositoryTest {

    @Mock private JdbcTemplate jdbcTemplate;

    @Test
    public void insertCastsExactlyTheJsonbColumns() {
        OnboardingRepository repository = new OnboardingRepository(jdbcTemplate, new ObjectMapper());
        OnboardingSignup signup = OnboardingSignup.builder().id(UUID.randomUUID())
                .ownerIssuer("https://issuer").ownerSubject("subject").status("DRAFT")
                .languages(Collections.singletonList("en")).tenantMetadata(Collections.emptyMap())
                .version(1).createdAt(1L).updatedAt(1L).build();

        repository.insertSignup(signup, "create-1");

        String sql = (String) org.mockito.Mockito.mockingDetails(jdbcTemplate).getInvocations()
                .iterator().next().getArgument(0);
        Matcher statement = Pattern.compile("\\((.*?)\\) VALUES \\((.*?)\\)").matcher(sql);
        statement.find();
        List<String> columns = Arrays.asList(statement.group(1).split(",\\s*"));
        List<String> jsonbColumns = new ArrayList<>();
        String[] values = statement.group(2).split(",\\s*");
        assertEquals(columns.size(), values.length);
        for (int i = 0; i < values.length; i++) {
            if (values[i].endsWith("::jsonb")) jsonbColumns.add(columns.get(i).trim());
        }
        assertEquals(Arrays.asList("languages", "tenant_metadata"), jsonbColumns);
    }
}
