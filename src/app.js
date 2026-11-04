import { solve, MATERIALS } from "./solver.js";
import { PRESETS, buildPreset } from "./presets.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const SNAP = 0.5; // m
const SUPPORT_CYCLE = ["none", "pin", "rollerY", "rollerX"];
const SUPPORT_LABEL = { none: "Free", pin: "Pin", rollerY: "Roller (vertical reaction)", rollerX: "Roller (horizontal reaction)" };
const HINTS = {
  select: "Drag joints to move · drag empty space to pan · scroll to zoom · Del removes selection",
  node: "Click to place a joint (snaps to 0.5 m)",
  member: "Click two joints to connect them · click empty space to add and connect a joint · Esc to stop",
  support: "Click a joint to cycle: free → pin → roller (vertical) → roller (horizontal)",
  load: "Click a joint to add a 10 kN downward load · edit the value in the panel",
};

const svg = document.getElementById("canvas");
const $ = (id) => document.getElementById(id);

const state = {
  model: null,
  result: null,
  tool: "select",
  selection: null, // { type: "node" | "member", index }
  pending: null, // node index while drawing a member
  hover: null, // world point
  drag: null,
  view: { scale: 60, ox: 0, oy: 0 },
  showDeformed: true,
};

/* ---------- helpers ---------- */

const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const toScreen = (x, y) => [state.view.ox + x * state.view.scale, state.view.oy - y * state.view.scale];
const toWorld = (px, py) => [(px - state.view.ox) / state.view.scale, (state.view.oy - py) / state.view.scale];
const snap = (v) => Math.round(v / SNAP) * SNAP;
const fmt = (v, d = 2) => (Number.isFinite(v) ? (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d) : "∞");
const fmtFos = (v) => (v === Infinity ? "–" : v > 99 ? ">99" : v.toFixed(2));

function pointerWorld(evt) {
  const r = svg.getBoundingClientRect();
  return toWorld(evt.clientX - r.left, evt.clientY - r.top);
}

function nodeAt(x, y, tolPx = 10) {
  const tol = tolPx / state.view.scale;
  let best = -1;
  let bestD = Infinity;
  state.model.nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < tol && d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

/* ---------- model edits ---------- */

function addNode(x, y) {
  const existing = nodeAt(x, y, 4);
  if (existing >= 0) return existing;
  state.model.nodes.push({ x, y, support: "none", fx: 0, fy: 0 });
  return state.model.nodes.length - 1;
}

function addMember(a, b) {
  if (a === b) return;
  const dup = state.model.members.some((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a));
  if (dup) return;
  const last = state.model.members.at(-1);
  state.model.members.push({ a, b, material: last?.material ?? "steel", area: last?.area ?? 4000 });
}

function deleteSelection() {
  const sel = state.selection;
  if (!sel) return;
  const { model } = state;
  if (sel.type === "member") {
    model.members.splice(sel.index, 1);
  } else {
    model.nodes.splice(sel.index, 1);
    model.members = model.members
      .filter((m) => m.a !== sel.index && m.b !== sel.index)
      .map((m) => ({ ...m, a: m.a > sel.index ? m.a - 1 : m.a, b: m.b > sel.index ? m.b - 1 : m.b }));
  }
  state.selection = null;
  state.pending = null;
  update();
}

/* ---------- view ---------- */

function fitView() {
  const { nodes } = state.model;
  const r = svg.getBoundingClientRect();
  if (!nodes.length) {
    state.view = { scale: 60, ox: r.width * 0.15, oy: r.height * 0.7 };
    return;
  }
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = Math.max(maxX - minX, 2);
  const h = Math.max(maxY - minY, 2);
  const pad = Math.min(r.width, r.height) < 500 ? 50 : 110;
  const scale = Math.min((r.width - 2 * pad) / w, (r.height - 2 * pad) / h, 140);
  state.view = {
    scale,
    ox: r.width / 2 - ((minX + maxX) / 2) * scale,
    oy: r.height / 2 + ((minY + maxY) / 2) * scale,
  };
}

/* ---------- drawing ---------- */

function drawGrid(g, w, h) {
  const { scale } = state.view;
  const step = scale >= 30 ? SNAP : 1;
  const [x0, y1] = toWorld(0, 0);
  const [x1, y0] = toWorld(w, h);
  for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
    const [px] = toScreen(x, 0);
    const major = Math.abs(x - Math.round(x)) < 1e-9;
    el("line", { x1: px, y1: 0, x2: px, y2: h, class: major ? "grid-major" : "grid-minor" }, g);
  }
  for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
    const [, py] = toScreen(0, y);
    const major = Math.abs(y - Math.round(y)) < 1e-9;
    el("line", { x1: 0, y1: py, x2: w, y2: py, class: major ? "grid-major" : "grid-minor" }, g);
  }
  const [ax, ay] = toScreen(0, 0);
  el("line", { x1: ax, y1: 0, x2: ax, y2: h, class: "axis" }, g);
  el("line", { x1: 0, y1: ay, x2: w, y2: ay, class: "axis" }, g);
  // metre ticks along the x axis
  const every = scale > 45 ? 1 : scale > 20 ? 2 : 5;
  for (let x = Math.ceil(x0 / every) * every; x <= x1; x += every) {
    const [px] = toScreen(x, 0);
    el("text", { x: px + 3, y: Math.min(Math.max(ay + 12, 12), h - 4), class: "axis-label" }, g).textContent = `${x} m`;
  }
}

