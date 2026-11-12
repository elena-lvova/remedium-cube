import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FACES, COMPANIES, SCENARIOS, STAGES, NUMBERS, SERVICE_MAP } from './data.js';

/* =========================================================
   Basics
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const canvas = $('#scene');
const panel = $('#panel');
const labelsEl = $('#labels');
const detailEl = $('#detail');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  outBack: (t) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
const STAGE_MAP = Object.fromEntries(STAGES.map((s) => [s.id, s]));
const FACE_BY_SIDE = Object.fromEntries(FACES.map((f, i) => [f.side, { ...f, index: i }]));

/* ---------- tween engine ---------- */
const tweens = new Set();
function tween(dur, fn, easing = ease.inOut, delay = 0) {
  return new Promise((resolve) => {
    tweens.add({ start: performance.now() + delay, dur, fn, easing, resolve });
  });
}
function runTweens(now) {
  for (const tw of tweens) {
    if (now < tw.start) continue;
    const t = clamp((now - tw.start) / tw.dur, 0, 1);
    tw.fn(tw.easing(t), t);
    if (t >= 1) { tweens.delete(tw); tw.resolve(); }
  }
}

/* ---------- sound (procedural) ---------- */
const sfx = (() => {
  let ctx = null; let enabled = true;
  const ensure = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } } if (ctx && ctx.state === 'suspended') ctx.resume(); return ctx; };
  const noise = (dur, f0, f1, gain, q = 6) => {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, ctx.currentTime); bp.frequency.exponentialRampToValueAtTime(f1, ctx.currentTime + dur);
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(bp).connect(g).connect(ctx.destination); src.start();
  };
  const tone = (freq, dur, gain, type = 'sine', slide = 1) => {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq * slide, ctx.currentTime + dur);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur + 0.02);
  };
  return {
    ensure,
    set enabled(v) { enabled = v; }, get enabled() { return enabled; },
    twist: () => noise(0.09, 2400, 900, 0.22, 3),
    whoosh: () => noise(0.5, 400, 3200, 0.08, 1.2),
    ping: (i = 0) => tone(660 * Math.pow(1.12246, i % 8), 0.35, 0.05, 'sine', 1.002),
    select: () => tone(880, 0.14, 0.05, 'triangle', 1.5),
    chord: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.9, 0.035, 'sine'), i * 70)); },
  };
})();

/* =========================================================
   Renderer / scene
   ========================================================= */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
camera.position.set(0, 0, 12);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// background gradient
(function makeBackground() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#060420'; g.fillRect(0, 0, 1024, 1024);
  let r = g.createRadialGradient(640, 420, 20, 640, 420, 760);
  r.addColorStop(0, '#1d1468'); r.addColorStop(0.45, '#0f0a3d'); r.addColorStop(1, 'rgba(6,4,32,0)');
  g.fillStyle = r; g.fillRect(0, 0, 1024, 1024);
  r = g.createRadialGradient(120, 980, 10, 120, 980, 620);
  r.addColorStop(0, 'rgba(25,211,197,0.22)'); r.addColorStop(1, 'rgba(25,211,197,0)');
  g.fillStyle = r; g.fillRect(0, 0, 1024, 1024);
  r = g.createRadialGradient(980, 80, 10, 980, 80, 520);
  r.addColorStop(0, 'rgba(240,68,154,0.14)'); r.addColorStop(1, 'rgba(240,68,154,0)');
  g.fillStyle = r; g.fillRect(0, 0, 1024, 1024);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
})();

const keyLight = new THREE.PointLight('#19D3C5', 40, 30); keyLight.position.set(-6, 4, 6); scene.add(keyLight);
const rimLight = new THREE.PointLight('#F0449A', 30, 30); rimLight.position.set(6, -4, -3); scene.add(rimLight);
const fillLight = new THREE.DirectionalLight('#ffffff', 0.6); fillLight.position.set(3, 6, 8); scene.add(fillLight);

// star / data field
const dotTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
})();
const stars = (() => {
  const N = 1400; const pos = new Float32Array(N * 3); const col = new Float32Array(N * 3);
  const palette = ['#19D3C5', '#3D8BFF', '#ffffff', '#4CC764', '#8B6BFF'].map((h) => new THREE.Color(h));
  for (let i = 0; i < N; i++) {
    const r = 12 + Math.random() * 26; const th = Math.random() * Math.PI * 2; const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.7; pos[i * 3 + 2] = r * Math.cos(ph) - 8;
    const c = palette[(Math.random() * palette.length) | 0]; col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 0.14, map: dotTex, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending });
  const p = new THREE.Points(g, m); scene.add(p); return p;
})();

// orbit ring (contour chapter)
const ring = (() => {
  const N = 900; const pos = new Float32Array(N * 3); const col = new Float32Array(N * 3);
  const cols = STAGES.map((s) => new THREE.Color(s.color));
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2; const r = 3.4 + (Math.random() - 0.5) * 0.35;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = (Math.random() - 0.5) * 0.18; pos[i * 3 + 2] = Math.sin(a) * r;
    const c = cols[Math.floor((i / N) * 4) % 4]; col.set([c.r * 1.8, c.g * 1.8, c.b * 1.8], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 0.12, map: dotTex, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const p = new THREE.Points(g, m); p.rotation.x = 0.35; scene.add(p); return p;
})();

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.75, 0.55, 1.02);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* =========================================================
   Textures for stickers
   ========================================================= */
function hexA(hex, a) { const c = new THREE.Color(hex); return `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${a})`; }
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function wrap(g, text, maxW) {
  const words = text.split(' '); const lines = []; let line = '';
  for (const w of words) { const test = line ? line + ' ' + w : w; if (g.measureText(test).width <= maxW || !line) line = test; else { lines.push(line); line = w; } }
  if (line) lines.push(line); return lines;
}
function fitText(g, text, font, maxW, maxLines, start, min) {
  for (let s = start; s >= min; s -= 2) {
    g.font = font.replace('{s}', s); const lines = wrap(g, text, maxW);
    if (lines.length <= maxLines && lines.every((l) => g.measureText(l).width <= maxW)) return { size: s, lines };
  }
  g.font = font.replace('{s}', min); return { size: min, lines: wrap(g, text, maxW) };
}
const maxAniso = renderer.capabilities.getMaxAnisotropy();
function makeTex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t; }

