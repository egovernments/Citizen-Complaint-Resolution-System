import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ours#544 / #1635: react-admin pings react-admin-telemetry.marmelab.com from CoreAdminUI unless disableTelemetry is set
describe('react-admin telemetry', () => {
  it('the management app turns it off', () => {
    const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
    const tags = app.match(/<CoreAdminUI\s[^>]*>/g) ?? []; // the JSX element, not a "<CoreAdminUI>" in a comment
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) expect(t).toMatch(/\bdisableTelemetry\b/);
  });
});