function arrow(g, x1, y1, x2, y2, cls) {
  el("line", { x1, y1, x2, y2, class: cls }, g);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const s = 7;
  const p = [
    [x2, y2],
    [x2 - s * Math.cos(ang - 0.4), y2 - s * Math.sin(ang - 0.4)],
    [x2 - s * Math.cos(ang + 0.4), y2 - s * Math.sin(ang + 0.4)],
  ];
  el("polygon", { points: p.map((q) => q.join(",")).join(" "), class: `${cls}-head` }, g);
}

function drawSupport(g, px, py, type) {
  if (type === "none") return;
  const s = 11;
  const grp = el("g", type === "rollerX" ? { transform: `rotate(90 ${px} ${py})` } : {}, g);
  el("polygon", { points: `${px},${py} ${px - s},${py + s * 1.5} ${px + s},${py + s * 1.5}`, class: "support" }, grp);
  let base = py + s * 1.5;
  if (type !== "pin") {
    el("circle", { cx: px - s / 2, cy: base + 3.5, r: 3, class: "support" }, grp);
    el("circle", { cx: px + s / 2, cy: base + 3.5, r: 3, class: "support" }, grp);
    base += 7;
  }
  el("line", { x1: px - s - 5, y1: base, x2: px + s + 5, y2: base, class: "support" }, grp);
  for (let i = -s - 3; i <= s + 3; i += 5) {
    el("line", { x1: px + i, y1: base, x2: px + i - 4, y2: base + 5, class: "support-hatch" }, grp);
  }
}