function drawService(svc, face, idx) {
  const S = 512; const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  rr(g, 0, 0, S, S, 60); g.fillStyle = '#100C3A'; g.fill();
  const gr = g.createLinearGradient(0, 0, S, S);
  gr.addColorStop(0, hexA(face.color, 0.5)); gr.addColorStop(0.55, hexA(face.color, 0.12)); gr.addColorStop(1, hexA(face.color, 0.03));
  rr(g, 0, 0, S, S, 60); g.fillStyle = gr; g.fill();
  g.lineWidth = 7; g.strokeStyle = hexA(face.color, 0.9); rr(g, 12, 12, S - 24, S - 24, 50); g.stroke();
  g.fillStyle = face.color; g.font = '800 34px Manrope'; g.textBaseline = 'alphabetic';
  g.fillText(String(idx + 1).padStart(2, '0'), 48, 86);
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = '700 22px Manrope';
  if ('letterSpacing' in g) g.letterSpacing = '2px';
  g.fillText(face.short.toUpperCase(), 48, 120);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  if (svc.tag) {
    g.font = '800 22px Manrope'; const t = svc.tag.toUpperCase(); const w = g.measureText(t).width + 28;
    rr(g, S - 44 - w, 54, w, 42, 12); g.fillStyle = face.color; g.fill();
    g.fillStyle = face.ink; g.fillText(t, S - 44 - w + 14, 83);
  }
  const fit = fitText(g, svc.label, '700 {s}px Manrope', 420, 3, 66, 40);
  g.fillStyle = '#FFFFFF'; g.font = `700 ${fit.size}px Manrope`;
  const lh = fit.size * 1.12; let y = S - 58 - (fit.lines.length - 1) * lh;
  for (const l of fit.lines) { g.fillText(l, 48, y); y += lh; }
  return makeTex(c);
}
function drawCenter(face, i) {
  const S = 512; const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, S, S);
  gr.addColorStop(0, face.color); gr.addColorStop(1, new THREE.Color(face.color).lerp(new THREE.Color('#ffffff'), 0.25).getStyle());
  rr(g, 0, 0, S, S, 60); g.fillStyle = gr; g.fill();
  g.fillStyle = face.ink; g.font = '800 24px Manrope'; if ('letterSpacing' in g) g.letterSpacing = '3px';
  g.fillText(`ГРАНЬ ${String(i + 1).padStart(2, '0')}`, 48, 84); if ('letterSpacing' in g) g.letterSpacing = '0px';
  const fit = fitText(g, face.name, '600 {s}px Unbounded', 420, 3, 60, 34);
  g.font = `600 ${fit.size}px Unbounded`; const lh = fit.size * 1.14; let y = S - 60 - (fit.lines.length - 1) * lh;
  for (const l of fit.lines) { g.fillText(l, 48, y); y += lh; }
  return makeTex(c);
}

function roundedRectGeo(size, r) {
  const h = size / 2; const s = new THREE.Shape();
  s.moveTo(-h + r, -h); s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r); s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h); s.quadraticCurveTo(-h, h, -h, h - r); s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
  const geo = new THREE.ShapeGeometry(s, 6); const uv = geo.attributes.uv; const p = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + h) / size, (p.getY(i) + h) / size);
  return geo;
}

/* =========================================================
   Cube
   ========================================================= */
const SIDES = {
  F: { n: [0, 0, 1], u: [0, 1, 0], r: [1, 0, 0] },
  B: { n: [0, 0, -1], u: [0, 1, 0], r: [-1, 0, 0] },
  R: { n: [1, 0, 0], u: [0, 1, 0], r: [0, 0, -1] },
  L: { n: [-1, 0, 0], u: [0, 1, 0], r: [0, 0, 1] },
  U: { n: [0, 1, 0], u: [0, 0, -1], r: [1, 0, 0] },
  D: { n: [0, -1, 0], u: [0, 0, 1], r: [1, 0, 0] },
};
const SLOT = { '0,0': 0, '0,1': 1, '0,2': 2, '1,2': 3, '2,2': 4, '2,1': 5, '2,0': 6, '1,0': 7 };
const STICKER = 0.84; const BODY = 0.94; const SURF = BODY / 2;

const holder = new THREE.Group(); scene.add(holder);
const cubeRoot = new THREE.Group(); holder.add(cubeRoot);
const pivot = new THREE.Group(); cubeRoot.add(pivot);
const cubies = []; const stickers = []; const stickerBySvc = {}; const stickerMeshes = [];
const stickerGeo = roundedRectGeo(STICKER, 0.1);
const haloGeo = roundedRectGeo(0.93, 0.12);
const bodyGeo = new RoundedBoxGeometry(BODY, BODY, BODY, 4, 0.1);
const bodyMat = new THREE.MeshPhysicalMaterial({ color: '#120e38', metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.2, envMapIntensity: 0.55 });
const spacing = { cur: 1, tgt: 1 };

function buildCube() {
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (!x && !y && !z) continue;
    const cubie = new THREE.Group();
    cubie.userData.coord = { x, y, z };
    cubie.position.set(x, y, z);
    cubie.add(new THREE.Mesh(bodyGeo, bodyMat));
    cubeRoot.add(cubie); cubies.push(cubie);
    for (const [side, v] of Object.entries(SIDES)) {
      const n = new THREE.Vector3(...v.n); const u = new THREE.Vector3(...v.u); const r = new THREE.Vector3(...v.r);
      const p = new THREE.Vector3(x, y, z);
      if (p.dot(n) !== 1) continue;
      const row = 1 - p.dot(u); const col = p.dot(r) + 1;
      const face = FACE_BY_SIDE[side];
      let svc = null; let tex;
      if (row === 1 && col === 1) tex = drawCenter(face, face.index);
      else { const idx = SLOT[`${row},${col}`]; svc = face.services[idx]; tex = drawService(svc, face, idx); }
      const basis = new THREE.Matrix4().makeBasis(r, u, n);
      const q = new THREE.Quaternion().setFromRotationMatrix(basis);
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      const mesh = new THREE.Mesh(stickerGeo, mat); mesh.quaternion.copy(q); mesh.position.copy(n).multiplyScalar(SURF + 0.004);
      const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(face.color).multiplyScalar(2.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const halo = new THREE.Mesh(haloGeo, haloMat); halo.quaternion.copy(q); halo.position.copy(n).multiplyScalar(SURF + 0.0015);
      cubie.add(halo); cubie.add(mesh);
      const st = { mesh, halo, svc, face, cubie, n, cur: { dim: 1, glow: 0, pop: 0 }, tgt: { dim: 1, glow: 0, pop: 0 }, hover: 0, wave: 0 };
      mesh.userData.sticker = st; stickers.push(st); stickerMeshes.push(mesh);
      if (svc) stickerBySvc[svc.id] = st;
    }
  }
}

