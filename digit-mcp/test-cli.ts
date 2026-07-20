/**
 * Tests for the DIGIT CLI.
 *
 * Covers:
 * 1. Adapter: JSON Schema → Commander option mapping
 * 2. Formatter: json/table/plain output modes
 * 3. Auth: credential persistence (save/load/clear)
 * 4. CLI program: command structure, tool mapping, help generation
 *
 * Usage: npx tsx test-cli.ts
 */
import { Command } from 'commander';
import { addSchemaOptions, optsToArgs, toFlag, toArgKey } from './src/cli/adapter.js';
import { formatOutput, shouldColor } from './src/cli/formatter.js';
import { saveCredentials, loadCredentials, clearCredentials } from './src/cli/auth.js';
import { ToolRegistry } from './src/tools/registry.js';
import { registerAllTools } from './src/tools/index.js';
import { ALL_GROUPS } from './src/types/index.js';
import { buildProgram } from './src/cli.js';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

// ============================================================
// 1. Adapter tests
// ============================================================
console.log('=== 1. Adapter: toFlag / toArgKey ===\n');

assert(toFlag('tenant_id') === '--tenant-id', 'toFlag: tenant_id → --tenant-id');
assert(toFlag('service_code') === '--service-code', 'toFlag: service_code → --service-code');
assert(toFlag('page_all') === '--page-all', 'toFlag: page_all → --page-all');
assert(toArgKey('--tenant-id') === 'tenant_id', 'toArgKey: --tenant-id → tenant_id');
assert(toArgKey('--service-request-id') === 'service_request_id', 'toArgKey: --service-request-id → service_request_id');

console.log('\n=== 2. Adapter: addSchemaOptions ===\n');
{
  const cmd = new Command('test');
  const schema = {
    type: 'object',
    properties: {
      tenant_id: { type: 'string', description: 'Tenant ID' },
      limit: { type: 'number', description: 'Max results' },
      page_all: { type: 'boolean', description: 'Fetch all pages' },
      status: { type: 'string', description: 'Filter status', enum: ['OPEN', 'CLOSED'] },
      tags: { type: 'array', description: 'Filter tags', items: { type: 'string' } },
      address: { type: 'object', description: 'Address JSON' },
    },
    required: ['tenant_id'],
  };

  addSchemaOptions(cmd, schema);
  const options = cmd.options;
  const optNames = options.map((o) => o.long);

  assert(optNames.includes('--tenant-id'), 'tenant_id option added');
  assert(optNames.includes('--limit'), 'limit option added');
  assert(optNames.includes('--page-all'), 'page_all option added');
  assert(optNames.includes('--status'), 'status option added');
  assert(optNames.includes('--tags'), 'tags option added');
  assert(optNames.includes('--address'), 'address option added');
  assert(options.length === 6, `6 options added (got ${options.length})`);

  // Check required vs optional
  const tenantOpt = options.find((o) => o.long === '--tenant-id')!;
  assert(tenantOpt.mandatory === true, 'tenant_id is mandatory');

  const limitOpt = options.find((o) => o.long === '--limit')!;
  assert(!limitOpt.mandatory, 'limit is optional');

  // Check enum choices
  const statusOpt = options.find((o) => o.long === '--status')!;
  assert(
    (statusOpt as unknown as { argChoices?: string[] }).argChoices?.includes('OPEN') === true,
    'status has enum choices',
  );
}

console.log('\n=== 3. Adapter: optsToArgs ===\n');
{
  const schema = {
    type: 'object',
    properties: {
      tenant_id: { type: 'string' },
      limit: { type: 'number' },
      page_all: { type: 'boolean' },
    },
    required: ['tenant_id'],
  };

  // Commander converts --tenant-id to tenantId in opts
  const opts = { tenantId: 'pg.citya', limit: 50 };
  const args = optsToArgs(opts, schema);

  assert(args.tenant_id === 'pg.citya', 'optsToArgs: tenant_id mapped');
  assert(args.limit === 50, 'optsToArgs: limit mapped');
  assert(args.page_all === undefined, 'optsToArgs: undefined not included');
  assert(!('pageAll' in args), 'optsToArgs: camelCase key not in result');
}

console.log('\n=== 4. Adapter: number coercion ===\n');
{
  const cmd = new Command('test-coerce');
  const schema = {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max results' },
    },
  };
  addSchemaOptions(cmd, schema);

  // Parse with a number argument — { from: 'user' } means pass only user args
  cmd.action(() => {});
  cmd.parse(['--limit', '42'], { from: 'user' });
  const opts = cmd.opts();
  assert(opts.limit === 42, 'number coercion: --limit 42 → 42');
  assert(typeof opts.limit === 'number', 'number coercion: type is number');
}

