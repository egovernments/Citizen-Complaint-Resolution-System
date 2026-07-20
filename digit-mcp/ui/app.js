// DIGIT MCP Session Viewer

const REFRESH_INTERVAL = 10_000;
let refreshTimer = null;
let activeSessionId = null;

// --- DOM refs ---
const $statSessions = document.getElementById('stat-sessions');
const $statTools = document.getElementById('stat-tools');
const $statErrors = document.getElementById('stat-errors');
const $statCheckpoints = document.getElementById('stat-checkpoints');
const $sessionsContainer = document.getElementById('sessions-container');
const $sessionsEmpty = document.getElementById('sessions-empty');
const $detailPlaceholder = document.getElementById('detail-placeholder');
const $detailContent = document.getElementById('detail-content');
const $detailHeader = document.getElementById('detail-header');
const $eventsContainer = document.getElementById('events-container');
const $warningBanner = document.getElementById('warning-banner');
const $autoRefresh = document.getElementById('auto-refresh');

// --- Helpers ---

function fmt(n) {
  if (n == null) return '--';
  return Number(n).toLocaleString();
}

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function shortId(uuid) {
  return uuid ? uuid.slice(0, 8) : '';
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function apiFetch(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (data.error) {
    $warningBanner.classList.remove('hidden');
    return data;
  }
  $warningBanner.classList.add('hidden');
  return data;
}

// --- Stats ---

async function loadStats() {
  const data = await apiFetch('/api/stats');
  $statSessions.textContent = fmt(data.total_sessions);
  $statTools.textContent = fmt(data.total_tools);
  $statErrors.textContent = fmt(data.total_errors);
  $statCheckpoints.textContent = fmt(data.total_checkpoints);
}

// --- Session list ---

async function loadSessions() {
  const data = await apiFetch('/api/sessions?limit=100&offset=0');
  const sessions = data.sessions || [];

  if (sessions.length === 0) {
    $sessionsContainer.innerHTML = '';
    $sessionsEmpty.classList.remove('hidden');
    return;
  }

  $sessionsEmpty.classList.add('hidden');

  $sessionsContainer.innerHTML = sessions.map(s => {
    const isActive = s.id === activeSessionId;
    const hasErrors = s.error_count > 0;
    return `
      <div class="session-card ${isActive ? 'active' : ''}" data-id="${s.id}">
        <div class="session-card-top">
          <span class="session-time">${relativeTime(s.started_at)}</span>
          <span class="badge badge-${s.transport}">${s.transport}</span>
        </div>
        <div class="session-env">${escapeHtml(s.environment || 'unknown')}${s.user_name ? ` &middot; ${escapeHtml(s.user_name)}` : ''}${s.client_name ? ` &middot; <span class="badge badge-client">${escapeHtml(s.client_name)}</span>` : ''}</div>
        <div class="session-stats">
          <span>Tools: ${s.tool_count || 0}</span>
          <span class="${hasErrors ? 'has-errors' : ''}">Err: ${s.error_count || 0}</span>
          <span>CP: ${s.checkpoint_count || 0}</span>
        </div>
      </div>
    `;
  }).join('');

  // Attach click handlers
  $sessionsContainer.querySelectorAll('.session-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      selectSession(id);
    });
  });
}

// --- Session detail ---

