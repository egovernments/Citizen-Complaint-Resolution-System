// =====================================================================
// Canvas — reads workflow (business config) + layout (visual config).
// Visual language:
//   STATE = large outlined rectangle, status chip top-left, SLA chip top-right,
//           terminal states get a double border, start gets a filled dot + ring.
//   ACTION = small rounded pill on an edge, colored by action kind,
//            with a tiny role-count tag, distinct icon, hoverable.
// =====================================================================

import React, { useState, useEffect, useRef } from 'react';
import { classifyAction, stateKey } from './data.jsx';

const ACTION_COLORS = {
  user:    { fg: "var(--accent)",  bg: "var(--accent-soft)", ring: "var(--accent-ring)" },
  system:  { fg: "#c8a6ff",        bg: "rgba(200,166,255,0.14)", ring: "rgba(200,166,255,0.4)" },
  auto:    { fg: "#ffb86b",        bg: "rgba(255,184,107,0.14)", ring: "rgba(255,184,107,0.4)" },
  comment: { fg: "#89c2ff",        bg: "rgba(137,194,255,0.14)", ring: "rgba(137,194,255,0.4)" },
};

function getStatePos(layout, key) {
  return layout.states[key] || { x: 0, y: 0, w: 240, h: 54 };
}
function getActionPos(layout, fromKey, action) {
  return layout.actions[`${fromKey}::${action}`] || null;
}

// Clip a line from inside a rect to its border toward (tx,ty)
function clipRectBorder(rect, tx, ty) {
  const cx = rect.x, cy = rect.y;
  const hw = rect.w / 2, hh = rect.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = hw / (Math.abs(dx) || 1e-9);
  const sy = hh / (Math.abs(dy) || 1e-9);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}
function clipCircle(c, tx, ty) {
  const dx = tx - c.x, dy = ty - c.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: c.x + (dx / d) * (c.r || 16), y: c.y + (dy / d) * (c.r || 16) };
}
function clipAny(node, tx, ty) {
  if (node.r != null) return clipCircle(node, tx, ty);
  return clipRectBorder(node, tx, ty);
}

function arrowHeadPath({ x, y, angle }, size = 10) {
  const a1 = angle + Math.PI * 0.82;
  const a2 = angle - Math.PI * 0.82;
  // base points of triangle
  const bx1 = x + Math.cos(a1)*size;
  const by1 = y + Math.sin(a1)*size;
  const bx2 = x + Math.cos(a2)*size;
  const by2 = y + Math.sin(a2)*size;
  return `M ${x} ${y} L ${bx1} ${by1} L ${bx2} ${by2} Z`;
}

function polylineToPath(points) {
  if (!points || points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) d += ` L ${points[i].x} ${points[i].y}`;
  return d;
}