function render() {
  if (!state.model) return;
  const r = svg.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
  svg.replaceChildren();
  const { model, result } = state;
  drawGrid(el("g", {}, svg), r.width, r.height);

  const ok = result?.ok;
  const forces = ok ? result.members.map((m) => Math.abs(m.force)) : [];
  const maxF = Math.max(1e-9, ...forces);

  // deformed shape
  let deformScale = 1;
  if (ok && state.showDeformed && result.maxDisplacement > 1e-12) {
    const xs = model.nodes.map((n) => n.x);
    const ys = model.nodes.map((n) => n.y);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    deformScale = (0.06 * span) / result.maxDisplacement;
    const g = el("g", {}, svg);
    model.members.forEach((m) => {
      const a = model.nodes[m.a], b = model.nodes[m.b];
      const da = result.displacements[m.a], db = result.displacements[m.b];
      const [x1, y1] = toScreen(a.x + da.dx * deformScale, a.y + da.dy * deformScale);
      const [x2, y2] = toScreen(b.x + db.dx * deformScale, b.y + db.dy * deformScale);
      el("line", { x1, y1, x2, y2, class: "deformed" }, g);
    });
  }
  $("deformScale").textContent = deformScale >= 10 ? Math.round(deformScale).toLocaleString() : deformScale.toFixed(1);

  // members
  const gm = el("g", {}, svg);
  const labels = el("g", {}, svg);
  model.members.forEach((m, i) => {
    const a = model.nodes[m.a], b = model.nodes[m.b];
    const [x1, y1] = toScreen(a.x, a.y);
    const [x2, y2] = toScreen(b.x, b.y);
    const res = ok ? result.members[i] : null;
    const cls = res ? { tension: "t", compression: "c", zero: "z" }[res.state] : "n";
    const width = res ? 1.5 + 5 * (Math.abs(res.force) / maxF) : 2;
    const sel = state.selection?.type === "member" && state.selection.index === i;
    el("line", { x1, y1, x2, y2, class: `member ${cls}${sel ? " sel" : ""}`, "stroke-width": width }, gm);
    el("line", { x1, y1, x2, y2, class: "member-hit", "data-member": i }, gm);
    if (res && state.view.scale >= 40 && model.members.length <= 60 && Math.hypot(x2 - x1, y2 - y1) > 46) {
      const t = el("text", { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 5, "text-anchor": "middle", class: "force-label" }, labels);
      t.textContent = fmt(res.force, 1);
    }
  });

  // ghost member while drawing
  if (state.tool === "member" && state.pending !== null && state.hover) {
    const a = model.nodes[state.pending];
    const [x1, y1] = toScreen(a.x, a.y);
    const [x2, y2] = toScreen(snap(state.hover[0]), snap(state.hover[1]));
    el("line", { x1, y1, x2, y2, class: "ghost" }, svg);
  }

  // supports, reactions, loads, joints
  const gs = el("g", {}, svg);
  const gl = el("g", {}, svg);
  const gn = el("g", {}, svg);
  model.nodes.forEach((n, i) => {
    const [px, py] = toScreen(n.x, n.y);
    drawSupport(gs, px, py, n.support);
    const mag = Math.hypot(n.fx, n.fy);
    if (mag > 1e-9) {
      const L = 46;
      const ux = n.fx / mag, uy = -n.fy / mag; // screen direction
      // Tail at the joint, pointing along the load, so arrows hang clear of the truss.
      arrow(gl, px + ux * 8, py + uy * 8, px + ux * (L + 8), py + uy * (L + 8), "load");
      const t = el("text", { x: px + ux * (L + 14), y: py + uy * (L + 14) + (uy > 0.3 ? 8 : 4), "text-anchor": ux > 0.3 ? "start" : ux < -0.3 ? "end" : "middle", class: "load-label" }, gl);
      t.textContent = `${fmt(mag, 1)} kN`;
    }
    const sel = state.selection?.type === "node" && state.selection.index === i;
    const unstable = result && !result.ok && result.unstableNode === i;
    el("circle", { cx: px, cy: py, r: sel ? 6 : 5, class: `node${sel ? " sel" : ""}${unstable ? " unstable" : ""}${state.pending === i ? " sel" : ""}`, "data-node": i }, gn);
    el("text", { x: px + 8, y: py - 7, class: "node-label" }, gn).textContent = i + 1;
  });

  if (ok) {
    result.reactions.forEach((rx) => {
      const n = model.nodes[rx.node];
      const [px, py] = toScreen(n.x, n.y);
      const offset = n.support === "rollerX" ? 0 : 30;
      if (Math.abs(rx.ry) > 1e-6) {
        const dir = Math.sign(rx.ry);
        const y0 = py + offset + 30 * dir;
        arrow(gl, px + 22, y0 + 6, px + 22, y0 - 24 * dir + 6, "reaction");
        el("text", { x: px + 28, y: y0 + 4 - 12 * dir, class: "reaction-label" }, gl).textContent = fmt(Math.abs(rx.ry), 1);
      }
      if (Math.abs(rx.rx) > 1e-6) {
        const dir = Math.sign(rx.rx);
        arrow(gl, px - 30 * dir - 18 * dir, py + 22, px - 18 * dir, py + 22, "reaction");
        el("text", { x: px - 30 * dir - 18 * dir, y: py + 36, "text-anchor": "middle", class: "reaction-label" }, gl).textContent = fmt(Math.abs(rx.rx), 1);
      }
    });
  }

  if (state.hover && (state.tool === "node" || state.tool === "member")) {
    const [hx, hy] = toScreen(snap(state.hover[0]), snap(state.hover[1]));
    el("circle", { cx: hx, cy: hy, r: 3, class: "cursor-dot" }, svg);
  }
}

