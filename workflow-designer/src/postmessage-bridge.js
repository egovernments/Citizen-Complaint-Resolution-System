// =====================================================================
// postMessage bridge — when running inside an iframe, talks to the parent.
//
// Outbound:
//   { type: 'designer-ready', version }     once on init
//   { type: 'save-workflow', workflow, layout }  when Save button clicked
//
// Inbound (from parent):
//   { type: 'load-workflow', workflow, layout }
//     → validated against ALLOWED_ORIGINS, then onLoad(workflow, layout)
//
// Allowed parent origins are baked in here; pass `extraOrigins` to widen.
// =====================================================================

export const BRIDGE_VERSION = '0.1.0';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://bometfeedbackhub.digit.org',
  'https://naipepea.digit.org',
  'http://localhost',
  'https://localhost',
];

/**
 * Initialise the bridge.
 *
 * @param {object}   opts
 * @param {function} opts.onLoad         — called with (workflow, layout) when parent posts 'load-workflow'
 * @param {function} opts.getCurrent     — () => ({ workflow, layout }); used by sendSave()
 * @param {string[]} [opts.extraOrigins] — additional origins to whitelist beyond the defaults
 * @param {Window}   [opts.window]       — window override (for tests)
 * @param {Window}   [opts.parent]       — parent override (for tests); defaults to window.parent
 *
 * @returns {{ sendSave: () => void, destroy: () => void, allowedOrigins: string[] }}
 */
export function initBridge({ onLoad, getCurrent, extraOrigins = [], window: win, parent } = {}) {
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  if (!w) throw new Error('initBridge: no window available');
  const p = parent || w.parent;

  const allowed = [...DEFAULT_ALLOWED_ORIGINS, ...extraOrigins];

  function originAllowed(origin) {
    if (!origin) return false;
    if (allowed.includes(origin)) return true;
    // Allow any localhost:* port
    try {
      const u = new URL(origin);
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    } catch (_) { /* ignore */ }
    return false;
  }

  function onMessage(ev) {
    if (!originAllowed(ev.origin)) {
      // eslint-disable-next-line no-console
      console.warn('[designer-bridge] rejected message from', ev.origin);
      return;
    }
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'load-workflow') {
      if (typeof onLoad === 'function') {
        try {
          onLoad(msg.workflow, msg.layout);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[designer-bridge] onLoad threw', err);
        }
      }
    }
  }

  w.addEventListener('message', onMessage);

  // Announce we're alive (use '*' for ready since we don't know yet which origin)
  if (p && p !== w) {
    try {
      p.postMessage({ type: 'designer-ready', version: BRIDGE_VERSION }, '*');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[designer-bridge] could not post ready', err);
    }
  }

  function sendSave() {
    if (!p || p === w) return;
    const cur = typeof getCurrent === 'function' ? getCurrent() : null;
    if (!cur) return;
    try {
      p.postMessage(
        { type: 'save-workflow', workflow: cur.workflow, layout: cur.layout },
        '*'
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[designer-bridge] could not post save', err);
    }
  }

  function destroy() {
    w.removeEventListener('message', onMessage);
  }

  return { sendSave, destroy, allowedOrigins: allowed };
}

export const __test__ = { DEFAULT_ALLOWED_ORIGINS };
