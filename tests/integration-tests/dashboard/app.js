/* Dashboard SPA — vanilla JS. Reads catalog.json, renders facet sidebar +
 * filterable table + per-test detail pane.
 *
 * Filter semantics:
 *   - Status filter (passed/failed/skipped/never-ran): OR within the group.
 *   - Each facet (persona/area/layer/kind/ccrs/health): OR within the group.
 *   - Across groups: AND.
 *   - Search box: substring match on title or file path.
 */
'use strict';

const FACET_LABELS = {
  persona: 'Persona',
  area:    'Area',
  layer:   'Layer',
  kind:    'Kind',
  ccrs:    'CCRS issue',
  pr:      'PR',
  health:  'Health',
};
const FACET_ORDER = ['persona', 'area', 'layer', 'kind', 'ccrs', 'pr', 'health'];

const STATUS_OPTIONS = [
  { value: 'passed',   label: 'Passed'  },
  { value: 'failed',   label: 'Failed'  },
  { value: 'timedOut', label: 'Timed out' },
  { value: 'skipped',  label: 'Skipped' },
  { value: 'never',    label: 'Never ran' },
];

const state = {
  catalog: null,
  filters: {
    status: new Set(),
    facets: {},   // { persona: Set, area: Set, ... }
    search: '',
  },
  selectedId: null,
};

async function init() {
  try {
    const resp = await fetch('catalog.json', { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.catalog = await resp.json();
  } catch (e) {
    document.getElementById('content').innerHTML =
      `<p style="color:var(--fail)">Failed to load catalog.json: ${escapeHtml(e.message)}</p>`;
    return;
  }
  for (const facet of FACET_ORDER) state.filters.facets[facet] = new Set();
  renderRunSummary();
  renderStatusFilter();
  renderFacetFilters();
  renderTable();
  hookSearch();
  hookClear();
  hookHash();
}

function renderRunSummary() {
  const r = (state.catalog.runs || [])[0];
  const el = document.getElementById('run-summary');
  if (!r) { el.textContent = 'no runs yet'; return; }
  const ago = relTime(r.startedAt);
  el.innerHTML = [
    `<strong>${escapeHtml(r.id)}</strong>`,
    `<span class="pill pass">${r.passed} passed</span>`,
    `<span class="pill fail">${r.failed} failed</span>`,
    `<span class="pill skip">${r.skipped} skipped</span>`,
    `<span class="muted">${r.total} total · ${formatDuration(r.durationMs)} · ${escapeHtml(r.branch)}@${escapeHtml(r.sha || '?')} · ${ago}</span>`,
    `<span class="muted">vs ${escapeHtml(r.baseUrl)}</span>`,
  ].join(' ');
  renderRunSwitcher();
}

/**
 * Renders a small panel showing every run in catalog.runs (oldest+newest).
 * Each chip links to that run's standalone Playwright HTML report at
 * /tests/runs/<id>/playwright-report/, so users can dig into any historical
 * run's video/trace/etc independently of which run is currently 'latest' in
 * the catalog. The current latest run is marked with a star.
 */
function renderRunSwitcher() {
  const el = document.getElementById('run-switcher');
  const runs = state.catalog.runs || [];
  if (runs.length === 0) { el.innerHTML = ''; return; }
  const latestId = state.catalog.lastRunId;
  const chips = runs.map(r => {
    const isLatest = r.id === latestId;
    const ago = relTime(r.startedAt);
    const summary = `${r.passed}/${r.total} pass`;
    const tooltip = `${r.id} · ${ago} · ${r.passed}p ${r.failed}f ${r.skipped}s`;
    return `<a class="run-chip${isLatest ? ' latest' : ''}" target="_blank" rel="noopener"
       href="runs/${escapeAttr(r.id)}/playwright-report/index.html"
       title="${escapeAttr(tooltip)}">
       ${isLatest ? '★ ' : ''}${escapeHtml(r.id.split('_').slice(0,2).join(' '))}
       <span class="run-chip-stats">${summary}</span>
     </a>`;
  }).join('');
  el.innerHTML = `<span class="run-switcher-label">Runs:</span> ${chips}`;
}

function renderStatusFilter() {
  const counts = { passed: 0, failed: 0, timedOut: 0, skipped: 0, never: 0 };
  for (const t of state.catalog.tests) {
    const s = t.lastStatus || 'never';
    counts[s] = (counts[s] || 0) + 1;
  }
  const wrap = document.getElementById('filter-status');
  wrap.innerHTML = STATUS_OPTIONS.map(opt => {
    const c = counts[opt.value] || 0;
    return `<label><input type="checkbox" data-status="${opt.value}"> ${opt.label} <span class="count">${c}</span></label>`;
  }).join('');
  wrap.querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', () => {
      const v = cb.dataset.status;
      if (cb.checked) state.filters.status.add(v);
      else state.filters.status.delete(v);
      renderTable();
    });
  });
}