/* ---------- twisting ---------- */
const moveHistory = [];
let twisting = false;
async function twist(axis, layer, dir, dur = 260, record = true) {
  twisting = true;
  const S = spacing.cur;
  const sel = cubies.filter((c) => c.userData.coord[axis] === layer);
  pivot.rotation.set(0, 0, 0); cubeRoot.updateMatrixWorld(true);
  sel.forEach((c) => pivot.attach(c));
  await tween(dur, (e) => { pivot.rotation[axis] = dir * (Math.PI / 2) * e; }, ease.inOut);
  cubeRoot.updateMatrixWorld(true);
  const m = new THREE.Matrix4();
  sel.forEach((c) => {
    cubeRoot.attach(c);
    const co = c.userData.coord;
    co.x = Math.round(c.position.x / S); co.y = Math.round(c.position.y / S); co.z = Math.round(c.position.z / S);
    c.position.set(co.x * S, co.y * S, co.z * S);
    m.makeRotationFromQuaternion(c.quaternion); const el = m.elements;
    [0, 1, 2, 4, 5, 6, 8, 9, 10].forEach((i) => { el[i] = Math.round(el[i]); });
    c.quaternion.setFromRotationMatrix(m);
  });
  pivot.rotation.set(0, 0, 0);
  if (record) moveHistory.push({ axis, layer, dir });
  sfx.twist();
  twisting = false;
}
function randomMoves(n) {
  const axes = ['x', 'y', 'z']; const out = []; let prev = null;
  while (out.length < n) {
    const m = { axis: axes[(Math.random() * 3) | 0], layer: [-1, 0, 1][(Math.random() * 3) | 0], dir: Math.random() < 0.5 ? 1 : -1 };
    if (prev && prev.axis === m.axis && prev.layer === m.layer) continue;
    out.push(m); prev = m;
  }
  return out;
}
async function scramble(n, dur) { for (const m of randomMoves(n)) await twist(m.axis, m.layer, m.dir, dur); }
async function solveAll(dur = 120) {
  while (moveHistory.length) { const m = moveHistory.pop(); await twist(m.axis, m.layer, -m.dir, dur, false); }
}
async function waitSpacing(v) {
  spacing.tgt = v; while (Math.abs(spacing.cur - v) > 0.002) await sleep(30); spacing.cur = v; applySpacing();
}
function applySpacing() { for (const c of cubies) { const co = c.userData.coord; c.position.set(co.x * spacing.cur, co.y * spacing.cur, co.z * spacing.cur); } }

/* =========================================================
   Orientation / interaction
   ========================================================= */
const HOME_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, -0.68, 0, 'XYZ'));
const TILT_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.42, 0, 'XYZ'));
function faceQuat(side) {
  const v = SIDES[side];
  const b = new THREE.Matrix4().makeBasis(new THREE.Vector3(...v.r), new THREE.Vector3(...v.u), new THREE.Vector3(...v.n));
  const q = new THREE.Quaternion().setFromRotationMatrix(b).invert();
  return TILT_Q.clone().multiply(q);
}
let orientTween = 0;
function orientTo(q, dur = 1000) {
  const id = ++orientTween; const from = cubeRoot.quaternion.clone();
  return tween(dur, (e) => { if (id === orientTween) cubeRoot.quaternion.slerpQuaternions(from, q, e); }, ease.inOut);
}

const pointer = { down: false, x: 0, y: 0, sx: 0, sy: 0, moved: false, lastMove: 0, vx: 0, vy: 0 };
const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2();
let hovered = null;

function pick(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const targets = [...stickerMeshes.filter((m) => m.visible), ...cards.map((c) => c.mesh)];
  const hits = raycaster.intersectObjects(targets, false);
  for (const h of hits) {
    if (h.object.userData.card) return { card: h.object.userData.card };
    const st = h.object.userData.sticker; if (st) return { sticker: st };
  }
  return null;
}

