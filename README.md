# Truss Lab

[![ci](https://github.com/Haneet10/Truss-Lab/actions/workflows/ci.yml/badge.svg)](https://github.com/Haneet10/Truss-Lab/actions/workflows/ci.yml)
![No dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)

**See how a bridge carries weight.** Build or pick a bridge, put weight on it, and Truss Lab shows you which parts are being pulled, which are being squeezed, and which ones would break.

**[▶ Open the app](https://haneet10.github.io/Truss-Lab/)** (it runs in your browser, with nothing to install)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img alt="A bridge in Truss Lab: blue bars are being pulled, red bars are being squeezed" src="docs/screenshot-light.png">
</picture>

## What is this?

A **truss** is a frame made of straight bars joined in triangles. You see them in bridges, roofs, cranes and towers. When weight sits on a truss, every bar is either **pulled** (tension) or **squeezed** (compression). Engineers have to work out how hard each bar is working to make sure none of them snap or buckle.

Normally that means pages of hand calculations. Truss Lab does it instantly and draws the answer on the bridge:

| On screen | What it means |
|---|---|
| **Blue bar** | Being pulled |
| **Red bar** | Being squeezed |
| **Thicker bar** | Carrying more force |
| **Dashed outline** | How the bridge bends (exaggerated so you can see it) |
| **Safety factor** | How many times stronger the bar is than it needs to be. Above 1 is safe, below 1 means it would fail. |

## How to use it

1. **Open the app.** A bridge is already loaded and solved.
2. **Drag any joint** (the white dots). The colours and numbers update as you move it.
3. **Hover over a bar** (or tap it on a phone) to see how much force it carries and whether it's safe.
4. **Try a different shape** from the *Load preset* menu, or build your own with the toolbar:

| Button | What it does |
|---|---|
| **Joint** (`J`) | Click to place a dot |
| **Member** (`M`) | Click two dots to connect them with a bar |
| **Support** (`S`) | Click a dot to fix it to the ground |
| **Load** (`L`) | Click a dot to hang 10 kN of weight on it (about one tonne) |
| **Select** (`V`) | Move dots, or click a bar to change its material and thickness |

Made a mess? Press `Ctrl Z` to undo. Press **Share** to copy a link to your design.

If the app says the structure is a **mechanism**, part of it can flop around freely. Add a bar or a support to brace it.

---

## For engineers

- **Analysis:** linear-elastic direct stiffness method with pin-jointed members. It re-solves on every edit.
- **Checks:** axial stress, factor of safety against yield, and Euler buckling (pinned ends, solid round section). The lower of the two is reported.
- **Stability:** Maxwell's count `m + r − 2j`, plus detection of a singular stiffness matrix that names the joint that's free to move.
- **Materials:** A36 steel, 6061-T6 aluminium, Ti-6Al-4V and Douglas fir, with per-member cross-sectional area.
- **Presets:** Pratt, Howe and Warren bridges, a Fink roof and a cantilever bracket.
- **No dependencies:** plain ES modules with no build step. The model is encoded in the URL, and you can export it as JSON.

## How the solver works

[`src/solver.js`](src/solver.js) is a self-contained module with no DOM access:

1. For each member with length `L`, direction cosines `c, s` and axial stiffness `k = EA/L`, it adds the 4×4 element stiffness `k · tᵀt` (where `t = [−c, −s, c, s]`) into the global matrix `K`.
2. It partitions `K` into free and restrained degrees of freedom and solves `K_ff · d_f = F_f` by Gaussian elimination with partial pivoting. A pivot that is effectively zero means a mechanism.
3. Member force is `N = k · t · d`, positive in tension, and stress is `σ = N / A`.
4. Reactions are recovered as `R = K · d − F` at the supported degrees of freedom.
5. The buckling check treats each compression member as a pinned-pinned Euler column with a solid round section (`I = A² / 4π`): `P_cr = π²EI / L²`.

Units: m, kN, GPa and mm², so stiffness is in kN/m and stress in MPa.

**Assumptions.** Pin-jointed members carrying axial force only, loads applied at the joints, linear-elastic material and small displacements. The section shape is only used for buckling. Treat the result as a hand-calc check, not a substitute for a design code.

## Tests

```bash
npm test
```

The test suite uses Node's built-in test runner, so there is nothing to install. Every result is checked against an independent hand calculation:

- Method of joints on a symmetric triangle: 5 kN chord tension and 7.07 kN diagonal compression
- Method of sections on a Pratt bridge: 30 kN bottom chord and 40 kN top chord
- Axial bar deflection `δ = PL/EA`
- Euler buckling load of a slender strut
- Mechanism detection on an unbraced square
- Equilibrium (ΣR = −ΣF) for every preset and for an indeterminate truss

## Running locally

Browsers don't load ES modules from `file://`, so serve the folder with any static server:

```bash
npm start            # or: python -m http.server
```

## Project layout

```
index.html            app shell
styles.css            light/dark theme, layout
src/solver.js         direct stiffness solver (pure, tested)
src/presets.js        starter trusses
src/app.js            SVG editor, interaction, results panel
tests/solver.test.js  hand-checked test cases
.github/workflows/    CI: tests on every push and PR, then deploy to GitHub Pages
```

## License

MIT