/* ---------- panel ---------- */

function renderPanel() {
  const { result, model } = state;
  const status = $("status");
  const det = result.determinacy;
  if (!result.ok) {
    status.className = "status bad";
    status.textContent = result.reason;
  } else {
    const weak = result.minFos < 1;
    status.className = `status${weak ? " warn" : ""}`;
    status.textContent = `Solved · ${det.label.toLowerCase()}${weak ? " · overstressed member" : ""}`;
  }

  const rows = [
    ["Joints / members", `${det.joints} / ${det.members}`],
    ["Reactions", det.reactions],
    ["m + r − 2j", det.degree],
  ];
  if (result.ok) {
    const ms = result.members;
    const maxT = ms.reduce((b, m) => (m.force > (b?.force ?? 0) ? m : b), null);
    const maxC = ms.reduce((b, m) => (m.force < (b?.force ?? 0) ? m : b), null);
    const minF = ms.reduce((b, m) => (m.fos < (b?.fos ?? Infinity) ? m : b), null);
    rows.push(
      ["Max tension", maxT ? `${fmt(maxT.force, 2)} kN  (#${maxT.index + 1})` : "–"],
      ["Max compression", maxC ? `${fmt(-maxC.force, 2)} kN  (#${maxC.index + 1})` : "–"],
      ["Max deflection", `${fmt(result.maxDisplacement * 1000, 2)} mm`],
      ["Min factor of safety", minF ? `${fmtFos(minF.fos)}  (#${minF.index + 1}, ${minF.fosBuckling < minF.fosYield ? "buckling" : "yield"})` : "–", minF && minF.fos < 1 ? "bad" : minF && minF.fos >= 2 ? "ok" : ""]
    );
  }
  $("summary").replaceChildren(
    ...rows.flatMap(([k, v, cls]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      if (cls) dd.className = cls;
      return [dt, dd];
    })
  );

  const tbody = $("members").querySelector("tbody");
  tbody.replaceChildren(
    ...model.members.map((m, i) => {
      const tr = document.createElement("tr");
      const res = result.ok ? result.members[i] : null;
      if (state.selection?.type === "member" && state.selection.index === i) tr.className = "sel";
      const L = Math.hypot(model.nodes[m.b].x - model.nodes[m.a].x, model.nodes[m.b].y - model.nodes[m.a].y);
      const cls = res ? { tension: "t", compression: "c", zero: "" }[res.state] : "";
      const cells = [
        [`${i + 1}`, ""],
        [fmt(L, 2), ""],
        [res ? fmt(res.force, 2) : "–", cls],
        [res ? fmt(res.stress, 1) : "–", cls],
        [res ? fmtFos(res.fos) : "–", res && res.fos < 1 ? "bad" : ""],
      ];
      cells.forEach(([text, c]) => {
        const td = document.createElement("td");
        td.textContent = text;
        if (c) td.className = c;
        tr.appendChild(td);
      });
      tr.addEventListener("click", () => select({ type: "member", index: i }));
      return tr;
    })
  );

  const rbody = $("reactions").querySelector("tbody");
  rbody.replaceChildren(
    ...(result.ok ? result.reactions : []).map((rx) => {
      const tr = document.createElement("tr");
      [`${rx.node + 1}`, fmt(rx.rx, 2), fmt(rx.ry, 2)].forEach((t) => {
        const td = document.createElement("td");
        td.textContent = t;
        tr.appendChild(td);
      });
      tr.addEventListener("click", () => select({ type: "node", index: rx.node }));
      return tr;
    })
  );

  renderInspector();
}

