// Web Worker: rechnet die Geometrie, damit die Oberfläche flüssig bleibt.
// Pro Berechnung wird ein frischer Worker gestartet und danach beendet (gibt WASM-Speicher frei).
import Module from '../vendor/manifold.js';
import { createGenerator, meshToStl } from './geometry.js';

self.onmessage = async (ev) => {
  const { params } = ev.data;
  try {
    const wasm = await Module();
    wasm.setup();
    const gen = createGenerator(wasm);
    const res = gen.build(params);
    const out = [];
    const transfer = [];
    for (const p of res.parts) {
      const disp = p.m.getMesh();
      const pos = new Float32Array(disp.vertProperties);
      const idx = new Uint32Array(disp.triVerts);
      const stl = meshToStl(gen.printOriented(p).getMesh(), p.file);
      out.push({ key: p.key, name: p.name, file: p.file, color: p.color, numProp: disp.numProp, pos, idx, stl });
      transfer.push(pos.buffer, idx.buffer, stl);
    }
    self.postMessage({ ok: true, parts: out, info: res.info }, transfer);
  } catch (e) {
    self.postMessage({ ok: false, error: String(e && e.message || e) });
  }
};