console.log('\n=== 5. Adapter: JSON object coercion ===\n');
{
  const cmd = new Command('test-json');
  const schema = {
    type: 'object',
    properties: {
      address: { type: 'object', description: 'Address JSON' },
    },
  };
  addSchemaOptions(cmd, schema);

  cmd.action(() => {});
  cmd.parse(['--address', '{"locality":{"code":"LOC1"}}'], { from: 'user' });
  const opts = cmd.opts();
  assert(typeof opts.address === 'object', 'JSON coercion: parsed to object');
  assert((opts.address as Record<string, unknown>).locality !== undefined, 'JSON coercion: nested key present');
}

// ============================================================
// 2. Formatter tests
// ============================================================
console.log('\n=== 6. Formatter: JSON mode ===\n');
{
  const input = JSON.stringify({ success: true, data: [1, 2, 3] });
  const output = formatOutput(input, 'json');
  const parsed = JSON.parse(output);
  assert(parsed.success === true, 'json mode: preserves structure');
  assert(Array.isArray(parsed.data), 'json mode: array preserved');
}

console.log('\n=== 7. Formatter: plain mode ===\n');
{
  // Error case
  const errInput = JSON.stringify({ success: false, error: 'Not found' });
  const errOutput = formatOutput(errInput, 'plain');
  assert(errOutput.includes('ERROR'), 'plain mode: error prefix');
  assert(errOutput.includes('Not found'), 'plain mode: error message');

  // Array count
  const arrInput = JSON.stringify({ success: true, complaints: [{ id: 1 }, { id: 2 }] });
  const arrOutput = formatOutput(arrInput, 'plain');
  assert(arrOutput.includes('2'), 'plain mode: array count shown');
  assert(arrOutput.includes('complaints'), 'plain mode: array key shown');
}

console.log('\n=== 8. Formatter: table mode ===\n');
{
  // Error with hint
  const errInput = JSON.stringify({ success: false, error: 'Auth failed', hint: 'Call configure first' });
  const errOutput = formatOutput(errInput, 'table');
  assert(errOutput.includes('Error:'), 'table mode: error label');
  assert(errOutput.includes('Hint:'), 'table mode: hint shown');

  // Tabular data
  const tableInput = JSON.stringify({
    success: true,
    tenants: [
      { code: 'pg.citya', name: 'City A', enabled: true },
      { code: 'pg.cityb', name: 'City B', enabled: false },
    ],
  });
  const tableOutput = formatOutput(tableInput, 'table');
  assert(tableOutput.includes('CODE'), 'table mode: header uppercase');
  assert(tableOutput.includes('pg.citya'), 'table mode: data row 1');
  assert(tableOutput.includes('pg.cityb'), 'table mode: data row 2');
  assert(tableOutput.includes('─'), 'table mode: separator line');
  assert(tableOutput.includes('2 tenants'), 'table mode: count footer');

  // Empty array
  const emptyInput = JSON.stringify({ success: true, complaints: [] });
  const emptyOutput = formatOutput(emptyInput, 'table');
  assert(emptyOutput.includes('No complaints'), 'table mode: empty message');

  // Key-value (no array)
  const kvInput = JSON.stringify({ success: true, environment: 'chakshu-digit', url: 'https://example.com' });
  const kvOutput = formatOutput(kvInput, 'table');
  assert(kvOutput.includes('environment:'), 'table mode: key-value label');
  assert(kvOutput.includes('chakshu-digit'), 'table mode: key-value value');
}

console.log('\n=== 9. Formatter: non-JSON passthrough ===\n');
{
  const output = formatOutput('just plain text', 'json');
  assert(output === 'just plain text', 'non-JSON: passed through unchanged');
}

// ============================================================
// 3. Auth tests
// ============================================================
console.log('\n=== 10. Auth: save/load/clear credentials ===\n');
{
  // Save
  saveCredentials({ environment: 'test-env', username: 'testuser', password: 'testpass' });
  const loaded = loadCredentials();
  assert(loaded.environment === 'test-env', 'auth: environment saved');
  assert(loaded.username === 'testuser', 'auth: username saved');
  assert(loaded.password === 'testpass', 'auth: password saved');

  // Merge
  saveCredentials({ tenant_id: 'pg.citya' });
  const merged = loadCredentials();
  assert(merged.environment === 'test-env', 'auth: environment preserved after merge');
  assert(merged.tenant_id === 'pg.citya', 'auth: tenant_id merged');

  // Clear
  clearCredentials();
  const cleared = loadCredentials();
  assert(cleared.environment === undefined, 'auth: cleared environment');
  assert(cleared.username === undefined, 'auth: cleared username');
}

