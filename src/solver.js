/**
 * 2D pin-jointed truss solver using the direct stiffness method.
 *
 * Units are consistent SI-ish engineering units:
 *   coordinates  m
 *   loads        kN
 *   E            GPa
 *   A            mm^2
 * so member stiffness EA/L is in kN/m, displacements in m, forces in kN.
 *
 * Sign convention: positive axial force = tension.
 */

export const MATERIALS = {
  steel: { name: "Structural steel A36", E: 200, yield: 250 },
  aluminium: { name: "Aluminium 6061-T6", E: 69, yield: 276 },
  titanium: { name: "Titanium Ti-6Al-4V", E: 114, yield: 880 },
  timber: { name: "Douglas fir (parallel to grain)", E: 12.4, yield: 30 },
};

const PIVOT_TOL = 1e-9;

/** Number of restrained degrees of freedom contributed by a support type. */
export function supportDofs(support) {
  switch (support) {
    case "pin":
      return [true, true];
    case "rollerY": // roller on horizontal surface: restrains vertical motion
      return [false, true];
    case "rollerX": // roller on vertical surface: restrains horizontal motion
      return [true, false];
    default:
      return [false, false];
  }
}

/**
 * Classify a truss by Maxwell's counting rule m + r vs 2j.
 * This is necessary but not sufficient for stability; the solver also
 * detects mechanisms from a singular stiffness matrix.
 */
export function determinacy(model) {
  const j = model.nodes.length;
  const m = model.members.length;
  const r = model.nodes.reduce(
    (sum, n) => sum + supportDofs(n.support).filter(Boolean).length,
    0
  );
  const degree = m + r - 2 * j;
  return {
    joints: j,
    members: m,
    reactions: r,
    degree,
    label:
      degree < 0
        ? "Unstable (too few members or supports)"
        : degree === 0
          ? "Statically determinate"
          : `Statically indeterminate (degree ${degree})`,
  };
}

/** Solve A x = b in place with Gaussian elimination and partial pivoting. */
export function gaussSolve(A, b) {
  const n = b.length;
  const scale = Math.max(1, ...A.map((row) => Math.max(...row.map(Math.abs))));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    if (Math.abs(A[pivot][col]) < PIVOT_TOL * scale) {
      return { ok: false, dof: col };
    }
    [A[col], A[pivot]] = [A[pivot], A[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = s / A[r][r];
  }
  return { ok: true, x };
}

function memberGeometry(nodes, m) {
  const a = nodes[m.a];
  const b = nodes[m.b];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  return { L, c: dx / L, s: dy / L };
}

/**
 * Solve a truss.
 *
 * @param {object} model
 * @param {{x:number,y:number,support?:string,fx?:number,fy?:number}[]} model.nodes
 * @param {{a:number,b:number,material?:string,area?:number}[]} model.members
 *   a, b are node indices; area in mm^2; material is a key of MATERIALS.
 * @returns {object} result with ok flag; on success displacements, member
 *   forces/stresses/factors of safety and support reactions.
 */
export function solve(model) {
  const { nodes, members } = model;
  const det = determinacy(model);
  const nDof = nodes.length * 2;

  if (nodes.length < 2 || members.length < 1) {
    return { ok: false, reason: "Add at least two joints and one member.", determinacy: det };
  }
  for (const [i, m] of members.entries()) {
    if (memberGeometry(nodes, m).L === 0) {
      return { ok: false, reason: `Member ${i + 1} has zero length.`, determinacy: det };
    }
  }

  // Global stiffness matrix K (kN/m) and load vector F (kN).
  const K = Array.from({ length: nDof }, () => new Array(nDof).fill(0));
  const F = new Array(nDof).fill(0);
  const props = members.map((m) => {
    const mat = MATERIALS[m.material] ?? MATERIALS.steel;
    const areaMm2 = m.area ?? 1000;
    const { L, c, s } = memberGeometry(nodes, m);
    const k = (mat.E * 1e6 * areaMm2 * 1e-6) / L; // kN/m  (E GPa -> kN/m^2)
    const dofs = [2 * m.a, 2 * m.a + 1, 2 * m.b, 2 * m.b + 1];
    const t = [-c, -s, c, s];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) K[dofs[i]][dofs[j]] += k * t[i] * t[j];
    }
    return { mat, areaMm2, L, c, s, k, dofs, t };
  });
  nodes.forEach((n, i) => {
    F[2 * i] = n.fx ?? 0;
    F[2 * i + 1] = n.fy ?? 0;
  });

  const restrained = nodes.flatMap((n) => supportDofs(n.support));
  const free = [];
  for (let i = 0; i < nDof; i++) if (!restrained[i]) free.push(i);

  const d = new Array(nDof).fill(0);
  if (free.length) {
    const Kff = free.map((i) => free.map((j) => K[i][j]));
    const Ff = free.map((i) => F[i]);
    const res = gaussSolve(Kff, Ff);
    if (!res.ok) {
      const dof = free[res.dof];
      return {
        ok: false,
        reason: `Mechanism: joint ${Math.floor(dof / 2) + 1} can move freely in ${dof % 2 ? "y" : "x"}. Add a member or support.`,
        unstableNode: Math.floor(dof / 2),
        determinacy: det,
      };
    }
    free.forEach((dof, i) => (d[dof] = res.x[i]));
  }

  const memberResults = props.map((p, i) => {
    const elong = p.t.reduce((sum, ti, j) => sum + ti * d[p.dofs[j]], 0); // m
    const force = p.k * elong; // kN, + tension
    const stress = (force * 1e3) / p.areaMm2; // N/mm^2 = MPa
    const fosYield = Math.abs(stress) > 1e-12 ? p.mat.yield / Math.abs(stress) : Infinity;
    let fosBuckling = Infinity;
    if (force < -1e-12) {
      // Euler buckling, pinned-pinned, solid circular section: I = A^2 / (4 pi)
      const A = p.areaMm2 * 1e-6; // m^2
      const I = (A * A) / (4 * Math.PI); // m^4
      const Pcr = (Math.PI ** 2 * p.mat.E * 1e6 * I) / (p.L * p.L); // kN
      fosBuckling = Pcr / Math.abs(force);
    }
    return {
      index: i,
      length: p.L,
      force,
      stress,
      state: Math.abs(force) < 1e-9 ? "zero" : force > 0 ? "tension" : "compression",
      fosYield,
      fosBuckling,
      fos: Math.min(fosYield, fosBuckling),
    };
  });

  // Reactions R = K d - F at restrained dofs.
  const reactions = nodes.map((n, i) => {
    const [rx, ry] = supportDofs(n.support);
    if (!rx && !ry) return null;
    const r = [2 * i, 2 * i + 1].map((dof, k) => {
      if (!(k === 0 ? rx : ry)) return 0;
      let s = -F[dof];
      for (let j = 0; j < nDof; j++) s += K[dof][j] * d[j];
      return s;
    });
    return { node: i, rx: r[0], ry: r[1] };
  }).filter(Boolean);

  const displacements = nodes.map((_, i) => ({ dx: d[2 * i], dy: d[2 * i + 1] }));
  const maxDisp = displacements.reduce((m, u) => Math.max(m, Math.hypot(u.dx, u.dy)), 0);

  return {
    ok: true,
    determinacy: det,
    displacements,
    maxDisplacement: maxDisp,
    members: memberResults,
    reactions,
    minFos: memberResults.reduce((m, r) => Math.min(m, r.fos), Infinity),
  };
}
