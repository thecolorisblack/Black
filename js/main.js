/* ═══════════════════════════════════════════════════════════════════
   EVENT HORIZON — интерфейс: прелоадер, reveal-анимации, счётчики,
   лаборатория времени, калькулятор, зоопарк, привязка камеры к скроллу.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

var $  = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
var lerp  = function (a, b, t) { return a + (b - a) * t; };

var REDUCED = window.matchMedia &&
              window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ═══════════ 1. РЕНДЕР ═══════════ */

var bh = null;
var canvas = $('#bh-canvas');

function initRender() {
  if (!canvas || !window.BlackHole) return false;
  bh = new window.BlackHole(canvas);
  if (!bh.ok) { document.body.classList.add('no-webgl'); bh = null; return false; }

  bh.onstats = function (s) {
    var f = $('#stat-fps'), r = $('#stat-res'), st = $('#stat-steps');
    if (f) f.textContent = s.fps + ' fps';
    if (r) r.textContent = s.w + '×' + s.h;
    if (st) st.textContent = s.steps + ' шагов/луч';
  };

  bh.start();

  document.addEventListener('visibilitychange', function () {
    bh.visible = !document.hidden;
    if (!document.hidden) bh.last = 0;
  });

  window.addEventListener('resize', function () { bh.last = 0; });

  if (!REDUCED) {
    window.addEventListener('pointermove', function (e) {
      bh.setMouse(
        (e.clientX / window.innerWidth  - 0.5) * 2,
        (e.clientY / window.innerHeight - 0.5) * 2
      );
    }, { passive: true });
  }
  return true;
}

var hasGL = initRender();

/* ═══════════ 2. ПРЕЛОАДЕР ═══════════ */

(function preloader() {
  var el = $('#preloader');
  if (!el) return;
  document.body.classList.add('is-loading');

  var fill   = $('#preloader-fill');
  var pct    = $('#preloader-pct');
  var status = $('#preloader-status');

  var stages = [
    'инициализация метрики',
    'решение геодезических',
    'разогрев аккреционного диска',
    'калибровка доплер-фактора',
    'горизонт стабилен'
  ];

  var p = 0, done = false, loaded = false;
  window.addEventListener('load', function () { loaded = true; });
  setTimeout(function () { loaded = true; }, 4200);   // страховка

  function finish() {
    if (done) return;
    done = true;
    set(100);
    if (status) status.textContent = stages[stages.length - 1];
    setTimeout(function () {
      el.classList.add('is-done');
      document.body.classList.remove('is-loading');
      document.body.classList.add('is-ready');
      if (canvas) canvas.classList.add('is-ready');
      startReveals();
    }, 420);
  }

  function set(v) {
    p = v;
    if (fill) fill.style.width = v + '%';
    if (pct) pct.textContent = Math.round(v) + '%';
    var si = clamp(Math.floor(v / 25), 0, stages.length - 1);
    if (status) status.textContent = stages[si];
  }

  var t = setInterval(function () {
    // до 92% идём сами, дальше ждём загрузки и первых кадров рендера
    var ready = loaded && (!hasGL || bh.fps > 0 || bh.time > 0.25);
    var target = ready ? 100 : 92;
    var step = ready ? 9 : (2 + Math.random() * 6);
    set(Math.min(target, p + step));
    if (p >= 100) { clearInterval(t); finish(); }
  }, 130);
})();

/* ═══════════ 3. REVEAL ═══════════ */

var revealStarted = false;

