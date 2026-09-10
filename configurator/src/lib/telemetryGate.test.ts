/**
 * The polarity of this gate is the whole point of these tests: absent flag means
 * NOT killed, because every environment running this app today is already
 * sending telemetry and defaulting to "off" would silently change their
 * behaviour. A regression that flips the default would be invisible in
 * production — nothing errors, data just stops (or keeps) flowing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isTelemetryKilled, isTelemetryEnabled } from './telemetryGate';

describe('telemetryGate', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.__CFG_TELEMETRY__;
  });

  afterEach(() => {
    window.localStorage.clear();
    delete window.__CFG_TELEMETRY__;
  });

  it('is NOT killed when nothing says otherwise', () => {
    expect(isTelemetryKilled()).toBe(false);
    expect(isTelemetryEnabled()).toBe(true);
  });

  it('is killed by the per-browser opt-out, using the same key as the portal shim', () => {
    window.localStorage.setItem('digit.analytics.off', '1');
    expect(isTelemetryKilled()).toBe(true);
  });

  it('ignores any other value of the opt-out key', () => {
    window.localStorage.setItem('digit.analytics.off', 'true');
    expect(isTelemetryKilled()).toBe(false);
    window.localStorage.setItem('digit.analytics.off', '0');
    expect(isTelemetryKilled()).toBe(false);
  });

  it('is killed by the runtime flag from public/telemetry-config.js', () => {
    window.__CFG_TELEMETRY__ = { kill: true };
    expect(isTelemetryKilled()).toBe(true);
  });

  it('treats the shipped default (kill: false) as not killed', () => {
    window.__CFG_TELEMETRY__ = { kill: false };
    expect(isTelemetryKilled()).toBe(false);
  });

  it('requires the flag to be exactly true, not merely truthy', () => {
    window.__CFG_TELEMETRY__ = { kill: 'true' as unknown as boolean };
    expect(isTelemetryKilled()).toBe(false);
  });

  it('survives a malformed flag object', () => {
    window.__CFG_TELEMETRY__ = null as unknown as { kill?: boolean };
    expect(() => isTelemetryKilled()).not.toThrow();
    expect(isTelemetryKilled()).toBe(false);
  });

  it('survives storage that throws, without killing telemetry', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage is blocked in this context');
      },
    });
    try {
      expect(() => isTelemetryKilled()).not.toThrow();
      expect(isTelemetryKilled()).toBe(false);
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });

  it('lets the browser opt-out win even when the runtime flag says keep going', () => {
    window.__CFG_TELEMETRY__ = { kill: false };
    window.localStorage.setItem('digit.analytics.off', '1');
    expect(isTelemetryKilled()).toBe(true);
  });
});
