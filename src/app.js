import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { DUCTS, DEFAULTS } from './geometry.js';
import { makeZip } from './zip.js';

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 0) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

// ------------------------------------------------------------------ Formular
const ductSel = $('duct');
for (const [od, id] of DUCTS) {
  const o = document.createElement('option');
  o.value = `${od}/${id}`;
  o.textContent = `${fmt(od, od % 1 ? 1 : 0)} / ${fmt(id, id % 1 ? 1 : 0)} mm`;
  ductSel.appendChild(o);
}
const oc = document.createElement('option');
oc.value = 'custom'; oc.textContent = 'Eigene Größe …';
ductSel.appendChild(oc);
ductSel.value = '12/8';

function readParams() {
  const mode = document.querySelector('input[name=mode]:checked').value;
  let ductOd, ductId;
  if (ductSel.value === 'custom') { ductOd = +$('ductOd').value; ductId = +$('ductId').value; }
  else [ductOd, ductId] = ductSel.value.split('/').map(Number);
  return {
    mode,
    volumeMl: +$('volumeL').value * 1000,
    heightMm: +$('heightMm').value,
    diameterMm: +$('diameterMm').value,
    wall: +$('wall').value,
    ductOd, ductId,
    tubeFree: +$('tubeFree').value,
    tubeOdAdjust: +$('tubeOdAdjust').value,
    splash: $('splash').checked,
    snap: $('snap').checked,
    reinforce: $('reinforce').checked,
    gasket: $('gasket').checked,
    threadClearance: +$('threadClearance').value,
    segments: +$('segments').value,
  };
}

function writeParams(p) {
  if (p.mode) document.querySelector(`input[name=mode][value=${p.mode}]`).checked = true;
  if (p.volumeMl) $('volumeL').value = p.volumeMl / 1000;
  for (const k of ['heightMm', 'diameterMm', 'wall', 'tubeFree', 'tubeOdAdjust', 'threadClearance', 'segments'])
    if (p[k] !== undefined) $(k).value = p[k];
  for (const k of ['splash', 'snap', 'reinforce', 'gasket']) if (p[k] !== undefined) $(k).checked = !!p[k];
  if (p.ductOd) {
    const v = `${p.ductOd}/${p.ductId}`;
    if ([...ductSel.options].some(o => o.value === v)) ductSel.value = v;
    else { ductSel.value = 'custom'; $('ductOd').value = p.ductOd; $('ductId').value = p.ductId; }
  }
}

function syncVisibility() {
  const mode = document.querySelector('input[name=mode]:checked').value;
  $('rowVolume').classList.toggle('hidden', mode !== 'volume');
  $('rowHeight').classList.toggle('hidden', mode !== 'height');
  $('customDuct').classList.toggle('hidden', ductSel.value !== 'custom');
}

// Konfiguration aus Link übernehmen (#d=110&v=1000…)
const KEYS = { mode: 'm', volumeMl: 'v', heightMm: 'h', diameterMm: 'd', wall: 'w', ductOd: 'ro', ductId: 'ri',
  tubeFree: 'tl', tubeOdAdjust: 'tk', splash: 's', snap: 'r', reinforce: 'x', gasket: 'g', threadClearance: 'gs', segments: 'q' };
function toHash(p) {
  const u = new URLSearchParams();
  for (const [k, s] of Object.entries(KEYS)) {
    if (p[k] === DEFAULTS[k]) continue;
    u.set(s, typeof p[k] === 'boolean' ? (p[k] ? 1 : 0) : p[k]);
  }
  return u.toString();
}
function fromHash() {
  const u = new URLSearchParams(location.hash.slice(1));
  const p = {};
  for (const [k, s] of Object.entries(KEYS)) {
    if (!u.has(s)) continue;
    const v = u.get(s);
    p[k] = typeof DEFAULTS[k] === 'boolean' ? v === '1' : (k === 'mode' ? v : +v);
  }
  return p;
}
writeParams(fromHash());
syncVisibility();

// ------------------------------------------------------------------ 3D-Ansicht
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.localClippingEnabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f2ee);
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b2a8, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(200, -300, 400);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.5);
fill.position.set(-300, 200, 100);
scene.add(fill);
const grid = new THREE.GridHelper(400, 40, 0xd5cfc5, 0xe6e1d8);
grid.rotation.x = Math.PI / 2;
scene.add(grid);

const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const group = new THREE.Group();
scene.add(group);
let meshes = {};
let lastInfo = null;

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function frameCamera() {
  if (!lastInfo) return;
  const ex = $('explode').checked ? 60 * Math.max(1, lastInfo.diameter / 110) : 0;
  const h = lastInfo.totalHeight + ex, d = lastInfo.diameter;
  const dist = Math.max(h, d) * 2.0;
  controls.target.set(0, 0, h / 2);
  camera.position.set(dist * 0.75, -dist * 0.95, h * 0.5 + dist * 0.45);
  controls.update();
}
$('resetCam').onclick = frameCamera;

const EXPLODE = { body: 0, gasket: 14, disk: 30, collar: 58 };
function applyViewOptions() {
  const ex = $('explode').checked, sec = $('section').checked;
  for (const [k, m] of Object.entries(meshes)) {
    m.position.z = ex ? (EXPLODE[k] || 0) * (lastInfo ? Math.max(1, lastInfo.diameter / 110) : 1) : 0;
    m.material.clippingPlanes = sec ? [clipPlane] : [];
    m.material.side = sec ? THREE.DoubleSide : THREE.FrontSide;
    m.material.needsUpdate = true;
  }
}
$('explode').onchange = () => { applyViewOptions(); frameCamera(); };
$('section').onchange = applyViewOptions;

