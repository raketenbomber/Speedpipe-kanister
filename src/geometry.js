// Kanister-Konfigurator – Geometrie
// Erzeugt alle Teile als Manifold-Körper (manifold-3d / WASM).
// Läuft im Browser (Web Worker) und in Node (Tests).

export const DUCTS = [
  // [Außen, Innen] in mm – gängige Mikrorohr-/Speedpipe-Größen
  [5, 3.5], [6, 3.5], [7, 3.5], [7, 4], [7, 5.5], [8, 4.5], [8, 5], [8, 6],
  [8.5, 6], [10, 5.5], [10, 6], [10, 8], [12, 8], [12, 9.8], [12, 10],
  [12.7, 8], [12.7, 10], [14, 10], [14, 11.4], [14, 12], [16, 12], [16, 13],
  [16, 14], [18, 14], [18, 16], [20, 15], [20, 16],
];

export const DEFAULTS = {
  mode: 'volume',        // 'volume' | 'height'
  volumeMl: 100,         // Zielvolumen bis Halsoberkante
  heightMm: 80,          // Körperhöhe (Boden bis Halsoberkante) im Modus 'height'
  diameterMm: 60,        // Außendurchmesser Körper (= Überwurfring)
  wall: 2.4,             // Wandstärke Körper
  ductOd: 12, ductId: 8, // Mikrorohr
  tubeFree: 22,          // freie Rohrlänge über dem Deckel (Einstecktiefe Verbinder)
  tubeOdAdjust: 0,       // Korrektur Rohr-Außendurchmesser (Druckertoleranz)
  splash: false,         // Spritzschutz-Dach mit Labyrinth (ab ca. Ø75 mm sinnvoll)
  snap: true,            // Deckelscheibe rastet im Überwurfring ein
  reinforce: false,      // Verstärkung: Rippen am Rohrfuß, dickere Scheibe, Boden und Dach
  gasket: true,          // TPU-Dichtung erzeugen
  threadClearance: 0.5,  // radiales Gewindespiel
  segments: 128,         // Kreisauflösung
};

const TH_P = 4.0, TH_D = 1.5;       // Gewinde Steigung / Tiefe (45°-Flanken)
const COL_WALL = 2.6;               // Wand Überwurfring über Gewindegrund
const NECK_L = 16.5;                // Halslänge
const GASKET_T = 1.5;
const COL_FL = 2.5;                 // Flanschdicke (ohne Dach)
const COL_TH_LEN = 14.0;
const WIN_Z0 = 9.0, WIN_Z1 = 20.0, WIN_POST = 4.0;
const ROOF_GAP = 22.0;
const SKIRT_T = 1.6;

