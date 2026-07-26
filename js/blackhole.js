/* ═══════════════════════════════════════════════════════════════════
   EVENT HORIZON — рендер чёрной дыры Шварцшильда в реальном времени.

   Лучи трассируются назад от камеры по нулевым геодезическим. В единицах
   rs = 1 (горизонт), M = 1/2, c = G = 1 уравнение орбиты фотона имеет вид

        d²u/dφ² + u = 3M·u²,     u = 1/r

   что в декартовых координатах эквивалентно центральному ускорению

        a⃗ = −3M·h²·r⃗ / r⁵ = −1.5·h²·r⃗ / r⁵,   h = |r⃗ × v⃗| = const.

   Отсюда «бесплатно» получаются: гравитационное линзирование, тень
   радиусом 2.6 rs, фотонное кольцо и задранный вверх дальний край диска.
   Никаких зависимостей, чистый WebGL 1.
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

var VERT = [
  'attribute vec2 aPos;',
  'void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }'
].join('\n');

var FRAG = [
'precision highp float;',

'uniform vec2  uRes;',
'uniform float uTime;',
'uniform float uDist;',      // расстояние камеры, в rs
'uniform float uIncl;        ', // наклон, рад
'uniform float uYaw;',
'uniform vec2  uOffset;',    // сдвиг центра композиции в экранных ед.
'uniform float uDisk;',      // яркость диска
'uniform float uLens;',      // 1 — искривлять лучи, 0 — прямые
'uniform float uDopp;',      // 1 — доплер + гравитационное смещение
'uniform float uSteps;',
'uniform float uFade;',      // общая экспозиция (для мягкого входа)

'#define MAXSTEPS 320',
'#define RIN  3.0',          // ISCO = 3 rs
'#define ROUT 11.0',
'#define PI 3.14159265',

/* ── шум ─────────────────────────────────────────────── */
'float hash13(vec3 p){',
'  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));',
'  p *= 17.0;',
'  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));',
'}',

'float vnoise(vec3 x){',
'  vec3 i = floor(x), f = fract(x);',
'  f = f * f * (3.0 - 2.0 * f);',
'  return mix(mix(mix(hash13(i + vec3(0.0,0.0,0.0)), hash13(i + vec3(1.0,0.0,0.0)), f.x),',
'                 mix(hash13(i + vec3(0.0,1.0,0.0)), hash13(i + vec3(1.0,1.0,0.0)), f.x), f.y),',
'             mix(mix(hash13(i + vec3(0.0,0.0,1.0)), hash13(i + vec3(1.0,0.0,1.0)), f.x),',
'                 mix(hash13(i + vec3(0.0,1.0,1.0)), hash13(i + vec3(1.0,1.0,1.0)), f.x), f.y), f.z);',
'}',

'float fbm(vec3 p){',
'  float a = 0.5, s = 0.0;',
'  for (int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.04; a *= 0.5; }',
'  return s;',
'}',

/* ── палитра теплового излучения ─────────────────────── */
'vec3 heat(float t){',
'  t = clamp(t, 0.0, 1.0);',
'  vec3 c;',
'  if (t < 0.25)      c = mix(vec3(0.36,0.045,0.008), vec3(0.95,0.30,0.03), t / 0.25);',
'  else if (t < 0.5)  c = mix(vec3(0.95,0.30,0.03),   vec3(1.00,0.62,0.16), (t - 0.25) / 0.25);',
'  else if (t < 0.75) c = mix(vec3(1.00,0.62,0.16),   vec3(1.00,0.90,0.68), (t - 0.5) / 0.25);',
'  else               c = mix(vec3(1.00,0.90,0.68),   vec3(0.80,0.90,1.00), (t - 0.75) / 0.25);',
'  return c;',
'}',

/* ── звёздное небо ───────────────────────────────────── */
'vec3 skyDome(vec3 d){',
'  vec3 col = vec3(0.0);',

