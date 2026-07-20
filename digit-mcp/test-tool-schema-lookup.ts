/**
 * Tests for per-tool schema lookup in api_catalog (issue #27).
 * Exercises the tool parameter for single-tool schema retrieval.
 *
 * Usage: npx tsx test-tool-schema-lookup.ts
 */

import { ToolRegistry } from './src/tools/registry.js';
import { registerAllTools } from './src/tools/index.js';
import type { ToolGroup } from './src/types/index.js';

const ALL_GROUPS: ToolGroup[] = ['core', 'mdms', 'boundary', 'masters', 'employees', 'localization', 'pgr', 'admin', 'idgen', 'location', 'encryption', 'docs', 'monitoring', 'tracing'];

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${msg}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`);
  }
}

console.log('=== Per-Tool Schema Lookup Tests ===\n');

const registry = new ToolRegistry();
registerAllTools(registry);
registry.enableGroups(ALL_GROUPS);

async function call(toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = registry.getTool(toolName);
  if (!tool) throw new Error(`Tool "${toolName}" not registered`);
  const raw = await tool.handler(args);
  return JSON.parse(raw);
}

// 1. Look up pgr_create
console.log('1. Look up pgr_create');
{
  const result = await call('api_catalog', { tool: 'pgr_create' });
  assert(result.success === true, 'success=true');
  assert(result.tool === 'pgr_create', 'tool=pgr_create');
  assert(result.group === 'pgr', 'group=pgr');
  assert(result.category === 'pgr', 'category=pgr');
  assert(result.risk === 'write', 'risk=write');
  assert(typeof result.description === 'string', 'description is string');
  assert(Array.isArray(result.parameters), 'parameters is array');

  const params = result.parameters as Array<{ name: string; required: boolean }>;
  const requiredParams = params.filter((p) => p.required).map((p) => p.name);
  assert(requiredParams.includes('tenant_id'), 'tenant_id is required');
  assert(requiredParams.includes('service_code'), 'service_code is required');
  assert(requiredParams.includes('description'), 'description is required');

  const relatedTools = result.relatedTools as string[];
  assert(Array.isArray(relatedTools), 'relatedTools is array');
  assert(relatedTools.includes('validate_complaint_types'), 'Related: validate_complaint_types');
  assert(relatedTools.includes('pgr_search'), 'Related: pgr_search');
}

// 2. Look up configure (core tool)
console.log('\n2. Look up configure');
{
  const result = await call('api_catalog', { tool: 'configure' });
  assert(result.success === true, 'success=true');
  assert(result.tool === 'configure', 'tool=configure');
  assert(result.group === 'core', 'group=core');

  const relatedTools = result.relatedTools as string[];
  assert(relatedTools.includes('get_environment_info'), 'Related: get_environment_info');
}

// 3. Look up nonexistent tool
console.log('\n3. Nonexistent tool');
{
  const result = await call('api_catalog', { tool: 'nonexistent_tool_xyz' });
  assert(result.success === false, 'success=false');
  assert((result.error as string).includes('not found'), 'Error says not found');
  assert((result.hint as string).includes('discover_tools'), 'Hint mentions discover_tools');
}

// 4. Partial name match in suggestions
console.log('\n4. Partial name match suggestions');
{
  const result = await call('api_catalog', { tool: 'pgr' });
  assert(result.success === false, 'success=false (partial name is not exact)');
  const suggestions = result.suggestions as string[] | undefined;
  assert(suggestions !== undefined && suggestions.length > 0, 'Suggestions returned');
  if (suggestions) {
    assert(suggestions.some((s) => s.startsWith('pgr_')), 'Suggestions include pgr_ tools');
  }
}

// 5. Tool parameter takes priority over service/format
console.log('\n5. Tool parameter takes priority');
{
  const result = await call('api_catalog', { tool: 'mdms_search', service: 'PGR', format: 'openapi' });
  assert(result.success === true, 'success=true');
  assert(result.tool === 'mdms_search', 'tool=mdms_search (not PGR service)');
  assert(result.parameters !== undefined, 'Returns parameters, not OpenAPI spec');
  assert(result.spec === undefined, 'No spec field');
}

// 6. Parameters include type info and descriptions
console.log('\n6. Parameter detail');
{
  const result = await call('api_catalog', { tool: 'user_search' });
  const params = result.parameters as Array<{ name: string; type: string; description: string; required: boolean }>;
  const tenantParam = params.find((p) => p.name === 'tenant_id');
  assert(tenantParam !== undefined, 'tenant_id param exists');
  assert(tenantParam!.type === 'string', 'tenant_id type is string');
  assert(tenantParam!.required === true, 'tenant_id is required');
  assert(typeof tenantParam!.description === 'string' && tenantParam!.description.length > 0, 'tenant_id has description');
}

// 7. Enum values included
console.log('\n7. Enum values in parameters');
{
  const result = await call('api_catalog', { tool: 'pgr_search' });
  const params = result.parameters as Array<{ name: string; enum?: string[] }>;
  const statusParam = params.find((p) => p.name === 'status');
  assert(statusParam !== undefined, 'status param exists');
  assert(Array.isArray(statusParam!.enum), 'status has enum values');
  assert(statusParam!.enum!.includes('RESOLVED'), 'enum includes RESOLVED');
}

// 8. Existing behavior preserved — service filter still works
console.log('\n8. Existing service filter still works');
{
  const result = await call('api_catalog', { service: 'PGR', format: 'summary' });
  assert(result.success === true, 'success=true');
  assert(result.services !== undefined, 'Returns services (not tool lookup)');
}

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
