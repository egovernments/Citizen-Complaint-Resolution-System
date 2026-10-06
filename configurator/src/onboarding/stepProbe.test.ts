import { describe, expect, it } from 'vitest';
import { probeGate } from './stepProbe';

const ready = { ready: true };

describe('probeGate', () => {
  it('keeps the step’s own hint while its own check fails', () => {
    expect(probeGate('EMPLOYEES', { ready: false, hint: 'Add at least one employee to continue.' }, { status: 'known', passed: true, legacy: false }))
      .toEqual({ disabled: true, hint: 'Add at least one employee to continue.', canRecheck: false });
  });

  it('waits while the server check runs', () => {
    expect(probeGate('EMPLOYEES', ready, { status: 'checking' }).disabled).toBe(true);
  });

  it('enables Continue only when the server check passes', () => {
    expect(probeGate('DEPARTMENTS', ready, { status: 'known', passed: true, legacy: false })).toEqual({ disabled: false, canRecheck: false });
  });

  it('says what the server still needs when its check fails', () => {
    const gate = probeGate('DEPARTMENTS', ready, { status: 'known', passed: false, legacy: false });
    expect(gate.disabled).toBe(true);
    expect(gate.hint).toBe('Not complete yet. Add at least one department and one designation.');
    expect(gate.canRecheck).toBe(true);
  });

  it('never reads an unknown result as passing', () => {
    const gate = probeGate('GEOGRAPHY', ready, { status: 'known', passed: null, legacy: false });
    expect(gate.disabled).toBe(true);
    expect(gate.canRecheck).toBe(true);
  });

  it('does not gate a legacy workspace, which has no probes', () => {
    expect(probeGate('GEOGRAPHY', ready, { status: 'known', passed: null, legacy: true }).disabled).toBe(false);
  });
});
