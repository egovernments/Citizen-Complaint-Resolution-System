// Maps common error patterns to actionable hints for agents.

interface HintRule {
  pattern: RegExp;
  hint: string;
}

const HINT_RULES: HintRule[] = [
  {
    pattern: /not authorized|unauthorized|access.*denied/i,
    hint: "Call user_role_add with the target tenant to add cross-tenant roles, or call configure with the target tenant_id.",
  },
  {
    pattern: /token.*expired|invalid.*token/i,
    hint: "Call configure to re-authenticate.",
  },
  {
    pattern: /not authenticated|must.*log.*in|call configure first/i,
    hint: "Call configure with your credentials before making API calls.",
  },
  {
    pattern: /group.*not.*enabled|not.*currently.*enabled/i,
    hint: "Call enable_tools with the required group.",
  },
  {
    pattern: /tenant.*not found|invalid.*tenant/i,
    hint: "Use validate_tenant or mdms_get_tenants to verify the tenant ID exists.",
  },
  {
    pattern: /complaint.*not found|service.*request.*not found/i,
    hint: "Use pgr_search to verify the service_request_id exists in the target tenant.",
  },
  {
    pattern: /employee.*not found/i,
    hint: "Use validate_employees to list employees in the target tenant.",
  },
  {
    pattern: /schema.*not found/i,
    hint: "Use mdms_schema_search to check which schemas are registered. You may need to call tenant_bootstrap first.",
  },
  {
    pattern: /boundary.*not found|no.*boundary/i,
    hint: "Use validate_boundary to check boundary setup, or call boundary_create to create boundaries.",
  },
  {
    pattern: /workflow.*not found|business.*service.*not/i,
    hint: "Use workflow_business_services to check if the workflow is configured. You may need to call workflow_create first.",
  },
  {
    pattern: /duplicate|already exists|unique.*constraint/i,
    hint: "The record already exists. Use the corresponding search tool to find it.",
  },
  {
    pattern: /429|too many requests|rate.*limit/i,
    hint: "The API is rate-limited. Wait a moment and retry.",
  },
  {
    pattern: /503|service.*unavailable/i,
    hint: "The DIGIT service is temporarily unavailable. Check health_check and retry shortly.",
  },
  {
    pattern: /ECONNREFUSED|ENOTFOUND|network/i,
    hint: "Cannot reach the DIGIT API. Verify the environment URL with get_environment_info and check that services are running.",
  },
];

/**
 * Match an error message against known patterns and return an actionable hint.
 * Returns undefined if no pattern matches.
 */
export function getErrorHint(errorMessage: string): string | undefined {
  for (const rule of HINT_RULES) {
    if (rule.pattern.test(errorMessage)) {
      return rule.hint;
    }
  }
  return undefined;
}