canvas.addEventListener('pointerdown', (e) => {
  sfx.ensure(); stopAuto();
  pointer.down = true; pointer.moved = false; pointer.x = pointer.sx = e.clientX; pointer.y = pointer.sy = e.clientY; pointer.vx = pointer.vy = 0;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (pointer.down) {
    const dx = e.clientX - pointer.x; const dy = e.clientY - pointer.y;
    if (Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 5) { pointer.moved = true; canvas.classList.add('dragging'); orientTween++; }
    if (pointer.moved) {
      rotateBy(dx * 0.007, dy * 0.007); pointer.vx = dx * 0.007; pointer.vy = dy * 0.007; pointer.lastMove = performance.now();
    }
    pointer.x = e.clientX; pointer.y = e.clientY;
  } else {
    const p = pick(e.clientX, e.clientY);
    const st = p && p.sticker && p.sticker.svc ? p.sticker : null;
    hovered = st;
    canvas.classList.toggle('hovering', !!(st || (p && p.card)));
  }
});
function endPointer(e) {
  if (!pointer.down) return;
  pointer.down = false; canvas.classList.remove('dragging');
  if (!pointer.moved) {
    const p = pick(e.clientX, e.clientY);
    if (p) onPick(p);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', () => { pointer.down = false; canvas.classList.remove('dragging'); });
canvas.addEventListener('pointerleave', () => { hovered = null; });

const _qa = new THREE.Quaternion(); const _qb = new THREE.Quaternion();
const AX_Y = new THREE.Vector3(0, 1, 0); const AX_X = new THREE.Vector3(1, 0, 0);
function rotateBy(ax, ay) {
  _qa.setFromAxisAngle(AX_Y, ax); _qb.setFromAxisAngle(AX_X, ay);
  cubeRoot.quaternion.premultiply(_qa).premultiply(_qb);
}

/* =========================================================
   Cards (solution)
   ========================================================= */
const cards = [];
const cardGroup = new THREE.Group(); scene.add(cardGroup);
let layout = null; // {positions, headers, arrows, w, h, mode}

function computeLayout(items) {
  const by = STAGES.map((s) => items.filter((i) => i.stage === s.id));
  const cols = STAGES.map((s, i) => ({ stage: s, items: by[i] })).filter((c) => c.items.length);
  const aspect = effAspect();
  const rows = aspect < 1.15 || window.innerWidth <= 900 && aspect < 1.6;
  const Z = 2; const cardS = 1.12;
  const out = { positions: {}, headers: [], arrows: [], mode: rows ? 'rows' : 'cols', cardS };
  if (!rows) {
    const R = Math.max(...cols.map((c) => c.items.length)); const gx = 2.35; const gy = 1.3;
    const topY = ((R - 1) * gy + 0.56 - 1.0) / 2;
    cols.forEach((c, ci) => {
      const x = (ci - (cols.length - 1) / 2) * gx;
      out.headers.push({ stage: c.stage, idx: ci, pos: new THREE.Vector3(x, topY + 0.85, Z) });
      if (ci > 0) out.arrows.push({ pos: new THREE.Vector3(x - gx / 2, topY + 0.55, Z) });
      c.items.forEach((it, ri) => { out.positions[it.svcId] = new THREE.Vector3(x, topY - ri * gy, Z); });
    });
    out.hw = ((cols.length - 1) / 2) * gx + 0.75; out.hh = ((R - 1) * gy + 0.56 + 1.0) / 2 + 0.15;
  } else {
    const C = Math.max(...cols.map((c) => c.items.length)); const gx = 1.22; const gy = 1.62;
    const topY = ((cols.length - 1) * gy) / 2 - 0.25;
    cols.forEach((c, ri) => {
      const y = topY - ri * gy;
      out.headers.push({ stage: c.stage, idx: ri, pos: new THREE.Vector3(-((C - 1) / 2) * gx - 0.56, y + 0.8, Z), left: true });
      c.items.forEach((it, ci) => { out.positions[it.svcId] = new THREE.Vector3((ci - (C - 1) / 2) * gx, y, Z); });
    });
    out.hw = ((C - 1) / 2) * gx + 0.62; out.hh = ((cols.length - 1) * gy) / 2 + 1.0;
  }
  return out;
}

function renderLabels() {
  labelsEl.innerHTML = '';
  if (!layout) return;
  layout.headers.forEach((h) => {
    const d = document.createElement('div'); d.className = 'stage-label'; d.style.setProperty('--c', h.stage.color);
    if (h.left) d.style.transform = 'translate(0, -100%)', d.style.textAlign = 'left';
    d.innerHTML = `<span>ШАГ ${h.idx + 1}</span><b>${h.stage.name}</b>`; labelsEl.appendChild(d); h.el = d;
  });
  layout.arrows.forEach((a) => { const d = document.createElement('div'); d.className = 'stage-arrow'; d.textContent = '→'; labelsEl.appendChild(d); a.el = d; });
  requestAnimationFrame(() => { layout && [...layout.headers, ...layout.arrows].forEach((h) => h.el.classList.add('show')); });
}
const _v = new THREE.Vector3();
function updateLabels() {
  if (!layout) return; const W = window.innerWidth; const H = window.innerHeight;
  const place = (el, pos) => { _v.copy(pos).project(camera); el.style.left = `${((_v.x + 1) / 2) * W}px`; el.style.top = `${((1 - _v.y) / 2) * H}px`; };
  layout.headers.forEach((h) => h.el && place(h.el, h.pos));
  layout.arrows.forEach((a) => a.el && a.pos && place(a.el, a.pos));
}

async function flyOut(items) {
  layout = computeLayout(items);
  updateLayoutTargets();
  sfx.whoosh();
  const hp0 = holder.position.clone(); const hs0 = holder.scale.x;
  tween(1100, (e) => { holder.position.lerpVectors(hp0, new THREE.Vector3(0, 0.2, -4), e); holder.scale.setScalar(Math.max(0.001, hs0 + (0.001 - hs0) * e)); }, ease.inOut);
  const ps = [];
  items.forEach((it, i) => {
    const st = stickerBySvc[it.svcId]; if (!st) return;
    const stage = STAGE_MAP[it.stage];
    const mesh = new THREE.Mesh(stickerGeo, new THREE.MeshBasicMaterial({ map: st.mesh.material.map, toneMapped: false, side: THREE.DoubleSide }));
    const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(stage.color).multiplyScalar(1.15), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.position.z = -0.01; halo.scale.setScalar(1.06); mesh.add(halo);
    const card = { mesh, halo, svcId: it.svcId, stage: it.stage, sticker: st };
    mesh.userData.card = card;
    holder.updateMatrixWorld(true);
    st.mesh.getWorldPosition(mesh.position); st.mesh.getWorldQuaternion(mesh.quaternion);
    const ws = new THREE.Vector3(); st.mesh.getWorldScale(ws); mesh.scale.copy(ws);
    cardGroup.add(mesh); cards.push(card);
    const delay = 250 + i * 85;
    setTimeout(() => { st.mesh.visible = false; sfx.ping(i); }, delay);
    const p0 = mesh.position.clone(); const q0 = mesh.quaternion.clone(); const s0 = ws.x;
    const p1 = layout.positions[it.svcId]; const q1 = new THREE.Quaternion();
    const mid = p0.clone().lerp(p1, 0.5).add(new THREE.Vector3(0, 0, 2.2));
    ps.push(tween(1150, (e) => {
      // quadratic bezier arc toward the viewer
      const a = (1 - e) * (1 - e), b = 2 * (1 - e) * e, c = e * e;
      mesh.position.set(a * p0.x + b * mid.x + c * p1.x, a * p0.y + b * mid.y + c * p1.y, a * p0.z + b * mid.z + c * p1.z);
      mesh.quaternion.slerpQuaternions(q0, q1, e);
      mesh.scale.setScalar(s0 + (layout.cardS - s0) * e);
      halo.material.opacity = e * 0.55;
    }, ease.outQuint, delay));
  });
  await Promise.all(ps);
  renderLabels();
  sfx.chord();
}

async function clearSolution() {
  if (!cards.length && !layout) return;
  const list = cards.splice(0);
  labelsEl.querySelectorAll('.show').forEach((el) => el.classList.remove('show'));
  const hp0 = holder.position.clone(); const hs0 = holder.scale.x;
  layout = null; updateLayoutTargets();
  tween(900, (e) => { holder.position.lerpVectors(hp0, new THREE.Vector3(0, 0, 0), e); holder.scale.setScalar(hs0 + (1 - hs0) * e); }, ease.inOut);
  const tp = new THREE.Vector3(); const tq = new THREE.Quaternion(); const ts = new THREE.Vector3();
  await Promise.all(list.map((card, i) => {
    const p0 = card.mesh.position.clone(); const q0 = card.mesh.quaternion.clone(); const s0 = card.mesh.scale.x;
    return tween(800, (e) => {
      holder.updateMatrixWorld(true);
      card.sticker.mesh.getWorldPosition(tp); card.sticker.mesh.getWorldQuaternion(tq); card.sticker.mesh.getWorldScale(ts);
      card.mesh.position.lerpVectors(p0, tp, e); card.mesh.quaternion.slerpQuaternions(q0, tq, e);
      card.mesh.scale.setScalar(s0 + (ts.x - s0) * e); card.halo.material.opacity = 0.55 * (1 - e);
    }, ease.inOut, i * 30).then(() => {
      card.sticker.mesh.visible = true; cardGroup.remove(card.mesh); card.mesh.material.dispose(); card.halo.material.dispose();
    });
  }));
  labelsEl.innerHTML = '';
  state.solutionShown = false;
}

/* =========================================================
   Layout / camera fitting
   ========================================================= */
const view = { dist: 12, ox: 0, oy: 0, tdist: 12, tox: 0, toy: 0 };
function reserved() {
  const W = window.innerWidth; const H = window.innerHeight; const mobile = W <= 900;
  if (mobile) {
    if (state.chapter === 0) return { top: 100, bottom: Math.min(H * 0.5, 380), left: 0, right: 0 };
    return { top: 104, bottom: H * 0.46 + 16, left: 0, right: 0 };
  }
  if (state.chapter === 0) return { top: 70, bottom: 30, left: Math.min(660, W * 0.44), right: 0 };
  const pw = W <= 1180 ? 360 : 400;
  return { top: 74, bottom: 40, left: 0, right: pw + 40 };
}
function effAspect() { const W = window.innerWidth; const H = window.innerHeight; const r = reserved(); return (W - r.left - r.right) / Math.max(1, H - r.top - r.bottom); }
function updateLayoutTargets() {
  const W = window.innerWidth; const H = window.innerHeight; const r = reserved();
  const fx = (W - r.left - r.right) / W; const fy = (H - r.top - r.bottom) / H;
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)); const aspect = W / H;
  let hw, hh, planeZ = 0;
  if (layout) { hw = layout.hw; hh = layout.hh; planeZ = 2; }
  else { const R = 1.5 * spacing.tgt * 1.62 + 0.25; hw = R; hh = R; }
  const L = Math.max(hh / (tanH * fy), hw / (tanH * aspect * fx));
  view.tdist = L + planeZ;
  const cx = r.left + (W - r.left - r.right) / 2; const cy = r.top + (H - r.top - r.bottom) / 2;
  view.tox = W / 2 - cx; view.toy = H / 2 - cy;
}
function resize() {
  const W = window.innerWidth; const H = window.innerHeight;
  renderer.setSize(W, H, false); composer.setSize(W, H);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  camera.aspect = W / H;
  if (layout && cards.length) { // recompute positions for new aspect
    const items = cards.map((c) => ({ svcId: c.svcId, stage: c.stage }));
    layout = computeLayout(items); cards.forEach((c) => { const p = layout.positions[c.svcId]; if (p) c.mesh.position.copy(p); c.mesh.scale.setScalar(layout.cardS); });
    renderLabels();
  }
  updateLayoutTargets();
  view.dist = view.tdist; view.ox = view.tox; view.oy = view.toy;
  applyView();
}
function applyView() {
  const W = window.innerWidth; const H = window.innerHeight;
  camera.position.set(0, 0, view.dist); camera.lookAt(0, 0, 0);
  camera.setViewOffset(W, H, view.ox, view.oy, W, H);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

/* =========================================================
   State, highlights
   ========================================================= */
const state = { chapter: 0, busy: false, auto: false, company: null, face: 0, scenario: null, ownMode: false, ownSel: new Set(), solutionShown: false, hoverSvc: null, ready: false };

function setTargets() {
  const ch = state.chapter;
  for (const s of stickers) {
    let dim = 1, glow = 0, pop = 0;
    if (ch === 1 && state.company) {
      const on = s.svc && s.svc.team.includes(state.company);
      dim = on ? 1 : 0.28; glow = on ? 1 : 0; pop = on ? 0.08 : 0;
    } else if (ch === 2) {
      const on = s.face.index === state.face; dim = on ? 1 : 0.4;
      if (s.svc && state.hoverSvc === s.svc.id) { glow = 1; pop = 0.08; }
    } else if (ch === 3) {
      if (state.solutionShown) { dim = 0.32; glow = 0; }
      else if (state.ownMode) { const on = s.svc && state.ownSel.has(s.svc.id); glow = on ? 1 : 0; pop = on ? 0.08 : 0; dim = !s.svc ? 0.6 : 1; }
      else if (state.scenario && state.pendingIds) { const on = s.svc && state.pendingIds.has(s.svc.id); glow = on ? 1 : 0; dim = on ? 1 : 0.3; pop = on ? 0.1 : 0; }
    }
    s.tgt.dim = dim; s.tgt.glow = glow; s.tgt.pop = pop;
  }
}

/* =========================================================
   Panels
   ========================================================= */
function setPanel(html) { panel.innerHTML = html; panel.classList.remove('fade-in'); void panel.offsetWidth; panel.classList.add('fade-in'); panel.scrollTop = 0; }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function panelTeam() {
  const counts = Object.fromEntries(COMPANIES.map((c) => [c.id, stickers.filter((s) => s.svc && s.svc.team.includes(c.id)).length]));
  setPanel(`
    <p class="eyebrow">Новая «старая» команда</p>
    <h2>Пять команд — один куб</h2>
    <p class="lead">IQDATA теперь в ГК «Ремедиум». Данные рынка, аналитика, CRM, визиты и медицинский контент работают в одном контуре. Выберите команду — куб подсветит её возможности.</p>
    <div class="company-list">
      ${COMPANIES.map((c) => `
        <button class="company" data-company="${esc(c.id)}" aria-pressed="${state.company === c.id}">
          <div class="company-head"><span class="company-name">${esc(c.id)}</span><span class="company-since">${esc(c.since)}</span></div>
          <div class="company-desc">${esc(c.desc)}</div>
          <span class="company-count">${counts[c.id]} ${plural(counts[c.id], 'плитка', 'плитки', 'плиток')} на кубе</span>
        </button>`).join('')}
    </div>`);
  panel.querySelectorAll('.company').forEach((b) => b.addEventListener('click', () => { stopAuto(); selectCompany(b.dataset.company); }));
}
function plural(n, a, b, c) { const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return a; if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return b; return c; }
function selectCompany(id) {
  state.company = state.company === id ? null : id;
  panel.querySelectorAll('.company').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.company === state.company)));
  if (state.company) {
    sfx.select();
    // turn the cube toward the face where this team has the most tiles
    let best = 0, bestN = -1;
    FACES.forEach((f, i) => { const n = f.services.filter((x) => x.team.includes(state.company)).length; if (n > bestN) { bestN = n; best = i; } });
    orientTo(faceQuat(FACES[best].side), 1000); pointer.lastMove = performance.now() + 1500;
  }
  setTargets();
}