// ============================================================
// 4. CLI program structure tests
// ============================================================
console.log('\n=== 11. CLI program: command structure ===\n');
{
  const registry = new ToolRegistry();
  registerAllTools(registry);
  registry.enableGroups(ALL_GROUPS);

  const program = buildProgram(registry);
  const commands = program.commands.map((c) => c.name());

  // Top-level core commands
  assert(commands.includes('configure'), 'top-level: configure');
  assert(commands.includes('get-environment-info'), 'top-level: get-environment-info');
  assert(commands.includes('health-check'), 'top-level: health-check');
  assert(commands.includes('mdms-get-tenants'), 'top-level: mdms-get-tenants');

  // Auth commands
  assert(commands.includes('login'), 'top-level: login');
  assert(commands.includes('logout'), 'top-level: logout');

  // MCP-only tools excluded from top level
  assert(!commands.includes('discover-tools'), 'excluded: discover-tools');
  assert(!commands.includes('enable-tools'), 'excluded: enable-tools');
  assert(!commands.includes('init'), 'excluded: init');
  assert(!commands.includes('session-checkpoint'), 'excluded: session-checkpoint');

  // Group commands
  assert(commands.includes('pgr'), 'group: pgr');
  assert(commands.includes('mdms'), 'group: mdms');
  assert(commands.includes('boundary'), 'group: boundary');
  assert(commands.includes('employees'), 'group: employees');
  assert(commands.includes('tracing'), 'group: tracing');
  assert(commands.includes('monitoring'), 'group: monitoring');
  assert(commands.includes('encryption'), 'group: encryption');
}

console.log('\n=== 12. CLI program: pgr subcommands ===\n');
{
  const registry = new ToolRegistry();
  registerAllTools(registry);
  registry.enableGroups(ALL_GROUPS);

  const program = buildProgram(registry);
  const pgrCmd = program.commands.find((c) => c.name() === 'pgr')!;
  assert(pgrCmd !== undefined, 'pgr group exists');

  const subcommands = pgrCmd.commands.map((c) => c.name());
  assert(subcommands.includes('search'), 'pgr: search');
  assert(subcommands.includes('create'), 'pgr: create');
  assert(subcommands.includes('update'), 'pgr: update');
  assert(subcommands.includes('workflow-business-services'), 'pgr: workflow-business-services');
  assert(subcommands.includes('workflow-process-search'), 'pgr: workflow-process-search');
  assert(subcommands.includes('workflow-create'), 'pgr: workflow-create');
}

console.log('\n=== 13. CLI program: tool count matches registry ===\n');
{
  const registry = new ToolRegistry();
  registerAllTools(registry);
  registry.enableGroups(ALL_GROUPS);

  const SKIP_TOOLS = new Set(['discover_tools', 'enable_tools', 'init', 'session_checkpoint']);
  const expectedTools = registry.getAllTools().filter((t) => !SKIP_TOOLS.has(t.name)).length;

  const program = buildProgram(registry);

  // Count all leaf commands (not groups)
  let cliToolCount = 0;
  for (const cmd of program.commands) {
    if (cmd.commands.length > 0) {
      // Group — count subcommands
      cliToolCount += cmd.commands.length;
    } else if (!['login', 'logout', 'help'].includes(cmd.name())) {
      // Top-level tool command
      cliToolCount++;
    }
  }

  assert(
    cliToolCount === expectedTools,
    `CLI tool count (${cliToolCount}) matches registry (${expectedTools})`,
  );
}

console.log('\n=== 14. CLI program: search command has correct options ===\n');
{
  const registry = new ToolRegistry();
  registerAllTools(registry);
  registry.enableGroups(ALL_GROUPS);

  const program = buildProgram(registry);
  const pgrCmd = program.commands.find((c) => c.name() === 'pgr')!;
  const searchCmd = pgrCmd.commands.find((c) => c.name() === 'search')!;

  const optNames = searchCmd.options.map((o) => o.long);
  assert(optNames.includes('--tenant-id'), 'pgr search: --tenant-id');
  assert(optNames.includes('--status'), 'pgr search: --status');
  assert(optNames.includes('--limit'), 'pgr search: --limit');
  assert(optNames.includes('--offset'), 'pgr search: --offset');
  assert(optNames.includes('--service-request-id'), 'pgr search: --service-request-id');

  // tenant_id should be mandatory
  const tenantOpt = searchCmd.options.find((o) => o.long === '--tenant-id')!;
  assert(tenantOpt.mandatory === true, 'pgr search: tenant-id is mandatory');
}

console.log('\n=== 15. CLI program: all groups have at least 1 tool ===\n');
{
  const registry = new ToolRegistry();
  registerAllTools(registry);
  registry.enableGroups(ALL_GROUPS);

  const program = buildProgram(registry);
  const groupCmds = program.commands.filter((c) => c.commands.length > 0);

  for (const group of groupCmds) {
    assert(group.commands.length >= 1, `group ${group.name()}: ${group.commands.length} commands`);
  }
}

