/** Starter trusses. Coordinates in m, loads in kN. */

function chordTruss(panels, width, depth, diagonals) {
  const nodes = [];
  const members = [];
  for (let i = 0; i <= panels; i++) nodes.push({ x: i * width, y: 0 });
  for (let i = 1; i < panels; i++) nodes.push({ x: i * width, y: depth });
  const bottom = (i) => i;
  const top = (i) => panels + i; // i in 1..panels-1
  nodes[0].support = "pin";
  nodes[panels].support = "rollerY";
  for (let i = 1; i < panels; i++) nodes[i].fy = -20;
  for (let i = 0; i < panels; i++) members.push({ a: bottom(i), b: bottom(i + 1) });
  for (let i = 1; i < panels - 1; i++) members.push({ a: top(i), b: top(i + 1) });
  members.push({ a: bottom(0), b: top(1) });
  members.push({ a: top(panels - 1), b: bottom(panels) });
  for (let i = 1; i < panels; i++) members.push({ a: bottom(i), b: top(i) });
  const mid = panels / 2;
  for (let i = 1; i < panels - 1; i++) {
    const towardCentre = i < mid;
    if (diagonals === "pratt") {
      members.push(towardCentre ? { a: top(i), b: bottom(i + 1) } : { a: bottom(i), b: top(i + 1) });
    } else {
      members.push(towardCentre ? { a: bottom(i), b: top(i + 1) } : { a: top(i), b: bottom(i + 1) });
    }
  }
  return { nodes, members };
}

function warren(panels, width, depth) {
  const nodes = [];
  const members = [];
  for (let i = 0; i <= panels; i++) nodes.push({ x: i * width, y: 0 });
  for (let i = 0; i < panels; i++) nodes.push({ x: (i + 0.5) * width, y: depth });
  nodes[0].support = "pin";
  nodes[panels].support = "rollerY";
  for (let i = 1; i < panels; i++) nodes[i].fy = -20;
  for (let i = 0; i < panels; i++) members.push({ a: i, b: i + 1 });
  for (let i = 0; i < panels - 1; i++) members.push({ a: panels + 1 + i, b: panels + 2 + i });
  for (let i = 0; i < panels; i++) {
    members.push({ a: i, b: panels + 1 + i });
    members.push({ a: panels + 1 + i, b: i + 1 });
  }
  return { nodes, members };
}

function cantilever() {
  const nodes = [
    { x: 0, y: 0, support: "pin" },
    { x: 0, y: 2, support: "pin" },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 4, y: 0, fy: -15 },
    { x: 4, y: 1.5 },
    { x: 6, y: 0.5, fy: -10 },
  ];
  const members = [
    [0, 2], [1, 3], [0, 3], [2, 3], [2, 4], [3, 5], [2, 5], [4, 5], [4, 6], [5, 6],
  ].map(([a, b]) => ({ a, b }));
  return { nodes, members };
}

function roof() {
  const nodes = [
    { x: 0, y: 0, support: "pin" },
    { x: 3, y: 0 },
    { x: 6, y: 0 },
    { x: 9, y: 0 },
    { x: 12, y: 0, support: "rollerY" },
    { x: 3, y: 1.5, fy: -12 },
    { x: 6, y: 3, fy: -12 },
    { x: 9, y: 1.5, fy: -12 },
  ];
  const members = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 4],
    [1, 5], [2, 6], [3, 7], [5, 2], [7, 2],
  ].map(([a, b]) => ({ a, b }));
  return { nodes, members };
}

export const PRESETS = {
  pratt: { label: "Pratt bridge", build: () => chordTruss(6, 3, 3, "pratt") },
  howe: { label: "Howe bridge", build: () => chordTruss(6, 3, 3, "howe") },
  warren: { label: "Warren bridge", build: () => warren(5, 3, 2.6) },
  roof: { label: "Fink roof", build: roof },
  cantilever: { label: "Cantilever bracket", build: cantilever },
  blank: { label: "Blank sheet", build: () => ({ nodes: [], members: [] }) },
};

export function buildPreset(key) {
  const m = PRESETS[key].build();
  m.members.forEach((mem) => {
    mem.material ??= "steel";
    mem.area ??= 4000;
  });
  m.nodes.forEach((n) => {
    n.support ??= "none";
    n.fx ??= 0;
    n.fy ??= 0;
  });
  return m;
}