// Route an edge from `from` node → through action-pill → to `to` node.
// Self loops bulge out to the specified side.
// If the pill has `polyIn` / `polyOut` arrays (from auto-layout), use those.
function routeEdge(fromNode, toNode, pill, selfSide) {
  if (fromNode === toNode) {
    const side = selfSide === "right" ? 1 : -1;
    const hw = fromNode.w / 2, hh = fromNode.h / 2;
    const sx = fromNode.x + side * hw;
    const sy = fromNode.y - hh * 0.35;
    const ex = fromNode.x + side * hw;
    const ey = fromNode.y + hh * 0.35;
    const bx = fromNode.x + side * (hw + 110);
    const pillSide = side === 1 ? (pill.x - 30) : (pill.x + 30);
    return {
      out:  `M ${sx} ${sy} C ${bx} ${sy - 30} ${bx} ${pill.y - 30} ${pillSide} ${pill.y}`,
      back: `M ${pillSide} ${pill.y} C ${bx} ${pill.y + 30} ${bx} ${ey + 30} ${ex} ${ey}`,
      arrow: { x: ex, y: ey, angle: Math.PI / 2 },
    };
  }

  // ---- Auto-layout path: use dagre's polyline waypoints ----
  if (pill.polyIn && pill.polyOut && pill.polyIn.length >= 2 && pill.polyOut.length >= 2) {
    // clip polyIn's first segment against fromNode border, and polyOut's last against toNode
    const inPts = pill.polyIn.slice();
    const outPts = pill.polyOut.slice();
    const clipStart = clipAny(fromNode, inPts[1].x, inPts[1].y);
    inPts[0] = clipStart;
    const clipEnd = clipAny(toNode, outPts[outPts.length - 2].x, outPts[outPts.length - 2].y);
    outPts[outPts.length - 1] = clipEnd;
    // trim polyIn to stop at pill edge and polyOut to start at pill edge
    const pillHw = 58, pillHh = 14;
    const clipPill = (p, pill) => {
      const dx = p.x - pill.x, dy = p.y - pill.y;
      const sx = dx === 0 ? 1 : Math.abs(pillHw / dx);
      const sy = dy === 0 ? 1 : Math.abs(pillHh / dy);
      const s = Math.min(sx, sy, 1);
      return { x: pill.x + dx * s, y: pill.y + dy * s };
    };
    inPts[inPts.length - 1] = clipPill(inPts[inPts.length - 2], pill);
    outPts[0] = clipPill(outPts[1], pill);
    const last = outPts[outPts.length - 1], prev = outPts[outPts.length - 2];
    const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
    return {
      out: polylineToPath(inPts),
      back: polylineToPath(outPts),
      arrow: { x: last.x, y: last.y, angle },
    };
  }

  // ---- Fallback: straight two-segment routing (hand-placed layouts) ----
  const pA = clipAny(fromNode, pill.x, pill.y);
  const pB = clipAny(toNode,   pill.x, pill.y);
  const dxA = pill.x - pA.x, dyA = pill.y - pA.y;
  const dxB = pB.x - pill.x, dyB = pB.y - pill.y;
  const pillHw = 58, pillHh = 14;
  const entry = Math.abs(dyA) > Math.abs(dxA)
    ? { x: pill.x, y: pill.y + (dyA > 0 ? -pillHh : pillHh) }
    : { x: pill.x + (dxA > 0 ? -pillHw : pillHw), y: pill.y };
  const exit  = Math.abs(dyB) > Math.abs(dxB)
    ? { x: pill.x, y: pill.y + (dyB > 0 ?  pillHh : -pillHh) }
    : { x: pill.x + (dxB > 0 ?  pillHw : -pillHw), y: pill.y };
  const angle = Math.atan2(pB.y - exit.y, pB.x - exit.x);
  return {
    out:  `M ${pA.x} ${pA.y} L ${entry.x} ${entry.y}`,
    back: `M ${exit.x} ${exit.y} L ${pB.x} ${pB.y}`,
    arrow: { x: pB.x, y: pB.y, angle },
  };
}

