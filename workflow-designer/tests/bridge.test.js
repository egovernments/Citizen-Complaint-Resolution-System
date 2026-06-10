// tests/bridge.test.js — smoke tests for src/postmessage-bridge.js
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initBridge, BRIDGE_VERSION } from '../src/postmessage-bridge.js';

// Tiny fake Window — enough surface for the bridge.
function makeWin({ name } = {}) {
  const listeners = new Map();
  return {
    name: name || 'win',
    _posted: [],
    addEventListener(type, fn) {
      const set = listeners.get(type) || new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    postMessage(data, targetOrigin) {
      this._posted.push({ data, targetOrigin });
    },
    _dispatch(type, ev) {
      const set = listeners.get(type);
      if (!set) return;
      for (const fn of set) fn(ev);
    },
  };
}

test('posts designer-ready to parent on init', () => {
  const child = makeWin({ name: 'child' });
  const parent = makeWin({ name: 'parent' });

  initBridge({
    onLoad: () => {},
    getCurrent: () => ({ workflow: {}, layout: {} }),
    window: child,
    parent,
  });

  assert.equal(parent._posted.length, 1);
  assert.deepEqual(parent._posted[0].data, {
    type: 'designer-ready',
    version: BRIDGE_VERSION,
  });
});

test('responds to load-workflow from allowed origin', () => {
  const child = makeWin();
  const parent = makeWin();
  let loaded = null;

  initBridge({
    onLoad: (wf, lo) => { loaded = { wf, lo }; },
    getCurrent: () => ({ workflow: {}, layout: {} }),
    window: child,
    parent,
  });

  const incoming = {
    type: 'load-workflow',
    workflow: { businessService: 'PGR', states: [] },
    layout: { canvas: { width: 100, height: 100 }, states: {}, actions: {} },
  };

  child._dispatch('message', {
    origin: 'https://bometfeedbackhub.digit.org',
    data: incoming,
  });

  assert.ok(loaded, 'onLoad should have fired');
  assert.equal(loaded.wf.businessService, 'PGR');
  assert.equal(loaded.lo.canvas.width, 100);
});

test('rejects load-workflow from un-allowed origin', () => {
  const child = makeWin();
  const parent = makeWin();
  let loaded = null;

  initBridge({
    onLoad: (wf, lo) => { loaded = { wf, lo }; },
    getCurrent: () => ({ workflow: {}, layout: {} }),
    window: child,
    parent,
  });

  child._dispatch('message', {
    origin: 'https://evil.example.com',
    data: { type: 'load-workflow', workflow: {x: 1}, layout: {} },
  });

  assert.equal(loaded, null);
});

test('allows extra origins passed in', () => {
  const child = makeWin();
  const parent = makeWin();
  let loaded = null;

  initBridge({
    onLoad: (wf) => { loaded = wf; },
    getCurrent: () => ({ workflow: {}, layout: {} }),
    extraOrigins: ['https://my-extra.example.com'],
    window: child,
    parent,
  });

  child._dispatch('message', {
    origin: 'https://my-extra.example.com',
    data: { type: 'load-workflow', workflow: { ok: true }, layout: {} },
  });

  assert.deepEqual(loaded, { ok: true });
});

test('sendSave posts save-workflow with current state', () => {
  const child = makeWin();
  const parent = makeWin();

  const state = {
    workflow: { businessService: 'PGR', states: [{ state: 'A' }] },
    layout: { canvas: { width: 1, height: 1 }, states: {}, actions: {} },
  };

  const bridge = initBridge({
    onLoad: () => {},
    getCurrent: () => state,
    window: child,
    parent,
  });

  // clear the designer-ready post first
  parent._posted.length = 0;
  bridge.sendSave();

  assert.equal(parent._posted.length, 1);
  assert.deepEqual(parent._posted[0].data, {
    type: 'save-workflow',
    workflow: state.workflow,
    layout: state.layout,
  });
});

test('ignores messages with no/invalid data', () => {
  const child = makeWin();
  const parent = makeWin();
  let count = 0;

  initBridge({
    onLoad: () => { count++; },
    getCurrent: () => ({ workflow: {}, layout: {} }),
    window: child,
    parent,
  });

  child._dispatch('message', { origin: 'https://bometfeedbackhub.digit.org', data: null });
  child._dispatch('message', { origin: 'https://bometfeedbackhub.digit.org', data: 'string' });
  child._dispatch('message', { origin: 'https://bometfeedbackhub.digit.org', data: { type: 'something-else' } });

  assert.equal(count, 0);
});

test('destroy removes the message listener', () => {
  const child = makeWin();
  const parent = makeWin();
  let count = 0;

  const bridge = initBridge({
    onLoad: () => { count++; },
    getCurrent: () => ({ workflow: {}, layout: {} }),
    window: child,
    parent,
  });

  bridge.destroy();
  child._dispatch('message', {
    origin: 'https://bometfeedbackhub.digit.org',
    data: { type: 'load-workflow', workflow: {}, layout: {} },
  });

  assert.equal(count, 0);
});
