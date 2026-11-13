import Module from 'manifold-3d';
import { createGenerator, meshToStl } from '../src/geometry.js';
import fs from 'fs';
const w = await Module(); w.setup();
const g = createGenerator(w);
const cfgs = JSON.parse(process.argv[2] || '[{}]');
for (const [i, c] of cfgs.entries()) {
  const t0 = Date.now();
  const r = g.build(c);
  const dir = `test/out/${i}`; fs.mkdirSync(dir, { recursive: true });
  const st = {};
  for (const p of r.parts) {
    st[p.key] = p.m.status();
    fs.writeFileSync(`${dir}/${p.file}`, Buffer.from(meshToStl(g.printOriented(p).getMesh(), p.file)));
    fs.writeFileSync(`${dir}/asm_${p.key}.stl`, Buffer.from(meshToStl(p.m.getMesh(), p.key)));
  }
  // Kollisionen (Montageposition, nur Rotation des Rings variieren)
  const by = Object.fromEntries(r.parts.map(p => [p.key, p.m]));
  let best = 1e9;
  for (let a = 0; a < 360; a += 15) best = Math.min(best, by.body.intersect(by.collar.rotate([0, 0, a])).volume());
  const cd = by.collar.intersect(by.disk).volume();
  console.log(JSON.stringify({ i, ms: Date.now() - t0, st, vol: +r.info.volumeMl.toFixed(1), bodyH: +r.info.bodyHeight.toFixed(1), totalH: +r.info.totalHeight.toFixed(1),
    ratio: +r.info.ratio.toFixed(1), flows: r.info.flows.map(f => [f[0], Math.round(f[1])]), body_collar_min: +best.toFixed(2), collar_disk: +cd.toFixed(2), warn: r.info.warnings }));
}