export function Canvas({ workflow, layout, selection, onSelect, onMoveState, onMoveAction, snapGrid, showGrid }) {
  const wrapRef = useRef(null);
  const [viewport, setViewport] = useState({ x: 20, y: 20, scale: 0.78 });
  const [panning, setPanning] = useState(false);
  const panRef = useRef(null);
  const [drag, setDrag] = useState(null);

  function onWheel(e) {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    const rect = wrapRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    setViewport(v => {
      const scale = Math.min(2.5, Math.max(0.25, v.scale * (1 + delta)));
      const wx = (mx - v.x) / v.scale, wy = (my - v.y) / v.scale;
      return { x: mx - wx * scale, y: my - wy * scale, scale };
    });
  }
  function bgMouseDown(e) {
    if (e.target === wrapRef.current || e.target.classList?.contains("canvas-grid") || e.target.tagName === "svg") {
      setPanning(true);
      panRef.current = { x: e.clientX, y: e.clientY, vx: viewport.x, vy: viewport.y };
      onSelect(null);
    }
  }
  function mouseMove(e) {
    if (panning && panRef.current) {
      setViewport(v => ({ ...v, x: panRef.current.vx + (e.clientX - panRef.current.x), y: panRef.current.vy + (e.clientY - panRef.current.y) }));
    }
    if (drag) {
      const dx = (e.clientX - drag.sx) / viewport.scale;
      const dy = (e.clientY - drag.sy) / viewport.scale;
      let nx = drag.ox + dx, ny = drag.oy + dy;
      if (snapGrid) { nx = Math.round(nx / 12) * 12; ny = Math.round(ny / 12) * 12; }
      if (drag.kind === "state") onMoveState(drag.key, nx, ny);
      else onMoveAction(drag.key, nx, ny);
    }
  }
  function mouseUp() { setPanning(false); setDrag(null); }
  useEffect(() => {
    window.addEventListener("mouseup", mouseUp);
    return () => window.removeEventListener("mouseup", mouseUp);
  });

  const zIn  = () => setViewport(v => ({...v, scale: Math.min(2.5, v.scale * 1.2)}));
  const zOut = () => setViewport(v => ({...v, scale: Math.max(0.25, v.scale / 1.2)}));
  const zRst = () => setViewport({ x: 20, y: 20, scale: 0.78 });

  const isSel = (t, k) => selection && selection.type === t && selection.id === k;
  const beginDrag = (e, key, kind, ox, oy) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setDrag({ key, kind, sx: e.clientX, sy: e.clientY, ox, oy });
  };

  // Build edges list
  const edges = [];
  workflow.states.forEach(s => {
    const fromKey = stateKey(s);
    (s.actions || []).forEach(a => {
      const pos = getActionPos(layout, fromKey, a.action);
      if (!pos) return;
      edges.push({ fromKey, toKey: a.nextState, action: a, pillPos: pos });
    });
  });

  return (
    <div className={"canvas-wrap" + (panning ? " panning" : "")}
         ref={wrapRef}
         onWheel={onWheel}
         onMouseDown={bgMouseDown}
         onMouseMove={mouseMove}>
      {showGrid && <div className="canvas-grid" />}
      <svg className="canvas-svg"
           width={layout.canvas.width} height={layout.canvas.height}
           style={{transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`}}
           onMouseDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}>

        {/* --- Edges (drawn first so nodes / pills sit on top) --- */}
        {edges.map((e, i) => {
          const from = e.fromKey === "__start__"
            ? { ...layout.states.__start__, r: layout.states.__start__.r || 16 }
            : getStatePos(layout, e.fromKey);
          const to = getStatePos(layout, e.toKey);
          if (!from || !to) return null;
          const r = routeEdge(from, to, e.pillPos, e.pillPos.side);
          const kindClass = classifyAction(e.action);
          const c = ACTION_COLORS[kindClass] || ACTION_COLORS.user;
          const sel = isSel("action", `${e.fromKey}::${e.action.action}`);
          return (
            <g key={i} className={"edge-group" + (sel ? " selected" : "")}
               onClick={(ev) => { ev.stopPropagation(); onSelect({ type: "action", id: `${e.fromKey}::${e.action.action}` }); }}>
              {r.out && (<>
                <path className="edge-hit" d={r.out} />
                <path className="edge" d={r.out} stroke={sel ? c.fg : undefined} />
              </>)}
              {r.back && (<>
                <path className="edge-hit" d={r.back} />
                <path className="edge" d={r.back} stroke={sel ? c.fg : undefined} />
              </>)}
              {r.arrow && (
                <path d={arrowHeadPath(r.arrow, 10)} fill={sel ? c.fg : "var(--stroke)"} stroke={sel ? c.fg : "var(--stroke)"} strokeWidth="0.5" strokeLinejoin="round" />
              )}
            </g>
          );
        })}

        {/* --- Action pills (on top of edges) --- */}
        {edges.map((e, i) => {
          const kindClass = classifyAction(e.action);
          const c = ACTION_COLORS[kindClass] || ACTION_COLORS.user;
          const key = `${e.fromKey}::${e.action.action}`;
          const sel = isSel("action", key);
          const w = Math.max(96, e.action.action.length * 8.2 + 44);
          return (
            <g key={"pill-"+i}
               className={"action-pill-group" + (sel ? " selected" : "")}
               onMouseDown={(ev) => beginDrag(ev, key, "action", e.pillPos.x, e.pillPos.y)}
               onClick={(ev) => { ev.stopPropagation(); onSelect({ type: "action", id: key }); }}>
              <rect x={e.pillPos.x - w/2} y={e.pillPos.y - 14}
                    width={w} height={28} rx={14}
                    fill={c.bg} stroke={c.fg} strokeWidth={sel ? 1.75 : 1} />
              {/* action-kind dot */}
              <circle cx={e.pillPos.x - w/2 + 12} cy={e.pillPos.y} r={3.2} fill={c.fg} />
              {/* action name */}
              <text x={e.pillPos.x - w/2 + 22} y={e.pillPos.y}
                    className="action-text" fill={c.fg}
                    dominantBaseline="middle">{e.action.action}</text>
              {/* role count badge */}
              <g transform={`translate(${e.pillPos.x + w/2 - 20}, ${e.pillPos.y})`}>
                <circle r={9} fill="var(--bg)" stroke={c.fg} strokeWidth="1" />
                <text className="action-role-count" fill={c.fg} textAnchor="middle" dominantBaseline="middle">
                  {e.action.roles?.length || 0}
                </text>
              </g>
            </g>
          );
        })}

        {/* --- States --- */}
        {workflow.states.map(s => {
          const key = stateKey(s);
          const pos = getStatePos(layout, key);
          if (s.isStartState) {
            const sel = isSel("start", key);
            return (
              <g key={key}
                 className={"start-node" + (sel ? " selected" : "")}
                 onMouseDown={(e) => beginDrag(e, key, "state", pos.x, pos.y)}
                 onClick={(e) => { e.stopPropagation(); onSelect({ type: "start", id: key }); }}>
                <circle className="start-outer" cx={pos.x} cy={pos.y} r={(pos.r || 16) + 8} />
                <circle className="start-inner" cx={pos.x} cy={pos.y} r={pos.r || 16} />
                <text className="start-label" x={pos.x} y={pos.y + (pos.r || 16) + 20}>START</text>
              </g>
            );
          }
          const sel = isSel("state", key);
          const terminal = s.isTerminateState;
          return (
            <g key={key}
               className={"state-node" + (sel ? " selected" : "") + (terminal ? " terminal" : "")}
               onMouseDown={(e) => beginDrag(e, key, "state", pos.x, pos.y)}
               onClick={(e) => { e.stopPropagation(); onSelect({ type: "state", id: key }); }}>
              {/* outer ring for terminal */}
              {terminal && (
                <rect x={pos.x - pos.w/2 - 4} y={pos.y - pos.h/2 - 4}
                      width={pos.w + 8} height={pos.h + 8} rx={10}
                      fill="none" stroke="var(--stroke-faint)" strokeWidth="1" />
              )}
              <rect className="state-rect"
                    x={pos.x - pos.w/2} y={pos.y - pos.h/2}
                    width={pos.w} height={pos.h} rx={6} />
              {/* status chip top-left */}
              <g transform={`translate(${pos.x - pos.w/2 + 10}, ${pos.y - pos.h/2 - 9})`}>
                <rect x="0" y="0" width="56" height="16" rx="3"
                      fill="var(--bg-panel)" stroke="var(--stroke-faint)" />
                <text className="state-chip" x="28" y="8" textAnchor="middle" dominantBaseline="middle">
                  {terminal ? "TERMINAL" : "ACTIVE"}
                </text>
              </g>
              {/* count chip top-right */}
              <g transform={`translate(${pos.x + pos.w/2 - 50}, ${pos.y - pos.h/2 - 9})`}>
                <rect x="0" y="0" width="40" height="16" rx="3"
                      fill="var(--bg-panel)" stroke="var(--stroke-faint)" />
                <text className="state-chip" x="20" y="8" textAnchor="middle" dominantBaseline="middle">
                  {(s.actions || []).length} ACT
                </text>
              </g>
              {/* state name, centered, monospace */}
              <text className="state-name" x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle">
                {s.state}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="canvas-controls">
        <button onClick={zOut} title="Zoom out">−</button>
        <span className="zoom-val">{Math.round(viewport.scale * 100)}%</span>
        <button onClick={zIn} title="Zoom in">+</button>
        <button onClick={zRst} title="Reset">⊙</button>
      </div>

      {/* Legend */}
      <div className="canvas-legend">
        <div className="lg-row"><span className="lg-sample state-sample"></span>State</div>
        <div className="lg-row"><span className="lg-sample action-sample" style={{background: "var(--accent-soft)", borderColor: "var(--accent)"}}></span>User action</div>
        <div className="lg-row"><span className="lg-sample action-sample" style={{background: "rgba(255,184,107,0.14)", borderColor: "#ffb86b"}}></span>Auto / escalate</div>
        <div className="lg-row"><span className="lg-sample action-sample" style={{background: "rgba(137,194,255,0.14)", borderColor: "#89c2ff"}}></span>Comment</div>
      </div>
    </div>
  );
}
