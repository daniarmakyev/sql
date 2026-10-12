// "Трансфер по Кыргызстану" — 3D motion-design ad (v6: punchier edit).
// Every frame is a pure function of time t. Live playback renders 1 sample per frame;
// export (?render=1) accumulates 16 samples per frame for motion blur, depth of field and anti-aliasing.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const RENDER = location.search.includes('render');
if (RENDER) document.body.classList.add('render');
const QS = new URLSearchParams(location.search);
const W = +(QS.get('w') || 1080), H = +(QS.get('h') || 1920), FPS = 30, T_END = 24.0;
let STILL = null, BLOOM = null;   // { shot, t, n, fov, pos, target, rel, focus, aperture, noWord }
const GOLD = new THREE.Color('#f6c443');
const CUTS = [
  { at: 3.2, dur: 0.7, mode: 1 },                          // aerial -> road: whip pan
  { at: 9.6, dur: 0.7, mode: 4, focus: [0.5, 0.55] },      // road -> cabin stickers: punch + flash
  { at: 12.2, dur: 0.8, mode: 3, focus: [0.5, 0.48] },     // stickers -> map: zoom through
  { at: 17.0, dur: 0.9, mode: 4, focusShot: 3 },           // map -> finale: dive into Bishkek + flash
];
// beat hits: [time, strength] -> zoom punch + camera shake on the whole frame
const IMPACTS = [[0.42, 1.0], [3.2, 0.6], [4.5, 0.45], [5.6, 0.45], [6.7, 0.45], [8.55, 0.7], [9.6, 0.8], [10.62, 0.7], [12.2, 0.5],
  [17.0, 1.0], [17.5, 0.55], [18.3, 0.8], [19.45, 0.35]];
const LEAKS = [3.2, 9.6, 17.0];

// ---------------------------------------------------------------- helpers
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, x) => a + (b - a) * x;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const smoother = x => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const easeOut = x => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = x => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const easeOutBack = (x, c1 = 1.4) => { x = clamp(x); const c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const deg = d => d * Math.PI / 180;
const lerpV = (a, b, x) => a.map((v, i) => lerp(v, b[i], x));
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const lin = hex => new THREE.Color(hex);
function fx(t) {
  let punch = 0, sx = 0, sy = 0, leak = 0, phase = 0, rgb = 0;
  IMPACTS.forEach(([ti, s], i) => {
    const d = t - ti; if (d < 0 || d > 1.2) return;
    punch += 0.042 * s * Math.exp(-d * 9); rgb += s * Math.exp(-d * 13);
    const e = Math.exp(-d * 10) * s; sx += e * Math.sin(d * 52 + i * 1.7) * 8; sy += e * Math.cos(d * 47 + i) * 7;
  });
  LEAKS.forEach(ti => { const d = t - ti, a = Math.exp(-Math.pow(d / 0.24, 2)); if (a > leak) { leak = a; phase = 0.5 + d * 2.2; } });
  return { punch, sx: sx / W, sy: sy / H, leak, phase, rgb: Math.min(rgb, 1.2) };
}
// integrates a speed profile v(t) into distance d(t)
function integrate(t0, t1, v) {
  const dt = 1 / 600, n = Math.ceil((t1 - t0) / dt) + 2, d = new Float64Array(n);
  for (let i = 1; i < n; i++) d[i] = d[i - 1] + v(t0 + (i - 0.5) * dt) * dt;
  return t => { const x = (t - t0) / dt; if (x <= 0) return v(t0) * (t - t0); const i = Math.min(n - 2, Math.floor(x)); return d[i] + (d[i + 1] - d[i]) * (x - i); };
}

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('film');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: RENDER, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = false;
renderer.setPixelRatio(1);
let RW = W, RH = H, MSAA = 4;
const ortho = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -10, 10);
const FS_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const fsGeo = new THREE.PlaneGeometry(2, 2);
function fsPass(frag, uniforms, extra = {}) {
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, ...extra });
  const scene = new THREE.Scene(); scene.add(new THREE.Mesh(fsGeo, mat));
  return { scene, mat };
}
function runPass(p, target) { renderer.setRenderTarget(target); renderer.render(p.scene, ortho); }

let rtA, rtB, accRT, blurA, blurB, composer, grade;
const GLASS = { blurTex: { value: null }, res: { value: new THREE.Vector2(W, H) } };
const MIX_FRAG = /* glsl */`
  uniform sampler2D tA, tB; uniform float p, k; uniform int mode; uniform vec2 focus; varying vec2 vUv;
  vec2 mir(vec2 u){ return 1.0 - abs(1.0 - mod(u, 2.0)); }
  vec3 hblur(sampler2D t, vec2 uv, float r){ vec3 c = vec3(0.0); for (int i = 0; i < 16; i++){ float s = float(i) / 15.0 - 0.5; c += texture2D(t, mir(uv + vec2(r * s, 0.0))).rgb; } return c / 16.0; }
  vec3 zblur(sampler2D t, vec2 uv, vec2 c0, float s){ vec3 c = vec3(0.0); for (int i = 0; i < 16; i++){ float q = float(i) / 15.0; c += texture2D(t, mir(c0 + (uv - c0) * (1.0 - s * q))).rgb; } return c / 16.0; }
  void main(){
    vec3 c;
    if (mode == 0) { c = texture2D(tA, vUv).rgb; }
    else {
      float e = p * p * (3.0 - 2.0 * p), pk = sin(3.14159 * p);
      if (mode == 1) {
        vec3 a = hblur(tA, vUv + vec2(e, 0.0), 0.14 * pk), b = hblur(tB, vUv - vec2(1.0 - e, 0.0), 0.14 * pk);
        float seam = 1.0 - e; c = mix(a, b, smoothstep(seam - 0.22, seam + 0.22, vUv.x));
      } else if (mode == 3) {
        vec3 a = zblur(tA, focus + (vUv - focus) / (1.0 + 1.3 * e), focus, 0.24 * pk);
        vec3 b = zblur(tB, focus + (vUv - focus) / (0.5 + 0.5 * e), focus, 0.24 * pk);
        c = mix(a, b, smoothstep(0.38, 0.62, p));
      } else {
        vec3 a = zblur(tA, focus + (vUv - focus) / (1.0 + 2.2 * e), focus, 0.28 * pk);
        vec3 b = zblur(tB, focus + (vUv - focus) / (0.75 + 0.25 * e), focus, 0.18 * (1.0 - e));
        c = mix(a, b, smoothstep(0.45, 0.6, p));
        c = mix(c, vec3(1.0, 0.92, 0.78), exp(-pow((p - 0.52) / 0.05, 2.0)) * 0.36);
      }
    }
    gl_FragColor = vec4(c * k, 1.0);
  }`;
