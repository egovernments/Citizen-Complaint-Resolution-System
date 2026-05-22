/**
 * Matomo telemetry for DIGIT MCP server.
 *
 * Sends lightweight usage events to Matomo (fire-and-forget, opt-out via TELEMETRY=false).
 * Uses the same Matomo instance and conventions as the CCRS local-setup telemetry.
 *
 * Events sent:
 *   - mcp / session_start    — new MCP session
 *   - mcp / tool_call        — tool invocation (name=tool, value=group)
 *   - mcp / tool_error       — tool failure (name=tool, value=error summary)
 *   - mcp / session_end      — session summary (name=transport, value=tool_count)
 */

import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MATOMO_URL = process.env.MATOMO_URL || 'https://unified-demo.digit.org/matomo/matomo.php';
const MATOMO_SITE_ID = process.env.MATOMO_SITE_ID || '5';
const UA = 'Mozilla/5.0 (DIGIT-MCP/1.0; Linux) AppleWebKit/537.36';

function isEnabled(): boolean {
  return (process.env.TELEMETRY ?? 'true').toLowerCase() !== 'false';
}

// Stable visitor ID: SHA256(hostname)[0:16] — same approach as CCRS telemetry
const VISITOR_ID = createHash('sha256').update(hostname()).digest('hex').slice(0, 16);

// ---------------------------------------------------------------------------
// Core sender
// ---------------------------------------------------------------------------

/**
 * Send a Matomo event. Fire-and-forget: never throws, never blocks the caller.
 */
function sendEvent(
  category: string,
  action: string,
  name?: string,
  value?: string | number
): void {
  if (!isEnabled()) return;

  const params = new URLSearchParams({
    idsite: MATOMO_SITE_ID,
    rec: '1',
    e_c: category,
    e_a: action,
    _id: VISITOR_ID,
    url: `https://local-setup.digit.org/mcp/${category}/${action}`,
    apiv: '1',
  });

  if (name) params.set('e_n', name);
  if (value !== undefined) params.set('e_v', String(value));

  fetch(MATOMO_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    // Fire-and-forget: silently ignore all errors
  });
}

// ---------------------------------------------------------------------------
// Public API — called from session-store.ts and server.ts
// ---------------------------------------------------------------------------

export const telemetry = {
  /** New MCP session started. */
  sessionStart(transport: 'stdio' | 'http', environment: string): void {
    sendEvent('mcp', 'session_start', transport, undefined);
  },

  /** Tool was invoked. */
  toolCall(tool: string, group: string): void {
    sendEvent('mcp', 'tool_call', tool, undefined);
  },

  /** Tool invocation failed. */
  toolError(tool: string, errorMessage: string): void {
    // Truncate error to avoid huge payloads
    const summary = errorMessage.length > 120 ? errorMessage.slice(0, 120) : errorMessage;
    sendEvent('mcp', 'tool_error', tool, undefined);
  },

  /** Init tool called — records client identity. */
  initCalled(clientName: string, purpose: string): void {
    sendEvent('mcp', 'init', clientName, undefined);
  },

  /** Session ended (or flush on checkpoint). */
  sessionSummary(transport: string, toolCount: number, errorCount: number): void {
    sendEvent('mcp', 'session_summary', transport, toolCount);
  },
};