function field(parent, label, input) {
  const id = `f-${label.replace(/\W+/g, "")}`;
  const l = document.createElement("label");
  l.textContent = label;
  l.htmlFor = id;
  input.id = id;
  parent.append(l, input);
  return input;
}
function numberInput(value, step, onChange) {
  const i = document.createElement("input");
  i.type = "number";
  i.step = step;
  i.value = Number(value.toFixed(4));
  i.addEventListener("input", () => {
    const v = parseFloat(i.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return i;
}
function selectInput(options, value, onChange) {
  const s = document.createElement("select");
  for (const [v, label] of options) s.add(new Option(label, v, false, v === value));
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

let inspectorKey = "";
function renderInspector() {
  const sel = state.selection;
  const box = $("inspector");
  if (!sel) {
    box.hidden = true;
    inspectorKey = "";
    return;
  }
  // Rebuild only when the selected item changes so typing keeps focus.
  const key = `${sel.type}:${sel.index}:${state.model.nodes.length}:${state.model.members.length}`;
  if (key === inspectorKey && box.contains(document.activeElement)) return;
  inspectorKey = key;
  box.hidden = false;
  const body = $("inspectorBody");
  body.replaceChildren();
  const live = (fn) => (v) => { fn(v); update({ panelOnly: false, keepInspector: true }); };

  if (sel.type === "node") {
    const n = state.model.nodes[sel.index];
    $("inspectorTitle").textContent = `Joint ${sel.index + 1}`;
    field(body, "x (m)", numberInput(n.x, 0.5, live((v) => (n.x = v))));
    field(body, "y (m)", numberInput(n.y, 0.5, live((v) => (n.y = v))));
    field(body, "Support", selectInput(SUPPORT_CYCLE.map((s) => [s, SUPPORT_LABEL[s]]), n.support, live((v) => (n.support = v))));
    field(body, "Fx (kN)", numberInput(n.fx, 1, live((v) => (n.fx = v))));
    field(body, "Fy (kN)", numberInput(n.fy, 1, live((v) => (n.fy = v))));
  } else {
    const m = state.model.members[sel.index];
    $("inspectorTitle").textContent = `Member ${sel.index + 1} · joints ${m.a + 1}–${m.b + 1}`;
    field(body, "Material", selectInput(Object.entries(MATERIALS).map(([k, v]) => [k, `${v.name} (E ${v.E} GPa)`]), m.material, live((v) => (m.material = v))));
    field(body, "Area (mm²)", numberInput(m.area, 50, live((v) => (m.area = Math.max(v, 1)))));
    const res = state.result.ok ? state.result.members[sel.index] : null;
    if (res) {
      const info = document.createElement("p");
      info.style.gridColumn = "1 / -1";
      info.style.margin = "0";
      info.style.fontFamily = "var(--mono)";
      info.style.color = "var(--mute)";
      info.textContent = `FoS yield ${fmtFos(res.fosYield)} · FoS buckling ${fmtFos(res.fosBuckling)}`;
      body.appendChild(info);
    }
    const apply = document.createElement("div");
    apply.className = "row-actions";
    const all = document.createElement("button");
    all.textContent = "Apply to all members";
    all.addEventListener("click", () => {
      state.model.members.forEach((o) => { o.material = m.material; o.area = m.area; });
      update();
    });
    apply.appendChild(all);
    body.appendChild(apply);
  }
  const actions = document.createElement("div");
  actions.className = "row-actions";
  const del = document.createElement("button");
  del.className = "danger";
  del.textContent = "Delete";
  del.addEventListener("click", deleteSelection);
  actions.appendChild(del);
  body.appendChild(actions);
}

/* ---------- update loop ---------- */

function update() {
  state.result = solve(state.model);
  render();
  renderPanel();
  saveToHash();
}

function select(sel) {
  state.selection = sel;
  update();
}

function setTool(tool) {
  state.tool = tool;
  state.pending = null;
  document.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === tool)));
  $("hint").textContent = HINTS[tool];
  render();
}

/* ---------- persistence ---------- */

function encodeModel(model) {
  const compact = {
    n: model.nodes.map((n) => [n.x, n.y, SUPPORT_CYCLE.indexOf(n.support), n.fx, n.fy]),
    m: model.members.map((m) => [m.a, m.b, m.material, m.area]),
  };
  return btoa(JSON.stringify(compact)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeModel(str) {
  const json = JSON.parse(atob(str.replace(/-/g, "+").replace(/_/g, "/")));
  return {
    nodes: json.n.map(([x, y, s, fx, fy]) => ({ x, y, support: SUPPORT_CYCLE[s] ?? "none", fx, fy })),
    members: json.m
      .filter(([a, b]) => a < json.n.length && b < json.n.length)
      .map(([a, b, material, area]) => ({ a, b, material: MATERIALS[material] ? material : "steel", area })),
  };
}
let hashTimer;
function saveToHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => history.replaceState(null, "", `#t=${encodeModel(state.model)}`), 250);
}

/* ---------- input ---------- */

svg.addEventListener("pointerdown", (evt) => {
  if (evt.button === 1) {
    state.drag = { type: "pan", sx: evt.clientX, sy: evt.clientY, ox: state.view.ox, oy: state.view.oy };
    svg.setPointerCapture(evt.pointerId);
    return;
  }
  if (evt.button !== 0) return;
  const [wx, wy] = pointerWorld(evt);
  const t = evt.target;
  const hitNode = t.dataset?.node !== undefined ? +t.dataset.node : nodeAt(wx, wy);
  const hitMember = t.dataset?.member !== undefined ? +t.dataset.member : -1;
  svg.setPointerCapture(evt.pointerId);
  svg.focus();

  switch (state.tool) {
    case "select":
      if (hitNode >= 0) {
        state.selection = { type: "node", index: hitNode };
        state.drag = { type: "node", index: hitNode };
      } else if (hitMember >= 0) {
        state.selection = { type: "member", index: hitMember };
      } else {
        state.selection = null;
        state.drag = { type: "pan", sx: evt.clientX, sy: evt.clientY, ox: state.view.ox, oy: state.view.oy };
      }
      break;
    case "node":
      state.selection = { type: "node", index: hitNode >= 0 ? hitNode : addNode(snap(wx), snap(wy)) };
      break;
    case "member": {
      const idx = hitNode >= 0 ? hitNode : addNode(snap(wx), snap(wy));
      if (state.pending === null) state.pending = idx;
      else {
        addMember(state.pending, idx);
        state.pending = idx;
      }
      break;
    }
    case "support":
      if (hitNode >= 0) {
        const n = state.model.nodes[hitNode];
        n.support = SUPPORT_CYCLE[(SUPPORT_CYCLE.indexOf(n.support) + 1) % SUPPORT_CYCLE.length];
        state.selection = { type: "node", index: hitNode };
      }
      break;
    case "load":
      if (hitNode >= 0) {
        state.model.nodes[hitNode].fy -= 10;
        state.selection = { type: "node", index: hitNode };
      }
      break;
  }
  update();
});

svg.addEventListener("pointermove", (evt) => {
  const [wx, wy] = pointerWorld(evt);
  state.hover = [wx, wy];
  const d = state.drag;
  if (d?.type === "node") {
    const n = state.model.nodes[d.index];
    const [nx, ny] = [snap(wx), snap(wy)];
    if (nx !== n.x || ny !== n.y) {
      n.x = nx;
      n.y = ny;
      inspectorKey = "";
      update();
    }
    return;
  }
  if (d?.type === "pan") {
    state.view.ox = d.ox + evt.clientX - d.sx;
    state.view.oy = d.oy + evt.clientY - d.sy;
  }
  if (d?.type === "pan" || state.tool === "member" || state.tool === "node") render();
});

svg.addEventListener("pointerup", () => (state.drag = null));
svg.addEventListener("pointerleave", () => {
  state.hover = null;
  if (!state.drag) render();
});

svg.addEventListener(
  "wheel",
  (evt) => {
    evt.preventDefault();
    const r = svg.getBoundingClientRect();
    const px = evt.clientX - r.left;
    const py = evt.clientY - r.top;
    const [wx, wy] = toWorld(px, py);
    const factor = Math.exp(-evt.deltaY * 0.0015);
    state.view.scale = Math.min(Math.max(state.view.scale * factor, 8), 400);
    state.view.ox = px - wx * state.view.scale;
    state.view.oy = py + wy * state.view.scale;
    render();
  },
  { passive: false }
);

const KEY_TOOLS = { v: "select", j: "node", m: "member", s: "support", l: "load" };
document.addEventListener("keydown", (evt) => {
  if (evt.target.matches?.("input, select, textarea") || evt.metaKey || evt.ctrlKey || evt.altKey) return;
  const k = evt.key.toLowerCase();
  if (KEY_TOOLS[k]) setTool(KEY_TOOLS[k]);
  else if (k === "escape") {
    state.pending = null;
    state.selection = null;
    update();
  } else if (k === "delete" || k === "backspace") {
    evt.preventDefault();
    deleteSelection();
  } else if (k === "f") {
    fitView();
    render();
  }
});

document.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));