// три слоя звёзд разной плотности
'  for (int L = 0; L < 3; L++){',
'    float fl = float(L);',
'    float scale = 78.0 + 128.0 * fl;',
'    vec3 p  = d * scale;',
'    vec3 id = floor(p);',
'    vec3 f  = fract(p) - 0.5;',
'    float h = hash13(id + fl * 19.7);',
'    if (h > 0.938){',
'      vec3 off = vec3(hash13(id + 3.1), hash13(id + 7.3), hash13(id + 11.9)) - 0.5;',
'      float dd = length(f - off * 0.62);',
'      float mag = 0.25 + 0.75 * pow(fract(h * 143.7), 4.0);',
'      float tw  = 0.65 + 0.35 * sin(uTime * (0.8 + 2.6 * fract(h * 57.3)) + h * 41.0);',
'      float s   = smoothstep(0.085, 0.0, dd) * mag * tw;',
'      float ct  = fract(h * 311.7);',
'      vec3  sc  = mix(vec3(0.68,0.80,1.00), vec3(1.00,0.84,0.62), ct);',
'      col += sc * s * (3.4 - 0.7 * fl);',
'    }',
'  }',

// полоса Млечного Пути + пыль
'  vec3 axis = normalize(vec3(0.34, 0.82, -0.46));',
'  float band = abs(dot(d, axis));',
'  float mw = exp(-band * band * 11.0);',
'  float dust = fbm(d * 5.5 + 3.0);',
'  float fine = fbm(d * 17.0);',
'  vec3 mwCol = mix(vec3(0.10,0.13,0.26), vec3(0.30,0.24,0.34), dust);',
'  col += mwCol * mw * (0.30 + 0.85 * fine) * 0.62;',

// далёкое диффузное свечение
'  col += vec3(0.014, 0.017, 0.030);',
'  return col;',
'}',

/* ── эмиссия аккреционного диска ─────────────────────── */
'vec3 diskEmission(vec3 hp, vec3 rayDir, out float opacity){',
'  float r = length(hp);',
'  opacity = 0.0;',
'  if (r < RIN || r > ROUT) return vec3(0.0);',

'  float phi = atan(hp.z, hp.x);',
// кеплеровская дифференциальная прокрутка: Ω ∝ r^-3/2
'  float spin = uTime * 1.25 * pow(r, -1.5) * 6.0;',
'  float a = phi + spin;',
'  vec2  q = vec2(cos(a), sin(a)) * r;',

'  float n1 = fbm(vec3(q * 0.85, r * 0.55));',
'  float n2 = fbm(vec3(q * 3.1,  r * 1.4 + 4.0));',
'  float turb = mix(n1, n2, 0.5);',
'  float streak = 0.55 + 0.45 * sin(a * 9.0 + r * 3.4 - uTime * 0.6);',
'  float dens = clamp((0.30 + 1.55 * turb) * (0.45 + 0.7 * streak), 0.0, 2.0);',

// профиль Шакуры—Сюняева: ноль на внутреннем крае, пик около 5 rs
'  float prof = pow(RIN / r, 2.55) * (1.0 - sqrt(RIN / r)) * 4.6;',
'  prof *= smoothstep(ROUT, ROUT * 0.62, r);',

// ── релятивистские поправки ──
'  float g = 1.0;',
'  if (uDopp > 0.5){',
'    vec3 vdir = normalize(cross(vec3(0.0, 1.0, 0.0), hp));',   // прямое вращение
'    float beta = sqrt(0.5 / max(r - 1.0, 0.35));',             // v = sqrt(M/(r-rs))
'    beta = min(beta, 0.92);',
'    float gam = 1.0 / sqrt(1.0 - beta * beta);',
'    vec3 toObs = normalize(-rayDir);',
'    float dop = 1.0 / (gam * (1.0 - beta * dot(vdir, toObs)));',
'    float grav = sqrt(max(1.0 - 1.0 / r, 0.02));',              // гравитационное красное смещение
'    g = clamp(dop * grav, 0.15, 3.4);',
'  } else {',
'    g = sqrt(max(1.0 - 1.0 / r, 0.02));',
'  }',

