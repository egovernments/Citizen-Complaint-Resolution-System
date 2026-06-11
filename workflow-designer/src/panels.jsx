// =====================================================================
// Unified right Sidebar — holds Inspector + JSON + Tweaks as collapsible
// sections. Replaces the separate drawer, JSON panel and Tweaks card.
// =====================================================================

import React, { useState, useMemo } from 'react';
import { FormEngine } from './form-engine.jsx';
import { FORM_SCHEMAS, DEFAULTS, kindOf } from './data.jsx';

// ---------- Inspector (the form for the selected element) ----------
function Inspector({ selection, workflow, layout, onChange, users, onClose, onAddAction, onDelete }) {
  const kind = kindOf(selection);

  const element = useMemo(() => {
    if (!selection) return null;
    if (selection.type === "start") {
      const s = workflow.states.find(x => x.isStartState);
      return s ? { ...s, _key: "__start__" } : null;
    }
    if (selection.type === "state") {
      const s = workflow.states.find(x => x.state === selection.id);
      return s ? { ...s, _key: selection.id } : null;
    }
    if (selection.type === "action") {
      const [fromKey, actionName] = selection.id.split("::");
      const s = workflow.states.find(x => (x.isStartState ? "__start__" : x.state) === fromKey);
      if (!s) return null;
      const a = (s.actions || []).find(ac => ac.action === actionName);
      return a ? { ...a, _fromKey: fromKey, _key: selection.id } : null;
    }
    return null;
  }, [selection, workflow]);

  const schema = useMemo(() => {
    if (!kind) return null;
    const s = JSON.parse(JSON.stringify(FORM_SCHEMAS[kind]));
    if (kind === "action") {
      const names = workflow.states.filter(x => !x.isStartState && x.state).map(x => x.state);
      s.properties.nextState.enum = names;
    }
    return s;
  }, [kind, workflow]);

  const value = useMemo(
    () => (kind && element ? { ...(DEFAULTS[kind] || {}), ...element } : null),
    [element, kind]
  );

  if (!selection || !kind || !element || !schema || !value) {
    return (
      <div className="inspector-empty">
        <span className="empty-icon">◌</span>
        <span>Click any state or action on the canvas to inspect.</span>
      </div>
    );
  }

  const kindLabel = kind === "state" ? (element.isStartState ? "start" : "state") : kind;
  const title = element.state ?? element.action ?? "start";

  return (
    <div>
      <div className="inspector-head">
        <span className="drawer-kind" data-kind={kindLabel}>{kindLabel}</span>
        <span className="inspector-title">{title}</span>
        <button className="drawer-close" onClick={onClose} title="Clear selection">×</button>
      </div>
      <div className="inspector-body">
        <FormEngine schema={schema} value={value} users={users}
                    onChange={(next) => onChange(selection, next)} />
        <div className="section-label">Layout</div>
        <LayoutFields selection={selection} layout={layout} onChange={onChange} />
        <div className="section-label">Actions</div>
        <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
          {kind === "state" && (
            <button className="btn-ghost" onClick={onAddAction}>
              <span style={{color:"var(--accent)"}}>+</span> Add action
            </button>
          )}
          {!element.isStartState && (
            <button className="btn-ghost" onClick={onDelete}
                    style={{borderColor:"rgba(255,90,90,0.4)", color:"#ff8a8a"}}>
              Delete {kindLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LayoutFields({ selection, layout, onChange }) {
  let pos;
  if (selection.type === "state" || selection.type === "start") {
    const k = selection.type === "start" ? "__start__" : selection.id;
    pos = layout.states[k];
  } else if (selection.type === "action") {
    pos = layout.actions[selection.id];
  }
  if (!pos) return null;
  const set = (next) => onChange({ ...selection, _layoutEdit: true }, next);
  return (
    <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}}>
      <div className="field" style={{marginBottom:0}}>
        <label className="field-label">X</label>
        <input className="input" type="number" value={pos.x ?? 0}
               onChange={e => set({ ...pos, x: Number(e.target.value) })} />
      </div>
      <div className="field" style={{marginBottom:0}}>
        <label className="field-label">Y</label>
        <input className="input" type="number" value={pos.y ?? 0}
               onChange={e => set({ ...pos, y: Number(e.target.value) })} />
      </div>
    </div>
  );
}

function formatJSON(obj) {
  const json = JSON.stringify(obj, null, 2);
  return json
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/("(?:\\.|[^"\\])*")(\s*:)/g, '<span class="json-key">$1</span>$2')
    .replace(/:\s*("(?:\\.|[^"\\])*")/g, ': <span class="json-str">$1</span>')
    .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="json-num">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span class="json-bool">$1</span>')
    .replace(/:\s*null/g, ': <span class="json-null">null</span>');
}

function JSONView({ workflow, layout }) {
  const [tab, setTab] = useState("workflow");
  const html = useMemo(
    () => formatJSON(tab === "workflow" ? workflow : layout),
    [tab, workflow, layout]
  );
  return (
    <div>
      <div className="json-tabs">
        <button className={tab === "workflow" ? "active" : ""} onClick={() => setTab("workflow")}>workflow.json</button>
        <button className={tab === "layout" ? "active" : ""} onClick={() => setTab("layout")}>layout.json</button>
      </div>
      <div className="json-view">
        <pre dangerouslySetInnerHTML={{__html: html}} />
      </div>
    </div>
  );
}

function TweaksBody({ tweaks, setTweaks }) {
  const set = (k,v) => setTweaks(t => ({...t, [k]: v}));
  const Seg = ({k, options}) => (
    <div className="seg">{options.map(o => (
      <button key={o.v} className={tweaks[k] === o.v ? "active" : ""} onClick={() => set(k, o.v)}>{o.label}</button>
    ))}</div>
  );
  return (
    <div className="tweaks-body">
      <div className="tweak-row"><label>Theme</label>
        <Seg k="theme" options={[{v:"terminal",label:"Terminal"},{v:"refined",label:"Refined"}]} /></div>
      <div className="tweak-row"><label>Accent</label>
        <Seg k="accent" options={[{v:"#8CF56B",label:"Lime"},{v:"#7aa2ff",label:"Blue"},{v:"#ffb86b",label:"Amber"},{v:"#ff79c6",label:"Pink"}]} /></div>
      <div className="tweak-row"><label>Node style</label>
        <Seg k="nodeStyle" options={[{v:"sharp",label:"Sharp"},{v:"rounded",label:"Round"}]} /></div>
      <div className="tweak-row"><label>Grid</label>
        <Seg k="grid" options={[{v:true,label:"On"},{v:false,label:"Off"}]} /></div>
      <div className="tweak-row"><label>Snap</label>
        <Seg k="snapGrid" options={[{v:true,label:"On"},{v:false,label:"Off"}]} /></div>
    </div>
  );
}

function Section({ id, title, count, open, onToggle, children }) {
  return (
    <section className={"sidebar-section" + (open ? " open" : "")}>
      <header onClick={onToggle}>
        <span className="chev">{open ? "▾" : "▸"}</span>
        <span className="sec-title">{title}</span>
        {count != null && <span className="sec-count">{count}</span>}
      </header>
      {open && <div className="sec-body">{children}</div>}
    </section>
  );
}

export function Sidebar({
  collapsed, setCollapsed,
  selection, workflow, layout, onChange, onClose, users,
  onAddAction, onDelete,
  tweaks, setTweaks,
  sectionsOpen, setSectionsOpen,
}) {
  const toggle = (k) => setSectionsOpen(s => ({...s, [k]: !s[k]}));

  if (collapsed) {
    return (
      <aside className="sidebar collapsed">
        <button className="collapse-btn" onClick={() => setCollapsed(false)} title="Expand panel">‹</button>
        <div className="collapsed-stack">
          <button className="stack-btn" onClick={() => { setCollapsed(false); setSectionsOpen(s => ({...s, inspector: true})); }} title="Inspector">INS</button>
          <button className="stack-btn" onClick={() => { setCollapsed(false); setSectionsOpen(s => ({...s, json: true})); }} title="JSON">JSN</button>
          <button className="stack-btn" onClick={() => { setCollapsed(false); setSectionsOpen(s => ({...s, tweaks: true})); }} title="Tweaks">TWK</button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <span className="sidebar-brand"><span className="dot"></span>Inspector</span>
        <button className="collapse-btn" onClick={() => setCollapsed(true)} title="Collapse panel">›</button>
      </header>
      <div className="sidebar-scroll">
        <Section id="inspector" title="INSPECTOR"
                 count={selection ? 1 : 0}
                 open={sectionsOpen.inspector}
                 onToggle={() => toggle("inspector")}>
          <Inspector selection={selection} workflow={workflow} layout={layout}
                     onChange={onChange} users={users} onClose={onClose}
                     onAddAction={onAddAction} onDelete={onDelete} />
        </Section>
        <Section id="json" title="JSON"
                 open={sectionsOpen.json}
                 onToggle={() => toggle("json")}>
          <JSONView workflow={workflow} layout={layout} />
        </Section>
        <Section id="tweaks" title="TWEAKS"
                 open={sectionsOpen.tweaks}
                 onToggle={() => toggle("tweaks")}>
          <TweaksBody tweaks={tweaks} setTweaks={setTweaks} />
        </Section>
      </div>
    </aside>
  );
}

export function Topbar({ workflow, collapsed, setCollapsed, onReset, onAutoLayout, onAddState, onSave, showSave, layoutDir, setLayoutDir }) {
  const totalActions = workflow.states.reduce((n, s) => n + (s.actions?.length || 0), 0);
  return (
    <header className="topbar">
      <span className="brand"><span className="dot"></span>Workflow Designer</span>
      <span className="meta" style={{paddingLeft:10, borderLeft:"1px solid var(--stroke-faint)", marginLeft:4}}>
        {workflow.businessService} · {workflow.business}
      </span>
      <span className="meta" style={{color:"var(--text-faint)"}}>
        {workflow.states.length} states · {totalActions} actions
      </span>
      <span className="spacer"></span>
      <button className="btn btn-add" onClick={onAddState} title="Add new state">
        <span style={{color:"var(--accent)"}}>+</span> State
      </button>
      <div className="seg" style={{marginRight:6}}>
        <button className={layoutDir === "TB" ? "active" : ""} onClick={() => setLayoutDir("TB")} title="Top → Bottom">TB</button>
        <button className={layoutDir === "LR" ? "active" : ""} onClick={() => setLayoutDir("LR")} title="Left → Right">LR</button>
      </div>
      <button className="btn" onClick={onAutoLayout} title="Recompute positions (dagre/Sugiyama)">
        <span style={{color:"var(--accent)"}}>↻</span> Auto-layout
      </button>
      <button className="btn" onClick={onReset}>Reset</button>
      {showSave && (
        <button className="btn active" onClick={onSave} title="Send workflow + layout to parent window">
          <span style={{color:"var(--accent)"}}>↑</span> Save
        </button>
      )}
      <button className={"btn" + (!collapsed ? " active" : "")}
              onClick={() => setCollapsed(c => !c)}>{collapsed ? "Show panel" : "Hide panel"}</button>
    </header>
  );
}