async function selectSession(id) {
  activeSessionId = id;

  // Highlight in list
  $sessionsContainer.querySelectorAll('.session-card').forEach(c => {
    c.classList.toggle('active', c.dataset.id === id);
  });

  $detailPlaceholder.classList.add('hidden');
  $detailContent.classList.remove('hidden');

  // Load events
  const data = await apiFetch(`/api/sessions/${id}/events`);
  const events = data.events || [];
  const session = data.session;

  // Header
  if (session) {
    const userLine = session.user_name
      ? `<div class="detail-user"><span>User: <strong>${escapeHtml(session.user_name)}</strong></span>${session.user_purpose ? ` <span>| Purpose: ${escapeHtml(session.user_purpose)}</span>` : ''}${session.client_name ? ` <span>| Client: <strong>${escapeHtml(session.client_name)}</strong></span>` : ''}</div>`
      : (session.client_name ? `<div class="detail-user"><span>Client: <strong>${escapeHtml(session.client_name)}</strong></span></div>` : '');
    const clientMeta = [];
    if (session.user_agent) clientMeta.push(`UA: ${escapeHtml(session.user_agent.length > 60 ? session.user_agent.slice(0, 60) + '...' : session.user_agent)}`);
    if (session.client_ip) clientMeta.push(`IP: ${escapeHtml(session.client_ip)}`);
    $detailHeader.innerHTML = `
      <div class="detail-title">${shortId(session.id)}&hellip;</div>
      ${userLine}
      <div class="detail-meta">
        <span>Started: ${formatTimestamp(session.started_at)}</span>
        <span>Transport: <span class="badge badge-${session.transport}">${session.transport}</span></span>
        <span>Env: ${escapeHtml(session.environment || 'unknown')}</span>
        <span>Tools: ${session.tool_count || 0}</span>
        <span>Errors: ${session.error_count || 0}</span>
        <span>Checkpoints: ${session.checkpoint_count || 0}</span>
      </div>
      ${clientMeta.length > 0 ? `<div class="detail-meta detail-client-meta"><span>${clientMeta.join('</span><span>')}</span></div>` : ''}
    `;
  } else {
    $detailHeader.innerHTML = `<div class="detail-title">${shortId(id)}&hellip;</div>`;
  }

  // Messages (thought chain) take priority over raw events
  const messages = data.messages || [];
  if (messages.length > 0) {
    $eventsContainer.innerHTML = messages.map(m => renderMessage(m)).join('');
    $eventsContainer.scrollTop = $eventsContainer.scrollHeight;
    return;
  }

  // Fallback: raw events
  if (events.length === 0) {
    $eventsContainer.innerHTML = '<div class="empty-state">No events recorded</div>';
    return;
  }

  $eventsContainer.innerHTML = events.map(e => renderEvent(e)).join('');
  $eventsContainer.scrollTop = $eventsContainer.scrollHeight;
}

function renderMessage(m) {
  const turnLabel = `<span class="message-turn">#${m.turn}</span>`;
  const blocks = Array.isArray(m.content) ? m.content : [];

  if (m.role === 'user') {
    const text = blocks
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('\n');
    return `
      <div class="message message-user">
        ${turnLabel}
        <div class="message-role">User</div>
        <div class="message-text">${escapeHtml(text)}</div>
      </div>`;
  }

  if (m.role === 'assistant') {
    return blocks.map(block => {
      if (block.type === 'thinking') {
        const text = (block.thinking || '').trim();
        if (!text) return '';
        return `
          <div class="message message-thinking">
            ${turnLabel}
            <div class="event-body">
              <details>
                <summary>Thinking</summary>
                <pre>${escapeHtml(text)}</pre>
              </details>
            </div>
          </div>`;
      }
      if (block.type === 'text') {
        const text = (block.text || '').trim();
        if (!text) return '';
        return `<div class="message message-assistant-text">${turnLabel}${escapeHtml(text)}</div>`;
      }
      if (block.type === 'tool_use') {
        const argsStr = block.input ? JSON.stringify(block.input, null, 2) : null;
        const toolName = (block.name || '').replace(/^mcp__\w+__/, '');
        return `
          <div class="message message-tool-use">
            ${turnLabel}
            <div class="event-header">
              <span class="event-type call">CALL</span>
              <span class="event-tool">${escapeHtml(toolName)}</span>
            </div>
            ${argsStr ? `
              <div class="event-body">
                <details>
                  <summary>Arguments</summary>
                  <pre>${escapeHtml(argsStr)}</pre>
                </details>
              </div>` : ''}
          </div>`;
      }
      return '';
    }).join('');
  }

  if (m.role === 'tool_result') {
    return blocks.map(block => {
      if (block.type !== 'tool_result') return '';
      const isError = block.is_error || false;
      const cssClass = isError ? 'message-tool-result-error' : 'message-tool-result-ok';
      const typeClass = isError ? 'result-error' : 'result-ok';
      const typeLabel = isError ? 'ERROR' : 'OK';

      // Extract text from content (can be string or array of {type:"text", text:...})
      let text = '';
      if (typeof block.content === 'string') {
        text = block.content;
      } else if (Array.isArray(block.content)) {
        text = block.content
          .filter(c => c.type === 'text')
          .map(c => c.text || '')
          .join('\n');
      }

      // Truncate very long results for display
      const displayText = text.length > 2000 ? text.slice(0, 2000) + '\n... (truncated)' : text;

      return `
        <div class="message ${cssClass}">
          ${turnLabel}
          <div class="event-header">
            <span class="event-type ${typeClass}">${typeLabel}</span>
          </div>
          ${displayText ? `
            <div class="event-body">
              <details>
                <summary>Result</summary>
                <pre>${escapeHtml(displayText)}</pre>
              </details>
            </div>` : ''}
        </div>`;
    }).join('');
  }

  return '';
}