function panelFaces() {
  const f = FACES[state.face];
  setPanel(`
    <p class="eyebrow">Шесть граней возможностей</p>
    <h2>${esc(f.name)}</h2>
    <p class="lead">${esc(f.lead)}</p>
    <div class="face-tabs">
      ${FACES.map((x, i) => `<button class="face-tab" style="--c:${x.color}" data-face="${i}" aria-pressed="${i === state.face}"><i></i>${esc(x.short)}</button>`).join('')}
    </div>
    <div class="svc-list" style="--c:${f.color}">
      ${f.services.map((s, i) => `
        <button class="svc" data-svc="${s.id}">
          <span class="svc-n">${String(i + 1).padStart(2, '0')}</span>
          <span><span class="svc-name">${esc(s.label)}</span><span class="svc-team">${esc(s.team.join(' · '))}</span></span>
          ${s.tag ? `<span class="tag">${esc(s.tag)}</span>` : '<span></span>'}
        </button>`).join('')}
    </div>
    <p class="note">Нажмите на строку или плитку на кубе, чтобы открыть описание.</p>`);
  panel.querySelectorAll('.face-tab').forEach((b) => b.addEventListener('click', () => { stopAuto(); selectFace(+b.dataset.face); }));
  panel.querySelectorAll('.svc').forEach((b) => {
    b.addEventListener('mouseenter', () => { state.hoverSvc = b.dataset.svc; setTargets(); });
    b.addEventListener('mouseleave', () => { state.hoverSvc = null; setTargets(); });
    b.addEventListener('click', () => { stopAuto(); showDetail(b.dataset.svc); });
  });
}
function selectFace(i) {
  state.face = i; hideDetail(); panelFaces(); setTargets(); sfx.select();
  orientTo(faceQuat(FACES[i].side), 1000);
}