let mixP, downP, gaussP;
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, fade: { value: 1 }, punch: { value: 0 }, shake: { value: new THREE.Vector2() }, leak: { value: 0 }, phase: { value: 0 }, rgb: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float fade, punch, leak, phase, rgb; uniform vec2 shake; varying vec2 vUv;
    void main(){
      vec2 uv = (vUv - 0.5) / (1.0 + punch) + 0.5 + shake, cd = (uv - 0.5) * rgb * 0.016;   // hits split the channels a little
      vec3 c = vec3(texture2D(tDiffuse, clamp(uv + cd, 0.001, 0.999)).r, texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).g, texture2D(tDiffuse, clamp(uv - cd, 0.001, 0.999)).b);
      vec2 d = vUv - 0.5; c *= 1.0 - smoothstep(0.18, 0.75, dot(d * vec2(0.9, 1.0), d * vec2(0.9, 1.0))) * 0.26;
      vec2 lq = (vUv - mix(vec2(-0.12, 1.02), vec2(1.12, 0.3), phase)) * vec2(1.0, 1.7778); float l = exp(-dot(lq, lq) / 0.1) * leak;
      c += vec3(1.0, 0.5, 0.15) * l * 0.24 + vec3(1.0, 0.85, 0.6) * pow(l, 3.0) * 0.1;
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(lum), c, 1.06);
      gl_FragColor = vec4(max(c, 0.0) * fade, 1.0);
    }`,
};
function setupPipeline() {
  renderer.setSize(RW, RH, false);
  GLASS.res.value.set(RW, RH);
  const hf = { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace };
  rtA = new THREE.WebGLRenderTarget(RW, RH, { ...hf, samples: MSAA });
  rtB = new THREE.WebGLRenderTarget(RW, RH, { ...hf, samples: MSAA });
  accRT = new THREE.WebGLRenderTarget(RW, RH, hf);
  blurA = new THREE.WebGLRenderTarget(RW >> 2, RH >> 2, hf);
  blurB = new THREE.WebGLRenderTarget(RW >> 2, RH >> 2, hf);
  mixP = fsPass(MIX_FRAG, { tA: { value: rtA.texture }, tB: { value: rtB.texture }, p: { value: 0 }, k: { value: 1 }, mode: { value: 0 }, focus: { value: new THREE.Vector2(0.5, 0.5) } },
    { blending: THREE.AdditiveBlending, transparent: true });
  downP = fsPass(`uniform sampler2D src; uniform vec2 px; varying vec2 vUv; void main(){ vec3 c = texture2D(src, vUv + px * vec2(-1.0, -1.0)).rgb + texture2D(src, vUv + px * vec2(1.0, -1.0)).rgb
      + texture2D(src, vUv + px * vec2(-1.0, 1.0)).rgb + texture2D(src, vUv + px * vec2(1.0, 1.0)).rgb; gl_FragColor = vec4(c * 0.25, 1.0); }`, { src: { value: null }, px: { value: new THREE.Vector2() } });
  gaussP = fsPass(`uniform sampler2D src; uniform vec2 dir; varying vec2 vUv; void main(){ float w0 = 0.227027, w1 = 0.1945946, w2 = 0.1216216, w3 = 0.054054, w4 = 0.016216;
      vec3 c = texture2D(src, vUv).rgb * w0 + (texture2D(src, vUv + dir).rgb + texture2D(src, vUv - dir).rgb) * w1 + (texture2D(src, vUv + 2.0 * dir).rgb + texture2D(src, vUv - 2.0 * dir).rgb) * w2
      + (texture2D(src, vUv + 3.0 * dir).rgb + texture2D(src, vUv - 3.0 * dir).rgb) * w3 + (texture2D(src, vUv + 4.0 * dir).rgb + texture2D(src, vUv - 4.0 * dir).rgb) * w4; gl_FragColor = vec4(c, 1.0); }`,
    { src: { value: null }, dir: { value: new THREE.Vector2() } });
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(RW, RH, hf));
  composer.setPixelRatio(1); composer.setSize(RW, RH);
  const first = new ShaderPass({ uniforms: { tDiffuse: { value: null }, src: { value: null } }, vertexShader: GradeShader.vertexShader,
    fragmentShader: `uniform sampler2D src; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(src, vUv).rgb, 1.0); }` });
  first.uniforms.src.value = accRT.texture;   // ShaderPass clones uniforms and drops render-target textures
  grade = new ShaderPass(GradeShader);
  composer.addPass(first); BLOOM = new UnrealBloomPass(new THREE.Vector2(RW, RH), 0.28, 0.5, 1.0); composer.addPass(BLOOM); composer.addPass(grade); composer.addPass(new OutputPass());
}
function blurInto(tex) {
  downP.mat.uniforms.src.value = tex; downP.mat.uniforms.px.value.set(1 / RW, 1 / RH); runPass(downP, blurA);
  for (let i = 0; i < 2; i++) {
    gaussP.mat.uniforms.src.value = blurA.texture; gaussP.mat.uniforms.dir.value.set(1.6 / (RW >> 2), 0); runPass(gaussP, blurB);
    gaussP.mat.uniforms.src.value = blurB.texture; gaussP.mat.uniforms.dir.value.set(0, 1.6 / (RH >> 2)); runPass(gaussP, blurA);
  }
  GLASS.blurTex.value = blurA.texture;
}

// ---------------------------------------------------------------- loading
const texLoader = new THREE.TextureLoader();
const loadTex = (url, srgb = true) => new Promise((res, rej) => texLoader.load(url, t => { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; res(t); }, undefined, rej));
const loadJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.json(); });
const loadImg = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(url)); i.src = url; });
async function loadPixels(url) {
  const img = await loadImg(url);
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
}
function gray(px) { const out = new Float32Array(px.w * px.h); for (let i = 0; i < out.length; i++) out[i] = px.data[i * 4] / 255; return { w: px.w, h: px.h, data: out }; }
function sample(g, u, v) {
  const x = clamp(u) * (g.w - 1), y = clamp(v) * (g.h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(g.w - 1, x0 + 1), y1 = Math.min(g.h - 1, y0 + 1);
  const fx2 = x - x0, fy = y - y0, D = g.data, w = g.w;
  return lerp(lerp(D[y0 * w + x0], D[y0 * w + x1], fx2), lerp(D[y1 * w + x0], D[y1 * w + x1], fx2), fy);
}

// ---------------------------------------------------------------- 2D overlay: text, glass, chips, stickers, icons
function drawIcon(x, kind, cx, cy, s, color) {
  x.save(); x.translate(cx, cy); x.scale(s / 100, s / 100);
  x.fillStyle = color; x.strokeStyle = color; x.lineWidth = 9; x.lineCap = 'round'; x.lineJoin = 'round';
  if (kind === 'seat') {
    x.beginPath(); x.arc(0, -26, 17, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.moveTo(-30, 42); x.quadraticCurveTo(-30, -2, 0, -2); x.quadraticCurveTo(30, -2, 30, 42); x.closePath(); x.fill();
  } else if (kind === 'bag') {
    x.beginPath(); x.roundRect(-38, -16, 76, 58, 10); x.fill(); x.beginPath(); x.roundRect(-16, -34, 32, 26, 8); x.stroke();
  } else if (kind === 'plane') {
    x.beginPath(); x.moveTo(0, -46); x.quadraticCurveTo(7, -40, 7, -26); x.lineTo(7, -8); x.lineTo(44, 12); x.lineTo(44, 22); x.lineTo(7, 12); x.lineTo(7, 30);
    x.lineTo(20, 40); x.lineTo(20, 47); x.lineTo(0, 41); x.lineTo(-20, 47); x.lineTo(-20, 40); x.lineTo(-7, 30); x.lineTo(-7, 12); x.lineTo(-44, 22); x.lineTo(-44, 12);
    x.lineTo(-7, -8); x.lineTo(-7, -26); x.quadraticCurveTo(-7, -40, 0, -46); x.fill();
  } else if (kind === 'clock') {
    x.beginPath(); x.arc(0, 0, 38, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.moveTo(0, -20); x.lineTo(0, 0); x.lineTo(16, 10); x.stroke();
  } else if (kind === 'pin') {
    x.beginPath(); x.moveTo(0, 46); x.bezierCurveTo(-8, 30, -34, 6, -34, -14); x.arc(0, -14, 34, Math.PI, 0); x.bezierCurveTo(34, 6, 8, 30, 0, 46); x.fill();
    x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(0, -14, 13, 0, Math.PI * 2); x.fill(); x.globalCompositeOperation = 'source-over';
  } else if (kind === 'chat') {
    x.beginPath(); x.arc(0, 0, 48, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ffffff'; x.beginPath(); x.arc(0, -2, 33, 0, Math.PI * 2); x.moveTo(-26, 18); x.lineTo(-33, 34); x.lineTo(-14, 28); x.closePath(); x.fill();
    x.fillStyle = color; x.beginPath(); x.arc(0, -2, 27.5, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ffffff'; x.save(); x.translate(-15, -17); x.scale(1.25, 1.25); x.translate(-3, -3);
    x.fill(new Path2D('M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z'));
    x.restore();
  }
  x.restore();
}
function canvasTex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; return t; }
function textMesh(parts, { size = 64, weight = 800, family = 'Manrope', tracking = 0, shadow = 0.35, pad = 26, brightness = 0.93 } = {}) {
  if (typeof parts === 'string') parts = [[parts, '#ffffff']];
  const c = document.createElement('canvas'); const x = c.getContext('2d');
  const font = `${weight} ${size}px "${family}", "Arial", sans-serif`;
  x.font = font; x.letterSpacing = `${tracking}px`;
  const ws = parts.map(([s]) => x.measureText(s).width), tw = ws.reduce((a, b) => a + b, 0);
  c.width = Math.ceil(tw + pad * 2); c.height = Math.ceil(size * 1.42 + pad * 2);
  x.font = font; x.letterSpacing = `${tracking}px`; x.textBaseline = 'middle';
  if (shadow) { x.shadowColor = `rgba(0,0,0,${shadow})`; x.shadowBlur = size * 0.3; x.shadowOffsetY = size * 0.05; }
  let px = pad; parts.forEach(([s, col], i) => { x.fillStyle = col; x.fillText(s, px, c.height / 2 + size * 0.04); px += ws[i]; });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(c.width, c.height), new THREE.MeshBasicMaterial({ map: canvasTex(c), transparent: true, depthTest: false, depthWrite: false, color: new THREE.Color(brightness, brightness, brightness) }));
  m.userData = { w: c.width, h: c.height, pad }; m.renderOrder = 10;
  return m;
}
// TikTok-style highlight caption: dark text on a yellow bar that wipes in from the left
function highlight(text, { size = 42, family = 'Unbounded', weight = 800, padX = 30, padY = 16, tracking = 1.5, bg = '#f6c443', fg = '#0b1424' } = {}) {
  const c = document.createElement('canvas'); const x = c.getContext('2d');
  const font = `${weight} ${size}px "${family}", "Arial Black", sans-serif`;
  x.font = font; x.letterSpacing = `${tracking}px`;
  const tw = x.measureText(text).width, w = Math.ceil(tw + padX * 2), h = Math.ceil(size * 1.25 + padY * 2);
  c.width = w + 24; c.height = h + 24;
  x.fillStyle = 'rgba(0,0,0,0.28)'; x.beginPath(); x.roundRect(12, 18, w, h, 16); x.fill();
  x.fillStyle = bg; x.beginPath(); x.roundRect(12, 12, w, h, 16); x.fill();
  x.font = font; x.letterSpacing = `${tracking}px`; x.textBaseline = 'middle'; x.fillStyle = fg; x.fillText(text, 12 + padX, 12 + h / 2 + size * 0.05);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(c.width, c.height), new THREE.ShaderMaterial({
    uniforms: { map: { value: canvasTex(c) }, wipe: { value: 1 }, opacity: { value: 1 }, shine: { value: -9 } }, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform float wipe, opacity, shine; varying vec2 vUv; void main(){ vec4 c = texture2D(map, vUv); float m = 1.0 - smoothstep(wipe - 0.02, wipe + 0.02, vUv.x);
      float s = vUv.x - shine + (vUv.y - 0.5) * 0.25; vec3 col = c.rgb * 0.95 + vec3(1.0, 0.98, 0.9) * exp(-s * s * 90.0) * 0.5 * smoothstep(0.6, 0.9, c.a) * smoothstep(0.3, 0.6, dot(c.rgb, vec3(0.3, 0.6, 0.1)));
      gl_FragColor = vec4(col, c.a * m * opacity); }`,
  }));
  m.userData = { w: c.width, h: c.height }; m.renderOrder = 10;
  return m;
}
function glassMaterial(w, h, { radius = 30, tint = '#0b1426', tintAmt = 0.5, border = 0.3, glow = 0 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { blurTex: GLASS.blurTex, res: GLASS.res, size: { value: new THREE.Vector2(w, h) }, radius: { value: radius }, tint: { value: lin(tint) }, tintAmt: { value: tintAmt },
      border: { value: border }, glow: { value: glow }, opacity: { value: 1 }, shine: { value: -9 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D blurTex; uniform vec2 res, size; uniform float radius, tintAmt, border, glow, opacity, shine; uniform vec3 tint; varying vec2 vUv;
      float sdb(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
      void main(){
        vec2 p = (vUv - 0.5) * size; float d = sdb(p, size * 0.5 - 2.0, radius);
        float a = 1.0 - smoothstep(-1.0, 1.0, d); if (a < 0.003) discard;
        vec3 bg = texture2D(blurTex, gl_FragCoord.xy / res).rgb;
        vec3 c = mix(bg * 1.1, tint, tintAmt) + vec3(0.035, 0.045, 0.065) * vUv.y;
        float rim = 1.0 - smoothstep(0.0, 1.8, abs(d + 1.0));
        c += vec3(1.0) * rim * border * (0.35 + 0.65 * vUv.y) + vec3(1.0, 0.75, 0.3) * rim * glow;
        float sh = vUv.x - shine + (vUv.y - 0.5) * 0.35; c += vec3(1.0, 0.95, 0.85) * exp(-sh * sh * 220.0) * 0.16;
        gl_FragColor = vec4(c, a * opacity);
      }`,
    transparent: true, depthTest: false, depthWrite: false,
  });
}
function shadowMesh(w, h, r, k = 0.38) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w + 140, h + 140), new THREE.ShaderMaterial({
    uniforms: { size: { value: new THREE.Vector2(w, h) }, r: { value: r }, opacity: { value: 1 }, k: { value: k } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec2 size; uniform float r, opacity, k; varying vec2 vP; float sdb(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
      void main(){ float d = sdb(vP + vec2(0.0, 16.0), size * 0.5, r); gl_FragColor = vec4(0.0, 0.0, 0.0, k * opacity * (1.0 - smoothstep(-12.0, 52.0, d))); }`,
    transparent: true, depthTest: false, depthWrite: false,
  }));
}
function chip(parts, { size = 44, weight = 700, family = 'Manrope', icon = null, iconColor = '#f6c443', padX = 34, padY = 22, radius = null, minW = 0, tint, tintAmt, glow = 0, border = 0.3 } = {}) {
  if (typeof parts === 'string') parts = [[parts, '#ffffff']];
  const c = document.createElement('canvas'); const x = c.getContext('2d');
  const font = `${weight} ${size}px "${family}", "Arial", sans-serif`;
  x.font = font;
  const ws = parts.map(([s]) => x.measureText(s).width), tw = ws.reduce((a, b) => a + b, 0);
  const iw = icon ? size * 1.05 : 0, gap = icon ? size * 0.42 : 0;
  const w = Math.ceil(Math.max(minW, tw + iw + gap + padX * 2)), h = Math.ceil(size * 1.3 + padY * 2);
  c.width = w; c.height = h; x.font = font; x.textBaseline = 'middle';
  let px = (w - (tw + iw + gap)) / 2;
  if (icon) { drawIcon(x, icon, px + iw / 2, h / 2, iw, iconColor); px += iw + gap; }
  parts.forEach(([s, col], i) => { x.fillStyle = col; x.fillText(s, px, h / 2 + size * 0.05); px += ws[i]; });
  const g = new THREE.Group(), rr = radius ?? h / 2;
  const sh = shadowMesh(w, h, rr); sh.renderOrder = 7; g.add(sh);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMaterial(w, h, { radius: rr, tint, tintAmt, glow, border })); panel.renderOrder = 8; g.add(panel);
  const content = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: canvasTex(c), transparent: true, depthTest: false, depthWrite: false, color: new THREE.Color(0.95, 0.95, 0.95) }));
  content.renderOrder = 9; g.add(content);
  g.userData = { w, h, panel };
  return g;
}
// photo sticker: white border, rounded corners, soft shadow
function sticker(map, w, h, crop = [0, 0, 1, 1], border = 14) {
  const g = new THREE.Group();
  const sh = shadowMesh(w, h, 30, 0.5); sh.renderOrder = 7; g.add(sh);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, size: { value: new THREE.Vector2(w, h) }, crop: { value: new THREE.Vector4(...crop) }, border: { value: border }, opacity: { value: 1 } },
    transparent: true, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform vec2 size; uniform vec4 crop; uniform float border, opacity; varying vec2 vUv;
      float sdb(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
      void main(){ vec2 p = (vUv - 0.5) * size; float a = 1.0 - smoothstep(-1.0, 1.0, sdb(p, size * 0.5, 30.0)); if (a < 0.003) discard;
        float pin = 1.0 - smoothstep(-1.0, 1.0, sdb(p, size * 0.5 - border, 30.0 - border * 0.6));
        vec2 uv = mix(crop.xy, crop.zw, (p + size * 0.5 - border) / (size - 2.0 * border));
        vec3 ph = texture2D(map, uv).rgb; ph = (ph - 0.5) * 1.06 + 0.52;
        gl_FragColor = vec4(mix(vec3(0.97), ph, pin), a * opacity); }`,
  })); m.renderOrder = 8; g.add(m);
  g.userData = { w, h };
  return g;
}
const px2o = (x, y) => [x - W / 2, H / 2 - y];
function place(m, x, y, a = 1, dy = 0, s = 1, rot = 0) {
  const [ox, oy] = px2o(x, y + dy); m.position.set(ox, oy, 0); m.scale.setScalar(s); m.rotation.z = rot; m.visible = a > 0.003;
  m.traverse(o => { if (o.material) { if (o.material.uniforms && o.material.uniforms.opacity) o.material.uniforms.opacity.value = a; else o.material.opacity = a; } });
}
function revealChip(g, x, y, t, t0, dur = 0.45, out = 1e9) {
  const k = seg(t, t0, t0 + dur), a = smooth(seg(t, t0, t0 + dur * 0.5)) * (1 - smooth(seg(t, out, out + 0.3)));
  place(g, x, y, a, (1 - easeOut(k)) * 30, lerp(0.86, 1, easeOutBack(k, 2.2)));
}
function lineMesh(color = GOLD, thick = 3) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, thick), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.3), transparent: true, depthTest: false }));
  m.geometry.translate(0.5, 0, 0); m.renderOrder = 6; return m;
}
function setLine(m, x0, y0, x1, y1, prog = 1, a = 1) {
  const [ax, ay] = px2o(x0, y0), [bx, by] = px2o(x1, y1);
  m.position.set(ax, ay, 0); m.rotation.z = Math.atan2(by - ay, bx - ax); m.scale.x = Math.max(0.001, Math.hypot(bx - ax, by - ay) * prog);
  m.material.opacity = a; m.visible = a > 0.003 && prog > 0.002;
}
function project(v3, cam) { const p = v3.clone().project(cam); return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H, p.z]; }
// world point on the plane z = zPlane seen at screen pixel (sx, sy), and its distance along the view axis
const _p = new THREE.Vector3(), _f = new THREE.Vector3();
function onScreenAt(cam, sx, sy, zPlane) {
  cam.updateMatrixWorld();
  _p.set(sx / W * 2 - 1, 1 - sy / H * 2, 0.5).unproject(cam).sub(cam.position).normalize();
  const k = (zPlane - cam.position.z) / _p.z, pos = cam.position.clone().addScaledVector(_p, k);
  cam.getWorldDirection(_f);
  return { pos, dist: pos.clone().sub(cam.position).dot(_f) };
}
const frameWidthAt = (cam, dist) => 2 * dist * Math.tan(deg(cam.fov) / 2) * cam.aspect;

// ---------------------------------------------------------------- 3D text
let FONTS = {};
function text3D(str, font, { size = 1, depth = 0.12, bevel = 0.01, mat, tracking = 0 } = {}) {
  const g = new THREE.Group(); const res = font.data.resolution, glyphs = font.data.glyphs;
  let x = 0; const letters = [];
  for (const ch of str) {
    const gl = glyphs[ch] || glyphs['?']; const adv = (gl ? gl.ha : res * 0.3) / res * size;
    if (ch !== ' ') {
      const geo = new TextGeometry(ch, { font, size, height: depth, curveSegments: 10, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 3 });
      geo.computeBoundingBox(); const bb = geo.boundingBox; const cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2;
      geo.translate(-cx, -cy, -depth / 2);
      const m = new THREE.Mesh(geo, mat.clone()); m.material.transparent = true;
      m.userData.home = new THREE.Vector3(x + cx, cy, 0); g.add(m); letters.push(m);
    }
    x += adv + tracking;
  }
  const width = x - tracking;
  letters.forEach(m => { m.userData.home.x -= width / 2; m.position.copy(m.userData.home); });
  g.userData = { letters, width };
  return g;
}
function setOpacity(group, a) { group.traverse(o => { if (o.material) o.material.opacity = a; }); group.visible = a > 0.003; }
function animLetters(group, t, t0, stagger, dur, from, mul = 1) {
  group.userData.letters.forEach((m, i) => {
    const k = seg(t, t0 + i * stagger, t0 + i * stagger + dur), e = easeOutBack(k), ea = easeOut(k), h = m.userData.home;
    m.position.set(h.x + (from.x || 0) * (1 - ea), h.y + (from.y || 0) * (1 - ea), h.z + (from.z || 0) * (1 - ea));
    m.rotation.set((from.rx || 0) * (1 - e), (from.ry || 0) * (1 - e), 0);
    m.scale.setScalar(lerp(from.s || 1, 1, ea));
    m.material.opacity = smooth(seg(t, t0 + i * stagger, t0 + i * stagger + dur * 0.45)) * mul;
    m.visible = m.material.opacity > 0.003;
  });
}
// a 3D word with a soft dark shadow behind it (reads on bright skies)
function bigWord(str, mat, font, { halo = 0 } = {}) {
  const g = new THREE.Group();
  const word = text3D(str, font, { size: 1, depth: 0.18, bevel: 0.012, mat });
  const sh = text3D(str, font, { size: 1, depth: 0.01, bevel: 0, mat: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true }) });
  sh.position.set(0.02, -0.04, -0.25); g.add(sh); g.add(word);
  g.userData = { word, sh, width: word.userData.width, halo: null, haloAmt: halo };
  if (halo) {
    const hm = new THREE.Mesh(new THREE.PlaneGeometry(word.userData.width * 1.25, 2.0), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { opacity: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float opacity; varying vec2 vUv; void main(){ vec2 d = (vUv - 0.5) * 2.0; float a = max(exp(-dot(d, d) * 2.4) - 0.0082, 0.0); gl_FragColor = vec4(0.0, 0.0, 0.0, a * opacity); }` }));
    hm.position.set(0, 0.4, -0.6); g.add(hm); g.userData.halo = hm;
  }
  return g;
}
// a glint sweeping across 3D letters: a screen-space band added inside their own shader
function addSheen(groups) {
  const u = { pos: { value: -9 }, amt: { value: 0 } };
  for (const grp of groups) grp.traverse(o => {
    if (!o.isMesh) return;
    o.material.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { sheenPos: u.pos, sheenAmt: u.amt, sheenRes: GLASS.res });
      sh.fragmentShader = 'uniform float sheenPos, sheenAmt; uniform vec2 sheenRes;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
        'float sq = gl_FragCoord.x / sheenRes.x + gl_FragCoord.y / sheenRes.y * 0.32;\n  outgoingLight += vec3(1.0, 0.95, 0.85) * exp(-pow((sq - sheenPos) / 0.05, 2.0)) * sheenAmt;\n#include <opaque_fragment>');
    };
  });
  return (t, t0, dur = 0.55) => { const k = seg(t, t0, t0 + dur); u.pos.value = lerp(-0.25, 1.6, k); u.amt.value = k > 0 && k < 1 ? 1.1 : 0; };
}