function renderEvent(e) {
  if (e.type === 'checkpoint') {
    return `
      <div class="checkpoint-divider">
        <span class="checkpoint-label">Checkpoint</span>
      </div>
      <div class="event checkpoint">
        <div class="event-header">
          <span class="event-seq">#${e.seq}</span>
          <span class="event-type cp">CP</span>
          <span class="event-duration">${formatTimestamp(e.ts)}</span>
        </div>
        ${e.summary ? `<div class="event-summary">${escapeHtml(e.summary)}</div>` : ''}
        ${e.recent_tools && e.recent_tools.length ? `
          <div class="event-body">
            <details>
              <summary>Recent tools (${e.recent_tools.length})</summary>
              <pre>${escapeHtml(e.recent_tools.join(', '))}</pre>
            </details>
          </div>
        ` : ''}
      </div>
    `;
  }

  if (e.type === 'tool_call') {
    const argsStr = e.args ? JSON.stringify(e.args, null, 2) : null;
    return `
      <div class="event tool-call">
        <div class="event-header">
          <span class="event-seq">#${e.seq}</span>
          <span class="event-type call">CALL</span>
          <span class="event-tool">${escapeHtml(e.tool)}</span>
        </div>
        ${argsStr ? `
          <div class="event-body">
            <details>
              <summary>Arguments</summary>
              <pre>${escapeHtml(argsStr)}</pre>
            </details>
          </div>
        ` : ''}
      </div>
    `;
  }

  if (e.type === 'tool_result') {
    const isError = e.is_error;
    const cssClass = isError ? 'tool-result-error' : 'tool-result-ok';
    const typeClass = isError ? 'result-error' : 'result-ok';
    const typeLabel = isError ? 'ERROR' : 'OK';
    const duration = e.duration_ms != null ? `${e.duration_ms}ms` : '';

    return `
      <div class="event ${cssClass}">
        <div class="event-header">
          <span class="event-seq">#${e.seq}</span>
          <span class="event-type ${typeClass}">${typeLabel}</span>
          <span class="event-tool">${escapeHtml(e.tool)}</span>
          ${duration ? `<span class="event-duration">${duration}</span>` : ''}
        </div>
        ${e.error_message ? `<div class="event-error-msg">${escapeHtml(e.error_message)}</div>` : ''}
        ${e.result_summary ? `
          <div class="event-body">
            <details>
              <summary>Result</summary>
              <pre>${escapeHtml(e.result_summary)}</pre>
            </details>
          </div>
        ` : ''}
      </div>
    `;
  }

  return '';
}

// --- Auto-refresh ---

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(async () => {
    await loadStats();
    await loadSessions();
    if (activeSessionId) {
      await selectSession(activeSessionId);
    }
  }, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

$autoRefresh.addEventListener('change', () => {
  if ($autoRefresh.checked) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
});

// --- Init ---

async function init() {
  await loadStats();
  await loadSessions();
  if ($autoRefresh.checked) {
    startAutoRefresh();
  }
}

init();
