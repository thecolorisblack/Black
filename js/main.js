/* ============================================================
   SINGULARITY — интерфейсные анимации
   ============================================================ */

(function () {
  'use strict';

  /* ---------- прелоадер ---------- */
  var loader = document.getElementById('loader');
  function hideLoader() {
    if (loader) loader.classList.add('done');
  }
  if (document.readyState === 'complete') {
    setTimeout(hideLoader, 400);
  } else {
    window.addEventListener('load', function () { setTimeout(hideLoader, 400); });
    setTimeout(hideLoader, 3500); /* страховка, если load задержится */
  }

  /* ---------- навигация при скролле ---------- */
  var nav = document.getElementById('nav');
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      if (nav) nav.classList.toggle('scrolled', window.scrollY > 40);
      ticking = false;
    });
  }, { passive: true });

  /* ---------- появление секций ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('visible'); });
  }

  /* ---------- счётчики ---------- */
  function formatCounter(el, value) {
    var format = el.dataset.format || 'plain';
    if (format === 'space') {
      /* 4 300 000 — разряды через тонкие пробелы */
      return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }
    if (format === 'short') {
      /* 6,5 млрд */
      return (value / 1e9).toFixed(1).replace('.', ',') + ' млрд';
    }
    if (format === 'power') {
      /* 40×10¹⁸ */
      return Math.round(value / 1e18) + '×10¹⁸';
    }
    return Math.round(value).toString();
  }

  function animateCounter(el) {
    var target = parseFloat(el.dataset.target || '0');
    var duration = 2200;
    var startTime = null;

    function tick(now) {
      if (startTime === null) startTime = now;
      var p = Math.min((now - startTime) / duration, 1);
      var eased = 1 - Math.pow(2, -10 * p); /* easeOutExpo */
      el.textContent = formatCounter(el, target * (p === 1 ? 1 : eased));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  var counters = document.querySelectorAll('.counter');
  if ('IntersectionObserver' in window) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          cio.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    counters.forEach(function (el) { cio.observe(el); });
  } else {
    counters.forEach(function (el) {
      el.textContent = formatCounter(el, parseFloat(el.dataset.target || '0'));
    });
  }

  /* ---------- лёгкий параллакс заголовка героя ---------- */
  var heroContent = document.querySelector('.hero-content');
  if (heroContent && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.addEventListener('scroll', function () {
      var y = window.scrollY;
      if (y < window.innerHeight) {
        heroContent.style.transform =
          'translateY(calc(-4vh + ' + y * 0.28 + 'px))';
        heroContent.style.opacity = Math.max(0, 1 - y / (window.innerHeight * 0.65));
      }
    }, { passive: true });
  }
})();
