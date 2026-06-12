// =====================================================================
// Auto-layout — uses dagre (layered/Sugiyama) to compute node positions
// that minimise edge crossings. Produces a fresh `layout` object shaped
// exactly like SEED_LAYOUT (states + actions with {x,y,...}).
//
// Approach:
//   - Build a dagre graph where BOTH states AND actions are nodes.
//     Actions are small "relay" nodes placed between fromState -> nextState.
//     This lets dagre route state->action->nextState as a normal DAG,
//     placing the action pill on the edge midpoint automatically.
//   - Self-loops (action.nextState === fromState) are handled specially:
//     a small virtual node with a side hint, positioned next to the state.
//   - Ranks are LR or TB depending on argument.
// =====================================================================

import dagre from 'dagre';

export function autoLayout(workflow, opts = {}) {
  const direction = opts.direction || "TB";          // TB or LR
  const nodeSep = opts.nodeSep ?? 70;
  const rankSep = opts.rankSep ?? 90;

  if (!dagre) { console.warn("dagre not loaded"); return null; }
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: direction, nodesep: nodeSep, ranksep: rankSep, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  const STATE_W = 280, STATE_H = 56;
  const ACTION_W = 150, ACTION_H = 30;
  const START_D = 36;

  // Self-loops we'll position after dagre finishes
  const selfLoops = [];

  // Add state nodes
  for (const s of workflow.states) {
    const key = s.isStartState ? "__start__" : s.state;
    if (s.isStartState) {
      g.setNode(key, { width: START_D, height: START_D, _kind: "start" });
    } else {
      g.setNode(key, { width: STATE_W, height: STATE_H, _kind: "state" });
    }
  }

  // Add action "relay" nodes + edges
  for (const s of workflow.states) {
    const fromKey = s.isStartState ? "__start__" : s.state;
    for (const a of (s.actions || [])) {
      const actKey = `${fromKey}::${a.action}`;
      const target = a.nextState;
      if (!target) continue;

      if (target === s.state) {
        // self-loop — don't add to dagre; place later beside the state
        selfLoops.push({ fromKey, actKey });
        continue;
      }

      // relay node for the action pill
      g.setNode(actKey, { width: ACTION_W, height: ACTION_H, _kind: "action" });
      g.setEdge(fromKey, actKey, { minlen: 1 }, `${actKey}-in`);
      g.setEdge(actKey, target, { minlen: 1 }, `${actKey}-out`);
    }
  }

  dagre.layout(g);

  // Translate dagre output → our layout shape
  const states = {};
  const actions = {};
  const nodes = g.nodes().map(id => ({ id, n: g.node(id) }));

  // dagre gives centre points; our states use top-left (x,y)+w/h, actions use centre
  for (const { id, n } of nodes) {
    if (n._kind === "start") {
      states["__start__"] = { x: n.x, y: n.y, r: 18 };
    } else if (n._kind === "state") {
      states[id] = { x: n.x - STATE_W / 2, y: n.y - STATE_H / 2, w: STATE_W, h: STATE_H };
    } else if (n._kind === "action") {
      actions[id] = { x: n.x, y: n.y };
    }
  }

  // Capture dagre's polyline points for every edge pair (in + out).
  // Store on the action as `polyIn` (from state → pill) and `polyOut` (pill → target).
  // These are world-space points dagre computed to avoid crossings.
  for (const e of g.edges()) {
    const pts = (g.edge(e).points || []).map(p => ({ x: p.x, y: p.y }));
    if (!pts.length) continue;
    // Edge name encodes target: "<actKey>-in" or "<actKey>-out"
    const name = e.name || "";
    const actKey = name.replace(/-(?:in|out)$/, "");
    const which = name.endsWith("-in") ? "polyIn" : "polyOut";
    if (actions[actKey]) actions[actKey][which] = pts;
  }

  // Place self-loop actions beside their state
  for (const { fromKey, actKey } of selfLoops) {
    const st = states[fromKey];
    if (!st) continue;
    // pick a free side (prefer right)
    const side = actions[`${fromKey}::__rightTaken`] ? "left" : "right";
    actions[`${fromKey}::__rightTaken`] = true;
    const cx = side === "right" ? st.x + (st.w ?? 0) + 120 : st.x - 120;
    const cy = st.y + ((st.h ?? 0) / 2);
    actions[actKey] = { x: cx, y: cy, side };
  }
  // strip marker keys
  for (const k of Object.keys(actions)) if (k.endsWith("::__rightTaken")) delete actions[k];

  // Compute canvas bounds
  let maxX = 0, maxY = 0;
  for (const k in states) {
    const s = states[k];
    maxX = Math.max(maxX, (s.x ?? 0) + (s.w ?? 40));
    maxY = Math.max(maxY, (s.y ?? 0) + (s.h ?? 40));
  }
  for (const k in actions) {
    const a = actions[k];
    maxX = Math.max(maxX, (a.x ?? 0) + 100);
    maxY = Math.max(maxY, (a.y ?? 0) + 40);
  }

  return {
    canvas: { width: Math.ceil(maxX + 80), height: Math.ceil(maxY + 80), grid: 12 },
    states,
    actions,
  };
}