function startReveals() {
  if (revealStarted) return;
  revealStarted = true;

  var items = $$('.reveal');

  if (!('IntersectionObserver' in window)) {
    items.forEach(function (n) { n.classList.add('is-revealed'); });
    items.forEach(afterReveal);
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var n = e.target;
      // лёгкая лесенка внутри одной группы
      var sibs = n.parentNode ? $$('.reveal', n.parentNode) : [n];
      var idx = sibs.indexOf(n);
      n.style.transitionDelay = (idx > 0 ? Math.min(idx, 6) * 0.075 : 0) + 's';
      n.classList.add('is-revealed');
      afterReveal(n);
      io.unobserve(n);
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -6% 0px' });

  items.forEach(function (n) { io.observe(n); });
}

function afterReveal(n) {
  if (n.classList.contains('num')) {
    var c = $('.counter', n);
    if (c) runCounter(c);
  }
  if (n.classList.contains('zoo__row')) fillZooRow(n);
}

/* ═══════════ 4. СЧЁТЧИКИ ═══════════ */

function runCounter(el) {
  if (el.dataset.done) return;
  el.dataset.done = '1';

  var to     = parseFloat(el.dataset.to) || 0;
  var dec    = parseInt(el.dataset.dec || '0', 10);
  var pre    = el.dataset.prefix || '';
  var suf    = el.dataset.suffix || '';
  var mode   = el.dataset.mode || '';
  var dur    = 1750;
  var t0     = null;

  if (REDUCED) { write(to); return; }

  function write(v) {
    var s = v.toFixed(dec);
    if (dec === 0) s = String(Math.round(v));
    // разделитель разрядов
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    el.innerHTML = (mode === 'exp')
      ? '10<sup>' + s + '</sup>'
      : pre + s + suf;
  }

  function step(ts) {
    if (t0 === null) t0 = ts;
    var t = clamp((ts - t0) / dur, 0, 1);
    var e = 1 - Math.pow(1 - t, 3.2);       // easeOutCubic-ish
    write(to * e);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ═══════════ 5. ЗООПАРК ═══════════ */

function fillZooRow(row) {
  if (row.dataset.done) return;
  row.dataset.done = '1';
  var v = clamp(parseFloat(row.dataset.log) || 0, 0, 1) * 100;
  var bar = $('.zoo__bar i', row);
  var dot = $('.zoo__dot', row);
  requestAnimationFrame(function () {
    if (bar) bar.style.width = v + '%';
    if (dot) dot.style.left = v + '%';
  });
}

/* ═══════════ 6. ПРОГРЕСС, ШАПКА, КАМЕРА ═══════════ */

(function scrollSystem() {
  var fill = $('#scroll-fill');
  var bar  = $('.topbar');
  var navLinks = $$('.nav a');
  var sections = $$('[data-cam]');

  var cams = sections.map(function (s) {
    var p = (s.dataset.cam || '14,14,1').split(',').map(parseFloat);
    return { el: s, dist: p[0], incl: p[1] * Math.PI / 180, disk: p[2] };
  });

  var ticking = false;

  function measure() {
    cams.forEach(function (c) {
      var r = c.el.getBoundingClientRect();
      c.top = r.top + window.scrollY;
      c.h = r.height;
    });
  }

  function update() {
    ticking = false;
    var y = window.scrollY || window.pageYOffset || 0;
    var vh = window.innerHeight;
    var max = Math.max(1, document.documentElement.scrollHeight - vh);

    if (fill) fill.style.width = clamp(y / max, 0, 1) * 100 + '%';
    if (bar) bar.classList.toggle('is-stuck', y > 40);

    // активный пункт меню
    var anchorY = y + vh * 0.35;
    var activeId = null;
    $$('main section[id]').forEach(function (s) {
      if (s.offsetTop <= anchorY) activeId = s.id;
    });
    navLinks.forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('href') === '#' + activeId);
    });

    // камера: ищем секцию под центром экрана и плавно смешиваем со следующей
    if (bh && cams.length) {
      var focus = y + vh * 0.5;
      var i = 0;
      for (var k = 0; k < cams.length; k++) {
        if (focus >= cams[k].top) i = k;
      }
      var a = cams[i], b = cams[Math.min(i + 1, cams.length - 1)];
      var local = clamp((focus - a.top) / Math.max(a.h, 1), 0, 1);
      // смешивание начинается на последней трети секции
      var t = clamp((local - 0.62) / 0.38, 0, 1);
      t = t * t * (3 - 2 * t);

      // на узких экранах кадр по горизонтали уже — отодвигаем камеру,
      // иначе дыра занимает весь экран и текст тонет
      var zoomOut = window.innerWidth < 720 ? 1.45
                  : window.innerWidth < 1080 ? 1.18 : 1;

      bh.setTarget({
        dist: lerp(a.dist, b.dist, t) * zoomOut,
        incl: lerp(a.incl, b.incl, t),
        disk: lerp(a.disk, b.disk, t)
      });

      // в герое дыра уходит вправо, дальше — по центру
      var wide = window.innerWidth > 1080;
      var heroOut = clamp(y / (vh * 0.85), 0, 1);
      bh.setOffset(wide ? lerp(-0.46, 0, heroOut) : 0, wide ? 0 : lerp(0.16, 0, heroOut));
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  measure();
  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { measure(); onScroll(); });
  window.addEventListener('load', function () { measure(); onScroll(); });
})();

/* ═══════════ 7. HUD ═══════════ */

(function hud() {
  var panel = $('#hud'), open = $('#hud-toggle'), close = $('#hud-close');
  if (!panel || !open) return;

  function setOpen(v) {
    panel.hidden = !v;
    open.setAttribute('aria-expanded', String(v));
  }
  open.addEventListener('click', function () { setOpen(panel.hidden); });
  if (close) close.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  if (!bh) { open.disabled = true; open.textContent = 'нет webgl'; return; }

  bind('#c-incl', '#v-incl', function (v) {
    bh.userIncl = v * Math.PI / 180;
    return Math.round(v) + '°';
  });
  bind('#c-dist', '#v-dist', function (v) {
    bh.userDist = v;
    return v.toFixed(1) + ' rs';
  });
  bind('#c-disk', '#v-disk', function (v) {
    bh.userDisk = v / 100;
    return Math.round(v) + '%';
  });
  bind('#c-qual', '#v-qual', function (v) {
    bh.setQuality(v | 0);
    return ['низкое', 'среднее', 'высокое', 'макс.'][v | 0];
  }, true);

  var lens = $('#c-lens'), dopp = $('#c-dopp');
  if (lens) lens.addEventListener('change', function () { bh.setFlag('lens', lens.checked); });
  if (dopp) dopp.addEventListener('change', function () { bh.setFlag('dopp', dopp.checked); });

  function bind(inp, out, fn, immediate) {
    var i = $(inp), o = $(out);
    if (!i) return;
    if (immediate) o.textContent = 'авто';
    i.addEventListener('input', function () {
      var txt = fn(parseFloat(i.value));
      if (o) o.textContent = txt;
    });
  }
})();

/* ═══════════ 8. АНАТОМИЯ ═══════════ */

(function anatomy() {
  var layers = $$('.layer');
  var rings  = $$('.cross .ring');
  var ticks  = $$('.cross .ticks text');
  if (!layers.length) return;

  function highlight(name, on) {
    layers.forEach(function (l) {
      l.classList.toggle('is-hot', on && l.dataset.layer === name);
    });
    rings.forEach(function (r) {
      r.classList.toggle('is-hot', on && r.dataset.layer === name);
    });
    ticks.forEach(function (t) {
      t.classList.toggle('is-hot', on && t.dataset.layer === name);
    });
  }

  layers.concat(rings).forEach(function (n) {
    var name = n.dataset.layer;
    n.addEventListener('mouseenter', function () { highlight(name, true); });
    n.addEventListener('mouseleave', function () { highlight(name, false); });
    n.addEventListener('focus', function () { highlight(name, true); });
    n.addEventListener('blur', function () { highlight(name, false); });
  });
})();

/* ═══════════ 9. ЛАБОРАТОРИЯ ВРЕМЕНИ ═══════════ */

(function timeLab() {
  var slider = $('#time-r');
  if (!slider) return;

  var out     = $('#time-r-out');
  var outside = $('#time-outside');
  var sqrtEl  = $('#time-sqrt');
  var zEl     = $('#time-z');
  var factEl  = $('#dilation-factor');
  var capEl   = $('#near-caption');
  var pills   = $$('.timelab__quick .pill');

  var hands = {
    far:  { h: $('#far-h'),  m: $('#far-m'),  s: $('#far-s')  },
    near: { h: $('#near-h'), m: $('#near-m'), s: $('#near-s') }
  };

  var r = parseFloat(slider.value);
  var factor = Math.sqrt(1 - 1 / r);
  var angFar = 0, angNear = 0;   // «секунды» на каждых часах

  function fmtDuration(hours) {
    if (hours < 1e-9) return '—';
    if (hours < 24) {
      var h = Math.floor(hours);
      var m = Math.round((hours - h) * 60);
      if (m === 60) { m = 0; h++; }
      return h + ' ч ' + (m < 10 ? '0' : '') + m + ' мин';
    }
    var days = hours / 24;
    if (days < 365) return days.toFixed(1) + ' сут';
    var years = days / 365.25;
    if (years < 1000) return years.toFixed(1) + ' лет';
    if (years < 1e6) return (years / 1000).toFixed(1) + ' тыс. лет';
    if (years < 1e9) return (years / 1e6).toFixed(2) + ' млн лет';
    return years.toExponential(2).replace('e+', '·10^') + ' лет';
  }

  function refresh() {
    r = parseFloat(slider.value);
    factor = Math.sqrt(Math.max(1 - 1 / r, 1e-12));

    if (out)    out.textContent = r.toFixed(3) + ' rs';
    if (capEl)  capEl.textContent = 'r = ' + r.toFixed(r < 2 ? 3 : 2) + ' rs';
    if (sqrtEl) sqrtEl.textContent = factor.toFixed(4);
    if (zEl)    zEl.textContent = (1 / factor - 1).toFixed(factor > 0.2 ? 3 : 1);
    if (factEl) factEl.textContent = '×' + (1 / factor).toFixed(factor > 0.1 ? 2 : 0);
    if (outside) outside.textContent = fmtDuration(1 / factor);

    pills.forEach(function (p) {
      p.classList.toggle('is-on', Math.abs(parseFloat(p.dataset.r) - r) < 1e-6);
    });
  }

  slider.addEventListener('input', refresh);
  pills.forEach(function (p) {
    p.addEventListener('click', function () {
      slider.value = p.dataset.r;
      refresh();
    });
  });
  refresh();

  // анимация стрелок: дальние часы — 1 оборот секундной за 6 с реального времени
  var last = 0;
  function tick(ts) {
    var dt = last ? Math.min((ts - last) / 1000, 0.1) : 0;
    last = ts;

    if (!document.hidden && !REDUCED) {
      var rate = 10;                      // «секунд» часов за секунду реального времени
      angFar  += dt * rate;
      angNear += dt * rate * factor;
    }
    set('far', angFar);
    set('near', angNear);
    requestAnimationFrame(tick);
  }

  function set(role, sec) {
    var hn = hands[role];
    if (!hn.s) return;
    hn.s.style.transform = 'translateX(-50%) rotate(' + (sec * 6) + 'deg)';
    hn.m.style.transform = 'translateX(-50%) rotate(' + (sec * 0.1) + 'deg)';
    hn.h.style.transform = 'translateX(-50%) rotate(' + (sec * 0.1 / 12) + 'deg)';
  }
  requestAnimationFrame(tick);
})();

/* ═══════════ 10. КАЛЬКУЛЯТОР ═══════════ */

(function lab() {
  var input = $('#mass');
  if (!input) return;

  var G = 6.67430e-11;
  var C = 299792458;
  var MSUN = 1.98892e30;
  var HBAR = 1.054571817e-34;
  var KB = 1.380649e-23;
  var YEAR = 3.15576e7;
  var HUMAN = 1.8;          // рост, м — база для приливной разности

  var els = {
    rs: $('#o-rs'), shadow: $('#o-shadow'), dens: $('#o-dens'),
    temp: $('#o-temp'), evap: $('#o-evap'), tidal: $('#o-tidal'),
    verdict: $('#o-verdict'), hint: $('#lab-hint')
  };

  var HINTS = {
    '3.7e-6': 'Если сжать Землю до чёрной дыры, она станет размером с виноградину.',
    '1': 'Солнце никогда не станет чёрной дырой — не хватит массы. Но если бы стало…',
    '10': 'Типичный остаток массивной звезды. Именно такие сливаются и звенят гравитационными волнами.',
    '4.3e6': 'Sagittarius A* — наша домашняя чёрная дыра, 26 тысяч световых лет отсюда.',
    '6.5e9': 'M87* — первая в истории сфотографированная чёрная дыра, 2019 год.',
    '6.6e10': 'TON 618 — рекордсмен. Её горизонт больше всей Солнечной системы.'
  };

  function fmtLen(m) {
    if (!isFinite(m)) return '—';
    if (m < 1e-12) return m.toExponential(2) + ' м';
    if (m < 1e-3)  return (m * 1e6).toPrecision(3) + ' мкм';
    if (m < 1)     return (m * 100).toPrecision(3) + ' см';
    if (m < 1000)  return m.toPrecision(3) + ' м';
    if (m < 1.5e11) {
      var km = m / 1000;
      if (km < 1e6) return sig(km) + ' км';
      return sig(km / 1e6) + ' млн км';
    }
    var au = m / 1.495978707e11;
    if (au < 1e4) return sig(au) + ' а.е.';
    return sig(m / 9.4607e15) + ' св. лет';
  }

  function sig(v) {
    if (v >= 1e6) return v.toExponential(2).replace('e+', '·10^');
    if (v >= 100) return Math.round(v).toLocaleString('ru-RU');
    return v.toPrecision(3);
  }

  function fmtBig(v, unit) {
    if (!isFinite(v)) return '—';
    if (v === 0) return '0 ' + unit;
    var e = Math.floor(Math.log10(Math.abs(v)));
    if (e >= -3 && e < 6) return sig(v) + ' ' + unit;
    var m = v / Math.pow(10, e);
    return m.toFixed(2) + '·10<sup>' + e + '</sup> ' + unit;
  }

  function parseMass(s) {
    s = String(s).trim().replace(/\s+/g, '').replace(',', '.');
    if (!s) return NaN;
    if (!/^[0-9.]+([eE][-+]?[0-9]+)?$/.test(s)) return NaN;
    var v = parseFloat(s);
    return (isFinite(v) && v > 0) ? v : NaN;
  }

  function compute(msun) {
    var M = msun * MSUN;
    var rs = 2 * G * M / (C * C);
    var vol = (4 / 3) * Math.PI * Math.pow(rs, 3);
    var dens = M / vol;
    var T = HBAR * Math.pow(C, 3) / (8 * Math.PI * G * M * KB);
    var tEvap = 5120 * Math.PI * G * G * Math.pow(M, 3) / (HBAR * Math.pow(C, 4));
    // приливная разность ускорений на длине тела у самого горизонта
    var tidal = 2 * G * M * HUMAN / Math.pow(rs, 3);
    return { M: M, rs: rs, dens: dens, T: T, evap: tEvap / YEAR, tidal: tidal / 9.80665 };
  }

  function verdict(d) {
    var g = d.tidal;
    if (g > 1e9)
      return 'Вас разорвёт на атомы за <b>' + fmtBig(g, 'g') +
             '</b> задолго до горизонта. Даже слово «разорвёт» здесь слишком мягкое.';
    if (g > 1e4)
      return 'Приливные силы порядка <b>' + fmtBig(g, 'g') +
             '</b>. Спагеттификация случится раньше, чем вы успеете что-либо заметить.';
    if (g > 50)
      return '<b>' + sig(g) + ' g</b> на длине тела — смертельно, но вы успеете увидеть, ' +
             'как небо сворачивается в кольцо.';
    if (g > 1)
      return 'Всего <b>' + g.toPrecision(2) + ' g</b> разницы между головой и ногами. ' +
             'Неприятно, но пересечь горизонт живым вы, скорее всего, сможете.';
    return 'Приливные силы у горизонта — <b>' + fmtBig(g, 'g') +
           '</b>. Вы пересечёте точку невозврата, вообще ничего не почувствовав. ' +
           'Это и есть самое жуткое.';
  }

  function render() {
    var msun = parseMass(input.value);
    if (isNaN(msun)) {
      input.classList.add('is-bad');
      return;
    }
    input.classList.remove('is-bad');
    var d = compute(msun);

    els.rs.textContent     = fmtLen(d.rs);
    els.shadow.textContent = fmtLen(d.rs * 2.6);
    els.dens.innerHTML     = fmtBig(d.dens, 'кг/м<sup>3</sup>');
    els.temp.innerHTML     = fmtBig(d.T, 'K');
    els.evap.innerHTML     = fmtBig(d.evap, 'лет');
    els.tidal.innerHTML    = fmtBig(d.tidal, 'g');
    els.verdict.innerHTML  = verdict(d);
  }

  input.addEventListener('input', render);

  $$('.presets .pill').forEach(function (p) {
    p.addEventListener('click', function () {
      input.value = p.dataset.mass;
      $$('.presets .pill').forEach(function (q) { q.classList.remove('is-on'); });
      p.classList.add('is-on');
      if (els.hint) els.hint.textContent = HINTS[p.dataset.mass] || '';
      render();
    });
  });

  var initial = $('.presets .pill[data-mass="4.3e6"]');
  if (initial) initial.classList.add('is-on');
  render();
})();

/* ═══════════ 11. КАРТОЧКИ ═══════════ */

$$('[data-card]').forEach(function (card) {
  card.setAttribute('aria-pressed', 'false');
  card.addEventListener('click', function () {
    var on = card.classList.toggle('is-flipped');
    card.setAttribute('aria-pressed', String(on));
  });
});

/* ═══════════ 12. ПЛАВНАЯ НАВИГАЦИЯ ═══════════ */

$$('a[href^="#"]').forEach(function (a) {
  a.addEventListener('click', function (e) {
    var id = a.getAttribute('href');
    if (id === '#' || id.length < 2) return;
    var t = document.querySelector(id);
    if (!t) return;
    e.preventDefault();
    var y = t.getBoundingClientRect().top + window.scrollY - 56;
    window.scrollTo({ top: y, behavior: REDUCED ? 'auto' : 'smooth' });
  });
});

/* если что-то пошло не так с прелоадером — не оставляем страницу запертой */
setTimeout(function () {
  var pre = $('#preloader');
  if (pre && !pre.classList.contains('is-done')) {
    pre.classList.add('is-done');
    document.body.classList.remove('is-loading');
    document.body.classList.add('is-ready');
    if (canvas) canvas.classList.add('is-ready');
    startReveals();
  }
}, 9000);

})();
