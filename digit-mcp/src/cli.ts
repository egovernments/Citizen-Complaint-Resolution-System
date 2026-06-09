#!/usr/bin/env node
/**
 * DIGIT CLI — auto-generated from the same ToolRegistry that powers the MCP server.
 *
 * Command structure:
 *   digit <group> <command> [flags]       — grouped tools
 *   digit <command> [flags]               — core tools (top-level)
 *   digit --help                          — list all groups
 *   digit pgr --help                      — list pgr commands
 *   digit pgr search --help               — show pgr search flags
 *
 * Output:
 *   --output json|table|plain             — global output format
 *   Default: table on TTY, json when piped
 */
import { Command } from 'commander';
import { ToolRegistry } from './tools/registry.js';
import { registerAllTools } from './tools/index.js';
import { ALL_GROUPS } from './types/index.js';
import type { ToolMetadata } from './types/index.js';
import { addSchemaOptions, optsToArgs } from './cli/adapter.js';
import { formatOutput, defaultFormat, shouldColor, type OutputFormat } from './cli/formatter.js';
import { applyCredentialsToEnv, saveCredentials, clearCredentials, getCredentialsPath } from './cli/auth.js';

// MCP-only tools that don't make sense in CLI context
const SKIP_TOOLS = new Set([
  'discover_tools',
  'enable_tools',
  'init',
  'session_checkpoint',
]);

// Core tools promoted to top-level commands
const CORE_GROUP = 'core';

/**
 * Build the full Commander program from the tool registry.
 * Exported for testing.
 */
export function buildProgram(registry: ToolRegistry): Command {
  const program = new Command('digit');
  program
    .version('1.0.0', '-V, --version')
    .description(
      'DIGIT platform CLI — manage tenants, complaints, employees, and more\n\n' +
      'Examples:\n' +
      '  $ digit login --environment self-hosted --username ADMIN\n' +
      '  $ digit pgr search --tenant-id pg.citya --status RESOLVED\n' +
      '  $ digit pgr create --tenant-id pg.citya --service-code StreetLightNotWorking \\\n' +
      '      --description "Broken light" --citizen-name "Ravi" --citizen-mobile 9876543210 \\\n' +
      '      --address \'{"locality":{"code":"LOC_CITYA_1"}}\'\n' +
      '  $ digit health-check\n\n' +
      'Docs:     https://github.com/ChakshuGautam/DIGIT-MCP#readme\n' +
      'Issues:   https://github.com/ChakshuGautam/DIGIT-MCP/issues'
    )
    .option('--output <format>', 'Output format: json, table, plain', undefined)
    .option('--no-color', 'Disable colored output');

  // Add login/logout convenience commands
  addAuthCommands(program);

  // Group tools by their tool group
  const groups = new Map<string, ToolMetadata[]>();
  for (const tool of registry.getAllTools()) {
    if (SKIP_TOOLS.has(tool.name)) continue;
    const group = tool.group;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(tool);
  }

  // Core tools → top-level commands
  const coreTools = groups.get(CORE_GROUP) || [];
  for (const tool of coreTools) {
    program.addCommand(buildToolCommand(tool, program));
  }

  // Other groups → subcommand namespaces
  for (const [group, tools] of groups.entries()) {
    if (group === CORE_GROUP) continue;

    const groupCmd = new Command(group);
    groupCmd.description(`${group} commands (${tools.length} tools)`);

    for (const tool of tools) {
      groupCmd.addCommand(buildToolCommand(tool, program));
    }

    program.addCommand(groupCmd);
  }

  return program;
}

/**
 * Build a Commander Command from a single ToolMetadata.
 */
function buildToolCommand(tool: ToolMetadata, program: Command): Command {
  // Convert tool name: pgr_search → search (when nested under pgr group)
  // For core tools at top level, use full name with underscores → hyphens
  const cmdName = tool.group === CORE_GROUP
    ? tool.name.replace(/_/g, '-')
    : tool.name.replace(`${tool.group}_`, '').replace(/_/g, '-');

  const cmd = new Command(cmdName);
  cmd.description(truncateDesc(tool.description));

  const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
  addSchemaOptions(cmd, schema as Parameters<typeof addSchemaOptions>[1]);

  cmd.action(async (opts: Record<string, unknown>) => {
    const format = (program.opts().output || defaultFormat()) as OutputFormat;
    const args = optsToArgs(opts, schema as Parameters<typeof optsToArgs>[1]);

    try {
      const result = await tool.handler(args);

      // Special handling: if this was a configure call, save credentials for next time
      if (tool.name === 'configure') {
        saveConfigureCredentials(args);
      }

      const output = formatOutput(result, format);
      console.log(output);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (format === 'json') {
        console.error(JSON.stringify({ success: false, error: msg }, null, 2));
      } else {
        console.error(colorError(msg));
      }
      process.exitCode = 1;
    }
  });

  return cmd;
}

/** Add login/logout commands for credential management. */
function addAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Save DIGIT credentials for subsequent commands')
    .requiredOption('--environment <env>', 'DIGIT environment (e.g. self-hosted)')
    .requiredOption('--username <user>', 'DIGIT username')
    .requiredOption('--password <pass>', 'DIGIT password (prefer stdin: echo $PASS | digit login ...)')
    .option('--tenant-id [id]', 'Override tenant ID')
    .option('--state-tenant [id]', 'Override state tenant')
    .action((opts) => {
      console.error('Warning: password passed via flag. Prefer: echo $PASS | digit login ... or set CRS_PASSWORD env var.');
      saveCredentials({
        environment: opts.environment,
        username: opts.username,
        password: opts.password,
        tenant_id: opts.tenantId,
        state_tenant: opts.stateTenant,
      });
      console.log(`Credentials saved to ${getCredentialsPath()}`);
    });

  program
    .command('logout')
    .description('Clear saved DIGIT credentials')
    .action(() => {
      clearCredentials();
      console.log('Credentials cleared.');
    });
}

/** After a successful configure call, persist the credentials. */
function saveConfigureCredentials(args: Record<string, unknown>): void {
  const creds: Record<string, string> = {};
  if (args.environment) creds.environment = String(args.environment);
  if (args.username) creds.username = String(args.username);
  if (args.password) creds.password = String(args.password);
  if (args.tenant_id) creds.tenant_id = String(args.tenant_id);
  if (args.state_tenant) creds.state_tenant = String(args.state_tenant);
  if (Object.keys(creds).length > 0) saveCredentials(creds);
}

/** Format an error message with optional color. */
function colorError(msg: string): string {
  return shouldColor() ? `\x1b[31mError:\x1b[0m ${msg}` : `Error: ${msg}`;
}

/** Truncate long descriptions for help output. */
function truncateDesc(desc: string): string {
  // Take first sentence or first 120 chars
  const firstSentence = desc.split(/\.\s/)[0];
  if (firstSentence.length <= 120) return firstSentence + '.';
  return firstSentence.slice(0, 117) + '...';
}

// --- Main (only when run directly, not when imported by tests) ---

const isMain = process.argv[1]?.replace(/\.ts$/, '').replace(/\.js$/, '').endsWith('/cli');

if (isMain) {
  // Apply stored credentials before anything runs
  applyCredentialsToEnv();

  // Build registry with all tools enabled (CLI doesn't use progressive disclosure)
  const registry = new ToolRegistry();
  registerAllTools(registry);
  registry.enableGroups(ALL_GROUPS);

  const program = buildProgram(registry);

  program.parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