const presetSel = $("preset");
presetSel.add(new Option("Load preset…", "", true, true));
for (const [k, p] of Object.entries(PRESETS)) presetSel.add(new Option(p.label, k));
presetSel.addEventListener("change", () => {
  if (!presetSel.value) return;
  loadModel(buildPreset(presetSel.value));
  presetSel.value = "";
});

$("showDeformed").addEventListener("change", (e) => {
  state.showDeformed = e.target.checked;
  render();
});

$("share").addEventListener("click", async () => {
  history.replaceState(null, "", `#t=${encodeModel(state.model)}`);
  const btn = $("share");
  try {
    await navigator.clipboard.writeText(location.href);
    btn.textContent = "Link copied";
  } catch {
    btn.textContent = "Copy URL from address bar";
  }
  setTimeout(() => (btn.textContent = "Share"), 1600);
});

$("export").addEventListener("click", () => {
  const data = { model: state.model, result: state.result };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "truss.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

const root = document.documentElement;
try {
  const saved = localStorage.getItem("truss-theme");
  if (saved) root.dataset.theme = saved;
} catch {}
$("theme").addEventListener("click", () => {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("truss-theme", root.dataset.theme); } catch {}
});

new ResizeObserver(() => render()).observe(svg);

function loadModel(model) {
  state.model = model;
  state.selection = null;
  state.pending = null;
  fitView();
  update();
}

/* ---------- boot ---------- */

let initial = null;
const m = location.hash.match(/^#t=(.+)$/);
if (m) {
  try { initial = decodeModel(m[1]); } catch { initial = null; }
}
setTool("select");
loadModel(initial ?? buildPreset("pratt"));