function showParts(parts) {
  for (const m of Object.values(meshes)) { group.remove(m); m.geometry.dispose(); m.material.dispose(); }
  meshes = {};
  for (const p of parts) {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.pos, p.numProp));
    g.setIndex(new THREE.BufferAttribute(p.idx, 1));
    g = g.toNonIndexed();
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.65, metalness: 0.0 });
    const mesh = new THREE.Mesh(g, mat);
    group.add(mesh);
    meshes[p.key] = mesh;
  }
  applyViewOptions();
}

(function loop() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
})();

// ------------------------------------------------------------------ Berechnung
let worker = null, lastParts = [], firstRun = true, urls = [];

function run() {
  syncVisibility();
  const params = readParams();
  history.replaceState(null, '', '#' + toHash(params));
  if (worker) worker.terminate();
  $('busy').classList.remove('hidden');
  $('zipBtn').disabled = true;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const w = worker;
  w.onmessage = (ev) => {
    if (w !== worker) return;
    w.terminate(); worker = null;
    $('busy').classList.add('hidden');
    const r = ev.data;
    if (!r.ok) {
      $('status').textContent = r.error;
      $('status').className = 'status err';
      return;
    }
    lastInfo = r.info;
    lastParts = r.parts;
    showParts(r.parts);
    if (firstRun) { frameCamera(); firstRun = false; }
    renderInfo(r.info, params);
    renderDownloads(r.parts, params);
  };
  w.onerror = (e) => {
    $('busy').classList.add('hidden');
    $('status').textContent = 'Fehler: ' + (e.message || 'Worker konnte nicht starten');
    $('status').className = 'status err';
  };
  w.postMessage({ params });
}

function renderInfo(info, p) {
  $('status').className = 'status';
  $('status').textContent = 'Fertig berechnet.';
  const rows = [
    ['Volumen (bis Halsrand)', fmt(info.volumeMl) + ' ml'],
    ['Kanister Ø × Höhe', `${fmt(info.diameter)} × ${fmt(info.bodyHeight, 1)} mm`],
    ['Gesamthöhe mit Deckel', fmt(info.totalHeight, 1) + ' mm'],
    ['Deckelöffnung innen', fmt(info.neckInnerD, 1) + ' mm'],
    ['Rohr außen / innen', `${fmt(info.tubeOd, 2)} / ${fmt(info.tubeId, 1)} mm`],
    ['Rohrquerschnitt', fmt(info.inletArea) + ' mm²'],
    ...info.flows.map(([n, a]) => [n, fmt(a) + ' mm²']),
  ];
  $('facts').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('') +
    `<dt>Entlüftung (engste Stelle)</dt><dd class="${info.ratio >= 10 ? 'good' : 'bad'}">${fmt(info.ratio, 1)}× Rohrquerschnitt</dd>`;
  $('warnings').innerHTML = info.warnings.map(w => `<div class="warning">${w}</div>`).join('');
  $('sizeHint').textContent = p.mode === 'volume'
    ? `→ Höhe Kanister: ${fmt(info.bodyHeight, 1)} mm`
    : `→ Volumen: ${fmt(info.volumeMl)} ml`;
}

function stamp(p) {
  return `D${p.diameterMm}_${p.mode === 'volume' ? (p.volumeMl / 1000).toString().replace('.', ',') + 'L' : 'H' + p.heightMm}_Rohr${String(p.ductOd).replace('.', ',')}x${String(p.ductId).replace('.', ',')}`;
}

function renderDownloads(parts, p) {
  urls.forEach(URL.revokeObjectURL); urls = [];
  $('downloads').innerHTML = '';
  for (const part of parts) {
    const url = URL.createObjectURL(new Blob([part.stl], { type: 'model/stl' }));
    urls.push(url);
    const a = document.createElement('a');
    a.href = url; a.download = part.file;
    a.innerHTML = `<b><i style="background:#${part.color.toString(16).padStart(6, '0')}"></i>${part.name}</b><span>${fmt(part.stl.byteLength / 1024)} KB</span>`;
    $('downloads').appendChild(a);
  }
  $('zipBtn').disabled = false;
  $('zipBtn').onclick = () => {
    const readme = [
      'Schwammfänger-Kanister – erzeugt mit dem Kanister-Konfigurator',
      '',
      'Einstellungen: ' + JSON.stringify(p, null, 1),
      '',
      'Link zur Konfiguration: ' + location.href,
      '',
      'Druck: PETG, 3–4 Perimeter, keine Stützstrukturen nötig. Dichtung aus TPU.',
      'Entlüftung nie abdecken – der Behälter ist nicht druckfest.',
    ].join('\n');
    const blob = makeZip([...parts.map(x => ({ name: x.file, data: x.stl })), { name: 'LIESMICH.txt', data: readme }]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Kanister_${stamp(p)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
}

$('linkBtn').onclick = async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $('linkBtn').textContent = 'Link kopiert ✓';
  } catch {
    prompt('Link kopieren:', location.href);
  }
  setTimeout(() => ($('linkBtn').textContent = 'Link zu dieser Konfiguration kopieren'), 2000);
};

let timer = null;
$('form').addEventListener('input', () => { syncVisibility(); clearTimeout(timer); timer = setTimeout(run, 450); });
$('form').addEventListener('submit', (e) => e.preventDefault());
run();