// ---------------------------------------------------------------- depth-displaced photo (3D photo)
function depthPhoto(map, depth, { fovV, aspect, near, far, gamma = 0.8, sx = 256, sy = 256 }) {
  const geo = new THREE.BufferGeometry(); const pos = [], uv = [], idx = [], tf = Math.tan(fovV / 2);
  const zOf = d => Math.exp(lerp(Math.log(far), Math.log(near), Math.pow(clamp(d), gamma)));
  for (let j = 0; j <= sy; j++) for (let i = 0; i <= sx; i++) {
    const u = i / sx, v = j / sy, z = zOf(sample(depth, u, 1 - v));
    pos.push((u - 0.5) * 2 * tf * aspect * z, (v - 0.5) * 2 * tf * z, -z); uv.push(u, v);
  }
  for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) { const a = j * (sx + 1) + i, b = a + 1, c = a + sx + 1, d = c + 1; idx.push(a, b, d, a, d, c); }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, exposure: { value: 1 }, haze: { value: new THREE.Color(0.8, 0.7, 0.6) }, hazeAmt: { value: 0 }, hazeFar: { value: far } },
    vertexShader: `varying vec2 vUv; varying float vD; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vD = distance(w.xyz, cameraPosition); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D map; uniform float exposure, hazeAmt, hazeFar; uniform vec3 haze; varying vec2 vUv; varying float vD;
      void main(){ vec3 c = texture2D(map, vUv).rgb * exposure; c = mix(c, haze, smoothstep(hazeFar * 0.12, hazeFar, vD) * hazeAmt); gl_FragColor = vec4(c, 1.0); }`,
  });
  return new THREE.Mesh(geo, mat);
}
function photoPlane(map, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, exposure: { value: opts.exposure ?? 1 }, tint: { value: new THREE.Color(...(opts.tint || [1, 1, 1])) }, haze: { value: new THREE.Color(...(opts.haze || [0.7, 0.78, 0.88])) },
      hazeAmt: { value: opts.hazeAmt ?? 0 }, topFade: { value: opts.topFade ?? 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform float exposure, hazeAmt, topFade; uniform vec3 tint, haze; varying vec2 vUv;
      void main(){ vec4 c = texture2D(map, vUv); vec3 col = mix(c.rgb * tint * exposure, haze, hazeAmt); float a = c.a; if (topFade > 0.0) a *= 1.0 - smoothstep(1.0 - topFade, 1.0, vUv.y); gl_FragColor = vec4(col, a); }`,
    transparent: !!opts.transparent, depthWrite: !opts.transparent,
  });
}

// ---------------------------------------------------------------- the car: photo body with normal-mapped reflections + real 3D wheels
let CAR, TX;
const PX_M = 5.1 / 905;
function carBodyMaterial({ env = 0, tint = [1.03, 1.0, 0.98], exposure = 1.05, refl = 1, mirror = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: TX.car }, nmap: { value: TX.carN }, mmap: { value: TX.carM }, pano: { value: TX.bg2far }, envMode: { value: env }, carX: { value: 0 },
      refl: { value: refl }, exposure: { value: exposure }, tint: { value: new THREE.Color(...tint) }, fade: { value: 1 }, mirror: { value: mirror ? 1 : 0 },
      studioRot: { value: 0 }, studioAmt: { value: 1 }, ground: { value: new THREE.Color(0.035, 0.04, 0.03) }, outline: { value: 0 },
      texel: { value: new THREE.Vector2(1 / CAR.size[0], 1 / CAR.size[1]) },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vWP, vTx, vTy, vTz; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz;
      vTx = mat3(modelMatrix) * vec3(1.0, 0.0, 0.0); vTy = mat3(modelMatrix) * vec3(0.0, 1.0, 0.0); vTz = mat3(modelMatrix) * vec3(0.0, 0.0, 1.0);
      gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map, nmap, mmap, pano; uniform float envMode, carX, refl, exposure, fade, mirror, studioRot, studioAmt, outline; uniform vec3 tint, ground; uniform vec2 texel;
      varying vec2 vUv; varying vec3 vWP, vTx, vTy, vTz;
      vec3 skyEnv(vec3 R){ float e = asin(clamp(R.y, -1.0, 1.0)), az = atan(R.x, -R.z);
        vec3 sky = texture2D(pano, vec2(fract(0.5 + az / 1.7 + carX * 0.0016), clamp(0.12 + e / 0.32, 0.05, 0.97))).rgb;
        return mix(ground * (0.6 + 0.4 * smoothstep(-0.5, 0.0, e)), sky, smoothstep(-0.02, 0.03, e)); }
      vec3 studioEnv(vec3 R){ float e = asin(clamp(R.y, -1.0, 1.0)), az = atan(R.x, -R.z) + studioRot;
        float top = smoothstep(0.32, 0.42, e) * (1.0 - smoothstep(1.15, 1.35, e)) * smoothstep(1.0, 0.75, abs(az));
        float s1 = smoothstep(0.06, 0.025, abs(az - 1.05)) * smoothstep(-0.15, 0.05, e) * (1.0 - smoothstep(0.65, 0.85, e));
        float s2 = smoothstep(0.06, 0.025, abs(az + 1.3)) * smoothstep(-0.15, 0.05, e) * (1.0 - smoothstep(0.65, 0.85, e));
        return vec3(0.01, 0.014, 0.026) + (vec3(1.0, 0.97, 0.92) * (top * 2.0 + (s1 + s2) * 1.5) + vec3(0.95, 0.72, 0.42) * exp(-pow(e / 0.06, 2.0)) * 0.3) * studioAmt; }
      void main(){
        vec4 c = texture2D(map, vUv);
        float ol = 0.0;
        if (outline > 0.001) {   // sticker-style white outline around the silhouette
          float m = 0.0;
          for (int i = 0; i < 12; i++) { float an = float(i) * 0.5236; m = max(m, texture2D(map, vUv + vec2(cos(an), sin(an)) * texel * 9.0).a); }
          ol = smoothstep(0.3, 0.6, m) * (1.0 - smoothstep(0.2, 0.6, c.a)) * outline;
        }
        if (c.a < 0.01 && ol < 0.01) discard;
        vec3 n = texture2D(nmap, vUv).xyz * 2.0 - 1.0;
        vec3 N = normalize(n.x * vTx + n.y * vTy + n.z * vTz), V = normalize(cameraPosition - vWP), Rv = reflect(-V, N);
        vec3 mm = texture2D(mmap, vUv).rgb;
        vec3 env = envMode < 0.5 ? skyEnv(Rv) : studioEnv(Rv);
        float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0), yy = 1.0 - vUv.y;
        vec3 col = c.rgb * tint * exposure * mix(1.07, 0.85, smoothstep(0.15, 0.95, yy));
        col += env * mm.r * refl * (mm.g > 0.5 ? 1.3 : 1.0) * (0.05 + 0.85 * fres);
        col = mix(col, vec3(1.15), ol);
        float a = max(c.a, ol) * fade; if (mirror > 0.5) a *= 0.3 * smoothstep(0.45, 1.0, yy);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
  });
}
const WM = {};
function wheelMaterials() {
  if (WM.rim) return WM;
  WM.rim = new THREE.MeshStandardMaterial({ color: 0xc6cbd3, metalness: 0.92, roughness: 0.27, envMapIntensity: 1.0 });
  WM.dark = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.6, roughness: 0.5 });
  WM.rubber = new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0.0, roughness: 0.82 });
  WM.chrome = new THREE.MeshStandardMaterial({ color: 0xe8ebef, metalness: 1.0, roughness: 0.12 });
  return WM;
}
function makeWheel() {
  const M = wheelMaterials();
  const Rt = 0.352, Rr = 0.262, Wt = 0.215, zf = Wt / 2;
  const g = new THREE.Group(), spin = new THREE.Group(); g.add(spin);
  const prof = new THREE.SplineCurve([[Rr - 0.004, -zf * 0.85], [Rr + 0.03, -zf * 0.98], [Rt - 0.03, -zf], [Rt - 0.004, -zf * 0.6], [Rt, 0], [Rt - 0.004, zf * 0.6], [Rt - 0.03, zf],
    [Rr + 0.03, zf * 0.98], [Rr - 0.004, zf * 0.85]].map(([r, z]) => new THREE.Vector2(r, z))).getPoints(48);
  const tire = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), M.rubber); tire.geometry.rotateX(Math.PI / 2); spin.add(tire);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(Rr - 0.01, Rr - 0.01, Wt * 0.8, 64, 1, true), M.dark); barrel.geometry.rotateX(Math.PI / 2); spin.add(barrel);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 48), M.dark); disc.geometry.rotateX(Math.PI / 2); disc.position.z = -0.02; g.add(disc);
  const shapes = [];
  const hub = new THREE.Shape(); hub.absarc(0, 0, 0.088, 0, Math.PI * 2, false); shapes.push(hub);
  for (let i = 0; i < 10; i++) for (const s of [-1, 1]) {
    const a = i * Math.PI / 5 + s * deg(4.4), d = [Math.cos(a), Math.sin(a)], n = [-Math.sin(a), Math.cos(a)];
    const r0 = 0.07, r1 = Rr - 0.014, w0 = 0.0125, w1 = 0.0078;
    const sh = new THREE.Shape();
    sh.moveTo(d[0] * r0 + n[0] * w0, d[1] * r0 + n[1] * w0); sh.lineTo(d[0] * r1 + n[0] * w1, d[1] * r1 + n[1] * w1);
    sh.lineTo(d[0] * r1 - n[0] * w1, d[1] * r1 - n[1] * w1); sh.lineTo(d[0] * r0 - n[0] * w0, d[1] * r0 - n[1] * w0); sh.lineTo(d[0] * r0 + n[0] * w0, d[1] * r0 + n[1] * w0);
    shapes.push(sh);
  }
  const ring = new THREE.Shape(); ring.absarc(0, 0, Rr - 0.003, 0, Math.PI * 2, false);
  const hole = new THREE.Path(); hole.absarc(0, 0, Rr - 0.024, 0, Math.PI * 2, true); ring.holes.push(hole); shapes.push(ring);
  const spokes = new THREE.Mesh(new THREE.ExtrudeGeometry(shapes, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.0035, bevelSegments: 2, curveSegments: 40 }), M.rim);
  spokes.position.z = zf * 0.45; spin.add(spokes);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.046, 0.022, 40), M.chrome); cap.geometry.rotateX(Math.PI / 2); cap.position.z = zf * 0.45 + 0.035; spin.add(cap);
  const emblem = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0035, 8, 40), M.dark); emblem.scale.y = 0.72; emblem.position.z = zf * 0.45 + 0.047; spin.add(emblem);
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5 + deg(18);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.016, 6), M.chrome); nut.geometry.rotateX(Math.PI / 2);
    nut.position.set(Math.cos(a) * 0.06, Math.sin(a) * 0.06, zf * 0.45 + 0.03); spin.add(nut);
  }
  const blur = new THREE.Mesh(new THREE.CircleGeometry(Rr - 0.004, 64), new THREE.ShaderMaterial({
    uniforms: { amt: { value: 0 } }, transparent: true, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float amt; varying vec2 vUv; void main(){ vec2 p = (vUv - 0.5) * 2.0; float r = length(p);
      vec3 metal = vec3(0.5, 0.52, 0.56), gap = vec3(0.03, 0.03, 0.035); vec3 c = r < 0.34 ? metal : (r < 0.91 ? mix(gap, metal, 0.4) : metal * 1.1);
      c *= 0.68 + 0.5 * (p.y * 0.5 + 0.5); c *= 0.94 + 0.06 * sin(r * 140.0);
      gl_FragColor = vec4(c, amt * smoothstep(1.0, 0.96, r) * (r < 0.34 ? 0.55 : 0.85)); }`,
  }));
  blur.position.z = zf * 0.45 + 0.055; blur.renderOrder = 4; g.add(blur);
  return { g, spin, blur, R: Rt };
}
function makeCar({ env = 0, tint, exposure, refl = 1, shadow = 0.8, mirror = false } = {}) {
  const [pw, ph] = CAR.size, cw = pw * PX_M, ch = ph * PX_M;
  const tb = CAR.wheels.reduce((a, w) => a + w.y + w.tire, 0) / CAR.wheels.length;
  const mid = (CAR.wheels[0].x + CAR.wheels[1].x) / 2;
  const toLocal = (x, y) => [(x - mid) * PX_M, (tb - y) * PX_M];
  const g = new THREE.Group(), bodyG = new THREE.Group(); g.add(bodyG);
  const body = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), carBodyMaterial({ env, tint, exposure, refl, mirror }));
  const [bx, by] = toLocal(pw / 2, ph / 2); body.position.set(bx, by, 0); body.renderOrder = 2; bodyG.add(body);
  const wheels = CAR.wheels.map(w => {
    const [wx, wy] = toLocal(w.x, w.y);
    const wh = makeWheel(); wh.g.position.set(wx, wy, 0.0);
    const s = (w.tire * PX_M + 0.004) / wh.R; wh.g.scale.set(s * w.rx / w.ry, s, s);
    g.add(wh.g); return wh;
  });
  const shMat = new THREE.ShaderMaterial({
    uniforms: { k: { value: shadow }, w0: { value: toLocal(CAR.wheels[0].x, 0)[0] }, w1: { value: toLocal(CAR.wheels[1].x, 0)[0] } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float k, w0, w1; varying vec2 vP; void main(){ float body = exp(-(pow(vP.x / 3.0, 2.0) + pow(vP.y / 0.95, 2.0)) * 2.2);
      float c = exp(-(pow((vP.x - w0) / 0.42, 2.0) + pow(vP.y / 0.28, 2.0)) * 3.0) + exp(-(pow((vP.x - w1) / 0.42, 2.0) + pow(vP.y / 0.28, 2.0)) * 3.0);
      gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(body * 0.8 + c, 0.0, 1.0) * k); }`,
    transparent: true, depthWrite: false,
  });
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 2.6), shMat); sh.rotation.x = -Math.PI / 2; sh.position.set(0, 0.004, -0.2); sh.renderOrder = 1; g.add(sh);
  g.userData = { body, bodyG, wheels, toLocal, cw, ch };
  return g;
}
function driveCar(car, dist, speed, t, { cap = 6.0, sway = 1 } = {}) {
  const { wheels, body, bodyG } = car.userData;
  for (const w of wheels) {
    const omega = Math.abs(speed) / w.R, k = omega > cap ? cap / omega : 1;
    w.spin.rotation.z = -(dist / w.R) * k;
    w.blur.material.uniforms.amt.value = smooth(seg(omega, 4, 14)) * 0.5;
  }
  body.material.uniforms.carX.value = dist;
  const sp = clamp(Math.abs(speed) / 10) * sway;
  bodyG.position.y = (Math.sin(t * 7.1) * 0.0035 + Math.sin(t * 11.3 + 1.2) * 0.002) * sp;
  bodyG.rotation.z = Math.sin(t * 2.3 + 0.4) * 0.0012 * sp;
}

// ---------------------------------------------------------------- particles (bokeh dust)
function dust(n, box, seed, { color = '#ffd88a', size = 0.06, opacity = 0.7 } = {}) {
  const r = rng(seed), pos = new Float32Array(n * 3), ph = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = lerp(box[0], box[1], r()); pos[i * 3 + 1] = lerp(box[2], box[3], r()); pos[i * 3 + 2] = lerp(box[4], box[5], r()); ph[i] = r() * 100; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('ph', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, col: { value: new THREE.Color(color) }, size: { value: size * RH }, opacity: { value: opacity } },
    vertexShader: `uniform float time, size; attribute float ph; varying float vA; void main(){ vec3 p = position + vec3(sin(time * 0.3 + ph) * 0.25, sin(time * 0.21 + ph * 1.7) * 0.18, cos(time * 0.17 + ph) * 0.25);
      vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size / -mv.z * (0.6 + 0.4 * fract(ph)); vA = 0.55 + 0.45 * sin(time * 1.3 + ph * 3.0); }`,
    fragmentShader: `uniform vec3 col; uniform float opacity; varying float vA; void main(){ float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)); gl_FragColor = vec4(col * 1.4, a * vA * opacity); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}
