/* ============================================================
   SINGULARITY — рендер чёрной дыры в реальном времени.

   Лучи трассируются по нулевым геодезическим метрики Шварцшильда
   (приближение: ускорение фотона a = -3/2 · h² · r̂ / r⁴),
   поэтому линзирование, фотонное кольцо и «поднятый» задний край
   аккреционного диска получаются сами собой, без спрайтов.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('blackhole');
  if (!canvas) return;

  var gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false, alpha: false })
        || canvas.getContext('experimental-webgl');
  if (!gl) { canvas.style.display = 'none'; return; }

  var VERT = [
    'attribute vec2 aPos;',
    'void main() { gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    '',
    'uniform vec2  uRes;',
    'uniform float uTime;',
    'uniform vec2  uMouse;',
    '',
    '#define PI 3.14159265359',
    '#define STEPS 150',
    '#define DISK_IN  2.6',
    '#define DISK_OUT 9.5',
    '#define ESCAPE_R 40.0',
    '',
    '/* ---------- hash & noise ---------- */',
    'float hash12(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    '',
    'float vnoise(vec2 p) {',
    '  vec2 i = floor(p), f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash12(i);',
    '  float b = hash12(i + vec2(1.0, 0.0));',
    '  float c = hash12(i + vec2(0.0, 1.0));',
    '  float d = hash12(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}',
    '',
    'float fbm(vec2 p) {',
    '  float v = 0.0, a = 0.5;',
    '  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);',
    '  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = m * p; a *= 0.5; }',
    '  return v;',
    '}',
    '',
    '/* ---------- звёздный фон ---------- */',
    'vec3 background(vec3 rd) {',
    '  vec3 col = vec3(0.0);',
    '  vec2 sph = vec2(atan(rd.z, rd.x), asin(clamp(rd.y, -1.0, 1.0)));',
    '',
    '  for (int layer = 0; layer < 2; layer++) {',
    '    float fl = float(layer);',
    '    vec2 grid = sph * (90.0 + fl * 70.0);',
    '    vec2 id = floor(grid);',
    '    vec2 gv = fract(grid) - 0.5;',
    '    float h = hash12(id + fl * 17.31);',
    '    if (h > 0.982) {',
    '      vec2 offs = vec2(hash12(id + 3.1), hash12(id + 7.7)) - 0.5;',
    '      float d = length(gv - offs * 0.7);',
    '      float star = smoothstep(0.4, 0.0, d);',
    '      float tw = 0.65 + 0.35 * sin(uTime * (1.0 + h * 5.0) + h * 43.0);',
    '      vec3 scol = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.85, 0.68), hash12(id + 11.0));',
    '      col += star * star * tw * scol * (0.35 + h * 0.9);',
    '    }',
    '  }',
    '',
    '  /* тусклая полоса «млечного пути» */',
    '  float band = exp(-abs(rd.y + 0.18) * 3.2);',
    '  float neb = fbm(vec2(sph.x * 2.4, rd.y * 5.0));',
    '  col += band * neb * vec3(0.045, 0.045, 0.085);',
    '  col += band * pow(neb, 3.0) * vec3(0.16, 0.09, 0.12);',
    '  return col;',
    '}',
    '',
    '/* ---------- излучение аккреционного диска ---------- */',
    'vec3 diskShade(vec3 hit, vec3 photonDir, out float alpha) {',
    '  float r = length(hit.xz);',
    '',
    '  /* дифференциальное (кеплеровское) вращение: внутренние кольца крутятся быстрее */',
    '  float om = 3.4 / pow(r, 1.5);',
    '  float ca = cos(uTime * om), sa = sin(uTime * om);',
    '  vec2 rp = mat2(ca, -sa, sa, ca) * hit.xz;',
    '',
    '  float turb = fbm(rp * vec2(1.1, 1.1) + fbm(rp * 2.3) * 0.8);',
    '  turb = pow(max(turb, 0.0), 1.5) * 1.6;',
    '',
    '  /* профиль яркости: резкий внутренний край (ISCO), плавный внешний */',
    '  float fade = smoothstep(DISK_IN, DISK_IN + 0.55, r) * smoothstep(DISK_OUT, DISK_OUT - 4.5, r);',
    '  float heat = pow(DISK_IN / r, 2.2);',
    '',
    '  /* температурная палитра: белое ядро -> янтарь -> глубокий красный */',
    '  vec3 cHot  = vec3(1.00, 0.92, 0.80);',
    '  vec3 cMid  = vec3(1.00, 0.46, 0.12);',
    '  vec3 cCold = vec3(0.45, 0.09, 0.02);',
    '  float t = clamp((r - DISK_IN) / (DISK_OUT - DISK_IN), 0.0, 1.0);',
    '  vec3 col = mix(cHot, cMid, smoothstep(0.0, 0.24, t));',
    '  col = mix(col, cCold, smoothstep(0.22, 1.0, t));',
    '',
    '  /* релятивистский доплер: приближающийся край ярче и голубее */',
    '  vec3 orbit = normalize(vec3(-hit.z, 0.0, hit.x));',
    '  float beta = clamp(0.42 / sqrt(max(r * 0.5 - 0.45, 0.12)), 0.0, 0.7);',
    '  float cosT = dot(orbit, -normalize(photonDir));',
    '  float doppler = 1.0 / (1.0 - beta * cosT);',
    '  float boost = min(pow(doppler, 3.0), 3.6);',
    '  col = mix(col, vec3(0.75, 0.85, 1.0), clamp((doppler - 1.0) * 0.55, 0.0, 0.55));',
    '',
    '  /* гравитационное красное смещение у внутреннего края */',
    '  float gz = sqrt(max(1.0 - 1.0 / max(r, 1.001), 0.0));',
    '',
    '  alpha = clamp(fade * (0.35 + turb * 0.85), 0.0, 1.0);',
    '  return col * (0.18 + turb) * heat * boost * gz * fade * 2.0;',
    '}',
    '',
    '/* ---------- тонмаппинг (ACES approx) ---------- */',
    'vec3 aces(vec3 x) {',
    '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;',
    '',
    '  /* камера: медленный кинематографичный дрейф + параллакс от мыши */',
    '  float yaw = 0.35 * uMouse.x + uTime * 0.015;',
    '  float height = 1.55 + uMouse.y * 0.9;',
    '  float dist = 17.5;',
    '  vec3 ro = vec3(sin(yaw) * dist, height, -cos(yaw) * dist);',
    '',
    '  vec3 fw = normalize(vec3(0.0, 0.35, 0.0) - ro);',
    '  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));',
    '  vec3 up = cross(rt, fw);',
    '  vec3 dir = normalize(fw * 1.55 + rt * uv.x + up * uv.y);',
    '',
    '  vec3 pos = ro;',
    '  vec3 vel = dir;',
    '',
    '  /* сохраняющийся момент импульса фотона */',
    '  vec3 hv = cross(pos, vel);',
    '  float h2 = dot(hv, hv);',
    '',
    '  vec3 col = vec3(0.0);',
    '  float T = 1.0;          /* пропускание вдоль луча */',
    '  bool escaped = false;',
    '',
    '  for (int i = 0; i < STEPS; i++) {',
    '    float r2 = dot(pos, pos);',
    '    float r = sqrt(r2);',
    '',
    '    if (r < 1.0) break;                 /* за горизонтом — чернота */',
    '    if (r > ESCAPE_R) { escaped = true; break; }',
    '',
    '    float dt = 0.14 * clamp(r * 0.45, 0.45, 3.6);',
    '',
    '    /* изгиб луча гравитацией */',
    '    vec3 acc = -1.5 * h2 * pos / (r2 * r2 * r);',
    '    vec3 prevPos = pos;',
    '    pos += vel * dt;',
    '    vel += acc * dt;',
    '    vel = normalize(vel);',
    '',
    '    /* пересечение плоскости диска */',
    '    if (prevPos.y * pos.y < 0.0 && T > 0.02) {',
    '      float f = prevPos.y / (prevPos.y - pos.y);',
    '      vec3 hit = mix(prevPos, pos, f);',
    '      float hr = length(hit.xz);',
    '      if (hr > DISK_IN && hr < DISK_OUT) {',
    '        float alpha;',
    '        vec3 emit = diskShade(hit, vel, alpha);',
    '        col += T * emit;',
    '        T *= (1.0 - alpha * 0.9);',
    '      }',
    '    }',
    '  }',
    '',
    '  if (escaped) col += T * background(normalize(vel));',
    '',
    '  /* мягкое тёплое гало вокруг тени */',
    '  float lens = length(uv);',
    '  col += vec3(1.0, 0.55, 0.25) * 0.012 / (0.06 + lens * lens * 2.2);',
    '',
    '  col = aces(col);',
    '  col = pow(col, vec3(1.0 / 2.2));',
    '',
    '  /* лёгкое виньетирование в самом рендере */',
    '  col *= 1.0 - 0.28 * smoothstep(0.45, 1.25, lens);',
    '',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[blackhole] shader error:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { canvas.style.display = 'none'; return; }

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[blackhole] link error:', gl.getProgramInfoLog(prog));
    canvas.style.display = 'none';
    return;
  }
  gl.useProgram(prog);

  var quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(prog, 'uRes');
  var uTime = gl.getUniformLocation(prog, 'uTime');
  var uMouse = gl.getUniformLocation(prog, 'uMouse');

  /* ---------- адаптивное качество ---------- */
  var renderScale = Math.min(window.devicePixelRatio || 1, 1.5);
  if (Math.min(window.innerWidth, window.innerHeight) < 700) renderScale = Math.min(renderScale, 1.0);
  var minScale = 0.5;

  /* софтверный рендер (SwiftShader/llvmpipe) не потянет полное разрешение */
  var dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
  var rendererName = dbgInfo ? String(gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL)) : '';
  if (/swiftshader|software|llvmpipe/i.test(rendererName)) {
    renderScale = 0.3;
    minScale = 0.2;
  }

  function resize() {
    var w = Math.max(1, Math.round(canvas.clientWidth * renderScale));
    var h = Math.max(1, Math.round(canvas.clientHeight * renderScale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }
  window.addEventListener('resize', resize);

  /* ---------- мышь с инерцией ---------- */
  var mouseX = 0, mouseY = 0, smX = 0, smY = 0;
  window.addEventListener('pointermove', function (e) {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  /* рендерим только когда hero в кадре и вкладка активна */
  var visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
    }, { threshold: 0.02 }).observe(canvas);
  }

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var start = performance.now();
  var lastFrame = start;
  var slowFrames = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) { lastFrame = now; return; }

    /* авто-даунскейл, если GPU не тянет */
    var dtms = now - lastFrame;
    lastFrame = now;
    if (dtms > 40 && dtms < 500) {
      if (++slowFrames > 20 && renderScale > minScale) {
        renderScale = Math.max(minScale, renderScale * 0.8);
        slowFrames = 0;
        resize();
      }
    } else if (slowFrames > 0) {
      slowFrames--;
    }

    resize();
    smX += (mouseX - smX) * 0.045;
    smY += (mouseY - smY) * 0.045;

    var t = reduced ? 12.0 : (now - start) / 1000 + 12.0;
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uMouse, smX, -smY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  resize();
  requestAnimationFrame(frame);
})();
