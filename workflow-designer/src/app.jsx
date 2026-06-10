// =====================================================================
// App shell — unified sidebar (Inspector + JSON + Tweaks).
// =====================================================================

import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';

import { SEED_WORKFLOW, SEED_LAYOUT, SEED_USERS } from './data.jsx';
import { Canvas } from './canvas.jsx';
import { Sidebar, Topbar } from './panels.jsx';
import { autoLayout } from './auto-layout.jsx';
import { initBridge } from './postmessage-bridge.js';

const DEFAULT_TWEAKS = {
  theme: "terminal",
  accent: "#8CF56B",
  nodeStyle: "sharp",
  grid: true,
  snapGrid: true,
};

function App() {
  const [workflow, setWorkflow] = useState(() => JSON.parse(JSON.stringify(SEED_WORKFLOW)));
  const [layout, setLayout] = useState(() => JSON.parse(JSON.stringify(SEED_LAYOUT)));
  const [selection, setSelection] = useState(null);
  const [tweaks, setTweaks] = useState(DEFAULT_TWEAKS);
  const [collapsed, setCollapsed] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState({ inspector: true, json: false, tweaks: false });
  const [layoutDir, setLayoutDir] = useState("TB");

  // Bridge: only active when running inside an iframe.
  const isEmbedded = typeof window !== 'undefined' && window.parent !== window;
  const stateRef = useRef({ workflow, layout });
  useEffect(() => { stateRef.current = { workflow, layout }; }, [workflow, layout]);
  const bridgeRef = useRef(null);

  useEffect(() => {
    if (!isEmbedded) return;
    const b = initBridge({
      onLoad: (wf, lo) => {
        if (wf) setWorkflow(JSON.parse(JSON.stringify(wf)));
        if (lo) setLayout(JSON.parse(JSON.stringify(lo)));
        setSelection(null);
      },
      getCurrent: () => stateRef.current,
    });
    bridgeRef.current = b;
    return () => b.destroy();
  }, [isEmbedded]);

  function sendSaveToParent() {
    bridgeRef.current?.sendSave();
  }

  useEffect(() => {
    document.documentElement.dataset.theme = tweaks.theme;
    document.documentElement.dataset.nodeStyle = tweaks.nodeStyle;
    document.documentElement.style.setProperty("--accent", tweaks.accent);
    document.documentElement.style.setProperty("--accent-soft", hexToRgba(tweaks.accent, 0.16));
    document.documentElement.style.setProperty("--accent-ring", hexToRgba(tweaks.accent, 0.38));
  }, [tweaks]);

  // Auto-open Inspector section when something is selected
  useEffect(() => {
    if (selection) setSectionsOpen(s => s.inspector ? s : ({...s, inspector: true}));
    if (selection && collapsed) setCollapsed(false);
  }, [selection]);

  function moveState(key, x, y) {
    setLayout(L => ({...L, states: {...L.states, [key]: {...L.states[key], x, y}}}));
  }
  function moveAction(key, x, y) {
    setLayout(L => ({...L, actions: {...L.actions, [key]: {...L.actions[key], x, y}}}));
  }

  function onChangeElement(sel, next) {
    if (sel._layoutEdit) {
      if (sel.type === "start") return setLayout(L => ({...L, states: {...L.states, "__start__": next}}));
      if (sel.type === "state") return setLayout(L => ({...L, states: {...L.states, [sel.id]: next}}));
      if (sel.type === "action") return setLayout(L => ({...L, actions: {...L.actions, [sel.id]: next}}));
      return;
    }
    setWorkflow(W => {
      const states = W.states.map(s => {
        if (sel.type === "start" && s.isStartState) return {...s, ...cleanMeta(next)};
        if (sel.type === "state" && s.state === sel.id) return {...s, ...cleanMeta(next)};
        if (sel.type === "action") {
          const [fromKey, actionName] = sel.id.split("::");
          const myKey = s.isStartState ? "__start__" : s.state;
          if (myKey !== fromKey) return s;
          return {...s, actions: (s.actions || []).map(a => a.action === actionName ? {...a, ...cleanMeta(next)} : a)};
        }
        return s;
      });
      return {...W, states};
    });
    if (sel.type === "state" && next.state && next.state !== sel.id) {
      const oldId = sel.id, newId = next.state;
      setLayout(L => {
        const states = {...L.states};
        if (states[oldId]) { states[newId] = states[oldId]; delete states[oldId]; }
        const actions = {};
        for (const k in L.actions) {
          const [f, a] = k.split("::");
          actions[(f === oldId ? newId : f) + "::" + a] = L.actions[k];
        }
        return {...L, states, actions};
      });
      setWorkflow(W => ({...W, states: W.states.map(s => ({
        ...s,
        actions: (s.actions || []).map(a => a.nextState === oldId ? {...a, nextState: newId} : a)
      }))}));
      setSelection({type: "state", id: newId});
    }
    if (sel.type === "action" && next.action) {
      const [fromKey, oldName] = sel.id.split("::");
      if (next.action !== oldName) {
        const oldK = sel.id, newK = `${fromKey}::${next.action}`;
        setLayout(L => {
          if (!L.actions[oldK]) return L;
          const actions = {...L.actions, [newK]: L.actions[oldK]};
          delete actions[oldK];
          return {...L, actions};
        });
        setSelection({type: "action", id: newK});
      }
    }
  }

  function cleanMeta(v) {
    const {_key, _fromKey, _layoutEdit, ...rest} = v;
    return rest;
  }

  function resetAll() {
    setWorkflow(JSON.parse(JSON.stringify(SEED_WORKFLOW)));
    setLayout(JSON.parse(JSON.stringify(SEED_LAYOUT)));
    setSelection(null);
  }

  function runAutoLayout() {
    const next = autoLayout(workflow, { direction: layoutDir });
    if (next) setLayout(next);
  }

  function addState() {
    // Generate a unique name
    const existing = new Set(workflow.states.map(s => s.state).filter(Boolean));
    let n = 1, name;
    do { name = `NEW_STATE_${n++}`; } while (existing.has(name));

    const newState = {
      state: name,
      applicationStatus: name,
      isStartState: false,
      isTerminateState: false,
      actions: [],
    };
    setWorkflow(W => ({ ...W, states: [...W.states, newState] }));
    // Place it somewhere visible — centre of current viewport-ish
    const x = 200 + Math.random() * 400;
    const y = 200 + Math.random() * 300;
    setLayout(L => ({ ...L, states: { ...L.states, [name]: { x, y, w: 280, h: 56 } } }));
    setSelection({ type: "state", id: name });
  }

  function addAction() {
    if (!selection || (selection.type !== "state" && selection.type !== "start")) return;
    const fromKey = selection.type === "start" ? "__start__" : selection.id;
    const fromState = workflow.states.find(s => (s.isStartState ? "__start__" : s.state) === fromKey);
    if (!fromState) return;
    const existing = new Set((fromState.actions || []).map(a => a.action));
    let n = 1, name;
    do { name = `NEW_ACTION_${n++}`; } while (existing.has(name));

    // Pick a reasonable nextState — first non-start state, or self
    const target = workflow.states.find(s => !s.isStartState)?.state || fromState.state;
    const newAction = {
      action: name,
      nextState: target,
      roles: [],
      kind: "user",
      auditLog: true,
      notifyAssignee: false,
      assignee: null,
      effectiveFrom: "",
      description: "",
    };
    setWorkflow(W => ({
      ...W,
      states: W.states.map(s =>
        (s.isStartState ? "__start__" : s.state) === fromKey
          ? { ...s, actions: [...(s.actions || []), newAction] }
          : s
      ),
    }));
    // Place pill near the state
    const statePos = layout.states[fromKey];
    if (statePos) {
      const px = (statePos.x ?? 0) + (statePos.w ?? 0) + 100;
      const py = (statePos.y ?? 0) + (statePos.h ?? 0) / 2 + (fromState.actions?.length || 0) * 40;
      setLayout(L => ({ ...L, actions: { ...L.actions, [`${fromKey}::${name}`]: { x: px, y: py } } }));
    }
    setSelection({ type: "action", id: `${fromKey}::${name}` });
  }

  function deleteSelected() {
    if (!selection) return;
    if (selection.type === "state") {
      const name = selection.id;
      setWorkflow(W => ({
        ...W,
        states: W.states
          .filter(s => s.state !== name)
          // also clean up any action that points to this state
          .map(s => ({ ...s, actions: (s.actions || []).filter(a => a.nextState !== name) })),
      }));
      setLayout(L => {
        const states = { ...L.states }; delete states[name];
        const actions = {};
        for (const k in L.actions) {
          const [f, a] = k.split("::");
          if (f !== name) actions[k] = L.actions[k];
        }
        return { ...L, states, actions };
      });
    } else if (selection.type === "action") {
      const [fromKey, actionName] = selection.id.split("::");
      setWorkflow(W => ({
        ...W,
        states: W.states.map(s => {
          const myKey = s.isStartState ? "__start__" : s.state;
          if (myKey !== fromKey) return s;
          return { ...s, actions: (s.actions || []).filter(a => a.action !== actionName) };
        }),
      }));
      setLayout(L => {
        const actions = { ...L.actions };
        delete actions[selection.id];
        return { ...L, actions };
      });
    }
    setSelection(null);
  }

  const sidebarWidth = collapsed ? 44 : 380;

  return (
    <>
      <Topbar workflow={workflow} collapsed={collapsed} setCollapsed={setCollapsed}
              onReset={resetAll} onAutoLayout={runAutoLayout}
              onAddState={addState}
              onSave={sendSaveToParent} showSave={isEmbedded}
              layoutDir={layoutDir} setLayoutDir={setLayoutDir} />
      <div className="main" style={{
        paddingRight: sidebarWidth,
        transition: "padding 220ms cubic-bezier(.4,0,.2,1)"
      }}>
        <div style={{position:"absolute", inset:0}}>
          <Canvas workflow={workflow} layout={layout}
                  selection={selection} onSelect={setSelection}
                  onMoveState={moveState} onMoveAction={moveAction}
                  snapGrid={tweaks.snapGrid} showGrid={tweaks.grid} />
        </div>
        {!selection && (
          <div className="empty-hint">click a state or action to edit</div>
        )}
      </div>

      <Sidebar
        collapsed={collapsed} setCollapsed={setCollapsed}
        selection={selection} workflow={workflow} layout={layout}
        onChange={onChangeElement} onClose={() => setSelection(null)}
        users={SEED_USERS}
        onAddAction={addAction}
        onDelete={deleteSelected}
        tweaks={tweaks} setTweaks={setTweaks}
        sectionsOpen={sectionsOpen} setSectionsOpen={setSectionsOpen} />
    </>
  );
}

function hexToRgba(hex, a) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(140,245,107,${a})`;
  return `rgba(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)},${a})`;
}

ReactDOM.createRoot(document.getElementById("app")).render(<App />);
