'use strict';
(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const distEl = document.getElementById('distance');
  const bestEl = document.getElementById('best');
  const flipsEl = document.getElementById('flips');
  const menuEl = document.getElementById('menu');
  const crashEl = document.getElementById('crash');
  const crashDistEl = document.getElementById('crashDist');
  const crashMsgEl = document.getElementById('crashMsg');

  let W = 430, H = 780;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0) { W = rect.width; H = rect.height; }
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Physics constants ----------
  const GRAVITY = 2100;
  const ENGINE = 3300;
  const AIR_ROT = 4.4;
  const GROUND_DRAG = 0.9985;
  const AIR_DRAG = 0.999;
  const MAX_SPEED = 900;
  const WHEEL_R = 15;
  const BODY_LEN = 52;

  // ---------- Terrain ----------
  // Track: sequence of (x, y) points with smooth hills + ramps + gaps.
  const SEG = 34;               // dx between points
  const lookahead = W + 200;

  let track = [];                // {x, y}
  let trackEndX = 0;
  let rngState = 123456789;
  function rnd() { // xorshift for reproducible per-seed tracks
    rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
    return ((rngState >>> 0) % 100000) / 100000;
  }

  function resetTrack(seed) {
    rngState = seed;
    track = [];
    trackEndX = 0;
    cursor = 0;
    const y = H - 220;
    for (let i = 0; i < 30; i++) addPoint(y);
  }

  function addPoint(y) {
    track.push({ x: trackEndX, y });
    trackEndX += SEG;
  }

  let cursor = 0;
  function extendTrack() {
    while (trackEndX < camX + lookahead * 2) {
      const r = rnd();
      const base = track[track.length - 1].y;
      if (r < 0.30) {
        // rolling hills
        for (let i = 0; i < 6; i++) addPoint(base + (rnd() - 0.5) * 70);
      } else if (r < 0.52) {
        // ramp up
        const h = 90 + rnd() * 130;
        for (let i = 0; i < 5; i++) addPoint(base - h * (i / 4));
        // gap
        const gapLen = 3 + Math.floor(rnd() * 4);
        const landY = base - h + (rnd() - 0.3) * 80;
        trackEndX += gapLen * SEG;
        for (let i = 0; i < 4; i++) addPoint(landY + i * 12);
      } else if (r < 0.72) {
        // gentle downhill (speed section)
        for (let i = 0; i < 8; i++) addPoint(base + 6 + rnd() * 10);
      } else if (r < 0.9) {
        // bumps
        for (let i = 0; i < 10; i++) addPoint(base + Math.sin(i * 1.4) * 26 + (rnd() - 0.5) * 12);
      } else {
        // flat rest
        for (let i = 0; i < 5; i++) addPoint(base);
      }
    }
  }

  function segmentAt(x) {
    if (x <= track[0].x) return 0;
    if (x >= track[track.length - 1].x) return track.length - 2;
    while (cursor < track.length - 2 && track[cursor + 1].x <= x) cursor++;
    while (cursor > 0 && track[cursor].x > x) cursor--;
    return cursor;
  }

  function groundYAt(x) {
    const i = segmentAt(x);
    const a = track[i], b = track[i + 1];
    if (!b) return a.y;
    const t = (x - a.x) / (b.x - a.x);
    return a.y + (b.y - a.y) * Math.max(0, Math.min(1, t));
  }

  function gapAt(x) {
    const i = segmentAt(x);
    if (i >= track.length - 2) return false;
    const a = track[i], b = track[i + 1];
    return x > a.x && x < b.x && (b.x - a.x) - SEG > 1;
  }

  // ---------- Bike ----------
  const bike = {
    x: 100, y: 0, vx: 0, vy: 0,
    angle: 0, av: 0,
    onGround: false,
    dead: false,
    wheelie: 0,
  };

  let camX = 0;
  let distance = 0;
  let flips = 0;
  let flipAccum = 0;
  let best = +(localStorage.getItem('rider_best') || 0);
  bestEl.textContent = 'рекорд: ' + Math.floor(best) + ' м';

  let running = false;
  let throttle = false;
  let time = 0;

  function reset() {
    resetTrack((Date.now() % 2147483647) || 42);
    bike.x = 60;
    bike.y = groundYAt(bike.x) - WHEEL_R;
    bike.vx = 170; bike.vy = 0;
    bike.angle = 0; bike.av = 0;
    bike.onGround = true; bike.dead = false;
    camX = 0; distance = 0; flips = 0; flipAccum = 0; time = 0;
    updateHUD();
  }

  function updateHUD() {
    distEl.textContent = Math.floor(distance) + ' м';
    flipsEl.innerHTML = 'FLIPS <b>' + flips + '</b>';
  }

  // ---------- Input ----------
  function on() { if (!bike.dead) throttle = true; }
  function off() { throttle = false; }

  canvas.addEventListener('touchstart', e => { e.preventDefault(); on(); }, { passive: false });
  canvas.addEventListener('touchend', e => { e.preventDefault(); off(); }, { passive: false });
  canvas.addEventListener('touchcancel', off);
  window.addEventListener('mousedown', on);
  window.addEventListener('mouseup', off);
  window.addEventListener('keydown', e => { if (e.repeat) return; if (e.code === 'Space' || e.code === 'ArrowRight') on(); });
  window.addEventListener('keyup', e => { if (e.code === 'Space' || e.code === 'ArrowRight') off(); });

  document.getElementById('playBtn').addEventListener('click', () => {
    menuEl.classList.add('hidden');
    startRun();
  });
  document.getElementById('retryBtn').addEventListener('click', () => {
    crashEl.classList.add('hidden');
    startRun();
  });

  function startRun() {
    reset();
    prevT = 0;
    running = true;
    requestAnimationFrame(loop);
  }

  // ---------- Physics step ----------
  let prevT = 0;
  function step(dt) {
    time += dt;
    const b = bike;

    if (b.dead) { running = false; return; }

    const gy = groundYAt(b.x);
    const wasAir = !b.onGround;
    b.onGround = b.y + WHEEL_R >= gy - 2 && !gapAt(b.x);

    if (b.onGround) {
      if (wasAir) {
        // landing
        b.y = gy - WHEEL_R;
        b.vy = 0;
        // crash check: bad angle
        const norm = normalize(b.angle);
        if (norm > 1.25 && norm < Math.PI * 2 - 1.25) {
          kill('Плохое приземление. Держи колёса внизу.');
          return;
        }
        if (Math.abs(norm) > 0.5) b.av *= 0.4; // hard landing damp
        b.angle = Math.round(b.angle / (Math.PI * 2)) * Math.PI * 2;
        if (flipAccum !== 0) { flipAccum = 0; }
      }
      // engine
      if (throttle) b.vx += ENGINE * dt;
      b.vx *= GROUND_DRAG;
      if (b.vx > MAX_SPEED) b.vx = MAX_SPEED;
      if (b.vx < 40) b.vx = 40;
      // slope influence
      const slope = (groundYAt(b.x + 8) - groundYAt(b.x - 8)) / 16;
      b.vx -= slope * 900 * dt;
      b.av *= 0.85;
      // wheelie torque when accelerating hard at low speed
      if (throttle && b.vx < 420) b.av -= 1.1 * dt;
      b.angle += b.av * dt;
      // stick to ground
      const targetY = gy - WHEEL_R;
      b.y += (targetY - b.y) * Math.min(1, 12 * dt);
      b.vy = 0;
    } else {
      // airborne
      if (throttle) b.av -= AIR_ROT * dt;   // gas => backflip rotation
      else b.av += AIR_ROT * 0.55 * dt;     // lean forward
      b.angle += b.av * dt;
      b.vy += GRAVITY * dt;
      b.vx *= AIR_DRAG;
      flipAccum += b.av * dt;
      const done = Math.floor(Math.abs(flipAccum) / (Math.PI * 2));
      if (done > 0) { flips += done; flipAccum -= Math.sign(flipAccum) * done * Math.PI * 2; }
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // fall out / ceiling
    if (b.y > H + 300) { kill('Пропасть. Набери скорость перед прыжком.'); return; }

    // head-strike: top of rider circle vs ground when inverted on ground level
    if (b.onGround || (b.y + WHEEL_R > gy && !gapAt(b.x))) {
      const head = riderHead(b);
      if (head.y > groundYAt(head.x) - 4) {
        const norm = normalize(b.angle);
        if (norm > 1.0 && norm < Math.PI * 2 - 1.0) {
          kill('Шея не резиновая.');
          return;
        }
      }
    }

    camX += (b.x - 130 - camX) * Math.min(1, 6 * dt);
    distance = Math.max(distance, (b.x - 60) / 10);
    extendTrack();
    updateHUD();
  }

  function normalize(a) {
    a = a % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a;
  }

  function riderHead(b) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const lx = -14, ly = -46;
    return { x: b.x + lx * c - ly * s, y: b.y + lx * s + ly * c };
  }

  function kill(msg) {
    if (bike.dead) return;
    bike.dead = true;
    crashMsgEl.textContent = msg;
    showCrash();
  }

  function showCrash() {
    if (distance > best) {
      best = distance;
      localStorage.setItem('rider_best', Math.floor(best));
      bestEl.textContent = 'рекорд: ' + Math.floor(best) + ' м';
      crashMsgEl.textContent += ' Новый рекорд!';
    }
    crashDistEl.textContent = Math.floor(distance) + ' м';
    crashEl.classList.remove('hidden');
  }

  // ---------- Render ----------
  function draw() {
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1b1035');
    sky.addColorStop(0.5, '#0a0a12');
    sky.addColorStop(1, '#0a0a12');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // stars
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    for (let i = 0; i < 40; i++) {
      const sx = (i * 97 - camX * 0.2) % (W + 40);
      const x = sx < 0 ? sx + W + 40 : sx;
      const y = (i * 53) % 260;
      ctx.fillRect(x, y, 2, 2);
    }

    // distant nebula blob
    const g = ctx.createRadialGradient(W * 0.75 - (camX * 0.05) % W, 180, 10, W * 0.75 - (camX * 0.05) % W, 180, 160);
    g.addColorStop(0, 'rgba(255,110,60,.12)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 400);

    ctx.save();
    ctx.translate(-camX, 0);

    // ground fill + line
    ctx.beginPath();
    const startX = camX - 40;
    ctx.moveTo(startX, groundYAt(startX));
    for (let x = startX; x < camX + W + 60; x += 8) ctx.lineTo(x, groundYAt(x));
    ctx.lineTo(camX + W + 60, H + 400);
    ctx.lineTo(startX, H + 400);
    ctx.closePath();
    const gg = ctx.createLinearGradient(0, H - 260, 0, H);
    gg.addColorStop(0, '#141422');
    gg.addColorStop(1, '#05050b');
    ctx.fillStyle = gg;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(startX, groundYAt(startX));
    for (let x = startX; x < camX + W + 60; x += 6) ctx.lineTo(x, groundYAt(x));
    ctx.strokeStyle = '#ff9a3c';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // checkpoint marks every 100m
    const markStep = 1000;
    const firstMark = Math.ceil((camX - 40) / markStep) * markStep;
    ctx.font = '600 12px Inter, sans-serif';
    for (let mx = firstMark; mx < camX + W + 60; mx += markStep) {
      const gy = groundYAt(mx);
      ctx.fillStyle = 'rgba(255,154,60,.5)';
      ctx.fillRect(mx, gy - 46, 3, 46);
      ctx.fillText(((mx - 60) / 10) + 'м', mx + 8, gy - 34);
    }

    drawBike();
    ctx.restore();
  }

  function drawBike() {
    const b = bike;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);

    // rear wheel
    wheel(-BODY_LEN / 2, 0);
    // front wheel
    wheel(BODY_LEN / 2, 0);

    // frame
    ctx.strokeStyle = '#e8e8f0';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-BODY_LEN / 2, 0);
    ctx.lineTo(-6, -14);
    ctx.lineTo(10, -18);
    ctx.lineTo(BODY_LEN / 2, 0);
    ctx.stroke();

    // handlebar
    ctx.beginPath();
    ctx.moveTo(10, -18);
    ctx.lineTo(14, -32);
    ctx.stroke();

    // rider
    ctx.strokeStyle = '#ff9a3c';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-6, -16);
    ctx.lineTo(-2, -34); // torso
    ctx.stroke();
    // arm
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -30);
    ctx.lineTo(14, -30);
    ctx.stroke();
    // leg
    ctx.beginPath();
    ctx.moveTo(-4, -18);
    ctx.lineTo(-BODY_LEN / 2 + 4, -4);
    ctx.stroke();
    // head
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-10, -44, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function wheel(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, WHEEL_R, 0, Math.PI * 2);
    ctx.stroke();
    // spokes
    ctx.save();
    ctx.rotate(-bike.x / WHEEL_R);
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI / 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 4, Math.sin(a) * 4);
      ctx.lineTo(Math.cos(a) * (WHEEL_R - 2), Math.sin(a) * (WHEEL_R - 2));
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---------- Loop ----------
  function loop(t) {
    if (!running) return;
    if (!prevT) prevT = t;
    let dt = Math.min((t - prevT) / 1000, 0.033);
    prevT = t;
    // fixed substeps for stable physics
    const sub = Math.ceil(dt / 0.008);
    const sdt = dt / sub;
    for (let i = 0; i < sub && running; i++) step(sdt);
    draw();
    if (running) requestAnimationFrame(loop);
  }

  // idle background on menu
  resetTrack(7);
  bike.x = 140; bike.y = groundYAt(140) - WHEEL_R;
  camX = 20;
  draw();
  (function idle() {
    if (running) return;
    draw();
    requestAnimationFrame(idle);
  })();
})();