console.log('\n=== 16. Adapter: boolean flag (no value argument) ===\n');
{
  const cmd = new Command('test-bool');
  const schema = {
    type: 'object',
    properties: {
      page_all: { type: 'boolean', description: 'Fetch all pages' },
      verbose: { type: 'boolean', description: 'Verbose output' },
    },
  };
  addSchemaOptions(cmd, schema);
  cmd.action(() => {});

  // Boolean flags should work without a value
  cmd.parse(['--page-all'], { from: 'user' });
  const opts = cmd.opts();
  assert(opts.pageAll === true, 'boolean flag: --page-all sets true');
}

console.log('\n=== 17. Adapter: variadic string array ===\n');
{
  const cmd = new Command('test-variadic');
  const schema = {
    type: 'object',
    properties: {
      assignees: { type: 'array', description: 'Employee UUIDs', items: { type: 'string' } },
    },
  };
  addSchemaOptions(cmd, schema);
  cmd.action(() => {});

  cmd.parse(['--assignees', 'uuid1', 'uuid2', 'uuid3'], { from: 'user' });
  const opts = cmd.opts();
  assert(Array.isArray(opts.assignees), 'variadic: parsed as array');
  assert((opts.assignees as string[]).length === 3, 'variadic: 3 items');
  assert((opts.assignees as string[])[0] === 'uuid1', 'variadic: first item correct');
}

console.log('\n=== 18. Formatter: single value response ===\n');
{
  const input = JSON.stringify({ success: true, count: 42 });
  const plain = formatOutput(input, 'plain');
  assert(plain === '42', 'plain mode: single value extracted');
}

console.log('\n=== 19. Formatter: shouldColor respects NO_COLOR ===\n');
{
  // shouldColor should return false when NO_COLOR is set
  const origNoColor = process.env.NO_COLOR;
  const origTerm = process.env.TERM;

  process.env.NO_COLOR = '1';
  assert(shouldColor() === false, 'shouldColor: false when NO_COLOR set');
  delete process.env.NO_COLOR;

  process.env.TERM = 'dumb';
  assert(shouldColor() === false, 'shouldColor: false when TERM=dumb');
  if (origTerm !== undefined) process.env.TERM = origTerm;
  else delete process.env.TERM;

  if (origNoColor !== undefined) process.env.NO_COLOR = origNoColor;
}

console.log('\n=== 20. Formatter: table mode respects NO_COLOR ===\n');
{
  const origNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';

  const errInput = JSON.stringify({ success: false, error: 'Auth failed', hint: 'Call configure first' });
  const errOutput = formatOutput(errInput, 'table');
  assert(!errOutput.includes('\x1b['), 'table mode: no ANSI codes when NO_COLOR set');
  assert(errOutput.includes('Error:'), 'table mode: still shows Error label');
  assert(errOutput.includes('Hint:'), 'table mode: still shows Hint label');

  if (origNoColor !== undefined) process.env.NO_COLOR = origNoColor;
  else delete process.env.NO_COLOR;
}

console.log('\n=== 21. CLI program: --no-color flag present ===\n');
{
  const registry = new ToolRegistry();
  registerAllTools(registry);
  registry.enableGroups(ALL_GROUPS);

  const program = buildProgram(registry);
  const optNames = program.options.map((o) => o.long);
  assert(optNames.includes('--no-color'), 'program: --no-color flag exists');
}

console.log('\n=== 22. CLI program: -V version flag ===\n');
{
  const registry = new ToolRegistry();
  registerAllTools(registry);
  registry.enableGroups(ALL_GROUPS);

  const program = buildProgram(registry);
  assert(program.version() === '1.0.0', 'program: version is 1.0.0');
  // Check that short flag -V is configured
  const versionOpt = program.options.find((o) => o.long === '--version');
  assert(versionOpt !== undefined, 'program: --version option exists');
  assert(versionOpt?.short === '-V', 'program: -V short flag for version');
}

console.log('\n=== 23. CLI program: help includes examples and links ===\n');
{
  const registry = new ToolRegistry();
  registerAllTools(registry);
  registry.enableGroups(ALL_GROUPS);

  const program = buildProgram(registry);
  const desc = program.description();
  assert(desc.includes('Examples:'), 'program help: includes Examples section');
  assert(desc.includes('digit pgr search'), 'program help: includes search example');
  assert(desc.includes('github.com/ChakshuGautam/DIGIT-MCP'), 'program help: includes GitHub link');
  assert(desc.includes('Issues:'), 'program help: includes Issues link');
}

// ============================================================
// Summary
// ============================================================
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