function panelSolve() {
  if (state.solutionShown && state.scenario) return panelStory();
  if (state.ownMode) return panelOwn();
  setPanel(`
    <p class="eyebrow">Конструктор решений</p>
    <h2>Соберите решение под задачу</h2>
    <p class="lead">Выберите задачу бренда — куб соберётся, а нужные сервисы выстроятся в цепочку от данных до измеримого результата.</p>
    <div class="scn-grid">
      ${SCENARIOS.map((s, i) => `<button class="scn" data-scn="${s.id}" ${state.busy ? 'disabled' : ''}><span>ЗАДАЧА ${String(i + 1).padStart(2, '0')}</span>${esc(s.name)}</button>`).join('')}
      <button class="scn own" data-own="1" ${state.busy ? 'disabled' : ''}><span>+</span>Собрать своё решение из плиток куба</button>
    </div>
    <p class="note">Клавиши 1–6 запускают задачи во время показа.</p>`);
  panel.querySelectorAll('[data-scn]').forEach((b) => b.addEventListener('click', () => { stopAuto(); runScenario(b.dataset.scn); }));
  panel.querySelector('[data-own]').addEventListener('click', () => { stopAuto(); startOwn(); });
}
function panelStory() {
  const own = state.scenario === 'own';
  const sc = own ? ownScenario() : SCENARIOS.find((s) => s.id === state.scenario);
  setPanel(`
    <p class="eyebrow">${own ? 'Ваше решение' : 'Решение под задачу'}</p>
    <h2>${esc(sc.name)}</h2>
    <div class="story">
      <div class="story-goal">${esc(sc.goal)}</div>
      ${STAGES.filter((st) => sc.steps[st.id] && sc.steps[st.id].ids.length).map((st) => `
        <div class="step" style="--c:${st.color}"><div class="step-bar"></div><div><h4>${st.name}</h4><p>${esc(sc.steps[st.id].text)}</p></div></div>`).join('')}
      <div class="story-result">${esc(sc.result)}</div>
    </div>
    <div class="row-btns">
      <button class="btn-solid" data-act="back">Другая задача</button>
      <button class="btn-ghost" data-act="again">Собрать заново</button>
    </div>`);
  panel.querySelector('[data-act="back"]').addEventListener('click', async () => { stopAuto(); await resetSolve(); });
  panel.querySelector('[data-act="again"]').addEventListener('click', () => { stopAuto(); own ? buildOwn() : runScenario(state.scenario); });
}
function ownScenario() {
  const items = [...state.ownSel].map((id) => SERVICE_MAP[id]);
  const steps = {};
  STAGES.forEach((st) => { const list = items.filter((s) => s.stage === st.id); steps[st.id] = { ids: list.map((s) => s.id), text: list.map((s) => s.label).join(', ') }; });
  const teams = [...new Set(items.flatMap((s) => s.team))];
  return { name: `${items.length} ${plural(items.length, 'сервис', 'сервиса', 'сервисов')} в одном контуре`, goal: `Команды: ${teams.join(', ')}.`, steps, result: 'Одна точка входа — один план, одна отчётность.' };
}
function panelOwn() {
  const items = [...state.ownSel].map((id) => SERVICE_MAP[id]);
  setPanel(`
    <p class="eyebrow">Своё решение</p>
    <h2>Выберите плитки на кубе</h2>
    <p class="lead">Поворачивайте куб и нажимайте на сервисы. Они встанут в нужный шаг цепочки.</p>
    ${items.length ? `<div class="own-list">${items.map((s) => `<div class="own-item" style="--c:${s.face.color}"><i></i>${esc(s.label)}<small>${STAGE_MAP[s.stage].name}</small></div>`).join('')}</div>`
      : '<div class="empty">Пока ничего не выбрано.<br>Нажмите на любую плитку куба.</div>'}
    <div class="row-btns">
      <button class="btn-solid" data-act="build" ${items.length < 2 ? 'disabled' : ''}>Собрать решение</button>
      <button class="btn-ghost" data-act="cancel">Назад к задачам</button>
    </div>`);
  panel.querySelector('[data-act="build"]').addEventListener('click', () => { stopAuto(); buildOwn(); });
  panel.querySelector('[data-act="cancel"]').addEventListener('click', () => { state.ownMode = false; state.ownSel.clear(); setTargets(); panelSolve(); });
}

function panelContour() {
  setPanel(`
    <p class="eyebrow">Единый контур</p>
    <h2>Видеть шире. Действовать точнее.</h2>
    <p class="lead">Данные, аналитика и коммуникационные сервисы группы работают на задачи клиента — от развития портфеля до кампании и оценки её результата.</p>
    <div class="loop">${STAGES.map((s, i) => `<span style="--c:${s.color}">${s.name}</span>${i < 3 ? '<em>→</em>' : ''}`).join('')}</div>
    <div class="nums">${NUMBERS.map((n) => `<div class="num"><b>${esc(n.v)}</b><span>${esc(n.l)}</span></div>`).join('')}</div>
    <p class="note">Данные. Решения. Результаты.</p>`);
}