let PMREM, SKY_ENV;

// ================================================================= SHOT A: hook — the title slams onto Issyk-Kul
function shotA(depthAerial) {
  const scene = new THREE.Scene(), overlay = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 8000);
  scene.environment = PMREM; scene.userData.bg = new THREE.Color(0.42, 0.48, 0.58);
  const aerial = depthPhoto(TX.aerial, depthAerial, { fovV: deg(52), aspect: 4 / 3, near: 26, far: 2400, gamma: 0.75, sx: 288, sy: 216 });
  aerial.material.uniforms.haze.value.set(0.86, 0.72, 0.58); aerial.material.uniforms.hazeAmt.value = 0.3;
  aerial.rotation.x = deg(-2); scene.add(aerial);
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f6fa, metalness: 0.05, roughness: 0.5, envMapIntensity: 0.55, emissive: 0xffffff, emissiveIntensity: 0.12 });
  const title = bigWord('ТРАНСФЕР', white, FONTS.oswald); scene.add(title);
  const key = new THREE.DirectionalLight(0xffe6c4, 1.5); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fbcff, 0.7); fill.position.set(3, 1, -4); scene.add(fill);
  scene.add(new THREE.AmbientLight(0x8090b0, 0.45));
  const motes = dust(200, [-7, 7, -6, 4, -24, -2], 7, { size: 0.05, opacity: 0.5 }); scene.add(motes);
  const sub = highlight('ПО КЫРГЫЗСТАНУ', { size: 50, padX: 34, padY: 18 }); overlay.add(sub);
  const q = new THREE.Quaternion(), off = new THREE.Vector3(), eu = new THREE.Euler();
  function update(t) {
    const ease = 1 - Math.exp(-t * 1.25), fly = smoother(seg(t, 2.4, 3.7));
    cam.position.set(0.15 * t, -(0.9 * ease + 0.12 * t + 1.4 * fly), -(7.2 * ease + 0.5 * t + 6.5 * fly));
    cam.rotation.order = 'YXZ'; cam.rotation.y = deg(-3 * smooth(seg(t, 1.5, 3.7))); cam.rotation.x = deg(lerp(-2, -8, smoother(seg(t, 0, 3.7))));
    cam.updateMatrixWorld();
    aerial.material.uniforms.exposure.value = lerp(0.6, 1.0, smooth(seg(t, 0.2, 1.4)));
    // the title rides with the camera (always readable), then the camera flies through it into the whip
    const zRel = -9.5 + 10.5 * smoother(seg(t, 2.6, 3.35));
    off.set(0, 1.25, zRel).applyQuaternion(cam.quaternion); title.position.copy(cam.position).add(off);
    title.quaternion.copy(cam.quaternion).multiply(q.setFromEuler(eu.set(Math.sin(t * 0.7) * 0.03, Math.sin(t * 0.55) * 0.05, 0)));
    title.scale.setScalar((0.88 * frameWidthAt(cam, 9.5)) / title.userData.width);
    animLetters(title.userData.word, t, 0.3, 0.022, 0.32, { y: 0.35, z: 3.0, rx: -0.9, s: 1.4 });
    animLetters(title.userData.sh, t, 0.3, 0.022, 0.32, { y: 0.35, z: 3.0, rx: -0.9, s: 1.4 }, 0.4);
    title.visible = true;
    const k = seg(t, 0.8, 1.1);
    place(sub, W / 2, 890, smooth(seg(t, 0.8, 0.9)) * (1 - smooth(seg(t, 2.75, 3.05))), (1 - easeOut(k)) * 12);
    sub.material.uniforms.wipe.value = easeOut(k) * 1.05;
    sub.material.uniforms.shine.value = lerp(-0.4, 1.4, seg(t, 1.2, 1.7));
    key.position.set(Math.sin(t * 0.6) * 3 - 1.5, 3, 4);
    motes.material.uniforms.time.value = t;
  }
  const dof = () => ({ focus: 9.5, aperture: 0.012 });
  return { scene, overlay, cam, update, dof };
}