export function createGenerator(wasm) {
  const { Manifold, CrossSection, Mesh } = wasm;
  // werden in build() je nach Verstärkung gesetzt
  let DISK_T = 4.0, ROOF_T = 2.5, BOTTOM_T = 2.4, RIB_H = 0;

  const cyl = (r, h, z = 0, x = 0, y = 0, r2 = undefined, seg = 128) =>
    Manifold.cylinder(h, r, r2 === undefined ? r : r2, seg).translate([x, y, z]);
  const ring = (ro, ri, h, z = 0, seg = 128) =>
    cyl(ro, h, z, 0, 0, undefined, seg).subtract(cyl(ri, h + 2, z - 1, 0, 0, undefined, seg));

  // Helix-Gewinderippe, Trapezprofil (45°-Flanken), weich ein-/auslaufend
  function thread(rSurf, depth, pitch, z0, length, internal = false, wCrest = 0.3, fadeDeg = 70, spt = 96) {
    const wRoot = wCrest + 2 * depth;
    const turns = length / pitch;
    const n = Math.floor(turns * spt) + 1;
    const sgn = internal ? -1 : 1;
    const emb = 0.4;
    const tEnd = turns * 2 * Math.PI;
    const fade = fadeDeg * Math.PI / 180;
    const verts = new Float32Array(n * 4 * 3);
    let vi = 0;
    for (let i = 0; i < n; i++) {
      const t = tEnd * i / (n - 1);
      let f = Math.min(1, Math.max(0, Math.min(t, tEnd - t) / fade));
      f = 0.02 + 0.98 * Math.sin(f * Math.PI / 2);
      const zc = z0 + pitch * t / (2 * Math.PI) + wRoot / 2;
      const d = depth * f;
      const wc = wCrest + (wRoot - wCrest) * (1 - f);
      const prof = [[-sgn * emb, -wRoot / 2], [sgn * d, -wc / 2], [sgn * d, wc / 2], [-sgn * emb, wRoot / 2]];
      const a = t + 0.0137; // Phasenversatz: keine deckungsgleichen Punkte mit Zylindern
      for (const [dr, dz] of prof) {
        const r = rSurf + dr;
        verts[vi++] = r * Math.cos(a); verts[vi++] = r * Math.sin(a); verts[vi++] = zc + dz;
      }
    }
    const tris = [];
    for (let i = 0; i < n - 1; i++) {
      const a = 4 * i, b = 4 * (i + 1);
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        tris.push(a + k, b + k, b + k2, a + k, b + k2, a + k2);
      }
    }
    tris.push(0, 1, 2, 0, 2, 3);                 // Startkappe
    const e = 4 * (n - 1);
    tris.push(e, e + 3, e + 2, e, e + 2, e + 1); // Endkappe
    // Orientierung über Volumenvorzeichen prüfen
    let vol = 0;
    for (let i = 0; i < tris.length; i += 3) {
      const p = [tris[i], tris[i + 1], tris[i + 2]].map(j => [verts[3 * j], verts[3 * j + 1], verts[3 * j + 2]]);
      vol += p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0]);
    }
    if (vol < 0) for (let i = 0; i < tris.length; i += 3) { const t = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = t; }
    const mesh = new Mesh({ numProp: 3, vertProperties: verts, triVerts: new Uint32Array(tris) });
    return new Manifold(mesh);
  }

  // Bogen (r, Winkel) als 2D-Fläche mit runden Enden
  function arcSlot(rm, w, a0, span, segs = 40) {
    const outer = [], inner = [];
    for (let i = 0; i <= segs; i++) {
      const a = a0 + span * i / segs;
      outer.push([(rm + 0.01) * Math.cos(a), (rm + 0.01) * Math.sin(a)]);
      inner.push([(rm - 0.01) * Math.cos(a), (rm - 0.01) * Math.sin(a)]);
    }
    return new CrossSection([outer.concat(inner.reverse())], 'NonZero').offset(w / 2, 'Round', 2, 48);
  }

  function derive(p) {
    const seg = p.segments;
    const BODY_R = p.diameterMm / 2;
    const CLR = p.threadClearance;
    const NECK_R = BODY_R - TH_D - CLR - COL_WALL;
    const S = BODY_R - NECK_R; // 45°-Absatz
    const COL_BORE = NECK_R + TH_D + CLR;
    const COL_OUT = COL_BORE + COL_WALL;      // == BODY_R
    const COL_PLAIN = NECK_R + 0.3;
    const COL_HOLE = NECK_R - 3.5;
    const tubeOd = p.ductOd + p.tubeOdAdjust;
    const tubeId = p.ductId;
    const A_in = Math.PI * (tubeId / 2) ** 2;
    const SKIRT_R = COL_HOLE - 7.9;
    // Entlüftungsschlitze automatisch: Ringe zwischen Rohr und Grenze
    const rStart = tubeOd / 2 + 2.5;
    const rLimit = p.splash ? SKIRT_R - 2.5 : COL_HOLE - 2.5;
    const rings = [];
    let r = rStart;
    while (true) {
      const w = Math.min(5, rLimit - r);
      if (w < 2.5) break;
      const rm = r + w / 2;
      const n = Math.max(3, Math.round(2 * Math.PI * rm / 17));
      rings.push({ ri: r, ro: r + w, n });
      r += w + 2.5;
    }
    // Spalt unter der Schürze: mind. 15× Rohrquerschnitt
    const SKIRT_GAP = Math.min(8, Math.max(4, 15 * A_in / (2 * Math.PI * SKIRT_R)));
    const WIN_N = Math.max(6, Math.round(2 * Math.PI * COL_OUT / 21));
    return { seg, BODY_R, NECK_R, S, CLR, COL_BORE, COL_OUT, COL_PLAIN, COL_HOLE, tubeOd, tubeId, A_in,
      SKIRT_R, SKIRT_GAP, rings, WIN_N };
  }

  function ventSlots(d) {
    const VENT_RIB = 3.0;
    let sl = null;
    d.rings.forEach((rg, k) => {
      const rm = (rg.ri + rg.ro) / 2, w = rg.ro - rg.ri;
      const ribAng = (VENT_RIB + w) / rm;
      const span = 2 * Math.PI / rg.n - ribAng;
      if (span <= 0.02) return;
      for (let i = 0; i < rg.n; i++) {
        const a0 = 2 * Math.PI * i / rg.n + (Math.PI / rg.n) * k + ribAng / 2;
        const s = arcSlot(rm, w, a0, span);
        sl = sl ? sl.add(s) : s;
      }
    });
    return sl;
  }

  // ---------------------------------------------------------------- Teile
  function body(p, d, H) {
    const { seg, BODY_R, NECK_R, S } = d;
    const W = p.wall;
    const Z_SH = H + S, Z_RIM = Z_SH + NECK_L;
    let outer = Manifold.hull([cyl(BODY_R, H, 0, 0, 0, undefined, seg), cyl(NECK_R, 0.01, Z_SH, 0, 0, undefined, seg)]);
    // Bodenfase 1 mm
    outer = outer.subtract(cyl(BODY_R + 1, 1.0, -0.01, 0, 0, undefined, seg).subtract(cyl(BODY_R - 1, 1.0, -0.01, 0, 0, BODY_R, seg)));
    const neck = cyl(NECK_R, NECK_L + 0.5, Z_SH - 0.5, 0, 0, undefined, seg);
    const k = Math.hypot(1, S / (BODY_R - NECK_R));
    const zInTop = H + S * (BODY_R - (NECK_R - W)) / (BODY_R - NECK_R) - W * k;
    const inner = Manifold.hull([
      cyl(BODY_R - W, H - 1 + W - BOTTOM_T, BOTTOM_T, 0, 0, undefined, seg),
      cyl(NECK_R - W, 0.01, zInTop, 0, 0, undefined, seg),
    ]);
    const bore = cyl(NECK_R - W, NECK_L + 40, zInTop - 1, 0, 0, undefined, seg);
    const th = thread(NECK_R, TH_D, TH_P, Z_RIM - 16.0, 12.0);
    const bead = new CrossSection([[[NECK_R - 1.8, 0], [NECK_R - 0.6, 0], [NECK_R - 1.2, 0.6]]]).revolve(seg).translate([0, 0, Z_RIM]);
    return { m: Manifold.union([outer, neck, th, bead]).subtract(inner).subtract(bore), Z_RIM, Z_SH, zInTop };
  }

  function collar(p, d, Z_RIM) {
    const { seg, NECK_R, COL_BORE, COL_OUT, COL_PLAIN, COL_HOLE, SKIRT_R, SKIRT_GAP, WIN_N, tubeOd } = d;
    const z_fl = Z_RIM + GASKET_T + DISK_T;
    const zb = Z_RIM - COL_TH_LEN;
    const top = z_fl + (p.splash ? ROOF_GAP + ROOF_T : COL_FL);
    let c = cyl(COL_OUT, top - zb, zb, 0, 0, undefined, seg);
    // Griffrillen
    const nG = Math.max(24, Math.round(2 * Math.PI * COL_OUT / 5.7));
    const grooves = [];
    for (let i = 0; i < nG; i++)
      grooves.push(Manifold.cube([1.2, 1.6, Z_RIM - zb - 1]).translate([COL_OUT - 0.6, -0.8, zb + 1.5]).rotate([0, 0, 360 * i / nG]));
    c = c.subtract(Manifold.union(grooves));
    c = c.subtract(cyl(COL_BORE, COL_TH_LEN + 0.01, zb - 0.01, 0, 0, undefined, seg));
    c = c.subtract(cyl(COL_PLAIN, GASKET_T + DISK_T + 0.02, Z_RIM - 0.01, 0, 0, undefined, seg));
    if (p.snap) {
      // Rastnut für die Deckelscheibe (mit 45°-Fase unten)
      const RG = NECK_R + 1.4;
      const zg0 = z_fl - DISK_T + 0.4;
      c = c.subtract(cyl(COL_PLAIN, RG - COL_PLAIN, zg0, 0, 0, RG, seg));
      c = c.subtract(cyl(RG, z_fl - (zg0 + RG - COL_PLAIN) + 0.01, zg0 + RG - COL_PLAIN - 0.005, 0, 0, undefined, seg));
    }
    if (!p.splash) {
      c = c.subtract(cyl(COL_HOLE, 10, z_fl - 1, 0, 0, undefined, seg));
    } else {
      const wallIn = COL_OUT - COL_WALL;
      c = c.subtract(cyl(COL_HOLE, COL_FL + 0.02, z_fl - 0.01, 0, 0, undefined, seg));
      c = c.subtract(cyl(COL_HOLE, wallIn - COL_HOLE + 0.01, z_fl + COL_FL, 0, 0, wallIn, seg));
      c = c.subtract(cyl(wallIn, ROOF_GAP - COL_FL - (wallIn - COL_HOLE) + 0.02, z_fl + COL_FL + wallIn - COL_HOLE - 0.01, 0, 0, undefined, seg));
      const winW = 2 * Math.PI * COL_OUT / WIN_N - WIN_POST;
      const wins = [];
      for (let i = 0; i < WIN_N; i++)
        wins.push(Manifold.cube([COL_WALL + 4, winW, WIN_Z1 - WIN_Z0]).translate([wallIn - 1, -winW / 2, z_fl + WIN_Z0]).rotate([0, 0, 360 * i / WIN_N + 180 / WIN_N]));
      c = c.subtract(Manifold.union(wins));
      c = c.add(ring(SKIRT_R + SKIRT_T, SKIRT_R, ROOF_GAP - SKIRT_GAP + 0.5, z_fl + SKIRT_GAP, seg));
      c = c.subtract(cyl(tubeOd / 2 + 0.3, ROOF_T + 2, z_fl + ROOF_GAP - 1, 0, 0, undefined, seg));
    }
    c = c.subtract(cyl(COL_BORE + 1.0, 1.0, zb - 0.01, 0, 0, COL_BORE, seg));
    c = c.add(thread(COL_BORE, TH_D, TH_P, zb + 0.5, COL_TH_LEN - 1.0, true));
    return { m: c, top, z_fl };
  }

  function disk(p, d, Z_RIM) {
    const { seg, NECK_R, COL_HOLE, SKIRT_R, tubeOd, tubeId } = d;
    const z0 = Z_RIM + GASKET_T, zt = z0 + DISK_T;
    const tubeH = (p.splash ? ROOF_GAP + ROOF_T : COL_FL + RIB_H) + p.tubeFree;
    let m = cyl(NECK_R, DISK_T, z0, 0, 0, undefined, seg);
    m = m.add(cyl(tubeOd / 2, tubeH + 0.01, zt - 0.01, 0, 0, undefined, 96));
    // kleine Fase oben am Rohr (Einführhilfe für Steckverbinder)
    m = m.subtract(cyl(tubeOd / 2 + 1, 0.6, zt + tubeH - 0.6, 0, 0, undefined, 96).subtract(cyl(tubeOd / 2 - 0.6, 0.6, zt + tubeH - 0.6, 0, 0, tubeOd / 2, 96)));
    m = m.subtract(cyl(tubeId / 2, DISK_T + tubeH + 2, z0 - 1, 0, 0, undefined, 96));
    const vs = ventSlots(d);
    if (vs) m = m.subtract(vs.extrude(DISK_T + 2).translate([0, 0, z0 - 1]));
    if (p.reinforce) {
      // Rippen am Rohrfuß – auf den Stegen zwischen den inneren Schlitzen
      const r0 = tubeOd / 2 - 0.3;
      const rg = d.rings[0];
      const len = (rg ? rg.ro + 1.0 : tubeOd / 2 + 8) - r0;
      const nR = rg ? rg.n : 6;
      const ribs = [];
      const tri = new CrossSection([[[0, 0], [len, 0], [len, 1.2], [0, RIB_H]]]);   // Dreieck mit kleiner Fußkante
      for (let i = 0; i < nR; i++) {
        const rib = tri.extrude(2.4).translate([0, 0, -1.2]).rotate([90, 0, 0])
          .translate([r0, 0, zt - 0.01]).rotate([0, 0, 360 * i / nR]);
        ribs.push(rib);
      }
      // Hohlkehle am Rohrfuß
      ribs.push(cyl(tubeOd / 2 + 2.5, 2.5, zt - 0.01, 0, 0, tubeOd / 2, 96));
      m = m.add(Manifold.union(ribs)).subtract(cyl(tubeId / 2, RIB_H + 5, z0 - 1, 0, 0, undefined, 96));
    }
    if (p.splash) {
      const dr = (SKIRT_R + SKIRT_T + COL_HOLE) / 2;
      const n = Math.max(6, Math.round(2 * Math.PI * dr / 23));
      const holes = [];
      for (let i = 0; i < n; i++) {
        const a = 2 * Math.PI * (i + 0.5) / n;
        holes.push(cyl(1.25, DISK_T + 2, z0 - 1, dr * Math.cos(a), dr * Math.sin(a), undefined, 32));
      }
      m = m.subtract(Manifold.union(holes));
    }
    if (p.snap) {
      // 4 federnde Raststege am Rand mit Rastnase
      const N = 4;
      const rSlit = NECK_R - 2.5;            // Mitte Schlitz (1 mm breit)
      const L = Math.min(36, 2 * Math.PI * rSlit / N - 12);
      const span = L / rSlit;
      const slits = [], bumps = [];
      for (let i = 0; i < N; i++) {
        const ac = 2 * Math.PI * i / N + Math.PI / N;
        slits.push(arcSlot(rSlit, 1.0, ac - span / 2, span).extrude(DISK_T + 2).translate([0, 0, z0 - 1]));
        const bumpDeg = Math.min(14, (8 / NECK_R) * 180 / Math.PI);
        const prof = new CrossSection([[[NECK_R - 0.3, 0.6], [NECK_R + 0.8, 1.4], [NECK_R + 0.8, 2.6], [NECK_R - 0.3, 3.4]]]);
        bumps.push(prof.revolve(24, bumpDeg).rotate([0, 0, ac * 180 / Math.PI - bumpDeg / 2]).translate([0, 0, z0]));
      }
      m = m.subtract(Manifold.union(slits)).add(Manifold.union(bumps));
    }
    return { m, tubeTop: zt + tubeH };
  }

  function gasket(p, d, Z_RIM) {
    return ring(d.NECK_R - 0.4, d.NECK_R - p.wall + 0.2, GASKET_T, Z_RIM, d.seg);
  }

  function innerVolumeMl(bodyRes, d, p, H) {
    const { seg, BODY_R, NECK_R } = d;
    const Z_SH = H + d.S, Z_RIM = Z_SH + NECK_L;
    const env = Manifold.hull([cyl(BODY_R, H, 0, 0, 0, undefined, seg), cyl(NECK_R, 0.01, Z_SH, 0, 0, undefined, seg)])
      .add(cyl(NECK_R, NECK_L, Z_SH, 0, 0, undefined, seg));
    const hollow = env.subtract(bodyRes.m);
    return hollow.intersect(cyl(BODY_R + 10, Z_RIM, 0, 0, 0, undefined, seg)).volume() / 1000;
  }

  // ---------------------------------------------------------------- Hauptfunktion
  function build(params) {
    const p = Object.assign({}, DEFAULTS, params);
    DISK_T = p.reinforce ? 6.0 : 4.0;
    ROOF_T = p.reinforce ? 3.5 : 2.5;
    BOTTOM_T = p.reinforce ? Math.max(4.0, p.wall) : p.wall;
    RIB_H = p.reinforce ? 10.0 : 0;
    const d = derive(p);
    const warnings = [];
    if (d.NECK_R - p.wall < d.tubeOd / 2 + 6) throw new Error('Durchmesser zu klein für dieses Rohr.');
    let H;
    const bodyH = (h) => h + d.S + NECK_L;
    if (p.mode === 'height') {
      H = p.heightMm - d.S - NECK_L;
      if (H < p.wall + 5) throw new Error('Höhe zu klein (mindestens ' + Math.ceil(d.S + NECK_L + p.wall + 5) + ' mm).');
    } else {
      // Volumen ist linear in H -> zwei Auswertungen reichen
      const H0 = 60;
      const v0 = innerVolumeMl(body(p, d, H0), d, p, H0);
      const slope = Math.PI * (d.BODY_R - p.wall) ** 2 / 1000;
      H = H0 + (p.volumeMl - v0) / slope;
      if (H < p.wall + 5) {
        H = p.wall + 5;
        warnings.push('Volumen ist für diesen Durchmesser zu klein – minimale Höhe verwendet.');
      }
    }
    const b = body(p, d, H);
    const volume = innerVolumeMl(b, d, p, H);
    const col = collar(p, d, b.Z_RIM);
    const dk = disk(p, d, b.Z_RIM);
    const parts = [
      { key: 'body', name: 'Kanister-Körper', file: '1_kanister_koerper.stl', m: b.m, flip: false, color: 0x9fb7c9 },
      { key: 'collar', name: p.splash ? 'Überwurfring mit Spritzschutz' : 'Überwurfring', file: '2_ueberwurfring' + (p.splash ? '_spritzschutz' : '') + '.stl', m: col.m, flip: true, color: 0xe07a3f },
      { key: 'disk', name: 'Deckelscheibe mit Rohr ' + p.ductOd + '/' + p.ductId, file: '3_deckelscheibe_rohr_' + String(p.ductOd).replace('.', ',') + 'x' + String(p.ductId).replace('.', ',') + '.stl', m: dk.m, flip: false, color: 0xf2b134 },
    ];
    if (p.gasket) parts.push({ key: 'gasket', name: 'Dichtung (TPU)', file: '4_dichtung_TPU.stl', m: gasket(p, d, b.Z_RIM), flip: false, color: 0x333333 });

    // Kennzahlen Entlüftung
    const vs = ventSlots(d);
    const ventArea = vs ? vs.area() : 0;
    const flows = [['Entlüftungsschlitze', ventArea]];
    if (p.splash) {
      flows.push(['Spalt unter Prallschürze', 2 * Math.PI * d.SKIRT_R * d.SKIRT_GAP]);
      flows.push(['Seitenfenster', d.WIN_N * (2 * Math.PI * d.COL_OUT / d.WIN_N - WIN_POST) * (WIN_Z1 - WIN_Z0)]);
    }
    const minFlow = Math.min(...flows.map(f => f[1]));
    const ratio = minFlow / d.A_in;
    if (ratio < 10) warnings.push(`Entlüftung nur ${ratio.toFixed(1)}× Rohrquerschnitt – empfohlen ≥ 10×. Größeren Durchmesser wählen${p.splash ? ' oder Spritzschutz abwählen' : ''}.`);
    const tubeWall = (d.tubeOd - d.tubeId) / 2;
    if (tubeWall < 1.2) warnings.push(`Rohrwand nur ${tubeWall.toFixed(2)} mm – sehr dünn zum Drucken, Druckfestigkeit prüfen.`);
    const totalH = dk.tubeTop;
    return {
      parts,
      info: {
        volumeMl: volume, bodyHeight: bodyH(H), totalHeight: totalH, diameter: p.diameterMm,
        neckInnerD: 2 * (d.NECK_R - p.wall), openingD: 2 * d.COL_HOLE,
        flows, ratio, inletArea: d.A_in, tubeOd: d.tubeOd, tubeId: d.tubeId, warnings,
      },
    };
  }

  // Druckausrichtung + auf Bett legen, zentriert
  function printOriented(part) {
    let m = part.m;
    if (part.flip) m = m.rotate([180, 0, 0]);
    const bb = m.boundingBox();
    return m.translate([-(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, -bb.min[2]]);
  }

  return { build, printOriented, derive };
}

// Binäres STL aus manifold-Mesh
export function meshToStl(mesh, name = 'kanister') {
  const np = mesh.numProp, vp = mesh.vertProperties, tv = mesh.triVerts;
  const nTri = tv.length / 3;
  const buf = new ArrayBuffer(84 + nTri * 50);
  const dv = new DataView(buf);
  const header = ('Kanister-Konfigurator ' + name).slice(0, 80);
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
  dv.setUint32(80, nTri, true);
  let o = 84;
  for (let t = 0; t < nTri; t++) {
    const a = tv[3 * t] * np, b = tv[3 * t + 1] * np, c = tv[3 * t + 2] * np;
    const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
    const vx = vp[c] - vp[a], vy = vp[c + 1] - vp[a + 1], vz = vp[c + 2] - vp[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    o += 12;
    for (const idx of [a, b, c]) {
      dv.setFloat32(o, vp[idx], true); dv.setFloat32(o + 4, vp[idx + 1], true); dv.setFloat32(o + 8, vp[idx + 2], true);
      o += 12;
    }
    o += 2;
  }
  return buf;
}