function renderPanel() {
  const ch = state.chapter;
  if (ch === 1) panelTeam(); else if (ch === 2) panelFaces(); else if (ch === 3) panelSolve(); else if (ch === 4) panelContour(); else panel.innerHTML = '';
}

/* ---------- detail ---------- */
function showDetail(id) {
  const s = SERVICE_MAP[id]; if (!s) return;
  detailEl.style.setProperty('--c', s.face.color);
  detailEl.querySelector('.detail-body').innerHTML = `
    <div class="d-face">${esc(s.face.name)}</div>
    <h3>${esc(s.label)}</h3>
    <p>${esc(s.desc)}</p>
    <div class="d-meta">${s.team.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}${s.tag ? `<span class="tag" style="--c:${s.face.color}">${esc(s.tag)}</span>` : ''}</div>`;
  detailEl.hidden = false; sfx.select();
}
function hideDetail() { detailEl.hidden = true; }
detailEl.querySelector('.detail-close').addEventListener('click', hideDetail);

function onPick(p) {
  if (p.card) { showDetail(p.card.svcId); return; }
  const st = p.sticker; if (!st) return;
  if (!st.svc) { // center tile → go to that face
    if (state.chapter === 2) selectFace(st.face.index);
    return;
  }
  if (state.chapter === 3 && state.ownMode && !state.busy) {
    const id = st.svc.id;
    if (state.ownSel.has(id)) state.ownSel.delete(id); else if (state.ownSel.size < 16) { state.ownSel.add(id); sfx.ping(state.ownSel.size); }
    setTargets(); panelOwn(); return;
  }
  if (state.chapter === 2 && st.face.index !== state.face) { selectFace(st.face.index); }
  showDetail(st.svc.id);
}

/* =========================================================
   Scenarios
   ========================================================= */
async function shuffleAndSolve() {
  await waitSpacing(1);
  spinBoost = 1;
  await scramble(10, 105);
  await sleep(120);
  await solveAll(95);
  spinBoost = 0;
}
async function runScenario(id) {
  if (state.busy) return;
  state.busy = true; hideDetail();
  await clearSolution();
  state.scenario = id; state.ownMode = false;
  const sc = SCENARIOS.find((s) => s.id === id);
  const items = []; STAGES.forEach((st) => sc.steps[st.id].ids.forEach((svcId) => items.push({ svcId, stage: st.id })));
  state.pendingIds = null; setTargets();
  setPanel(`<p class="eyebrow">Задача</p><h2>${esc(sc.name)}</h2><p class="lead">${esc(sc.goal)}</p><p class="note">Куб подбирает сервисы группы…</p>`);
  await shuffleAndSolve();
  state.pendingIds = new Set(items.map((i) => i.svcId)); setTargets();
  await orientTo(HOME_Q, 600);
  await sleep(500);
  state.solutionShown = true; setTargets();
  await flyOut(items);
  state.pendingIds = null; state.busy = false;
  panelStory();
}
function startOwn() { state.ownMode = true; state.scenario = null; state.ownSel.clear(); setTargets(); panelOwn(); orientTo(HOME_Q, 800); }
async function buildOwn() {
  if (state.busy || state.ownSel.size < 2) return;
  state.busy = true; hideDetail();
  await clearSolution();
  const items = [...state.ownSel].map((id) => SERVICE_MAP[id]);
  const ordered = STAGES.flatMap((st) => items.filter((s) => s.stage === st.id).map((s) => ({ svcId: s.id, stage: st.id })));
  state.scenario = 'own'; state.ownMode = false; setTargets();
  await shuffleAndSolve();
  state.solutionShown = true; setTargets();
  await flyOut(ordered);
  state.busy = false;
  panelStory();
}
async function resetSolve() {
  if (state.busy) return; state.busy = true;
  await clearSolution(); state.scenario = null; state.ownMode = false; state.ownSel.clear(); setTargets();
  state.busy = false; panelSolve();
}

/* =========================================================
   Chapters
   ========================================================= */
const navBtns = [...document.querySelectorAll('.chapters button')];
let navToken = 0;
async function goChapter(n) {
  n = clamp(n, 0, 4);
  const token = ++navToken;
  while (!state.ready) { await sleep(60); if (token !== navToken) return; }
  while (state.busy) { await sleep(60); if (token !== navToken) return; }
  if (n === state.chapter) return;
  state.busy = true; hideDetail();
  if (cards.length || layout) await clearSolution();
  state.chapter = n; app.dataset.chapter = String(n);
  navBtns.forEach((b) => b.setAttribute('aria-current', String(+b.dataset.ch === n)));
  state.company = null; state.scenario = null; state.ownMode = false; state.ownSel.clear(); state.hoverSvc = null; state.pendingIds = null;
  spacing.tgt = n === 1 ? 1.34 : 1;
  updateLayoutTargets();
  renderPanel(); setTargets();
  if (moveHistory.length) { await waitSpacing(1); await solveAll(90); spacing.tgt = n === 1 ? 1.34 : 1; updateLayoutTargets(); }
  if (n === 2) orientTo(faceQuat(FACES[state.face].side), 1100);
  else if (n === 3) orientTo(HOME_Q, 900);
  state.busy = false;
  if (n === 3) panelSolve();
}
navBtns.forEach((b) => b.addEventListener('click', () => { sfx.ensure(); stopAuto(); goChapter(+b.dataset.ch); }));
$('#btn-start').addEventListener('click', () => { sfx.ensure(); stopAuto(); goChapter(1); });

window.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input,textarea')) return;
  sfx.ensure();
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { stopAuto(); goChapter(state.chapter + 1); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { stopAuto(); goChapter(state.chapter - 1); }
  else if (e.key === 'Escape') hideDetail();
  else if (e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') toggleAuto();
  else if (/^[1-6]$/.test(e.key) && state.chapter === 3) { stopAuto(); runScenario(SCENARIOS[+e.key - 1].id); }
});