// ================================================================= SHOT B: road — speed ramp + giant words behind the car
function shotB(layers) {
  const scene = new THREE.Scene(), overlay = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 9000);
  scene.environment = SKY_ENV; scene.userData.bg = new THREE.Color(0.4, 0.55, 0.72);
  const hazeCol = [0.74, 0.8, 0.86];
  const vB = t => t < 3.9 ? 22 : t < 4.55 ? lerp(22, 3.2, smoother(seg(t, 3.9, 4.55))) : t < 7.9 ? 3.2 : lerp(3.2, 26, smoother(seg(t, 7.9, 8.7)));
  const carX = integrate(2.6, 10.6, vB);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vP; void main(){ float h = normalize(vP).y; gl_FragColor = vec4(mix(vec3(0.40, 0.55, 0.72), vec3(0.055, 0.22, 0.52), smoothstep(0.0, 0.42, h)), 1.0); }` }));
  sky.renderOrder = -3; scene.add(sky);
  const Pv = new THREE.Vector3(0, 1.25, 7.0), vf = deg(20), asp = layers.W / layers.H, yaw0 = deg(5);
  const pitch = Math.atan((2 * layers.waterline - 1) * Math.tan(vf / 2)) - Math.atan(1.25 / 420);
  function layer(map, D, r0, r1, transparent, topFade = 0) {
    const hh = D * Math.tan(vf / 2), hw = hh * asp, yT = hh - r0 * 2 * hh, yB = hh - r1 * 2 * hh;
    const g = new THREE.PlaneGeometry(2 * hw, yT - yB); g.translate(0, (yT + yB) / 2, 0);
    const m = new THREE.Mesh(g, photoPlane(map, { transparent, topFade, exposure: 1.02, tint: [1.02, 1.0, 0.97], haze: hazeCol, hazeAmt: D > 1000 ? 0.12 : 0.06 }));
    const dir = new THREE.Vector3(Math.sin(yaw0) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw0) * Math.cos(pitch));
    m.position.copy(Pv).addScaledVector(dir, D); m.lookAt(Pv); return m;
  }
  const far = layer(TX.bg2far, 3000, layers.far[0], layers.far[1], true, 0.16); far.renderOrder = -2; scene.add(far);
  const nearL = layer(TX.bg2near, 420, layers.near[0], layers.near[1], true); nearL.renderOrder = -1; scene.add(nearL);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 470), new THREE.ShaderMaterial({
    uniforms: { map: { value: TX.water }, haze: { value: new THREE.Color(...hazeCol) }, time: { value: 0 } },
    vertexShader: `varying vec3 wp; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); wp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 haze; uniform float time; varying vec3 wp;
      void main(){ vec2 uv = vec2(wp.x / 70.0 + time * 0.012, -wp.z / 26.0 + time * 0.03); uv = 1.0 - abs(1.0 - mod(uv, 2.0));
        vec3 c = texture2D(map, uv).rgb * 1.05; c = mix(c, haze * vec3(0.92, 0.97, 1.0), smoothstep(30.0, 430.0, distance(wp, cameraPosition)) * 0.55); gl_FragColor = vec4(c, 1.0); }`,
  }));
  water.rotation.x = -Math.PI / 2; water.position.set(300, -0.02, -241); scene.add(water);
  const GLSL_NOISE = `float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
    float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.03 + 1.7; a *= 0.5; } return v; }`;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(1200, 11.2), new THREE.ShaderMaterial({
    uniforms: { haze: { value: new THREE.Color(...hazeCol) } },
    vertexShader: `varying vec3 wp; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); wp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: GLSL_NOISE + `uniform vec3 haze; varying vec3 wp;
      void main(){ float z = wp.z, az = abs(z), x = wp.x; float n1 = fbm(wp.xz * 7.0), n2 = fbm(wp.xz * 0.4);
        vec3 asphalt = mix(vec3(0.058, 0.057, 0.056), vec3(0.105, 0.1, 0.095), n1 * 0.75 + n2 * 0.25);
        vec3 gravel = mix(vec3(0.14, 0.12, 0.09), vec3(0.3, 0.26, 0.2), fbm(wp.xz * 9.0)), sand = mix(vec3(0.33, 0.27, 0.19), vec3(0.5, 0.42, 0.3), fbm(wp.xz * 5.0));
        vec3 c = mix(asphalt, gravel, smoothstep(3.72, 3.95, az + (n1 - 0.5) * 0.12)); if (z < -4.7) c = mix(c, sand, smoothstep(-4.7, -5.2, z));
        float fw = fwidth(z) * 1.2 + 0.003, edge = 1.0 - smoothstep(0.075 - fw, 0.075 + fw, abs(az - 3.5));
        float centre = (1.0 - smoothstep(0.06 - fw, 0.06 + fw, az)) * (1.0 - smoothstep(2.9, 3.1, mod(x, 12.0)));
        c = mix(c, vec3(0.76, 0.75, 0.7), max(edge, centre) * 0.86); c = mix(c, haze, smoothstep(80.0, 700.0, distance(wp, cameraPosition)) * 0.5);
        gl_FragColor = vec4(c * vec3(1.06, 1.02, 0.96), 1.0); }`,
  }));
  road.rotation.x = -Math.PI / 2; road.position.set(300, 0, -0.4); scene.add(road);
  const verge = new THREE.Mesh(new THREE.PlaneGeometry(1200, 40), new THREE.ShaderMaterial({
    vertexShader: `varying vec3 wp; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); wp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: GLSL_NOISE + `varying vec3 wp; void main(){ float n = fbm(wp.xz * 3.0); vec3 c = mix(vec3(0.03, 0.025, 0.01), vec3(0.12, 0.09, 0.035), n * n * 1.4);
      c = mix(c, vec3(0.12, 0.105, 0.075), smoothstep(5.5, 5.2, wp.z)); c *= mix(1.0, 0.5, smoothstep(7.0, 13.0, wp.z)); gl_FragColor = vec4(c, 1.0); }`,
  }));
  verge.rotation.x = -Math.PI / 2; verge.position.set(300, -0.005, 25.2); scene.add(verge);
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.008, 0, 0, 0.008, 0, 0, 0.002, 1, 0], 3));
  blade.setAttribute('color', new THREE.Float32BufferAttribute([0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 1, 1, 1], 3));
  const NG = 52000, grass = new THREE.InstancedMesh(blade, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), NG);
  const r = rng(11), m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  for (let i = 0; i < NG; i++) {
    const x = lerp(-30, 220, r()), z = lerp(5.25, 12.8, r()), near = smooth((z - 8.5) / 2.5);
    const hgt = lerp(lerp(0.05, 0.2, r()), lerp(0.16, 0.44, r()), near);
    e.set(lerp(-0.22, 0.22, r()), r() * Math.PI, lerp(-0.3, 0.3, r())); qq.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, 0, z), qq, new THREE.Vector3(1 + near * 1.4, hgt, 1)); grass.setMatrixAt(i, m4);
    const k = r(), dim = lerp(1, 0.55, near); col.setRGB(lerp(0.2, 0.6, k) * dim, lerp(0.13, 0.38, k) * dim, lerp(0.03, 0.08, k) * dim); grass.setColorAt(i, col);
  }
  scene.add(grass);
  for (let x = 14; x < 220; x += 42) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.05, 0.11), new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.5 })); p.position.set(x, 0.52, 4.55);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.22, 0.115), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 })); band.position.y = 0.3; p.add(band);
    const refl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 0.85, 0.2) })); refl.position.y = 0.3; p.add(refl);
    scene.add(p);
  }
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a4030, 0.6));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.6); sun.position.set(-40, 60, 50); scene.add(sun);
  const car = makeCar({ env: 0, refl: 1.0 }); car.position.set(0, 0, 1.75); scene.add(car);
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f6fa, metalness: 0.05, roughness: 0.5, envMapIntensity: 0.5, emissive: 0xffffff, emissiveIntensity: 0.5 });
  const gold = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.5, roughness: 0.42, envMapIntensity: 0.6, emissive: GOLD, emissiveIntensity: 0.42 });
  if (!RENDER) {   // live playback has no lens blur: soften the foreground grass with the blurred frame instead
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(W, 780), new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false,
      uniforms: { blurTex: GLASS.blurTex, res: GLASS.res },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D blurTex; uniform vec2 res; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(blurTex, gl_FragCoord.xy / res).rgb, smoothstep(1.0, 0.72, vUv.y)); }` }));
    fg.position.set(0, -H / 2 + 390, 0); fg.renderOrder = 0; overlay.add(fg);
  }
  const words = [['КОМФОРТ', white, 4.45, 5.55], ['БЕЗОПАСНОСТЬ', gold, 5.55, 6.65], ['НАДЁЖНОСТЬ', white, 6.65, 8.45]].map(([s, m, t0, t1]) => {
    const g = bigWord(s, m, FONTS.oswald, { halo: 0.34 }); g.userData.t0 = t0; g.userData.t1 = t1; scene.add(g); return g;
  });
  const camA = [-1.4, 0.95, 15.2, 0.1, 1.3], camB = [0.6, 0.85, 14.0, 0.3, 1.12];
  const camRel = t => lerpV(camA, camB, smoother(seg(t, 2.85, 9.95)));
  function camPose(t) { const [dx, y, z, lx, ly] = camRel(t), cx = carX(t); return { pos: new THREE.Vector3(cx + dx, y, z), target: new THREE.Vector3(cx + lx, ly, 1.75) }; }
  const q = new THREE.Quaternion(), eu = new THREE.Euler();
  function update(t) {
    const cx = carX(t); car.position.x = cx; driveCar(car, cx, vB(t), t, { cap: 5.5 });
    const { pos, target } = camPose(t); cam.position.copy(pos); cam.lookAt(target); cam.updateMatrixWorld();
    water.material.uniforms.time.value = t;
    for (const g of words) {
      const { t0, t1 } = g.userData, last = t1 > 8;
      const a = smooth(seg(t, t0, t0 + 0.1)) * (1 - smooth(seg(t, t1 - 0.12, t1)));
      if (a <= 0.003) { g.visible = false; continue; }
      const { pos: p, dist } = onScreenAt(cam, W / 2, 800, -16);
      g.position.copy(p); g.quaternion.copy(cam.quaternion).multiply(q.setFromEuler(eu.set(0, Math.sin(t * 0.8) * 0.04, 0)));
      const punch = lerp(1.32, 1, easeOut(seg(t, t0, t0 + 0.22))) * (last ? lerp(1, 1.6, smooth(seg(t, t1 - 0.5, t1))) : lerp(1, 0.9, seg(t, t1 - 0.12, t1)));
      g.scale.setScalar(0.88 * frameWidthAt(cam, dist) / g.userData.width * punch);
      g.visible = true; setOpacity(g.userData.word, a); setOpacity(g.userData.sh, a * 0.58); g.userData.halo.material.uniforms.opacity.value = a * g.userData.haloAmt;
    }
  }
  const dof = t => { const { pos } = camPose(t); return { focus: pos.z - 1.75, aperture: 0.016 }; };
  return { scene, overlay, cam, update, dof, glass: !RENDER, carX, vB, car };
}