'  float tIdx = clamp(pow(RIN / r, 0.62) * 0.72 * pow(g, 0.85), 0.0, 1.0);',
'  vec3 col = heat(tIdx);',

// I_обс ∝ g³ · I_соб (инвариант I_ν/ν³)
'  float boost = g * g * g;',
'  opacity = clamp(dens * prof * 0.9, 0.0, 0.92);',
'  return col * prof * dens * boost * 1.35 * uDisk;',
'}',

/* ── тонмаппинг ──────────────────────────────────────── */
'vec3 aces(vec3 x){',
'  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
'}',

/* ── main ────────────────────────────────────────────── */
'void main(){',
'  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;',
'  uv += uOffset;',

// камера
'  float ci = cos(uIncl), si = sin(uIncl);',
'  float cy = cos(uYaw),  sy = sin(uYaw);',
'  vec3 cam = vec3(0.0, si * uDist, -ci * uDist);',
'  cam = vec3(cam.x * cy + cam.z * sy, cam.y, -cam.x * sy + cam.z * cy);',

'  vec3 fwd = normalize(-cam);',
'  vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));',
'  vec3 up  = cross(rgt, fwd);',
'  float tanF = 0.40;',
'  vec3 dir = normalize(fwd + (uv.x * rgt + uv.y * up) * tanF);',

// интегрирование
'  vec3 pos = cam;',
'  vec3 vel = dir;',
'  vec3 hvec = cross(pos, vel);',
'  float h2 = dot(hvec, hvec) * uLens;',

'  vec3 acc = vec3(0.0);',
'  float transmit = 1.0;',
'  bool captured = false;',
'  bool escaped = false;',
'  float farLimit = uDist * 1.3 + 12.0;',

'  for (int i = 0; i < MAXSTEPS; i++){',
'    if (float(i) >= uSteps) break;',
'    float r = length(pos);',
'    if (r <= 1.0){ captured = true; break; }',
'    if (r > farLimit && dot(pos, vel) > 0.0){ escaped = true; break; }',
'    if (transmit < 0.02) break;',

'    float dt = clamp(0.085 * r, 0.03, 1.6);',
'    if (r < ROUT + 2.0){',
'      float tPlane = abs(pos.y) / max(abs(vel.y), 1e-4);',
'      dt = min(dt, max(tPlane * 0.6, 0.06));',
'    }',

'    float r5 = r * r * r * r * r;',
'    vec3 a0 = -1.5 * h2 * pos / r5;',
'    vec3 np = pos + vel * dt + 0.5 * a0 * dt * dt;',
'    float nr = max(length(np), 0.35);',
'    vec3 a1 = -1.5 * h2 * np / (nr * nr * nr * nr * nr);',
'    vec3 nv = vel + 0.5 * (a0 + a1) * dt;',

// пересечение экваториальной плоскости — попадание в диск
'    if (pos.y * np.y < 0.0){',
'      float t = pos.y / (pos.y - np.y);',
'      vec3 hp = mix(pos, np, t);',
'      float op;',
'      vec3 em = diskEmission(hp, normalize(np - pos), op);',
'      acc += em * transmit;',
'      transmit *= (1.0 - op);',
'    }',

'    pos = np;',
'    vel = nv;',
'  }',

'  vec3 col = acc;',
'  if (escaped) col += skyDome(normalize(vel)) * transmit;',

// мягкий ореол вокруг тени — дешёвая имитация блума
'  float b = length(uv);',
'  float haloMask = escaped ? 1.0 : 0.10;',
'  col += vec3(1.0, 0.58, 0.24) * exp(-b * 5.5) * 0.030 * uDisk * haloMask;',
'  col += vec3(1.0, 0.82, 0.58) * exp(-b * 13.0) * 0.022 * uDisk * haloMask;',

'  col *= uFade;',
'  col = aces(col * 1.06);',
'  col = pow(col, vec3(1.0 / 2.2));',

// лёгкое зерно, чтобы убрать бандинг на градиентах
'  float dth = (hash13(vec3(gl_FragCoord.xy, uTime * 60.0)) - 0.5) * 0.016;',
'  col += dth;',