/* ---------- autoplay ---------- */
const autoBtn = $('#btn-auto');
let autoToken = 0;
function stopAuto() { if (!state.auto) return; state.auto = false; autoToken++; autoBtn.setAttribute('aria-pressed', 'false'); }
function toggleAuto() { if (state.auto) stopAuto(); else startAuto(); }
autoBtn.addEventListener('click', () => { sfx.ensure(); toggleAuto(); });
async function startAuto() {
  state.auto = true; autoBtn.setAttribute('aria-pressed', 'true');
  const tk = ++autoToken; const alive = () => tk === autoToken;
  const wait = async (ms) => { const end = performance.now() + ms; while (performance.now() < end) { if (!alive()) throw 0; await sleep(80); } };
  try {
    while (alive()) {
      await goChapter(0); await wait(4500);
      await goChapter(1); await wait(1200);
      for (const c of COMPANIES) { if (!alive()) throw 0; selectCompany(c.id); await wait(2600); }
      await goChapter(2);
      for (let i = 0; i < FACES.length; i++) { if (!alive()) throw 0; selectFace(i); await wait(2800); }
      await goChapter(3); await wait(1200);
      for (const id of ['s2', 's1', 's3']) {
        if (!alive()) throw 0; await runScenario(id); await wait(9000);
        if (!alive()) throw 0; await resetSolve(); await wait(800);
      }
      await goChapter(4); await wait(9000);
    }
  } catch (e) { /* stopped */ }
}

/* ---------- sound toggle ---------- */
const soundBtn = $('#btn-sound');
soundBtn.addEventListener('click', () => { sfx.ensure(); sfx.enabled = !sfx.enabled; soundBtn.setAttribute('aria-pressed', String(sfx.enabled)); });

/* =========================================================
   Loop
   ========================================================= */
let spinBoost = 0; let last = performance.now(); let introDone = false;
const clock0 = performance.now();
const _wp = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = (now - clock0) / 1000;
  runTweens(now);

  // spacing
  if (!twisting && Math.abs(spacing.cur - spacing.tgt) > 0.0005) { spacing.cur += (spacing.tgt - spacing.cur) * Math.min(1, dt * 5); applySpacing(); updateLayoutTargets(); }

  // idle rotation & inertia
  const idle = !pointer.down && now - pointer.lastMove > 2500;
  if (!pointer.down && (Math.abs(pointer.vx) > 0.0001 || Math.abs(pointer.vy) > 0.0001)) { rotateBy(pointer.vx, pointer.vy); pointer.vx *= 0.92; pointer.vy *= 0.92; }
  const ch = state.chapter;
  if (introDone && idle && (ch === 0 || ch === 1 || ch === 4 || (ch === 3 && state.solutionShown))) {
    _qa.setFromAxisAngle(AX_Y, dt * (ch === 3 ? 0.25 : 0.18)); cubeRoot.quaternion.premultiply(_qa);
  }
  if (spinBoost) { _qa.setFromAxisAngle(AX_Y, dt * 0.9); cubeRoot.quaternion.premultiply(_qa); }

  // stickers
  const k = Math.min(1, dt * 7);
  for (const s of stickers) {
    let glowT = s.tgt.glow;
    if (ch === 4) { s.mesh.getWorldPosition(_wp); glowT = Math.max(0, Math.sin(t * 2.2 - (_wp.x * 0.9 + _wp.y * 0.6))) * 0.9; }
    if (s.wave > 0) { glowT = Math.max(glowT, s.wave); s.wave = Math.max(0, s.wave - dt * 1.4); }
    s.cur.dim += (s.tgt.dim - s.cur.dim) * k; s.cur.glow += (glowT - s.cur.glow) * k; s.cur.pop += (s.tgt.pop - s.cur.pop) * k;
    const hv = hovered === s ? 1 : 0; s.hover += (hv - s.hover) * k;
    s.mesh.material.color.setScalar(s.cur.dim + s.hover * 0.12);
    s.halo.material.opacity = Math.min(1, s.cur.glow + s.hover * 0.45);
    s.mesh.position.copy(s.n).multiplyScalar(SURF + 0.004 + s.cur.pop + s.hover * 0.05);
  }
  // card float
  cards.forEach((c, i) => { if (state.solutionShown && !state.busy) { c.mesh.rotation.y = Math.sin(t * 0.8 + i) * 0.06; c.mesh.rotation.x = Math.cos(t * 0.7 + i * 1.3) * 0.04; } });

  ring.material.opacity += ((ch === 4 ? 0.9 : 0) - ring.material.opacity) * Math.min(1, dt * 3);
  ring.rotation.y += dt * 0.25;
  stars.rotation.y += dt * 0.01;

  // camera
  const kc = Math.min(1, dt * 3.2);
  view.dist += (view.tdist - view.dist) * kc; view.ox += (view.tox - view.ox) * kc; view.oy += (view.toy - view.oy) * kc;
  applyView();
  updateLabels();
  composer.render();
}

/* =========================================================
   Intro animation
   ========================================================= */
async function intro() {
  const targets = cubies.map((c) => c.position.clone());
  const startQ = cubies.map((c) => c.quaternion.clone());
  cubies.forEach((c, i) => {
    const dir = targets[i].clone().normalize();
    c.position.copy(dir.multiplyScalar(9 + Math.random() * 7)).add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, -6 - Math.random() * 10));
    c.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    c.scale.setScalar(0.4);
  });
  cubeRoot.quaternion.copy(HOME_Q);
  const ps = cubies.map((c, i) => {
    const p0 = c.position.clone(); const q0 = c.quaternion.clone(); const delay = 200 + targets[i].length() * 160 + Math.random() * 500;
    return tween(1500, (e) => { c.position.lerpVectors(p0, targets[i], e); c.quaternion.slerpQuaternions(q0, startQ[i], Math.min(1, e * 1.1)); c.scale.setScalar(0.4 + 0.6 * Math.min(1, e * 1.3)); }, ease.outBack, delay);
  });
  await Promise.all(ps);
  sfx.chord();
  // glow wave across stickers
  stickers.forEach((s) => { s.mesh.getWorldPosition(_wp); setTimeout(() => { s.wave = 1; }, 80 + (_wp.x + _wp.y + 4) * 110); });
  await sleep(700);
  await twist('y', 1, 1, 340); await twist('x', -1, -1, 340); await twist('z', 1, 1, 340);
  await sleep(150);
  await solveAll(300);
  introDone = true;
}

/* =========================================================
   Boot
   ========================================================= */
async function boot() {
  const fontsReady = Promise.all([document.fonts.load('700 60px Manrope'), document.fonts.load('800 30px Manrope'), document.fonts.load('600 60px Unbounded')]).catch(() => {});
  await Promise.race([fontsReady, sleep(2500)]); // never block the show on fonts
  buildCube();
  resize();
  navBtns.forEach((b) => b.setAttribute('aria-current', String(+b.dataset.ch === 0)));
  requestAnimationFrame(frame);
  $('#loader').classList.add('done');
  const hero = $('#hero'); hero.classList.add('pre');
  intro().then(() => { state.ready = true; });
  setTimeout(() => hero.classList.remove('pre'), 900);
}
boot();