// ================================================================= SHOT C: the cabin as quick stickers around a big "7 МЕСТ"
function shotC() {
  const scene = new THREE.Scene(), overlay = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, W / H, 0.05, 200);
  scene.environment = PMREM; scene.userData.bg = new THREE.Color(0, 0, 0);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vP; void main(){ vec3 d = normalize(vP); float r = length(d.xy);
      vec3 c = mix(vec3(0.03, 0.05, 0.11), vec3(0.004, 0.006, 0.014), smoothstep(0.0, 0.7, r));
      c += vec3(0.5, 0.33, 0.12) * 0.12 * exp(-pow((d.y + 0.05) / 0.25, 2.0)) * exp(-pow(d.x / 0.45, 2.0));
      gl_FragColor = vec4(c, 1.0); }` })));
  const motes = dust(140, [-4, 4, -5, 5, -14, -3], 23, { color: '#ffd38a', size: 0.16, opacity: 0.45 }); scene.add(motes);
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f6fa, metalness: 0.05, roughness: 0.45, envMapIntensity: 0.7, emissive: 0xffffff, emissiveIntensity: 0.15 });
  const gold = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.75, roughness: 0.32, envMapIntensity: 1.0, emissive: GOLD, emissiveIntensity: 0.15 });
  scene.add(new THREE.AmbientLight(0x8899bb, 0.5)); const kl = new THREE.DirectionalLight(0xffffff, 1.4); kl.position.set(-2, 3, 4); scene.add(kl);
  const group = new THREE.Group(); group.position.set(0, -0.15, -6); scene.add(group);
  const mest = text3D('МЕСТ', FONTS.oswald, { size: 1, depth: 0.2, bevel: 0.014, mat: white });
  const digits = [...'1234567'].map(d => text3D(d, FONTS.oswald, { size: 1.15, depth: 0.24, bevel: 0.016, mat: gold }));
  const dW = digits[6].userData.width, gap = 0.22, total = dW + gap + mest.userData.width;
  digits.forEach(d => { d.position.x = -total / 2 + dW / 2; d.position.y = 0.075; group.add(d); });
  mest.position.x = total / 2 - mest.userData.width / 2; group.add(mest);
  const glint7 = addSheen(digits);
  const s1 = sticker(TX.seatsV, 390, 488, [0.0, 0.08, 1.0, 0.94]), s2 = sticker(TX.seatsW, 560, 330);
  const salon = chip([['Просторный салон', '#ffffff']], { size: 46, weight: 700, padX: 36 });
  overlay.add(s1, s2, salon);
  function update(t) {
    const k = smoother(seg(t, 9.25, 12.6));
    cam.position.set(lerp(0.15, -0.15, k), lerp(0.1, -0.05, k), lerp(0.6, 0.0, k)); cam.lookAt(0, -0.1, -6);
    group.scale.setScalar(0.86 * frameWidthAt(cam, 6) / total);
    const cnt = Math.min(6, Math.max(0, Math.floor((t - 9.95) / 0.095)));
    digits.forEach((d, i) => { const on = i === cnt && t >= 9.95; setOpacity(d, on ? 1 : 0); });
    digits[6].scale.setScalar(t >= 10.62 ? lerp(1.35, 1, easeOutBack(seg(t, 10.62, 10.9), 2)) : 1);
    const dk = seg(t, 9.95, 10.1); digits.forEach(d => { if (d !== digits[6]) d.scale.setScalar(lerp(1.25, 1, dk)); });
    const mk = seg(t, 10.62, 10.85); setOpacity(mest, t >= 10.62 ? smooth(mk) : 0); mest.position.y = lerp(-0.4, 0, easeOut(mk));
    group.rotation.y = Math.sin(t * 0.9) * 0.08; group.rotation.x = Math.sin(t * 0.7) * 0.04;
    const p1 = seg(t, 10.0, 10.38), p2 = seg(t, 10.28, 10.66);
    place(s1, 262, 395 + Math.sin(t * 1.3) * 6, smooth(seg(t, 10.0, 10.1)), 0, lerp(0.3, 1, easeOutBack(p1, 2.4)), deg(lerp(-19, -7, easeOut(p1)) + Math.sin(t * 1.1) * 1.2));
    place(s2, 770, 1505 + Math.sin(t * 1.2 + 1) * 6, smooth(seg(t, 10.28, 10.38)), 0, lerp(0.3, 1, easeOutBack(p2, 2.4)), deg(lerp(17, 6, easeOut(p2)) + Math.sin(t * 1.0 + 2) * 1.2));
    revealChip(salon, W / 2, 1160, t, 10.78);
    glint7(t, 10.95, 0.5);
    motes.material.uniforms.time.value = t;
  }
  const dof = () => ({ focus: 6.1, aperture: 0.05 });
  return { scene, overlay, cam, update, dof, glass: true };
}

// ================================================================= SHOT D: real-relief map of Kyrgyzstan with routes
function shotD(geo, relief, rmeta) {
  const scene = new THREE.Scene(), overlay = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, W / H, 0.05, 200);
  scene.environment = PMREM; scene.userData.bg = new THREE.Color(0.006, 0.01, 0.022);
  const HS = 0.000046;
  const RWd = rmeta.w, RHd = rmeta.h, alt = new Float32Array(RWd * RHd);
  for (let i = 0; i < alt.length; i++) alt[i] = relief.data[i * 4] * 256 + relief.data[i * 4 + 1] - 500;
  const altAt = (x, y) => {
    const u = (x - rmeta.x0) / (rmeta.x1 - rmeta.x0) * (RWd - 1), v = (rmeta.y1 - y) / (rmeta.y1 - rmeta.y0) * (RHd - 1);
    const i0 = clamp(Math.floor(u), 0, RWd - 2), j0 = clamp(Math.floor(v), 0, RHd - 2), fu = clamp(u - i0), fv = clamp(v - j0);
    return lerp(lerp(alt[j0 * RWd + i0], alt[j0 * RWd + i0 + 1], fu), lerp(alt[(j0 + 1) * RWd + i0], alt[(j0 + 1) * RWd + i0 + 1], fu), fv);
  };
  const mc = document.createElement('canvas'); mc.width = RWd; mc.height = RHd; const mx = mc.getContext('2d', { willReadFrequently: true });
  const toM = ([x, y]) => [(x - rmeta.x0) / (rmeta.x1 - rmeta.x0) * (RWd - 1), (rmeta.y1 - y) / (rmeta.y1 - rmeta.y0) * (RHd - 1)];
  mx.fillStyle = '#000'; mx.fillRect(0, 0, RWd, RHd); mx.filter = 'blur(1.2px)'; mx.fillStyle = '#fff';
  mx.beginPath(); geo.country.forEach((p, i) => { const [a, b] = toM(p); i ? mx.lineTo(a, b) : mx.moveTo(a, b); }); mx.closePath(); mx.fill();
  const inside = mx.getImageData(0, 0, RWd, RHd).data;
  const pos = new Float32Array(RWd * RHd * 3), colA = new Float32Array(RWd * RHd * 4), idx = new Uint32Array((RWd - 1) * (RHd - 1) * 6);
  const ramp = [[0, '#0a1630'], [900, '#10244a'], [1800, '#1a355f'], [2900, '#2b4a78'], [3900, '#53709d'], [4700, '#8ca2c2'], [6000, '#d6e0ee']].map(([h, c]) => [h, lin(c)]);
  const tmpC = new THREE.Color();
  const rampAt = h => { for (let i = 1; i < ramp.length; i++) if (h <= ramp[i][0]) return tmpC.copy(ramp[i - 1][1]).lerp(ramp[i][1], (h - ramp[i - 1][0]) / (ramp[i][0] - ramp[i - 1][0])); return tmpC.copy(ramp[ramp.length - 1][1]); };
  for (let j = 0; j < RHd; j++) for (let i = 0; i < RWd; i++) {
    const k = j * RWd + i, x = lerp(rmeta.x0, rmeta.x1, i / (RWd - 1)), y = lerp(rmeta.y1, rmeta.y0, j / (RHd - 1));
    const h = Math.max(alt[k], 300), ins = inside[k * 4] / 255;
    pos[k * 3] = x; pos[k * 3 + 1] = h * HS; pos[k * 3 + 2] = -y;
    const c = rampAt(h), l = (c.r + c.g + c.b) / 3, f = lerp(0.2, 1, ins), sat = lerp(0.4, 1, ins);
    colA[k * 4] = lerp(l, c.r, sat) * f; colA[k * 4 + 1] = lerp(l, c.g, sat) * f; colA[k * 4 + 2] = lerp(l, c.b, sat) * f;
    colA[k * 4 + 3] = clamp(Math.min(i, RWd - 1 - i, j, RHd - 1 - j) / 36);
  }
  let o = 0; for (let j = 0; j < RHd - 1; j++) for (let i = 0; i < RWd - 1; i++) { const a = j * RWd + i, b = a + 1, c = a + RWd, d = c + 1; idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d; }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('color', new THREE.BufferAttribute(colA, 4)); tg.setIndex(new THREE.BufferAttribute(idx, 1)); tg.computeVertexNormals();
  scene.add(new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0.0, transparent: true })));
  const sunL = new THREE.DirectionalLight(0xfff1dc, 1.75); sunL.position.set(-6, 3.2, -4.5); scene.add(sunL);
  scene.add(new THREE.HemisphereLight(0x8fb0e0, 0x05070c, 0.5));
  const lake = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(geo.lake.map(([x, y]) => new THREE.Vector2(x, y)))), new THREE.MeshPhysicalMaterial({ color: lin('#1c6fe0'), emissive: lin('#0a3a9a'), emissiveIntensity: 0.55, roughness: 0.12, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.2 }));
  lake.rotation.x = -Math.PI / 2; lake.position.y = 1607 * HS + 0.004; scene.add(lake);
  const bpts = geo.country.map(([x, y]) => new THREE.Vector3(x, altAt(x, y) * HS + 0.012, -y));
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bpts, true), 2400, 0.0085, 5, true), new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(2.2) })));
  const C = geo.cities;
  const at = (name, lift = 0.06) => new THREE.Vector3(C[name][0], altAt(C[name][0], C[name][1]) * HS + lift, -C[name][1]);
  const pinMat = new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(2.1) }), pinW = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.7, 1.8) });
  function pin(name, big) {
    const g = new THREE.Group(); g.position.copy(at(name));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(big ? 0.042 : 0.028, 20, 12), big ? pinMat : pinW));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.062, 48), new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(1.8), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -0.045; g.add(ring); g.userData.ring = ring; scene.add(g); return g;
  }
  const home = pin('Бишкек', true);
  const T0 = 12.85, STEP = 0.27;
  const D = [['Аэропорт «Манас»', -170, -150, 'plane'], ['Ала-Арча', -200, 110, 'pin'], ['Чон-Курчак', 120, 175, 'pin'], ['Иссык-Куль', 30, -120, 'pin'],
    ['Каракол', 20, 120, 'pin'], ['Токтогул', -40, -120, 'pin'], ['Джалал-Абад', -210, 40, 'pin'], ['Ош', 60, 115, 'pin']].map(([name, dx, dy, icon], i) => {
    const a = at('Бишкек'), b = at(name), dist = a.distanceTo(b), mid = a.clone().lerp(b, 0.5); mid.y += 0.2 + 0.16 * dist;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.0095, 6, false), new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(2.4) })); scene.add(tube);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.6) })); scene.add(head);
    const p = pin(name, false);
    const lab = chip([[name, '#ffffff']], { size: 36, weight: 700, padX: 24, padY: 13, icon }); overlay.add(lab);
    const ll = lineMesh(new THREE.Color(1, 1, 1), 2); overlay.add(ll);
    return { name, t0: T0 + i * STEP, dx, dy, curve, tube, head, p, lab, ll, n: tube.geometry.index.count };
  });
  const homeLab = chip([['Бишкек', '#0b1424']], { size: 38, weight: 800, padX: 26, padY: 14, tint: '#f6c443', tintAmt: 0.92, border: 0.2 }); overlay.add(homeLab);
  const title = highlight('ПОПУЛЯРНЫЕ НАПРАВЛЕНИЯ', { size: 34, padX: 26, padY: 14 });
  const sub = textMesh('Из Бишкека — по всему Кыргызстану', { size: 36, weight: 600 });
  overlay.add(title, sub);
  const c0 = at('Бишкек', 0), cMid = new THREE.Vector3(0.55, 0.1, -0.62);
  let focusScreen = [0.5, 0.5];
  function camPose(t) {
    const k = smoother(seg(t, 11.8, 17.45)), tgt = c0.clone().lerp(cMid, smoother(seg(t, 12.1, 15.6)));
    const rad = lerp(6.0, 11.2, smoother(seg(t, 12.2, 15.8))), yaw = deg(lerp(-10, 5, k)), pitch = deg(lerp(62, 55, k));
    return { pos: new THREE.Vector3(tgt.x + rad * Math.cos(pitch) * Math.sin(yaw), tgt.y + rad * Math.sin(pitch), tgt.z + rad * Math.cos(pitch) * Math.cos(yaw)), tgt };
  }
  function update(t) {
    const { pos, tgt } = camPose(t); cam.position.copy(pos); cam.lookAt(tgt); cam.updateMatrixWorld();
    home.scale.setScalar(Math.max(0.001, easeOutBack(seg(t, 12.5, 12.9))));
    const ph = (t * 0.9) % 1; home.userData.ring.scale.setScalar(1 + ph * 2.5); home.userData.ring.material.opacity = (1 - ph) * seg(t, 12.5, 12.9);
    for (const d of D) {
      const pr = easeInOut(seg(t, d.t0, d.t0 + 0.55));
      d.tube.geometry.setDrawRange(0, Math.floor(d.n * pr / 6) * 6); d.tube.visible = pr > 0;
      d.head.position.copy(d.curve.getPoint(pr)); d.head.visible = pr > 0.001 && pr < 0.999;
      const arr = seg(t, d.t0 + 0.5, d.t0 + 0.8); d.p.scale.setScalar(Math.max(0.001, easeOutBack(arr)));
      const q = ((t - d.t0) * 0.8) % 1; d.p.userData.ring.scale.setScalar(1 + q * 2); d.p.userData.ring.material.opacity = (1 - q) * 0.6 * arr;
      const [sx, sy] = project(d.p.position, cam), hw = d.lab.userData.w / 2, hh = d.lab.userData.h / 2;
      const lx = clamp(sx + d.dx, hw + 24, W - hw - 24), ly = sy + d.dy, la = seg(t, d.t0 + 0.58, d.t0 + 0.85), side = Math.abs(d.dx) > 100;
      setLine(d.ll, sx, sy, side ? lx - Math.sign(d.dx) * (hw - 10) : lx, side ? ly : ly + (d.dy < 0 ? hh - 6 : -hh + 6), easeInOut(la), la * 0.7);
      revealChip(d.lab, lx, ly, t, d.t0 + 0.58, 0.4);
    }
    const [hx, hy] = project(home.position, cam);
    revealChip(homeLab, hx, hy - 70, t, 12.6, 0.4);
    const tk = seg(t, 12.35, 12.65); title.material.uniforms.wipe.value = easeOut(tk) * 1.05;
    place(title, W / 2, 250, smooth(seg(t, 12.35, 12.45)), (1 - easeOut(tk)) * 14);
    title.material.uniforms.wipe.value = easeOut(tk) * 1.05;
    place(sub, W / 2, 330, smooth(seg(t, 12.55, 12.95)), (1 - easeOut(seg(t, 12.55, 13.0))) * 18);
    title.material.uniforms.shine.value = lerp(-0.4, 1.4, seg(t, 13.0, 13.5));
    focusScreen = [hx / W, 1 - hy / H];
  }
  const dof = t => { const { pos, tgt } = camPose(t); return { focus: pos.distanceTo(tgt), aperture: 0.07 }; };
  return { scene, overlay, cam, update, dof, glass: true, focusScreen: () => focusScreen };
}

// ================================================================= SHOT E: finale — hard stop, giant word behind the car, call to action
function shotE() {
  const scene = new THREE.Scene(), overlay = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(38, W / H, 0.05, 1000);
  scene.environment = PMREM; scene.userData.bg = new THREE.Color(0, 0, 0);
  const V3 = (...a) => ({ value: new THREE.Vector3(...a) });
  const skyM = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    uniforms: { cLow: V3(0.004, 0.006, 0.012), cHigh: V3(0.002, 0.003, 0.006), cGlow: V3(0.42, 0.26, 0.1), gAmt: { value: 0.2 }, gH: { value: 0.2 }, gW: { value: 0.16 },
      cNavy: V3(0.08, 0.12, 0.24), nAmt: { value: 0.35 } },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 cLow, cHigh, cGlow, cNavy; uniform float gAmt, gH, gW, nAmt; varying vec3 vP; void main(){ vec3 d = normalize(vP); float h = d.y, az = atan(d.x, -d.z);
      vec3 c = mix(cLow, cHigh, smoothstep(0.0, 0.5, h));
      c += cGlow * gAmt * exp(-pow(az / 0.6, 2.0)) * exp(-pow((h - gH) / gW, 2.0)) * smoothstep(0.0, 0.12, h);
      c += cNavy * nAmt * exp(-pow(az / 1.2, 2.0)) * exp(-pow((h - 0.25) / 0.3, 2.0));
      gl_FragColor = vec4(c, 1.0); }` }));
  scene.add(skyM);
  const car = makeCar({ env: 1, tint: [1.0, 1.0, 1.02], exposure: 1.0, refl: 1.0, shadow: 0.95 }); scene.add(car);
  const mir = makeCar({ env: 1, tint: [1.0, 1.0, 1.02], exposure: 1.0, refl: 0.8, shadow: 0, mirror: true }); mir.scale.y = -1; scene.add(mir);
  mir.userData.body.renderOrder = -1;
  mir.traverse(o => { if (o.isMesh && o !== mir.userData.body && o.material && !o.material.uniforms) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.1; o.renderOrder = -1; } });
  mir.userData.wheels.forEach(w => { w.blur.visible = false; });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
    uniforms: { fNear: V3(0.02, 0.018, 0.02), fFar: V3(0.004, 0.006, 0.012), fA0: { value: 0.62 }, fA1: { value: 0.985 } },
    vertexShader: `varying vec3 wp; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); wp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 fNear, fFar; uniform float fA0, fA1; varying vec3 wp; void main(){ float r = length(wp.xz * vec2(0.6, 1.0)); vec3 c = mix(fNear, fFar, smoothstep(1.5, 14.0, r));
      gl_FragColor = vec4(c, mix(fA0, fA1, smoothstep(0.8, 9.0, r))); }` }));
  floor.rotation.x = -Math.PI / 2; floor.renderOrder = 0; scene.add(floor);
  const motes = dust(160, [-6, 6, 0.3, 6, -8, 2], 41, { color: '#ffcf86', size: 0.04, opacity: 0.4 }); scene.add(motes);
  scene.add(new THREE.AmbientLight(0x8899bb, 0.45)); const kl = new THREE.DirectionalLight(0xffffff, 1.3); kl.position.set(-2, 4, 6); scene.add(kl);
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f6fa, metalness: 0.05, roughness: 0.45, envMapIntensity: 0.6, emissive: 0xffffff, emissiveIntensity: 0.06 });
  const big = bigWord('ТРАНСФЕР', white, FONTS.oswald); scene.add(big);
  const sub = highlight('ПО КЫРГЫЗСТАНУ', { size: 46, padX: 32, padY: 16 });
  const feats = [
    chip([['7 мест', '#ffffff']], { size: 40, weight: 700, icon: 'seat', minW: 456 }),
    chip([['Багажный бокс', '#ffffff']], { size: 40, weight: 700, icon: 'bag', minW: 456 }),
    chip([['Аэропорт и вокзал', '#ffffff']], { size: 40, weight: 700, icon: 'plane', minW: 456 }),
    chip([['24/7 на связи', '#ffffff']], { size: 40, weight: 700, icon: 'clock', minW: 456 }),
  ];
  const ctaW = 940, ctaH = 236, cta = new THREE.Group();
  const ctaSh = shadowMesh(ctaW, ctaH, 46); ctaSh.renderOrder = 7; cta.add(ctaSh);
  const ctaPanel = new THREE.Mesh(new THREE.PlaneGeometry(ctaW, ctaH), glassMaterial(ctaW, ctaH, { radius: 46, tintAmt: 0.62, border: 0.35 })); ctaPanel.renderOrder = 8; cta.add(ctaPanel);
  const cc = document.createElement('canvas'); cc.width = ctaW; cc.height = ctaH; const cx2 = cc.getContext('2d');
  drawIcon(cx2, 'chat', 112, ctaH / 2, 120, '#25d366');
  cx2.textBaseline = 'middle'; cx2.fillStyle = 'rgba(255,255,255,0.78)'; cx2.font = '600 34px "Manrope", Arial, sans-serif'; cx2.fillText('Звоните или пишите в WhatsApp', 206, 78);
  cx2.fillStyle = '#ffffff'; cx2.font = '800 76px "Unbounded", "Arial Black", sans-serif'; cx2.letterSpacing = '1px'; cx2.fillText('0556 07 07 21', 202, 156);
  const ctaContent = new THREE.Mesh(new THREE.PlaneGeometry(ctaW, ctaH), new THREE.MeshBasicMaterial({ map: canvasTex(cc), transparent: true, depthTest: false, depthWrite: false, color: new THREE.Color(0.95, 0.95, 0.95) }));
  ctaContent.renderOrder = 9; cta.add(ctaContent);
  const pulse = new THREE.Mesh(new THREE.RingGeometry(58, 64, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.0, 0.5), transparent: true, depthTest: false })); pulse.renderOrder = 10;
  const foot = textMesh([['Бишкек', '#ffffff'], ['  →  ', '#f6c443'], ['по всему Кыргызстану', '#ffffff']], { size: 32, weight: 600, brightness: 0.8 });
  overlay.add(sub, ...feats, cta, pulse, foot);
  const X0 = -10, ARR0 = 16.65, ARR1 = 18.3;
  const carXAt = t => X0 * Math.pow(1 - seg(t, ARR0, ARR1), 2.6);
  function update(t) {
    const x = carXAt(t), sp = (carXAt(t + 0.01) - carXAt(t - 0.01)) / 0.02;
    car.position.x = x; mir.position.x = x;
    driveCar(car, x, sp, t, { cap: 7, sway: 0.4 }); driveCar(mir, x, sp, t, { cap: 7, sway: 0.4 });
    const dip = t < ARR1 ? -0.011 * smooth(seg(t, 17.6, ARR1)) : -0.011 * Math.exp(-(t - ARR1) * 4.5) * Math.cos((t - ARR1) * 11);
    car.userData.bodyG.rotation.z += dip; mir.userData.bodyG.rotation.z += dip;
    car.userData.body.material.uniforms.outline.value = smooth(seg(t, 18.32, 18.42)) * (1 - smooth(seg(t, 18.5, 18.85)));
    for (const c of [car, mir]) c.userData.body.material.uniforms.studioRot.value = lerp(-0.9, 0.7, smoother(seg(t, 17.0, 22.5)));
    const k = smoother(seg(t, 16.55, T_END));
    cam.position.set(lerp(-0.3, 0.2, k), 1.08, lerp(15.0, 14.2, k)); cam.lookAt(0, 0.45, 0); cam.updateMatrixWorld();
    // giant word stands behind the car; the car partly covers it
    const ba = smooth(seg(t, 17.45, 17.58));
    if (ba > 0.003) {
      const { pos: p, dist } = onScreenAt(cam, W / 2, 610, -2.6);
      big.position.copy(p); big.quaternion.copy(cam.quaternion);
      big.scale.setScalar(0.92 * frameWidthAt(cam, dist) / big.userData.width * lerp(1.3, 1, easeOut(seg(t, 17.45, 17.7))));
      setOpacity(big.userData.word, ba); setOpacity(big.userData.sh, ba * 0.35); big.visible = true;
    } else big.visible = false;
    if (STILL && STILL.noWord) big.visible = false;
    const sk = seg(t, 17.9, 18.2);
    place(sub, W / 2, 1150, smooth(seg(t, 17.9, 18.0)), (1 - easeOut(sk)) * 12); sub.material.uniforms.wipe.value = easeOut(sk) * 1.05;
    sub.material.uniforms.shine.value = lerp(-0.4, 1.4, t < 21 ? seg(t, 18.35, 18.85) : seg(t, 22.3, 22.8));
    const gx = [W / 2 - 236, W / 2 + 236], gy = [1268, 1376];
    feats.forEach((f, i) => revealChip(f, gx[i % 2], gy[i >> 1], t, 18.7 + i * 0.15));
    revealChip(cta, W / 2, 1565, t, 19.45, 0.5);
    ctaPanel.material.uniforms.glow.value = t > 19.9 ? 0.16 + 0.2 * Math.pow(0.5 + 0.5 * Math.sin((t - 19.9) * 3.4), 2) : 0;
    ctaPanel.material.uniforms.shine.value = t > 20.2 ? lerp(-0.3, 1.3, ((t - 20.2) % 1.8) / 0.8) : -9;
    const pp = t > 19.9 ? ((t - 19.9) % 1.25) / 1.25 : 0;
    place(pulse, W / 2 - ctaW / 2 + 112, 1565, t > 19.9 ? (1 - pp) * 0.7 : 0, 0, 1 + pp * 0.9);
    place(foot, W / 2, 1745, smooth(seg(t, 19.95, 20.35)) * 0.9, (1 - easeOut(seg(t, 19.95, 20.4))) * 14);
    motes.material.uniforms.time.value = t;
  }
  const dof = () => ({ focus: 14.4, aperture: 0.02 });
  return { scene, overlay, cam, update, dof, glass: true, car, sky: skyM, floor, motes, big };
}

