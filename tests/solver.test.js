import { test } from "node:test";
import assert from "node:assert/strict";
import { solve, determinacy, gaussSolve } from "../src/solver.js";

const close = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);

test("gaussSolve solves a small dense system", () => {
  const res = gaussSolve([[2, 1], [1, 3]], [3, 5]);
  assert.ok(res.ok);
  close(res.x[0], 0.8);
  close(res.x[1], 1.4);
});

test("gaussSolve flags a singular matrix", () => {
  assert.equal(gaussSolve([[1, 2], [2, 4]], [1, 2]).ok, false);
});

// Symmetric triangle: span 4 m, apex 2 m up, 10 kN down at apex.
// Hand calc: each support reacts 5 kN; diagonals at 45 deg carry
// 5 / sin45 = 7.071 kN compression; bottom chord carries 5 kN tension.
const triangle = () => ({
  nodes: [
    { x: 0, y: 0, support: "pin" },
    { x: 4, y: 0, support: "rollerY" },
    { x: 2, y: 2, fy: -10 },
  ],
  members: [
    { a: 0, b: 1 },
    { a: 0, b: 2 },
    { a: 1, b: 2 },
  ],
});

test("triangle truss matches method-of-joints hand calc", () => {
  const r = solve(triangle());
  assert.ok(r.ok);
  close(r.members[0].force, 5);
  close(r.members[1].force, -10 / Math.SQRT2);
  close(r.members[2].force, -10 / Math.SQRT2);
  assert.equal(r.members[0].state, "tension");
  assert.equal(r.members[1].state, "compression");
});

test("reactions balance applied loads", () => {
  const r = solve(triangle());
  const sumRy = r.reactions.reduce((s, x) => s + x.ry, 0);
  const sumRx = r.reactions.reduce((s, x) => s + x.rx, 0);
  close(sumRy, 10);
  close(sumRx, 0, 1e-9);
  close(r.reactions[0].ry, 5);
});

test("axial bar deflection equals PL/EA", () => {
  // 2 m steel bar, 1000 mm^2, 50 kN pull: delta = 50 * 2 / (200e6 * 1e-3) = 0.5 mm
  const r = solve({
    nodes: [
      { x: 0, y: 0, support: "pin" },
      { x: 2, y: 0, support: "rollerY", fx: 50 },
    ],
    members: [{ a: 0, b: 1, material: "steel", area: 1000 }],
  });
  assert.ok(r.ok);
  close(r.displacements[1].dx, 0.0005);
  close(r.members[0].stress, 50); // 50 kN / 1000 mm^2 = 50 MPa
  close(r.members[0].fosYield, 5);
});

test("Euler buckling governs a slender compression member", () => {
  // 3 m steel strut, A = 500 mm^2 solid round: I = A^2/(4 pi) = 1.989e-8 m^4
  // Pcr = pi^2 * 200e6 * 1.989e-8 / 9 = 4.363 kN; load 2 kN -> FoS 2.18
  const r = solve({
    nodes: [
      { x: 0, y: 0, support: "pin" },
      { x: 3, y: 0, support: "rollerY", fx: -2 },
    ],
    members: [{ a: 0, b: 1, material: "steel", area: 500 }],
  });
  const A = 500e-6;
  const Pcr = (Math.PI ** 2 * 200e6 * (A * A) / (4 * Math.PI)) / 9;
  close(r.members[0].fosBuckling, Pcr / 2);
  assert.ok(r.members[0].fosBuckling < r.members[0].fosYield);
  close(r.minFos, Pcr / 2);
});

test("a square without a diagonal is reported as a mechanism", () => {
  const r = solve({
    nodes: [
      { x: 0, y: 0, support: "pin" },
      { x: 2, y: 0, support: "rollerY" },
      { x: 2, y: 2, fx: 1 },
      { x: 0, y: 2 },
    ],
    members: [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
      { a: 2, b: 3 },
      { a: 3, b: 0 },
    ],
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Mechanism/);
});

test("determinacy uses m + r = 2j", () => {
  const d = determinacy(triangle());
  assert.equal(d.degree, 0);
  assert.equal(d.label, "Statically determinate");
});

test("indeterminate truss still solves and satisfies equilibrium", () => {
  // Triangle with an extra vertical from apex to a midspan joint, both supports pinned.
  const r = solve({
    nodes: [
      { x: 0, y: 0, support: "pin" },
      { x: 4, y: 0, support: "pin" },
      { x: 2, y: 2, fy: -10 },
      { x: 2, y: 0 },
    ],
    members: [
      { a: 0, b: 3 },
      { a: 3, b: 1 },
      { a: 0, b: 2 },
      { a: 1, b: 2 },
      { a: 2, b: 3 },
    ],
  });
  assert.ok(r.ok);
  assert.ok(r.determinacy.degree > 0);
  close(r.reactions.reduce((s, x) => s + x.ry, 0), 10);
});

test("Pratt bridge: symmetric loading gives symmetric forces", () => {
  // 4-panel Pratt truss, 3 m panels, 3 m deep, 20 kN at each interior bottom joint.
  const nodes = [0, 3, 6, 9, 12].map((x) => ({ x, y: 0 }));
  nodes[0].support = "pin";
  nodes[4].support = "rollerY";
  [1, 2, 3].forEach((i) => (nodes[i].fy = -20));
  [3, 6, 9].forEach((x) => nodes.push({ x, y: 3 }));
  const members = [
    [0, 1], [1, 2], [2, 3], [3, 4], // bottom chord
    [5, 6], [6, 7], // top chord
    [0, 5], [7, 4], // end posts
    [1, 5], [2, 6], [3, 7], // verticals
    [5, 2], [7, 2], // diagonals
  ].map(([a, b]) => ({ a, b }));
  const r = solve({ nodes, members });
  assert.ok(r.ok);
  assert.equal(r.determinacy.degree, 0);
  close(r.members[0].force, r.members[3].force);
  close(r.members[1].force, r.members[2].force);
  // Method of sections, R = 30 kN. Cut panel 2, moments about top joint (3,3):
  // bottom chord T = 30*3 / 3 = 30 kN. Moments about bottom joint (6,0):
  // top chord C = (30*6 - 20*3) / 3 = 40 kN.
  close(r.members[1].force, 30);
  close(r.members[4].force, -40);
});

import { PRESETS, buildPreset } from "../src/presets.js";

for (const key of Object.keys(PRESETS).filter((k) => k !== "blank")) {
  test(`preset "${key}" is stable and in equilibrium`, () => {
    const model = buildPreset(key);
    const r = solve(model);
    assert.ok(r.ok, r.reason);
    const Fy = model.nodes.reduce((s, n) => s + n.fy, 0);
    const Fx = model.nodes.reduce((s, n) => s + n.fx, 0);
    close(r.reactions.reduce((s, x) => s + x.ry, 0), -Fy);
    close(r.reactions.reduce((s, x) => s + x.rx, 0), -Fx, 1e-9);
  });
}