'  gl_FragColor = vec4(col, 1.0);',
'}'
].join('\n');

/* ═════════════════════ реализация ═════════════════════ */

var QUALITY = [
  { scale: 0.50, steps: 110 },
  { scale: 0.70, steps: 170 },
  { scale: 0.88, steps: 240 },
  { scale: 1.00, steps: 300 }
];

function compile(gl, type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[blackhole] shader:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function BlackHole(canvas) {
  this.canvas = canvas;
  this.gl = null;
  this.ok = false;

  this.reduced = global.matchMedia
    ? global.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  // текущее и целевое состояние камеры — интерполируются каждый кадр
  this.cur = { dist: 54, incl: 0.16, disk: 0.0, yaw: 0 };
  this.tgt = { dist: 26, incl: 0.28, disk: 1.0, yaw: 0 };

  this.userIncl = null;   // ручной перехват из HUD
  this.userDist = null;
  this.userDisk = 1;

  this.lens = 1;
  this.dopp = 1;
  this.offset = [0, 0];
  this.offsetT = [0, 0];
  this.mouse = [0, 0];
  this.mouseT = [0, 0];

  this.qualityMode = 'auto';
  this.qi = 1;
  this.fade = 0;
  this.time = 0;
  this.last = 0;
  this.visible = true;
  this.running = false;

  this._fpsAcc = 0;
  this._fpsN = 0;
  this.fps = 60;
  this._settle = 0;

  this.onstats = null;

  this._init();
}

BlackHole.prototype._init = function () {
  var opts = {
    alpha: false, antialias: false, depth: false, stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false
  };
  var gl = this.canvas.getContext('webgl', opts) ||
           this.canvas.getContext('experimental-webgl', opts);
  if (!gl) return;
  this.gl = gl;

  var vs = compile(gl, gl.VERTEX_SHADER, VERT);
  var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;

  var p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('[blackhole] link:', gl.getProgramInfoLog(p));
    return;
  }
  gl.useProgram(p);
  this.prog = p;

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  var names = ['uRes','uTime','uDist','uIncl','uYaw','uOffset','uDisk','uLens','uDopp','uSteps','uFade'];
  this.u = {};
  for (var i = 0; i < names.length; i++) this.u[names[i]] = gl.getUniformLocation(p, names[i]);

  // на софтверном рендерере сразу опускаем качество
  var dbg = gl.getExtension('WEBGL_debug_renderer_info');
  if (dbg) {
    var rend = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
    if (/swiftshader|llvmpipe|software|basic render/.test(rend)) this.qi = 0;
  }

  this.ok = true;
  this._resize();
};

BlackHole.prototype._resize = function () {
  if (!this.ok) return;
  var q = QUALITY[this.qi];
  var dpr = Math.min(global.devicePixelRatio || 1, 2);
  var w = Math.max(1, Math.round(this.canvas.clientWidth * dpr * q.scale));
  var h = Math.max(1, Math.round(this.canvas.clientHeight * dpr * q.scale));
  // потолок по числу пикселей — большие экраны иначе съедают весь бюджет
  var maxPx = 2100000;
  if (w * h > maxPx) {
    var k = Math.sqrt(maxPx / (w * h));
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
  }
  if (w === this.canvas.width && h === this.canvas.height) return;
  this.canvas.width = w;
  this.canvas.height = h;
  this.gl.viewport(0, 0, w, h);
};

/* ── публичное API ────────────────────────────────────── */

BlackHole.prototype.setTarget = function (t) {
  if (t.dist != null) this.tgt.dist = t.dist;
  if (t.incl != null) this.tgt.incl = t.incl;
  if (t.disk != null) this.tgt.disk = t.disk;
};

BlackHole.prototype.setOffset = function (x, y) { this.offsetT[0] = x; this.offsetT[1] = y; };

BlackHole.prototype.setMouse = function (x, y) { this.mouseT[0] = x; this.mouseT[1] = y; };

BlackHole.prototype.setQuality = function (mode) {
  this.qualityMode = mode;                       // 'auto' | 0..3
  if (mode !== 'auto') { this.qi = mode | 0; this._resize(); }
  this._settle = 90;
};