// ---------------------------------------------------------------- frame assembly
let SHOTS;
const tmpR = new THREE.Vector3(), tmpU = new THREE.Vector3();
function renderShot(shot, t, rt, s) {
  shot.update(t);
  const cam = shot.cam;
  if (STILL) {   // free camera; x of pos/target is relative to the car when STILL.rel
    const ox = STILL.rel && shot.car ? shot.car.position.x : 0;
    cam.fov = STILL.fov; cam.position.set(STILL.pos[0] + ox, STILL.pos[1], STILL.pos[2]); cam.lookAt(STILL.target[0] + ox, STILL.target[1], STILL.target[2]);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    if (STILL.word && shot.big) {
      const { pos: p, dist } = onScreenAt(cam, W / 2, STILL.word.y, STILL.word.z);
      shot.big.position.copy(p); shot.big.quaternion.copy(cam.quaternion);
      shot.big.scale.setScalar(STILL.word.w * frameWidthAt(cam, dist) / shot.big.userData.width);
      shot.big.visible = true; setOpacity(shot.big.userData.word, 1); setOpacity(shot.big.userData.sh, STILL.word.sh ?? 0.35);
    }
  }
  if (s) {   // thin-lens depth of field + sub-pixel jitter
    let ox = s.jx, oy = s.jy;
    const d = STILL ? { focus: STILL.focus, aperture: STILL.aperture } : (shot.dof ? shot.dof(t) : null);
    if (d && d.aperture > 0) {
      cam.updateMatrixWorld();
      tmpR.setFromMatrixColumn(cam.matrixWorld, 0); tmpU.setFromMatrixColumn(cam.matrixWorld, 1);
      const ax = s.lx * d.aperture, ay = s.ly * d.aperture;
      cam.position.addScaledVector(tmpR, ax).addScaledVector(tmpU, ay); cam.updateMatrixWorld();
      const fpx = (RH / 2) / Math.tan(deg(cam.fov) / 2);
      ox -= ax / d.focus * fpx; oy += ay / d.focus * fpx;
    }
    cam.setViewOffset(RW, RH, ox, oy, RW, RH);
  }
  renderer.setRenderTarget(rt);
  renderer.setClearColor(shot.scene.userData.bg || 0x000000, 1); renderer.clear(true, true, true);
  renderer.render(shot.scene, cam);
  if (s) cam.clearViewOffset();
  if (shot.glass) { blurInto(rt.texture); renderer.setRenderTarget(rt); }
  renderer.clearDepth();
  if (!STILL) renderer.render(shot.overlay, ortho);
}
function activeAt(t) {
  for (let c = 0; c < CUTS.length; c++) { const cut = CUTS[c]; if (t >= cut.at - cut.dur / 2 && t < cut.at + cut.dur / 2) return { a: c, b: c + 1, p: (t - (cut.at - cut.dur / 2)) / cut.dur, cut }; }
  let i = 0; while (i < CUTS.length && t >= CUTS[i].at) i++;
  return { a: i, b: -1, p: 0, cut: null };
}
function subframe(t, s, weight) {
  const st = activeAt(t);
  renderShot(SHOTS[st.a], t, rtA, s);
  if (st.b >= 0) renderShot(SHOTS[st.b], t, rtB, s);
  const u = mixP.mat.uniforms;
  u.mode.value = st.cut ? st.cut.mode : 0; u.p.value = st.p; u.k.value = weight;
  if (st.cut && st.cut.focus) u.focus.value.set(...st.cut.focus);
  if (st.cut && st.cut.focusShot !== undefined) { const f = SHOTS[st.cut.focusShot].focusScreen(); u.focus.value.set(f[0], f[1]); }
  renderer.setRenderTarget(accRT); renderer.render(mixP.scene, ortho);
}
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
function pattern(n) {
  const out = [], perm = [...Array(n).keys()].sort((a, b) => halton(a + 1, 5) - halton(b + 1, 5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n), th = i * 2.399963;
    out.push({ dt: n > 1 ? ((perm[i] + 0.5) / n - 0.5) : 0, lx: r * Math.cos(th), ly: r * Math.sin(th), jx: halton(i + 1, 2) - 0.5, jy: halton(i + 1, 3) - 0.5 });
  }
  return out;
}
function renderFrame(t, n = 1, shutter = 0.5) {
  renderer.setRenderTarget(accRT); renderer.setClearColor(0x000000, 1); renderer.clear();
  for (const s of pattern(n)) subframe(clamp(t + s.dt * shutter / FPS, 0, T_END), n > 1 ? s : null, 1 / n);
  const f = fx(t), g = grade.uniforms;
  g.fade.value = smooth(seg(t, 0, 0.35)); g.punch.value = f.punch; g.shake.value.set(f.sx, f.sy); g.leak.value = f.leak; g.phase.value = f.phase; g.rgb.value = f.rgb;
  composer.render();
}