function renderFacetFilters() {
  const counts = {};   // counts[facet][value]
  for (const t of state.catalog.tests) {
    for (const tag of t.tags) {
      const m = tag.match(/^@([a-z]+):(.+)$/i);
      if (!m) continue;
      const [_, facet, value] = m;
      (counts[facet] ||= {})[value] = (counts[facet]?.[value] || 0) + 1;
    }
  }
  const root = document.getElementById('facet-filters');
  root.innerHTML = '';
  for (const facet of FACET_ORDER) {
    const values = (state.catalog.tagFacets || {})[facet] || [];
    if (!values.length) continue;
    const sec = document.createElement('section');
    sec.className = 'filter-group';
    sec.innerHTML = `<h3>${escapeHtml(FACET_LABELS[facet] || facet)}</h3>` +
      `<div class="filter-options">` +
      values.map(v => {
        const c = (counts[facet] || {})[v] || 0;
        return `<label><input type="checkbox" data-facet="${escapeHtml(facet)}" data-value="${escapeHtml(v)}"> ${escapeHtml(v)} <span class="count">${c}</span></label>`;
      }).join('') +
      `</div>`;
    root.appendChild(sec);
  }
  root.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const facet = cb.dataset.facet;
      const value = cb.dataset.value;
      const set = state.filters.facets[facet] ||= new Set();
      if (cb.checked) set.add(value); else set.delete(value);
      renderTable();
    });
  });
}

function applyFilters(tests) {
  const f = state.filters;
  return tests.filter(t => {
    if (f.status.size) {
      const s = t.lastStatus || 'never';
      if (!f.status.has(s)) return false;
    }
    for (const facet of FACET_ORDER) {
      const want = f.facets[facet];
      if (!want || !want.size) continue;
      const have = new Set();
      for (const tag of t.tags) {
        const m = tag.match(/^@([a-z]+):(.+)$/i);
        if (m && m[1] === facet) have.add(m[2]);
      }
      let any = false;
      for (const v of want) if (have.has(v)) { any = true; break; }
      if (!any) return false;
    }
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!t.title.toLowerCase().includes(q)
          && !t.file.toLowerCase().includes(q)
          && !t.describe.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function renderTable() {
  const filtered = applyFilters(state.catalog.tests);
  document.getElementById('result-meta').textContent =
    `${filtered.length} of ${state.catalog.tests.length} tests shown`;
  const tbody = document.querySelector('#test-table tbody');
  tbody.innerHTML = filtered.map(t => rowHtml(t)).join('');
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => selectTest(tr.dataset.id));
  });
  if (state.selectedId) {
    const sel = tbody.querySelector(`tr[data-id="${cssEscape(state.selectedId)}"]`);
    if (sel) sel.classList.add('selected');
  }
}

function rowHtml(t) {
  const dots = renderDots(t.history);
  const tags = t.tags.map(tagChipHtml).join('');
  const status = t.lastStatus || 'unknown';
  const dur = t.lastDurationMs != null ? formatDuration(t.lastDurationMs) : '—';
  return `<tr data-id="${escapeAttr(t.id)}">
    <td class="title-cell">${escapeHtml(t.title)}<div class="describe">${escapeHtml(t.describe)}</div></td>
    <td class="file-cell" title="${escapeAttr(t.file)}:${t.line}">${escapeHtml(t.file)}:${t.line}</td>
    <td class="tag-cell">${tags}</td>
    <td class="numeric"><div class="dot-row">${dots}</div></td>
    <td class="numeric">${dur}</td>
    <td><span class="status-badge ${escapeHtml(status)}">${escapeHtml(status)}</span></td>
  </tr>`;
}

function renderDots(history) {
  const slots = 5;
  const out = [];
  for (let i = 0; i < slots; i++) {
    const h = history[i];
    if (!h) { out.push('<span class="dot empty"></span>'); continue; }
    out.push(`<span class="dot ${escapeHtml(h.status)}" title="${escapeHtml(h.runId)} · ${escapeHtml(h.status)} · ${formatDuration(h.durationMs)}"></span>`);
  }
  return out.join('');
}

function tagChipHtml(tag) {
  const m = tag.match(/^@([a-z]+):(.+)$/i);
  const facet = m ? m[1] : 'other';
  const value = m ? m[2] : tag;
  return `<span class="tag-chip" data-facet="${escapeAttr(facet)}" data-value="${escapeAttr(value)}" data-tag="${escapeAttr(tag)}">${escapeHtml(value)}</span>`;
}

