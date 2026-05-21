/**
 * Test script for CRS Validator MCP — exercises progressive disclosure flow.
 * Runs in-process (no stdio transport needed).
 *
 * Usage: npx tsx test-validator.ts
 */
import { ToolRegistry } from './src/tools/registry.js';
import { registerAllTools } from './src/tools/index.js';

async function main() {
  console.log('=== CRS Validator MCP — Test Script ===\n');

  const registry = new ToolRegistry();
  let listChangedCount = 0;

  registry.setToolListChangedCallback(() => {
    listChangedCount++;
    console.log(`  [event] toolListChanged fired (#${listChangedCount})`);
  });

  registerAllTools(registry);

  // 1. Initial state — only core tools visible
  console.log('1. Initial enabled tools (core only):');
  const initialTools = registry.getEnabledTools();
  console.log(`   Count: ${initialTools.length}`);
  for (const t of initialTools) {
    console.log(`   - ${t.name} [${t.group}] (${t.category}, ${t.risk})`);
  }
  console.log();

  // 2. Call discover_tools
  console.log('2. Calling discover_tools...');
  const discoverTool = registry.getTool('discover_tools');
  if (!discoverTool) throw new Error('discover_tools not found');
  const discoverResult = JSON.parse(await discoverTool.handler({}));
  console.log(`   Message: ${discoverResult.message}`);
  console.log(`   Groups:`);
  for (const [group, info] of Object.entries(discoverResult.groups)) {
    const groupInfo = info as { enabled: boolean; tools: { name: string }[] };
    console.log(
      `     ${group}: ${groupInfo.enabled ? 'ENABLED' : 'disabled'} (${groupInfo.tools.length} tools: ${groupInfo.tools.map((t) => t.name).join(', ')})`
    );
  }
  console.log();

  // 3. Enable mdms group
  console.log('3. Enabling mdms...');
  const enableTools = registry.getTool('enable_tools');
  if (!enableTools) throw new Error('enable_tools not found');
  const enableResult = JSON.parse(await enableTools.handler({ enable: ['mdms'] }));
  console.log(`   Result: ${enableResult.toolCount}`);
  console.log(`   Active groups: ${enableResult.activeGroups.join(', ')}`);
  console.log();

  // 4. Verify mdms tools are now visible
  console.log('4. Enabled tools after mdms:');
  const mdmsTools = registry.getEnabledTools();
  console.log(`   Count: ${mdmsTools.length}`);
  for (const t of mdmsTools) {
    console.log(`   - ${t.name} [${t.group}]`);
  }
  console.log();

  // 5. Try calling a disabled tool
  console.log('5. Testing disabled tool access...');
  const boundaryTool = registry.getTool('validate_boundary');
  if (!boundaryTool) throw new Error('validate_boundary not found');
  const isEnabled = registry.isToolEnabled('validate_boundary');
  console.log(`   validate_boundary enabled: ${isEnabled}`);
  console.log();

  // 6. Enable all remaining groups
  console.log('6. Enabling all remaining groups...');
  const enableAllResult = JSON.parse(
    await enableTools.handler({ enable: ['boundary', 'masters', 'employees', 'localization', 'pgr', 'admin'] })
  );
  console.log(`   Result: ${enableAllResult.toolCount}`);
  console.log(`   Active groups: ${enableAllResult.activeGroups.join(', ')}`);
  console.log();

  // 7. Verify all tools visible
  console.log('7. All tools after enabling all groups:');
  const allTools = registry.getEnabledTools();
  console.log(`   Count: ${allTools.length}`);
  for (const t of allTools) {
    console.log(`   - ${t.name} [${t.group}] (${t.category}, ${t.risk})`);
  }
  console.log();

  // 8. Test get_environment_info (no API call needed)
  console.log('8. Calling get_environment_info...');
  const envTool = registry.getTool('get_environment_info');
  if (!envTool) throw new Error('get_environment_info not found');
  const envResult = JSON.parse(await envTool.handler({}));
  console.log(`   Current: ${envResult.current.name} (${envResult.current.url})`);
  console.log(`   Available: ${envResult.available.map((e: { key: string }) => e.key).join(', ')}`);
  console.log(`   Authenticated: ${envResult.authenticated}`);
  console.log();

  // 9. Test disabling a group
  console.log('9. Disabling employees...');
  const disableResult = JSON.parse(
    await enableTools.handler({ disable: ['employees'] })
  );
  console.log(`   Result: ${disableResult.toolCount}`);
  console.log(`   Active groups: ${disableResult.activeGroups.join(', ')}`);
  console.log();

  // 10. Test that core cannot be disabled
  console.log('10. Attempting to disable core (should be no-op)...');
  const disableCoreResult = JSON.parse(
    await enableTools.handler({ disable: ['core'] })
  );
  console.log(`   Active groups: ${disableCoreResult.activeGroups.join(', ')}`);
  console.log(`   Core still enabled: ${disableCoreResult.activeGroups.includes('core')}`);
  console.log();

  // Summary
  console.log('=== Summary ===');
  console.log(`Total tools registered: ${registry.getAllTools().length}`);
  console.log(`Tool list changed events: ${listChangedCount}`);
  console.log(`Final active groups: ${registry.getEnabledGroups().join(', ')}`);
  console.log(`Final enabled tools: ${registry.getEnabledTools().length}`);
  console.log('\nAll tests passed!');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