// mask mode: the car silhouette alone (white on black, linear coverage) for text-behind-car compositing
let MASK_BODY, MASK_SOLID, COPY;
function applyMask(S, on) {
  if (!MASK_BODY) {
    MASK_BODY = new THREE.ShaderMaterial({ uniforms: { map: { value: null }, carX: { value: 0 }, fade: { value: 1 }, outline: { value: 0 }, studioRot: { value: 0 }, studioAmt: { value: 1 }, refl: { value: 1 }, exposure: { value: 1 } }, transparent: true,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; void main(){ float a = texture2D(map, vUv).a; if (a < 0.01) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, a); }` });
    MASK_SOLID = new THREE.MeshBasicMaterial({ color: 0xffffff });
    COPY = fsPass(`uniform sampler2D src; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(src, vUv).rgb, 1.0); }`, { src: { value: null } });
  }
  if (on) {
    S._mask = [];
    S.scene.traverse(o => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) { S._mask.push([o, o.visible, o.material]); o.visible = false; } });
    S.car.traverse(o => {
      if (!o.isMesh) return;
      const u = o.material.uniforms;
      if (u && ((u.k && u.w0) || u.amt)) return;   // contact shadow, wheel motion-blur disc
      o.visible = true;
      if (u && u.nmap) { MASK_BODY.uniforms.map.value = u.map.value; o.material = MASK_BODY; } else o.material = MASK_SOLID;
    });
    S._bg = S.scene.userData.bg; S.scene.userData.bg = new THREE.Color(0, 0, 0);
  } else {
    for (const [o, v, m] of S._mask) { o.visible = v; o.material = m; }
    S.scene.userData.bg = S._bg;
  }
}
function renderStill({ shot, t, n = 64, shutter = 0.5, sky, floor, noMotes, bloom = 0.28, mask = false }) {
  BLOOM.strength = bloom;
  if (mask) applyMask(SHOTS[shot], true);
  const S = SHOTS[shot], setU = (m, o) => o && Object.entries(o).forEach(([k, v]) => { const u = m.material.uniforms[k]; if (Array.isArray(v)) u.value.set(...v); else u.value = v; });
  if (S.sky) setU(S.sky, sky); if (S.floor) setU(S.floor, floor); if (S.motes) S.motes.visible = !noMotes;
  renderer.setRenderTarget(accRT); renderer.setClearColor(0x000000, 1); renderer.clear();
  const u = mixP.mat.uniforms;
  for (const s of pattern(n)) {
    renderShot(SHOTS[shot], t + s.dt * shutter / FPS, rtA, n > 1 ? s : null);
    u.mode.value = 0; u.p.value = 0; u.k.value = 1 / n;
    renderer.setRenderTarget(accRT); renderer.render(mixP.scene, ortho);
  }
  if (mask) { applyMask(SHOTS[shot], false); COPY.mat.uniforms.src.value = accRT.texture; runPass(COPY, null); return; }
  const g = grade.uniforms;
  g.fade.value = 1; g.punch.value = 0; g.shake.value.set(0, 0); g.leak.value = 0; g.phase.value = 0; g.rgb.value = 0;
  composer.render();
}

// ---------------------------------------------------------------- boot
async function boot() {
  if (!RENDER) {
    const stage = document.getElementById('stage');
    const hPx = stage.getBoundingClientRect().height * Math.min(2, window.devicePixelRatio || 1);
    const q = clamp(hPx / H, 0.6, 1);
    RW = Math.round(W * q / 4) * 4; RH = Math.round(H * q / 4) * 4;
  } else { MSAA = 0; }
  canvas.width = RW; canvas.height = RH;
  setupPipeline();
  const pm = new THREE.PMREMGenerator(renderer); PMREM = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  await Promise.all(['900 50px Unbounded', '800 50px Unbounded', '700 50px Unbounded', '800 40px Manrope', '700 40px Manrope', '600 30px Manrope'].map(f => document.fonts.load(f))).catch(() => {});
  const fl = new FontLoader();
  const [car, kg, layers, rmeta, oswald, aerialPx, reliefPx, ...tex] = await Promise.all([
    loadJSON('assets/data/car.json'), loadJSON('assets/data/kg.json'), loadJSON('assets/data/bg2_layers.json'), loadJSON('assets/data/relief.json'),
    loadJSON('assets/fonts/Oswald-Bold.typeface.json'),
    loadPixels('assets/depth/aerial.png'), loadPixels('assets/data/relief.png'),
    loadTex('assets/img/aerial.jpg'), loadTex('assets/img/bg2_far.jpg'), loadTex('assets/img/bg2_near.png'), loadTex('assets/img/water2.jpg'),
    loadTex('assets/img/car.png'), loadTex('assets/img/car_normal.png', false), loadTex('assets/img/car_mat.png', false),
    loadTex('assets/img/seats_v.jpg'), loadTex('assets/img/seats_w.jpg'),
  ]);
  CAR = car;
  FONTS = { oswald: fl.parse(oswald) };
  const [aerial, bg2far, bg2near, water, carT, carN, carM, seatsV, seatsW] = tex;
  water.wrapS = water.wrapT = THREE.MirroredRepeatWrapping;
  TX = { aerial, bg2far, bg2near, water, car: carT, carN, carM, seatsV, seatsW };
  const skyTex = bg2far.clone(); skyTex.mapping = THREE.EquirectangularReflectionMapping; skyTex.needsUpdate = true;
  SKY_ENV = pm.fromEquirectangular(skyTex).texture;
  SHOTS = [shotA(gray(aerialPx)), shotB(layers), shotC(), shotD(kg, reliefPx, rmeta), shotE()];
  document.getElementById('loading').hidden = true;
  return true;
}

const ready = boot();
if (RENDER) {
  window.__api = { ready, T_END, still: async cfg => { await ready; STILL = cfg; renderStill(cfg); STILL = null; return canvas.toDataURL('image/png'); } };
} else {
  ready.then(() => {
    const veil = document.getElementById('veil'), btn = document.getElementById('play'), label = document.getElementById('playLabel'), audio = document.getElementById('music');
    renderFrame(1.6); veil.hidden = false;
    let playing = false, t0 = 0;
    const loop = () => {
      if (!playing) return;
      const t = audio && !audio.paused && audio.readyState > 2 ? audio.currentTime : (performance.now() - t0) / 1000;
      if (t >= T_END - 0.04) { playing = false; renderFrame(T_END - 0.04); label.textContent = 'Смотреть снова'; veil.hidden = false; return; }
      renderFrame(t); requestAnimationFrame(loop);
    };
    btn.addEventListener('click', () => {
      veil.hidden = true; playing = true; t0 = performance.now();
      try { audio.currentTime = 0; audio.play().catch(() => {}); } catch (e) { /* silent playback */ }
      requestAnimationFrame(loop);
    });
  }).catch(err => { document.getElementById('loading').textContent = 'Не удалось загрузить сцену: ' + err.message; });
}