function selectTest(id) {
  state.selectedId = id;
  location.hash = `#test/${encodeURIComponent(id)}`;
  document.querySelectorAll('#test-table tbody tr').forEach(tr => {
    tr.classList.toggle('selected', tr.dataset.id === id);
  });
  renderDetail(id);
}

function renderDetail(id) {
  const t = state.catalog.tests.find(x => x.id === id);
  const detail = document.getElementById('detail');
  document.getElementById('layout').classList.add('with-detail');
  if (!t) {
    detail.hidden = false;
    detail.innerHTML = `<p>Test not found: ${escapeHtml(id)}</p>`;
    return;
  }
  detail.hidden = false;
  const lr = t.latestRun;
  const tagChips = t.tags.map(tagChipHtml).join(' ');
  const dots = renderDots(t.history);
  const error = (lr && (lr.errorMessage || lr.errorStack))
    ? `<div class="section"><h4>Error</h4><pre class="error">${escapeHtml((lr.errorMessage || '') + '\n\n' + (lr.errorStack || ''))}</pre></div>`
    : '';
  const screenshots = (lr && lr.screenshotUrls && lr.screenshotUrls.length)
    ? `<div class="section"><h4>Screenshots</h4><div class="screenshot-thumbs">${lr.screenshotUrls.map(u => `<a href="${escapeAttr(u)}" target="_blank"><img src="${escapeAttr(u)}" loading="lazy"></a>`).join('')}</div></div>`
    : '';
  const video = (lr && lr.videoUrl)
    ? `<div class="section"><h4>Video</h4><video src="${escapeAttr(lr.videoUrl)}" controls preload="metadata"></video></div>`
    : `<div class="section"><h4>Video</h4><p class="muted">No video for the latest run (test did not run, or media capture disabled).</p></div>`;
  const trace = (lr && lr.traceUrl)
    ? `<a href="${escapeAttr(lr.traceUrl)}" target="_blank">Open trace.zip</a>`
    : '';
  const reportLink = (lr && lr.runId)
    ? `<a href="runs/${escapeAttr(lr.runId)}/playwright-report/index.html" target="_blank">Open Playwright report</a>`
    : '';
  const description = t.description
    ? `<div class="section"><h4>Description</h4><div class="description-body">${descriptionToHtml(t.description)}</div></div>`
    : `<div class="section"><h4>Description</h4><p class="muted">No description yet — add one to the test as <code>annotation: { type: 'description', description: '…' }</code>.</p></div>`;

  detail.innerHTML = `
    <button class="close-btn" id="close-detail" aria-label="Close">×</button>
    <h2>${escapeHtml(t.title)}</h2>
    <div class="describe">${escapeHtml(t.describe)} · ${escapeHtml(t.file)}:${t.line}</div>
    ${description}
    <div class="section"><h4>Tags</h4>${tagChips}</div>
    <div class="section"><h4>Last 5 runs</h4><div class="dot-row">${dots}</div><div class="history-row">${historyHtml(t.history)}</div></div>
    ${video}
    ${screenshots}
    <div class="section"><h4>Actions</h4><div class="actions">${trace} ${reportLink} <button id="copy-claude-prompt">Copy as Claude prompt</button></div></div>
    ${error}
    <div class="section"><h4>Source</h4><pre class="source">${escapeHtml(t.source)}</pre></div>
  `;
  document.getElementById('close-detail').addEventListener('click', () => {
    document.getElementById('layout').classList.remove('with-detail');
    detail.hidden = true;
    state.selectedId = null;
    if (location.hash.startsWith('#test/')) history.replaceState(null, '', location.pathname + location.search);
  });
  const copyBtn = document.getElementById('copy-claude-prompt');
  copyBtn.addEventListener('click', () => {
    const prompt = buildClaudePrompt(t);
    navigator.clipboard.writeText(prompt).then(() => {
      copyBtn.textContent = 'Copied ✓';
      setTimeout(() => (copyBtn.textContent = 'Copy as Claude prompt'), 1400);
    }, () => {
      copyBtn.textContent = 'Copy failed';
    });
  });
  detail.querySelectorAll('.tag-chip, a.ref-link').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      const facet = el.dataset.facet;
      const value = el.dataset.value;
      if (!facet || !value) return;
      const set = state.filters.facets[facet] ||= new Set();
      set.add(value);
      const cb = document.querySelector(`#facet-filters input[data-facet="${cssEscape(facet)}"][data-value="${cssEscape(value)}"]`);
      if (cb) cb.checked = true;
      renderTable();
    });
  });
}