BlackHole.prototype.setFlag = function (name, v) {
  if (name === 'lens') this.lens = v ? 1 : 0;
  if (name === 'dopp') this.dopp = v ? 1 : 0;
};

BlackHole.prototype.start = function () {
  if (!this.ok || this.running) return;
  this.running = true;
  this.last = 0;
  var self = this;
  this._loop = function (ts) {
    if (!self.running) return;
    self._frame(ts);
    global.requestAnimationFrame(self._loop);
  };
  global.requestAnimationFrame(this._loop);
};

BlackHole.prototype.stop = function () { this.running = false; };

/* ── кадр ─────────────────────────────────────────────── */

BlackHole.prototype._frame = function (ts) {
  var dt = this.last ? Math.min((ts - this.last) / 1000, 0.06) : 0.016;
  this.last = ts;

  // счётчик FPS + авто-качество
  this._fpsAcc += dt; this._fpsN++;
  if (this._fpsAcc >= 0.5) {
    this.fps = this._fpsN / this._fpsAcc;
    this._fpsAcc = 0; this._fpsN = 0;
    if (this.qualityMode === 'auto') this._autoQuality();
    if (this.onstats) {
      this.onstats({
        fps: Math.round(this.fps),
        w: this.canvas.width, h: this.canvas.height,
        steps: QUALITY[this.qi].steps
      });
    }
  }
  if (this._settle > 0) this._settle--;

  if (!this.visible) return;
  this._resize();

  if (!this.reduced) this.time += dt;
  else this.time = 8.0;

  // плавные переходы камеры
  var k = 1 - Math.pow(0.0016, dt);
  var dist = this.userDist != null ? this.userDist : this.tgt.dist;
  var incl = this.userIncl != null ? this.userIncl : this.tgt.incl;
  var disk = this.tgt.disk * this.userDisk;

  this.cur.dist += (dist - this.cur.dist) * k;
  this.cur.incl += (incl - this.cur.incl) * k;
  this.cur.disk += (disk - this.cur.disk) * k;

  this.mouse[0] += (this.mouseT[0] - this.mouse[0]) * (1 - Math.pow(0.004, dt));
  this.mouse[1] += (this.mouseT[1] - this.mouse[1]) * (1 - Math.pow(0.004, dt));
  this.offset[0] += (this.offsetT[0] - this.offset[0]) * k;
  this.offset[1] += (this.offsetT[1] - this.offset[1]) * k;

  // медленный кинематографичный дрейф + параллакс за курсором
  var yaw = this.time * 0.019 + this.mouse[0] * 0.14;
  var inclFinal = this.cur.incl + this.mouse[1] * 0.09;

  this.fade += (1 - this.fade) * (1 - Math.pow(0.05, dt));

  var gl = this.gl, u = this.u;
  gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
  gl.uniform1f(u.uTime, this.time);
  gl.uniform1f(u.uDist, this.cur.dist);
  gl.uniform1f(u.uIncl, inclFinal);
  gl.uniform1f(u.uYaw, yaw);
  gl.uniform2f(u.uOffset, this.offset[0], this.offset[1]);
  gl.uniform1f(u.uDisk, Math.max(this.cur.disk, 0));
  gl.uniform1f(u.uLens, this.lens);
  gl.uniform1f(u.uDopp, this.dopp);
  gl.uniform1f(u.uSteps, QUALITY[this.qi].steps);
  gl.uniform1f(u.uFade, this.fade);

  gl.drawArrays(gl.TRIANGLES, 0, 3);
};

BlackHole.prototype._autoQuality = function () {
  if (this._settle > 0) return;
  if (this.fps < 34 && this.qi > 0) { this.qi--; this._resize(); this._settle = 8; }
  else if (this.fps > 57 && this.qi < QUALITY.length - 1) { this.qi++; this._resize(); this._settle = 8; }
};

global.BlackHole = BlackHole;
global.BlackHoleQuality = QUALITY;

})(window);