/**
 * Render the multi-paragraph annotation.description into HTML.
 * Format expected from build-catalog (mirrors what authors write):
 *   <opening paragraph>
 *
 *   Steps:
 *   1. …
 *   2. …
 *
 *   <closing paragraph>
 *
 * We split on blank lines, then for each block look for "Steps:" followed by
 * numbered lines and turn that into an <ol>. Other blocks render as <p>.
 */
function descriptionToHtml(text) {
  const blocks = text.trim().split(/\n{2,}/);
  return blocks.map(block => {
    if (/^Steps:\s*$/m.test(block.split('\n')[0])) {
      const lines = block.split('\n').slice(1);
      const items = lines
        .map(l => l.replace(/^\s*\d+\.\s*/, '').trim())
        .filter(Boolean);
      return `<p class="steps-heading">Steps:</p><ol class="steps-list">${items.map(s => `<li>${linkifyAndEscape(s)}</li>`).join('')}</ol>`;
    }
    return `<p>${linkifyAndEscape(block)}</p>`;
  }).join('');
}

/**
 * HTML-escape and turn CCRS#NNN / PR#NN references into clickable filter chips.
 * The dashboard already filters by ccrs/pr facets; clicking a reference adds
 * it to the active filter so you can see all related tests.
 */
function linkifyAndEscape(s) {
  let out = escapeHtml(s);
  // CCRS#NNN -> filter chip
  out = out.replace(/\bCCRS#(\d+)\b/g, (_m, num) =>
    `<a class="ref-link" href="#ccrs/${num}" data-facet="ccrs" data-value="${num}">CCRS#${num}</a>`);
  // PR #NN or PR#NN
  out = out.replace(/\bPR\s*#(\d+)\b/g, (_m, num) =>
    `<a class="ref-link" href="#pr/${num}" data-facet="pr" data-value="${num}">PR#${num}</a>`);
  return out;
}

function buildClaudePrompt(t) {
  const lr = t.latestRun;
  const status = t.lastStatus || 'never ran';
  const errorBlock = lr && (lr.errorMessage || lr.errorStack)
    ? `\n\nError:\n${lr.errorMessage || ''}\n${lr.errorStack || ''}`
    : '';
  const videoLine = lr && lr.videoUrl
    ? `Latest video: ${absoluteUrl(lr.videoUrl)}`
    : 'No video for the latest run.';
  const intentBlock = t.description
    ? `\nWhat this test is meant to verify (author's description):\n${t.description}\n`
    : '';
  return [
    `This Playwright test is at ${t.file}:${t.line}:`,
    '',
    t.source,
    intentBlock,
    `Last run status: ${status}.`,
    videoLine,
    errorBlock,
  ].filter(Boolean).join('\n');
}

function historyHtml(history) {
  if (!history.length) return '<span class="muted">no prior runs</span>';
  return history.map(h => `${h.runId}: ${h.status} (${formatDuration(h.durationMs)})`).join(' · ');
}

function hookSearch() {
  const input = document.getElementById('search');
  input.addEventListener('input', () => {
    state.filters.search = input.value.trim();
    renderTable();
  });
}

function hookClear() {
  document.getElementById('clear-filters').addEventListener('click', () => {
    state.filters.status.clear();
    for (const facet of FACET_ORDER) state.filters.facets[facet]?.clear();
    state.filters.search = '';
    document.querySelectorAll('#filters input[type="checkbox"]').forEach(cb => (cb.checked = false));
    document.getElementById('search').value = '';
    renderTable();
  });
}

function hookHash() {
  function handleHash() {
    const m = location.hash.match(/^#test\/(.+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      state.selectedId = id;
      const tr = document.querySelector(`#test-table tbody tr[data-id="${cssEscape(id)}"]`);
      if (tr) tr.classList.add('selected');
      renderDetail(id);
    }
  }
  window.addEventListener('hashchange', handleHash);
  handleHash();
}

// helpers --------------------------------------------------------------------

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s) { return escapeHtml(s); }
function cssEscape(s) { return CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, c => `\\${c}`); }
function absoluteUrl(rel) {
  try { return new URL(rel, location.href).href; } catch { return rel; }
}
function formatDuration(ms) {
  if (ms == null || isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms/1000).toFixed(1)}s`;
  return `${Math.floor(ms/60_000)}m ${Math.round((ms%60_000)/1000)}s`;
}
function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const dt = (Date.now() - t) / 1000;
  if (dt < 60) return `${Math.round(dt)}s ago`;
  if (dt < 3600) return `${Math.round(dt/60)}m ago`;
  if (dt < 86400) return `${Math.round(dt/3600)}h ago`;
  return `${Math.round(dt/86400)}d ago`;
}

init();
